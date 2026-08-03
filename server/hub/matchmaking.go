package hub

import (
	"fmt"
	"log"
	"strings"
	"time"
	"unicode/utf8"

	"loco/server/game"
	"loco/server/protocol"
)

// Matchmaking: a 1v1 against whoever else is looking for one.
//
// The whole mode is one FIFO queue and a pairing rule, and it is deliberately
// that small. There is no rating, no bucket and no region: the day a ranked
// ladder exists it becomes a second queue next to this one, keyed on whatever
// it needs, and nothing here has to be unpicked for that. Which is also why
// nothing a player can see says "unranked": there is only "play", and a ranked
// mode would name itself.
//
// Two rules the queue obeys and the UI is built on:
//
//   - **The queue's size never reaches a client.** Not as a count, not as a
//     position, not as an estimated wait. A number that reads "1 player
//     searching" tells everybody to stop searching, which is the one thing an
//     empty queue must not do at the moment it is trying to fill. The client
//     times its own wait and says the honest thing instead: this may take a
//     while, stay here, you will be placed the moment somebody arrives.
//   - **Nobody presses start.** Two players are seated, given a couple of
//     seconds to see who they drew, and dealt in. A matchmade room has no host,
//     no lobby config and no bots: handleAddBot, handleStartGame,
//     set_match_format, set_max_players and kick_player are all refused in one.
//     There is nobody with standing to remove the stranger they drew. `rematch` is
//     not refused, it means something else there: an offer both sides have to
//     make, rather than a decision one of them takes (handleRematchOffer).

var (
	// MatchmakingRevealDelay is how long the versus screen holds before the
	// match deals itself. Long enough to read the other name and register that a
	// human is on the other side, short enough that it never feels like a menu.
	MatchmakingRevealDelay = 2500 * time.Millisecond

	// MatchmakingRevealBackstop arms a second, later attempt at the same deal.
	//
	// Losing the reveal's job is the one dropped job in the server whose cost is
	// unbounded rather than merely lossy. postCritical retries it once; if that
	// retry is dropped too, the table stays a matchmade lobby for good — which
	// means it publishes phaseInFlight for good, so checkDrained can never close
	// and every deploy from then on burns its whole LOCO_DRAIN_TIMEOUT waiting on
	// a table nobody is playing at, while the two players hold a versus screen
	// that will never deal.
	//
	// The handler was already written to be re-checked (wrong pairing, room gone,
	// somebody left), so running it a second time is free when the first one
	// landed: it finds a room that is no longer a lobby and returns. That is the
	// whole backstop.
	MatchmakingRevealBackstop = 3 * time.Second

	// MatchmakingFormat is what a matchmade match plays: one round.
	//
	// A queue is entered by somebody who wants to play now, and a single round is
	// the shortest complete thing this game has. It also keeps the commitment
	// honest: two strangers owe each other one round, not a best-of, which is the
	// commitment most likely to be abandoned halfway. Whoever wants another goes
	// straight back into the queue from the game-over screen.
	MatchmakingFormat = game.BO1

	// MatchmakingReconnectTimeout replaces ReconnectTimeout in a matchmade room.
	//
	// The 60s hold exists for a group of friends who will wait for each other.
	// Two strangers will not: a minute of staring at a frozen board is longer
	// than most of a round, and the player who is still there did nothing wrong.
	// 15s covers the disconnect people actually have (a wifi hiccup, a tab
	// reload, both come back in two or three) and ends the rest quickly.
	MatchmakingReconnectTimeout = 15 * time.Second

	// MatchmakingAFKThreshold replaces AFKKickThreshold in a matchmade room: two
	// consecutive turn timeouts instead of four. At a 30s turn clock that is one
	// minute of an opponent who has walked away, and then the match is over,
	// where the ordinary threshold would spend two minutes auto-passing for
	// somebody who is never coming back.
	MatchmakingAFKThreshold = 2
)

// queuedPlayer is one socket waiting for an opponent.
type queuedPlayer struct {
	client   *Client
	nickname string
	since    time.Time
}

// mmStartMsg is the deferred "the reveal is over, deal them in" signal.
type mmStartMsg struct {
	roomCode string
	pairedAt time.Time
}

// --- Queue ---

// queueIndex returns this client's position in the queue, or -1.
func (h *Hub) queueIndex(c *Client) int {
	for i, q := range h.queue {
		if q.client == c {
			return i
		}
	}
	return -1
}

// dequeue removes a client from the queue and reports whether it was in it.
// Called on disconnect as well as on cancel: a socket that has gone away must
// not be paired with somebody who is still there.
func (h *Hub) dequeue(c *Client) bool {
	i := h.queueIndex(c)
	if i < 0 {
		return false
	}
	h.queue = append(h.queue[:i], h.queue[i+1:]...)
	h.metrics.matchmakingQueue.Store(int32(len(h.queue)))
	return true
}

// enqueue puts a client at the back of the queue and acknowledges it.
func (h *Hub) enqueue(c *Client, nickname string) {
	h.queue = append(h.queue, queuedPlayer{client: c, nickname: nickname, since: time.Now()})
	h.metrics.matchmakingQueue.Store(int32(len(h.queue)))
	log.Printf("matchmaking queued conn=%s nickname=%s", c.connID, nickname)
	c.Send(protocol.ServerMsg{Type: protocol.SMsgMatchmakingQueued})
}

// handleFindMatch puts a player in the queue and pairs them if somebody is
// already waiting.
//
// A player who is sitting in a room they are not playing in (the game-over
// screen of the match they just finished, a lobby they created and gave up on)
// is released into the queue rather than refused. "Find another opponent" is
// one button, and making the client choreograph a leave_room before a
// find_match would put an ordering bug between them for no gain.
func (h *Hub) handleFindMatch(c *Client, msg protocol.ClientMsg) {
	// A queue this process has stopped pairing is worse than no queue: see
	// drain.go, which also empties whoever was already in it.
	if h.refuseWhileDraining(c) {
		return
	}
	nickname := validateNickname(c, msg.Nickname)
	if nickname == "" {
		return
	}
	if h.alreadySeated(c) {
		t := h.tableOf(c)
		if t == nil {
			// alreadySeated releases a client pointing at a table that is gone,
			// so this is the case where it just did.
			h.enqueueAndPair(c, nickname)
			return
		}
		// Whether the room can be left, and the leaving itself, are the table's
		// to answer; the queue is the hub's. So the two halves are ordered
		// rather than raced: the seat is given up first, and only then does the
		// player go back into the queue. Being in a room and in the queue at the
		// same time is the one state neither side could recover from.
		if !t.post(tableJob{what: "find_match_release", c: c, run: func() {
			if t.room.Status == game.StatusPlaying {
				c.sendError("already in a room")
				return
			}
			h.releaseSeat(t, c)
			h.postToRouter("enqueue", func() { h.enqueueAndPair(c, nickname) })
		}}) {
			c.sendError("server busy, please retry")
		}
		return
	}
	h.enqueueAndPair(c, nickname)
}

// enqueueAndPair is the queue half of find_match, and runs on the hub.
func (h *Hub) enqueueAndPair(c *Client, nickname string) {
	if h.queueIndex(c) >= 0 {
		c.sendError("already searching for an opponent")
		return
	}
	h.enqueue(c, nickname)
	h.tryPair()
}

// handleCancelMatchmaking takes a player back out of the queue. Acknowledged
// even when they were not in it: the answer to "stop searching" is the same
// either way, and a client whose cancel raced a pairing is about to be told
// about the match instead.
func (h *Hub) handleCancelMatchmaking(c *Client) {
	if h.dequeue(c) {
		log.Printf("matchmaking cancelled conn=%s", c.connID)
	}
	c.Send(protocol.ServerMsg{Type: protocol.SMsgMatchmakingCancelled})
}

// tryPair seats every pair the queue can make, oldest waits first.
func (h *Hub) tryPair() {
	for len(h.queue) >= 2 {
		a, b := h.queue[0], h.queue[1]
		h.queue = h.queue[2:]
		h.metrics.matchmakingQueue.Store(int32(len(h.queue)))
		h.pairMatch(a, b)
	}
}

// pairMatch creates the room, seats both players and starts the reveal.
func (h *Hub) pairMatch(a, b queuedPlayer) {
	code := h.generateCode()
	room := game.NewRoom(code)
	// Both are lobby-only settings and both are set on a room nobody else can
	// reach, so neither can fail; log rather than swallow if that ever changes.
	if err := room.SetMaxPlayers(2); err != nil {
		log.Printf("WARN matchmaking SetMaxPlayers code=%s err=%v", code, err)
	}
	if err := room.SetFormat(MatchmakingFormat); err != nil {
		log.Printf("WARN matchmaking SetFormat code=%s err=%v", code, err)
	}

	// Two strangers are perfectly free to have picked the same name, and Join
	// refuses a duplicate. In a private lobby that refusal is right, you can see
	// who is in there and pick another. Here it would fail a pairing neither
	// player did anything wrong in, so the second one is disambiguated instead.
	if err := room.Join(a.nickname); err != nil {
		log.Printf("WARN matchmaking join code=%s nickname=%s err=%v", code, a.nickname, err)
		h.failPairing(a, b)
		return
	}
	if err := room.Join(uniqueNickname(room, b.nickname)); err != nil {
		log.Printf("WARN matchmaking join code=%s nickname=%s err=%v", code, b.nickname, err)
		h.failPairing(a, b)
		return
	}

	pairedAt := time.Now()
	t := newTable(code, room)
	t.matchmadeAt = pairedAt
	h.tables[code] = t
	h.seatClient(t, a.client, 0)
	h.seatClient(t, b.client, 1)
	h.metrics.rooms.Add(1)
	h.metrics.matchesMatchmade.Add(1)

	log.Printf("matchmaking paired code=%s a=%s b=%s waited_ms=%d",
		code, room.Players[0].Nickname, room.Players[1].Nickname,
		pairedAt.Sub(a.since).Milliseconds())

	pl := h.playerList(t)
	for seat, member := range t.members {
		member.Send(protocol.ServerMsg{
			Type:         protocol.SMsgMatchFound,
			RoomCode:     code,
			PlayerID:     intPtr(seat),
			Players:      pl,
			SessionToken: t.issueToken(seat),
			MatchFormat:  matchFormatString(room.Format),
			MaxPlayers:   room.MaxPlayers,
			StartsInMs:   MatchmakingRevealDelay.Milliseconds(),
		})
	}

	h.scheduleMatchmakingStart(t, pairedAt)

	// Last, when the hub has finished filling this table in. The reveal timer
	// above posts into a box that already exists, so arming it first loses
	// nothing. See table.start.
	t.start(h)
}

// scheduleMatchmakingStart arms the end of the versus reveal. Shared by a fresh
// pairing and by a rematch between the same two, which is the same thing as far
// as everything downstream is concerned.
func (h *Hub) scheduleMatchmakingStart(t *table, pairedAt time.Time) {
	sm := mmStartMsg{roomCode: t.code, pairedAt: pairedAt}
	// Critical: dropping this leaves two players staring at a versus screen that
	// never deals. Same retry discipline as the bot move.
	time.AfterFunc(MatchmakingRevealDelay, func() {
		h.postCritical(t, "matchmaking_start", time.Second, func() {
			h.handleMatchmakingStart(t, sm)
		})
	})
	// And once more, later, in case both of those were dropped. See
	// MatchmakingRevealBackstop.
	time.AfterFunc(MatchmakingRevealDelay+MatchmakingRevealBackstop, func() {
		t.postFromTimer("matchmaking_start_backstop", func() {
			h.handleMatchmakingStart(t, sm)
		})
	})
}

// failPairing puts both players back at the front of the queue after a pairing
// that could not be built. Neither of them did anything, so neither loses their
// place: they go back in the order they were drawn in.
func (h *Hub) failPairing(a, b queuedPlayer) {
	h.queue = append([]queuedPlayer{a, b}, h.queue...)
	h.metrics.matchmakingQueue.Store(int32(len(h.queue)))
}

// handleMatchmakingStart deals the pair in once the reveal is over.
//
// Re-checked like every other deferred callback: the room may be gone, the pair
// may have been superseded by a rematched room reusing the code, and either
// player may have closed the tab during the reveal.
func (h *Hub) handleMatchmakingStart(t *table, sm mmStartMsg) {
	if !t.matchmadeAt.Equal(sm.pairedAt) {
		return
	}
	if t.room.Status != game.StatusLobby {
		return
	}
	if t.connected() < 2 {
		h.requeueSurvivor(t)
		return
	}
	h.startMatch(t)
}

// requeueSurvivor rescues the player left holding a pairing that fell apart
// during the reveal: the room is torn down and they go back to searching,
// rather than sitting in a two-seat room that can never start.
func (h *Hub) requeueSurvivor(t *table) {
	code, room := t.code, t.room
	var survivor *Client
	var nickname string
	for seat, member := range t.members {
		if member == nil {
			continue
		}
		survivor = member
		if seat < len(room.Players) {
			nickname = room.Players[seat].Nickname
		}
	}
	log.Printf("matchmaking pairing lost before start code=%s requeued=%t", code, survivor != nil)
	if survivor != nil {
		survivor.leaveSeat()
	}
	// Deleting the room and refilling the queue are both the hub's, and they
	// happen together: the survivor must not be findable at a table that is
	// being torn down. Everything this needs is captured by value, so nothing
	// below reads a table the hub is about to stop.
	h.postToRouter("requeue_survivor", func() {
		h.deleteRoom(code)
		if survivor == nil {
			return
		}
		if nickname == "" {
			survivor.Send(protocol.ServerMsg{Type: protocol.SMsgMatchmakingCancelled})
			return
		}
		h.enqueue(survivor, nickname)
		h.tryPair()
	})
}

// refuseInMatchmade answers a host-only lobby control sent in a matchmade room.
// There is no host in one: the format is fixed, the size is two, the match
// starts by itself and there are no bots to add. `rematch` is deliberately not
// among them: see handleRematchOffer.
func refuseInMatchmade(c *Client, t *table) bool {
	if !t.isMatchmade() {
		return false
	}
	c.sendError("not available in a matchmade game")
	return true
}

// reconnectHold is how long a seat is held for a player who dropped.
func reconnectHold(t *table) time.Duration {
	if t.isMatchmade() {
		return MatchmakingReconnectTimeout
	}
	return ReconnectTimeout
}

// afkThreshold is how many consecutive turn timeouts count as gone.
func afkThreshold(t *table) int {
	if t.isMatchmade() {
		return MatchmakingAFKThreshold
	}
	return AFKKickThreshold
}

// --- Rematch, by agreement ---

// A rematch is an agreement in every room, and handleRematch owns it. What is
// specific to a matchmade one is only the shape of the deal: the same two are
// paired again rather than sent back to a lobby this mode does not have.
//
// Nothing here is a countdown. An offer that is never answered costs the offerer
// nothing: the other button on that screen still finds the next opponent, and
// leaving is what retires the offer.

// startRematchedMatch deals the same two players in again.
//
// It is deliberately the *pairing* path rather than the lobby one: the pair
// already exists, so they get another `match_found` and another reveal, and
// every client screen, timer and gate downstream is the one they already went
// through. A matchmade rematch is a new match between the same two people, not a
// room returning to a lobby that this mode does not have.
func (h *Hub) startRematchedMatch(t *table) {
	code, room := t.code, t.room
	if err := room.ResetForRematch(); err != nil {
		log.Printf("WARN matchmade rematch reset failed code=%s err=%v", code, err)
		return
	}
	t.resetForNextMatch()

	pairedAt := time.Now()
	t.matchmadeAt = pairedAt
	h.metrics.matchesMatchmade.Add(1)
	log.Printf("matchmade rematch code=%s players=%d", code, len(room.Players))

	pl := h.playerList(t)
	for seat, member := range t.members {
		if member == nil {
			continue
		}
		member.Send(protocol.ServerMsg{
			Type:         protocol.SMsgMatchFound,
			RoomCode:     code,
			PlayerID:     intPtr(seat),
			Players:      pl,
			SessionToken: t.issueToken(seat),
			MatchFormat:  matchFormatString(room.Format),
			MaxPlayers:   room.MaxPlayers,
			StartsInMs:   MatchmakingRevealDelay.Milliseconds(),
		})
	}
	h.scheduleMatchmakingStart(t, pairedAt)
}

// --- Leaving ---

// releaseSeat gives up the seat this socket holds in a room that is not
// playing, without touching the socket itself. Same bookkeeping as the lobby
// branch of handleDisconnect, which is the point: a player who leaves and a
// player who drops must leave the room in the same shape.
func (h *Hub) releaseSeat(t *table, c *Client) {
	code := t.code
	nickname := ""
	if c.playerID() < len(t.room.Players) {
		nickname = t.room.Players[c.playerID()].Nickname
	}
	leavingID := c.playerID()
	if h.reindexLobbyDisconnect(c, t) {
		h.broadcastToRoomAll(t, protocol.ServerMsg{
			Type:     protocol.SMsgPlayerLeft,
			Nickname: nickname,
			Players:  h.playerList(t),
		})
	} else {
		h.scheduleRoomCleanup(t)
	}
	c.leaveSeat()
	// This seat's ask goes with it, and the ones above it move down: they are
	// keyed by playerID like everything else the re-index just shifted.
	h.releaseRematchOffer(t, leavingID)
	log.Printf("player left room code=%s nickname=%s", code, nickname)
}

// handleLeaveRoom gives up a seat on purpose. In a matchmade match in progress
// it is a forfeit, announced as one, so the other player is told the match
// ended rather than left watching a board that stopped moving.
//
// In an ordinary room mid-match it is refused: those rooms are groups of people
// who came in together, the 60s hold exists precisely so a drop is not the end,
// and the board offers no way out to send it from.
//
// Before the deal it is nobody's forfeit and every room allows it: the waiting
// room's quit button lands here, and the seat is released on the spot instead of
// being held the way a closed tab would hold it.
func (h *Hub) handleLeaveRoom(c *Client) {
	// The queue is emptied here, on the hub, and the seat at the table: a
	// player who leaves is neither searching nor seated, and the two halves
	// belong to different owners.
	h.dequeue(c)
	if !h.alreadySeated(c) {
		c.Send(protocol.ServerMsg{Type: protocol.SMsgLeftRoom})
		return
	}
	t := h.tableOf(c)
	if t == nil {
		c.Send(protocol.ServerMsg{Type: protocol.SMsgLeftRoom})
		return
	}
	if !t.post(tableJob{what: string(protocol.CMsgLeaveRoom), c: c, run: func() {
		h.leaveAtTable(t, c)
	}}) {
		c.sendError("server busy, please retry")
	}
}

func (h *Hub) leaveAtTable(t *table, c *Client) {
	if c.roomCode() != t.code {
		c.Send(protocol.ServerMsg{Type: protocol.SMsgLeftRoom})
		return
	}
	if t.room.Status == game.StatusPlaying {
		switch {
		case t.isMatchmade():
			h.forfeitMatch(t, c.playerID())
		case t.abandonedBy(c.playerID()):
			// Nobody left to walk out on, so there is nothing to refuse. No
			// forfeit either: there is no one to award the match to, and
			// remainingSeat would hand it to the player who is not there. The
			// seat goes and the table goes with it.
			log.Printf("leave allowed, match abandoned code=%s player=%d", t.code, c.playerID())
			t.sweep(c)
			c.leaveSeat()
			h.closeAbandonedMatch(t)
			c.Send(protocol.ServerMsg{Type: protocol.SMsgLeftRoom})
			return
		default:
			c.sendError("you cannot leave a match in progress")
			return
		}
	}
	h.releaseSeat(t, c)
	c.Send(protocol.ServerMsg{Type: protocol.SMsgLeftRoom})
}

// forfeitMatch ends a match because one seat stopped being there, and hands it
// to whoever is still at the table.
//
// Every per-match timer keyed on the room is dropped here, not left to fire
// into a finished match: a turn timeout that lands afterwards would auto-draw
// for a seat in a room that is over.
func (h *Hub) forfeitMatch(t *table, awaySeat int) {
	code, room := t.code, t.room
	winner := t.remainingSeat(awaySeat)
	if winner < 0 {
		// Nobody is left to award it to. The empty-room cleanup owns this case.
		return
	}
	if err := room.ForfeitTo(winner); err != nil {
		log.Printf("WARN forfeit failed code=%s away=%d err=%v", code, awaySeat, err)
		return
	}
	t.turnStartedAt = time.Time{}
	t.loading = nil
	t.afk = make(map[int]int)
	h.metrics.matchesFinished.Add(1)
	log.Printf("match forfeited code=%s away=%d winner=%s", code, awaySeat, room.MatchWinner)

	h.broadcastToRoomAll(t, protocol.ServerMsg{
		Type:        protocol.SMsgMatchEnd,
		MatchWinner: room.MatchWinner,
		Scoreboard:  h.buildScoreboard(room),
		Forfeit:     true,
		PlayerIndex: intPtr(awaySeat),
	})
}

// remainingSeat picks the seat a forfeited match goes to: a connected human
// first, and failing that any seat that is not the one that left. The fallback
// matters for the AFK path, where the away player's socket is still open.
func (t *table) remainingSeat(awaySeat int) int {
	room := t.room
	for seat, member := range t.members {
		if seat == awaySeat || member == nil || seat >= len(room.Players) {
			continue
		}
		return seat
	}
	for seat := range room.Players {
		if seat != awaySeat {
			return seat
		}
	}
	return -1
}

// forfeitDeadlineMs is the unix-millisecond instant an absent seat's match is
// given away, or 0 when the room does not work that way. Rides
// player_disconnected so the player still at the table gets a number instead of
// an open-ended "opponent disconnected".
func forfeitDeadlineMs(t *table, disconnectedAt time.Time) int64 {
	if !t.isMatchmade() {
		return 0
	}
	return disconnectedAt.Add(MatchmakingReconnectTimeout).UnixMilli()
}

// uniqueNickname returns want, or the first "want (n)" nobody in the room has
// taken. The base is trimmed first so the result cannot outgrow what a seat
// label is built to hold: the display is the constraint here, not the
// protocol.
func uniqueNickname(room *game.Room, want string) string {
	taken := func(n string) bool {
		for _, p := range room.Players {
			if p.Nickname == n {
				return true
			}
		}
		return false
	}
	if !taken(want) {
		return want
	}
	base := trimRunes(want, 16)
	for n := 2; n < 100; n++ {
		candidate := fmt.Sprintf("%s (%d)", base, n)
		if !taken(candidate) {
			return candidate
		}
	}
	return fmt.Sprintf("%s (%d)", base, time.Now().UnixNano()%1000)
}

// trimRunes cuts a string to at most n runes, never mid-character.
func trimRunes(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	var b strings.Builder
	count := 0
	for _, r := range s {
		if count == n {
			break
		}
		b.WriteRune(r)
		count++
	}
	return strings.TrimSpace(b.String())
}
