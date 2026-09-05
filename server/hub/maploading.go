package hub

import (
	"log"
	"sort"
	"time"

	"loco/server/game"
	"loco/server/protocol"
)

// Synchronised map loading: the moment between "the hands are dealt" and "the
// clock is running".
//
// A map is a megabyte of backdrop and table that the browser has to fetch and
// decode. Dealt straight into a match, the first player's turn timer starts
// ticking while their table is still a grey rectangle, and in a game decided by
// arrival order that is not a cosmetic problem: whoever downloaded fastest gets
// the first interrupt window to themselves.
//
// So the table waits. Every client answers game_started by preloading the map
// and sending map_ready; the server holds the turn timer and the bots until the
// last human is in, then releases everybody at once with match_ready. Until
// then every gameplay message is refused. A client that skips its own loading
// screen must not get a head start on the ones that did not.
//
// The gate is per *match*, not per round: round two runs on the same map, which
// is already decoded, and a second pause there would be a stall with no cause a
// player could see.

// MapLoadTimeout bounds the wait. One client that never answers (a tab thrown
// into the background, a proxy eating the message) must not hold nine other
// people on a loading screen forever, so the table starts without it and that
// player catches up whenever their assets land.
//
// Exported so tests can shorten it; production never changes it.
var MapLoadTimeout = 20 * time.Second

// mapLoadState tracks one table's gate. A non-nil table.loading is what "this
// table is still shut" means; it is cleared the instant the table opens.
type mapLoadState struct {
	// ready is the set of seats that have answered map_ready. Bot seats are put
	// in at the start: they render nothing and have nothing to download.
	ready map[int]bool
	// startedAt stamps the gate so a timeout that fires late (the table opened
	// on its own, a rematch started a second gate) can tell it is stale. Same
	// re-check discipline as every other scheduled callback in the hub.
	startedAt time.Time
}

// isGameplayMsg reports whether a message would move the game on. Exactly the
// set that carries a rules decision. Lobby traffic, the loading answer itself
// and the dev-only state injector are all still accepted while the gate is
// open, since none of them can win a race.
func isGameplayMsg(t protocol.ClientMsgType) bool {
	switch t {
	case protocol.CMsgPlayCard,
		protocol.CMsgDrawCard,
		protocol.CMsgPassTurn,
		protocol.CMsgDeclareUno,
		protocol.CMsgCatchUno,
		protocol.CMsgCounterDraw,
		protocol.CMsgInterruptPlay,
		protocol.CMsgInterruptPlayCard:
		return true
	}
	return false
}

// mapLoadTimeoutMsg is the deferred "start without the stragglers" signal.
type mapLoadTimeoutMsg struct {
	roomCode  string
	startedAt time.Time
}

// beginMapLoading opens the gate for a freshly started match. The caller must
// already have broadcast game_started: the client cannot preload a map it has
// not been told the name of.
func (h *Hub) beginMapLoading(t *table) {
	code, room := t.code, t.room
	st := &mapLoadState{ready: make(map[int]bool), startedAt: time.Now()}
	for playerID := range t.bots {
		st.ready[playerID] = true
	}
	t.loading = st

	log.Printf("map loading code=%s map=%s waiting=%d", code, room.MapID, len(t.pendingLoaders()))

	h.broadcastLoadingProgress(t)
	msg := mapLoadTimeoutMsg{roomCode: code, startedAt: st.startedAt}
	// Non-critical, and deliberately not retried: the only cost of losing this is
	// that the table waits for the last client instead of for the deadline, and
	// every client that is actually alive still answers.
	time.AfterFunc(MapLoadTimeout, func() {
		t.postFromTimer("map_load_timeout", func() { h.handleMapLoadTimeout(t, msg) })
	})

	// A table of one human and three bots is ready the moment it is dealt.
	h.maybeOpenTable(t)
}

// pendingLoaders returns the connected human seats the table is still waiting
// on. A seat with no socket behind it is mid-disconnect and cannot answer, so
// it never blocks: its reconnect is handled by the ordinary snapshot path.
func (t *table) pendingLoaders() []int {
	if t.loading == nil {
		return nil
	}
	var pending []int
	for playerID, member := range t.members {
		if member == nil || t.loading.ready[playerID] {
			continue
		}
		pending = append(pending, playerID)
	}
	return pending
}

// readySeats returns the seats that have answered, in seat order so the loading
// screen's list never reshuffles between two updates.
func (t *table) readySeats() []int {
	if t.loading == nil {
		return nil
	}
	seats := make([]int, 0, len(t.loading.ready))
	for playerID := range t.loading.ready {
		seats = append(seats, playerID)
	}
	sort.Ints(seats)
	return seats
}

// broadcastLoadingProgress tells the room who is in. Sent on every arrival:
// watching the other names light up is the whole content of the screen, and it
// is also how a player knows the wait is somebody else's connection, not theirs.
func (h *Hub) broadcastLoadingProgress(t *table) {
	h.broadcastToRoomAll(t, protocol.ServerMsg{
		Type:         protocol.SMsgMatchLoading,
		PlayersReady: t.readySeats(),
	})
}

// handleMapReady records one client's arrival.
func (h *Hub) handleMapReady(t *table, c *Client) {
	if t.loading == nil {
		// The table already opened: a duplicate answer, or one that lost the race
		// with the timeout. Neither is an error and neither is worth a rejection:
		// the client is telling us something we no longer need. The other half of
		// that case, a client with no table at all, is answered in dispatch.
		return
	}
	if t.loading.ready[c.playerID()] {
		return
	}
	t.loading.ready[c.playerID()] = true

	h.broadcastLoadingProgress(t)
	h.maybeOpenTable(t)
}

// maybeOpenTable releases the table once nobody is left to wait for. Called on
// every arrival and on every disconnect, since a player who leaves during the gate
// stops being someone the table is waiting on.
func (h *Hub) maybeOpenTable(t *table) {
	if t.loading == nil || len(t.pendingLoaders()) > 0 {
		return
	}
	h.openTable(t, "all_ready")
}

// openTable starts the match for real: the turn clock is armed here, and this is
// the first moment any gameplay message is accepted.
func (h *Hub) openTable(t *table, reason string) {
	st := t.loading
	if st == nil {
		return
	}
	t.loading = nil

	code, room := t.code, t.room
	if room.Status != game.StatusPlaying {
		// The match ended or the room went back to the lobby while the gate was
		// open (everyone but one player left). Nothing to open.
		return
	}

	log.Printf("table opened code=%s map=%s reason=%s waited=%dms",
		code, room.MapID, reason, time.Since(st.startedAt).Milliseconds())

	// The match is timed from here, not from the deal: the wait behind the gate
	// was nobody's game. Once per match — a rematch resets it and opens again.
	t.matchStartedAt = time.Now()

	// Order matters: the deadline broadcast below reads what this arms.
	h.scheduleTurnTimer(t)
	h.broadcastToRoomAll(t, protocol.ServerMsg{
		Type:         protocol.SMsgMatchReady,
		Turn:         room.State.CurrentTurn,
		TurnDeadline: turnDeadlineMs(t),
	})
	h.maybeScheduleBot(t)
}

// handleMapLoadTimeout starts the match without whoever has not answered.
//
// Re-checked like every other deferred callback: the room may be gone, the gate
// may have opened on its own, and a rematch may have opened a second gate whose
// clock this timer knows nothing about.
func (h *Hub) handleMapLoadTimeout(t *table, msg mapLoadTimeoutMsg) {
	if t.loading == nil {
		return // table already open
	}
	if !t.loading.startedAt.Equal(msg.startedAt) {
		return // this timer belongs to a previous gate
	}
	log.Printf("WARN map load timeout code=%s waiting_on=%v", msg.roomCode, t.pendingLoaders())
	h.openTable(t, "timeout")
}
