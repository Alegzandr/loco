// The turn clock, what it does when it runs out, and the consecutive timeouts
// that make a seat away.
package hub

import (
	"log"
	"time"

	"loco/server/game"
	"loco/server/protocol"
)

// scheduleTurnTimer records the current turn start time and schedules an auto-action
// if the player (human only) does not act within TurnTimeout.
func (h *Hub) scheduleTurnTimer(t *table) {
	code, room := t.code, t.room
	if room.Status != game.StatusPlaying {
		return
	}
	turn := room.State.CurrentTurn
	// Bots handle their own timing; don't schedule a timeout for them.
	if t.isBot(turn) {
		// Drop the previous turn's start time on the way out. turnDeadlineMs
		// reads this with no notion of whose turn it is, so leaving the human's
		// stamp behind made every card_played that hands the turn to a bot carry
		// a deadline that had already half expired: the client mounts its
		// countdown bar on any non-null deadline, so it drained the rest of
		// somebody else's clock under a seat that has no clock. Zero really is
		// an absence: turn_deadline is omitempty, so the field never reaches the
		// client and the bar stays down.
		t.turnStartedAt = time.Time{}
		return
	}
	now := time.Now()
	t.turnStartedAt = now
	tm := turnTimerMsg{roomCode: code, playerID: turn, turnStartedAt: now}
	time.AfterFunc(TurnTimeout, func() {
		select {
		case h.turnTimeout <- tm:
		default:
			// Non-critical: if dropped the player just gets a free extra turn.
			log.Printf("turnTimeout channel full, dropping for code=%s player=%d", code, turn)
		}
	})
}

// resetAFK clears the consecutive-timeout counter for a player after any
// voluntary action. Called from the dispatch switch.
func (h *Hub) resetAFK(c *Client) {
	if t := h.tableOf(c); t != nil {
		delete(t.afk, c.playerID)
	}
}

// handleTurnTimeout fires when a human player's turn clock runs out.
// It auto-draws (if not yet drawn) then auto-passes.
func (h *Hub) handleTurnTimeout(tm turnTimerMsg) {
	t, ok := h.turnTimeoutTarget(tm)
	if !ok {
		return
	}
	code, room := t.code, t.room

	log.Printf("turn timeout code=%s player=%d auto-acting", code, tm.playerID)

	if h.kickIfAFK(t, tm.playerID, t.client(tm.playerID)) {
		return
	}

	if !h.autoDrawOnTimeout(t, tm.playerID) {
		return
	}

	if err := room.PassTurn(tm.playerID); err != nil {
		log.Printf("turn timeout pass error code=%s player=%d err=%v", code, tm.playerID, err)
		return
	}
	// Re-arm before reading the deadline, not after. Read first, this broadcast
	// carried the deadline of the turn that had *just expired*: every client
	// applied a timestamp already in the past, useDrainBar found nothing left to
	// drain and took the countdown bar down for the whole of the next player's
	// turn — until some unrelated message happened to carry a live one.
	h.scheduleTurnTimer(t)
	h.broadcastToRoomAll(t, protocol.ServerMsg{
		Type:         protocol.SMsgTurnChanged,
		Turn:         room.State.CurrentTurn,
		TurnDeadline: turnDeadlineMs(t),
	})
	h.maybeScheduleBot(t)
}

// turnTimeoutTarget validates that the timer message still applies: the room
// exists and is playing, the current turn matches, and the recorded turn-start
// timestamp is the same one the timer was armed against (not a stale callback).
func (h *Hub) turnTimeoutTarget(tm turnTimerMsg) (*table, bool) {
	t, ok := h.tables[tm.roomCode]
	if !ok || t.room.Status != game.StatusPlaying {
		return nil, false
	}
	if t.room.State.CurrentTurn != tm.playerID {
		return nil, false
	}
	if !t.turnStartedAt.Equal(tm.turnStartedAt) {
		return nil, false
	}
	return t, true
}

// kickIfAFK bumps the AFK counter for human players and acts once the threshold
// is reached. Bots are exempt: their timeouts are driven by the scheduler, not
// player inactivity. Returns true when the player was dealt with and the caller
// must not go on to auto-act for them.
//
// In a matchmade room the threshold is lower and the outcome is different: the
// match is forfeited on the spot rather than the socket being closed. Closing it
// would only start a second wait (the reconnect hold) for a player who has
// already proved they are not there, and the opponent has now sat through both.
func (h *Hub) kickIfAFK(t *table, playerID int, client *Client) bool {
	code := t.code
	if t.isBot(playerID) {
		return false
	}
	t.afk[playerID]++
	if t.afk[playerID] < afkThreshold(t) {
		return false
	}
	if t.isMatchmade() {
		if t.room.Status != game.StatusPlaying {
			return false
		}
		log.Printf("AFK forfeit code=%s player=%d threshold=%d", code, playerID, afkThreshold(t))
		if client != nil {
			client.Send(protocol.ServerMsg{Type: protocol.SMsgError, Error: "afk_forfeit"})
		}
		h.forfeitMatch(t, playerID)
		return true
	}
	if client == nil {
		return false
	}
	log.Printf("AFK kick code=%s player=%d threshold=%d", code, playerID, AFKKickThreshold)
	client.Send(protocol.ServerMsg{Type: protocol.SMsgError, Error: "afk_kicked"})
	client.conn.Close()
	return true
}

// autoDrawOnTimeout draws for a player who hasn't drawn yet this turn, and
// reports whether the caller may go on to pass the turn for them.
//
// There is only one way out of here: a forced draw does not cost the turn
// (rules.md §14.5), so the seat still owes the table a play or a pass. The
// branch that used to handle a draw advancing the turn was unreachable from the
// day that deviation landed.
func (h *Hub) autoDrawOnTimeout(t *table, playerID int) bool {
	room := t.room
	if room.State.HasDrawn {
		return true
	}
	priorSize := len(room.State.Hands[playerID].Cards)
	if err := room.DrawCard(playerID); err != nil {
		log.Printf("turn timeout draw error code=%s player=%d err=%v", t.code, playerID, err)
		return false
	}
	h.sendHandGrowth(t, playerID, room.State.Hands[playerID].Cards[priorSize:])
	return true
}

// turnDeadlineMs returns the unix-millisecond deadline for the current turn,
// or 0 when no turn is being timed (a bot's, or a table that has not opened).
func turnDeadlineMs(t *table) int64 {
	if t.turnStartedAt.IsZero() {
		return 0
	}
	return t.turnStartedAt.Add(TurnTimeout).UnixMilli()
}
