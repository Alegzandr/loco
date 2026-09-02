// Sending. Every path that grows a hand goes through sendHandGrowth, and every
// personalised send indexes by slot rather than by the client's own playerID.
package hub

import (
	"encoding/json"
	"log"
	"time"

	"loco/server/game"
	"loco/server/protocol"
)

// sendHandGrowth tells the affected player exactly WHICH cards just entered
// their hand, and everyone else only how many. Every path that grows a hand
// must go through here: a client that is told a count but not the cards keeps
// a hand shorter than the server's, empties it, and the round then never ends
// (the server still holds cards for a player whose screen shows none).
//
// Callers must have (re)armed the turn timer first — the deadline is read here.
func (h *Hub) sendHandGrowth(t *table, playerID int, newCards []game.Card) {
	room := t.room
	if len(newCards) == 0 {
		return
	}
	state := room.State
	dl := turnDeadlineMs(t)
	client := t.client(playerID)
	if client != nil {
		client.Send(protocol.ServerMsg{
			Type:         protocol.SMsgCardDrawn,
			PlayerIndex:  intPtr(playerID),
			Cards:        cardDTOs(newCards),
			Turn:         state.CurrentTurn,
			PendingDraw:  intPtr(state.PendingDraw),
			HasDrawn:     boolPtr(state.HasDrawn),
			TurnDeadline: dl,
		})
	}
	// client == nil (bot seat, or a player mid-reconnect) still needs the count fan-out.
	h.broadcastToRoom(t, protocol.ServerMsg{
		Type:         protocol.SMsgCardDrawn,
		PlayerIndex:  intPtr(playerID),
		DrawnCount:   len(newCards),
		Turn:         state.CurrentTurn,
		PendingDraw:  intPtr(state.PendingDraw),
		HasDrawn:     boolPtr(state.HasDrawn),
		TurnDeadline: dl,
	}, client)
}

// refuseAction answers a rejected gameplay message with the reason and the
// metric, plus a fresh personalised snapshot when the refusal can only mean the
// client was acting on a board the server no longer has.
//
// Without that snapshot a client whose state has drifted has no way back. It
// keeps offering the action its own copy says is legal, the player keeps taking
// it, and every attempt comes back refused: the loop only ends when some other
// broadcast happens to carry the field that was wrong. That is the shape of the
// bug this was written for, an off-colour Swap that opened its target prompt
// over and over and answered "illegal card play" every time.
//
// It is deliberately narrow (game.IsStateMismatch, never a lost race): a
// personalised game_state is the most expensive message this server sends, and
// interrupts are refused by design all match long.
// resyncPeriod is the shortest gap between two corrections to one socket.
//
// A snapshot answers a client whose board has drifted, and one is enough: the
// drift is corrected by the first, and everything the client sends in the
// millisecond after it was composed against the old board. Without a floor, a
// client offering the same stale card at the rate limit pulled the most
// expensive message this server sends ten times a second — the amplification
// the rate-limit notice already had to be given the same treatment for.
const resyncPeriod = time.Second

func (h *Hub) refuseAction(c *Client, t *table, err error) {
	c.sendError(err.Error())
	c.noteRejection(err)
	if !game.IsStateMismatch(err) {
		return
	}
	now := time.Now()
	if now.Sub(c.lastResyncAt) < resyncPeriod {
		return
	}
	c.lastResyncAt = now
	log.Printf("state resync conn=%s code=%s player=%d reason=%v", c.connID, c.roomCode(), c.playerID(), err)
	c.Send(protocol.ServerMsg{
		Type:  protocol.SMsgGameState,
		State: h.playerGameStateUsing(t, c.playerID(), h.playerList(t)),
	})
}

// broadcastPersonalizedGameState sends each connected player their personalized game state.
// Used after Swap and GlobalSwitch when all hands change simultaneously.
// broadcastPersonalizedGameState sends every member the board as only they may
// see it.
//
// The seat comes from the slot index, never from member.playerID. The two agree
// for a correctly seated client, and hub.alreadySeated is what keeps them
// agreeing, but this is the call that hands out a hand, so it reads the
// authority (where the room filed this client) rather than the claim (what the
// client's own record says it is). The same rule applies to every personalised
// send below.
func (h *Hub) broadcastPersonalizedGameState(t *table) {
	pl := h.playerList(t)
	shared := h.sharedGameState(t)
	for seat, member := range t.members {
		if member == nil {
			continue
		}
		member.Send(protocol.ServerMsg{
			Type:  protocol.SMsgGameState,
			State: h.playerGameStateWith(t, seat, pl, shared),
		})
	}
}

// broadcastToRoom marshals msg once and fans the same []byte out to every
// member in the room except `exclude`. This avoids re-marshaling identical
// payloads N times for an N-player room — a significant CPU win on hot paths
// like card_played, round_end, turn_changed.
func (h *Hub) broadcastToRoom(t *table, msg protocol.ServerMsg, exclude *Client) {
	members := t.members
	if len(members) == 0 {
		return
	}
	data, err := json.Marshal(msg)
	if err != nil {
		log.Printf("broadcast marshal error code=%s err=%v", t.code, err)
		return
	}
	for _, c := range members {
		if c != nil && c != exclude {
			c.SendBytes(data)
		}
	}
}

func (h *Hub) broadcastToRoomAll(t *table, msg protocol.ServerMsg) {
	h.broadcastToRoom(t, msg, nil)
}

// broadcastCardPlayed sends a card_played event for the top discard card to all room members.
// It also includes the updated player list so clients learn about finish/placement changes.
// If the round is not over, it schedules (or resets) the per-turn timer for the next player.
// chosenPlayer is the swap target index (>= 0) when the played card was a Swap; pass -1 otherwise.
func (h *Hub) broadcastCardPlayed(t *table, playerID int, chosenPlayer int) {
	room := t.room
	if !room.RoundEnded {
		h.scheduleTurnTimer(t)
	}
	state := room.State
	top := state.Discard[len(state.Discard)-1]
	msg := protocol.ServerMsg{
		Type:         protocol.SMsgCardPlayed,
		PlayerIndex:  intPtr(playerID),
		Card:         cardToDTO(top),
		ActiveColor:  colorName(state.ActiveColor),
		Turn:         state.CurrentTurn,
		Direction:    state.Direction,
		PendingDraw:  intPtr(state.PendingDraw),
		HasDrawn:     boolPtr(state.HasDrawn),
		Players:      h.playerList(t),
		TurnDeadline: turnDeadlineMs(t),
		CatchSeats:   catchSeats(state),
	}
	if top.Kind == game.Swap && chosenPlayer >= 0 {
		cp := chosenPlayer
		msg.ChosenPlayer = &cp
	}
	h.broadcastToRoomAll(t, msg)
}

// catchSeats is who owes the table a declaration right now, and until when.
//
// It rides card_played because that is the message that opens a window, and it
// is the whole of what a client needs: no client works out who is on the hook
// any more, so the rule that a Swap or a GlobalSwitch puts *every* seat left on
// one card on it lives here and nowhere else.
func catchSeats(state *game.GameState) []protocol.CatchSeatDTO {
	now := time.Now()
	targets := state.CatchableTargets(now)
	if len(targets) == 0 {
		return nil
	}
	out := make([]protocol.CatchSeatDTO, 0, len(targets))
	for _, seat := range targets {
		out = append(out, protocol.CatchSeatDTO{
			PlayerIndex: seat,
			EndsAt:      state.CatchWindowEnd(seat).UnixMilli(),
		})
	}
	return out
}

// LatencyBroadcastPeriod is how often a playing room is told every seat's ping.
// One small message per member: slow enough to disappear next to gameplay
// traffic, fast enough that a score table opened on TAB is never showing a
// number from a previous minute. Exported so tests can shorten it.
var LatencyBroadcastPeriod = 3 * time.Second

// broadcastLatencies asks every table for its round trips. The ticker is the
// hub's, and reading h.tables from it is safe; what each table then sends is
// decided on that table's own goroutine, because the roster and the seats are
// its own. The RTT itself comes from an atomic written by the connection pumps.
func (h *Hub) broadcastLatencies() {
	for _, t := range h.tables {
		t.postFromTimer("latency", func() { h.sendLatencies(t) })
	}
}

// sendLatencies fans one table's per-seat round trips out, if it is actually
// playing: the score table is an in-game overlay, and a lobby has nothing to
// put the numbers next to.
func (h *Hub) sendLatencies(t *table) {
	room := t.room
	if room.Status != game.StatusPlaying {
		return
	}
	members := t.members
	entries := make([]protocol.LatencyEntryDTO, len(room.Players))
	measured := false
	for i := range room.Players {
		entry := protocol.LatencyEntryDTO{PlayerIndex: i, RTTMs: -1}
		if t.isBot(i) {
			entry.Bot = true
		} else if i < len(members) && members[i] != nil {
			entry.RTTMs = members[i].latency()
			measured = measured || entry.RTTMs >= 0
		}
		entries[i] = entry
	}
	// Nothing has answered a ping yet (the first seconds of a round, or a table
	// of bots): a payload of "unknown" tells the client exactly what its own
	// default already says.
	if !measured {
		return
	}
	h.broadcastToRoomAll(t, protocol.ServerMsg{
		Type:      protocol.SMsgLatency,
		Latencies: entries,
	})
}
