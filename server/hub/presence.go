// Leaving and coming back: what a disconnect costs at a table that has dealt
// and at one that has not, the 60s the slot is held for, and the reclaim.
package hub

import (
	"log"
	"time"

	"loco/server/game"
	"loco/server/protocol"
)

// handleDisconnect runs on the hub, because the queue and the map of tables are
// the hub's. Everything a departure does to the room it happened in is the
// table's, and is handed to it: critically, because losing it would leave a seat
// occupied by a socket that no longer exists.
func (h *Hub) handleDisconnect(c *Client) {
	// A socket that has gone away must not be paired with somebody who is still
	// there, so the queue is the first thing it leaves.
	h.dequeue(c)
	code := c.roomCode()
	if code == "" {
		log.Printf("player disconnected conn=%s addr=%s (no room)", c.connID, c.netPrefix())
		return
	}
	t, ok := h.tables[code]
	if !ok {
		return
	}
	h.postCritical(t, "disconnect", time.Second, func() { h.disconnectAtTable(t, c) })
}

func (h *Hub) disconnectAtTable(t *table, c *Client) {
	// The socket may have been seated elsewhere, or already released, between
	// the unregister and now. See dispatchAtTable for why this is checked
	// against the table rather than trusted.
	if c.roomCode() != t.code {
		return
	}
	room := t.room
	nickname := ""
	if c.playerID() < len(room.Players) {
		nickname = room.Players[c.playerID()].Nickname
	}

	log.Printf("player disconnected code=%s nickname=%s playerID=%d", t.code, nickname, c.playerID())

	// During an active game the seat is held rather than removed: the player has
	// the reconnect window to come back into it.
	if room.Status == game.StatusPlaying {
		disconnectTime := time.Now()
		t.hold(c.playerID(), disconnectTime)

		// The forfeit deadline rides this message in a matchmade room: the player
		// still at the table is owed a number rather than an open-ended notice,
		// and 15s of "they might come back" is short enough to sit through only
		// because it is visibly counting down.
		h.broadcastToRoomAll(t, protocol.ServerMsg{
			Type:            protocol.SMsgPlayerDisconnected,
			PlayerIndex:     intPtr(c.playerID()),
			Nickname:        nickname,
			Players:         h.playerList(t),
			ForfeitDeadline: forfeitDeadlineMs(t, disconnectTime),
		})

		// A seat that left during the loading gate is no longer a seat the table
		// is waiting on. Without this the room sits on the loading screen until
		// MapLoadTimeout for a player who is provably gone.
		if t.isLoading() {
			h.broadcastLoadingProgress(t)
			h.maybeOpenTable(t)
		}

		h.scheduleReconnectExpiry(t, c.playerID(), disconnectTime)

		// If all slots are now empty, start the room cleanup timer.
		if t.allSeatsEmpty() {
			h.scheduleRoomCleanup(t)
		}
		return
	}

	// A finished ordinary table holds the seat too. The match is over; the
	// rematch is not. A socket that dropped on the game-over screen used to lose
	// its seat outright, so the player whose wifi hiccuped between the last card
	// and the rematch button was answered "not in a room" by the one control
	// that screen has. The seat is held for the same window a match seat gets,
	// the ask it may already have made is retired while it is away — nobody
	// waits on a seat that is not there — and the expiry below removes it for
	// good, roster and all.
	//
	// Matchmade tables are deliberately excluded. Two strangers are done with
	// each other, the survivor's client goes back to the queue the moment the
	// roster says it is alone, and holding a seat would make it wait out the
	// hold first for a rematch that is refused anyway (handleRematch).
	if room.Status == game.StatusFinished && !t.isMatchmade() {
		disconnectTime := time.Now()
		t.hold(c.playerID(), disconnectTime)
		h.broadcastToRoomAll(t, protocol.ServerMsg{
			Type:        protocol.SMsgPlayerDisconnected,
			PlayerIndex: intPtr(c.playerID()),
			Nickname:    nickname,
			Players:     h.playerList(t),
		})
		h.scheduleReconnectExpiry(t, c.playerID(), disconnectTime)
		if t.allSeatsEmpty() {
			h.scheduleRoomCleanup(t)
		}
		// Last, because it can deal: whoever is left may already have asked, and
		// this seat leaving the quorum is what answers the table's question. The
		// deal prunes the held seat and resets the table, so everything above has
		// to have happened against the state it was written for.
		h.retireRematchOffer(t, c.playerID())
		return
	}

	// The versus reveal. A matchmade table is a lobby for the two and a half
	// seconds between the pairing and the deal, and the client keeps its seat
	// across a reload there (`matchfound` persists as a game, and the rejoin
	// reclaims with the token). Treated as a lobby departure, the reload took
	// the seat out of the roster and every column it had in the recap, and the
	// reclaim came back as a fresh Join under a fresh seat — a rematch's recap
	// then had no columns at all. Held instead, exactly like a match seat: the
	// reveal deals with a held seat counted present (handleMatchmakingStart),
	// and the same 15 s clock a matchmade match runs on decides whether the
	// pairing survives. Nothing here is a departure until that clock says so.
	if room.Status == game.StatusLobby && t.isMatchmade() {
		disconnectTime := time.Now()
		t.hold(c.playerID(), disconnectTime)
		h.broadcastToRoomAll(t, protocol.ServerMsg{
			Type:            protocol.SMsgPlayerDisconnected,
			PlayerIndex:     intPtr(c.playerID()),
			Nickname:        nickname,
			Players:         h.playerList(t),
			ForfeitDeadline: forfeitDeadlineMs(t, disconnectTime),
		})
		h.scheduleReconnectExpiry(t, c.playerID(), disconnectTime)
		if t.allSeatsEmpty() {
			h.scheduleRoomCleanup(t)
		}
		return
	}

	// Lobby, or a matchmade table that is over: treat it exactly like a lobby.
	// The room can be reopened by a rematch, so the roster and every
	// playerID-keyed structure must stay consistent — leaving a phantom player
	// here would deal a hand to nobody in the next match.
	leavingID := c.playerID()
	finished := room.Status == game.StatusFinished

	// Lobby: remove the player from room.Players and re-index everything keyed
	// on playerID. Without this, a disconnected host (playerID 0) leaves a
	// phantom slot and no surviving player can ever start the game.
	if !h.reindexLobbyDisconnect(c, t) {
		// Only bots (or nothing) remain — no human can start the game.
		h.scheduleRoomCleanup(t)
		return
	}
	h.broadcastToRoomAll(t, protocol.ServerMsg{
		Type:     protocol.SMsgPlayerLeft,
		Nickname: nickname,
		Players:  h.playerList(t),
		// Re-based with the roster, for the same reason releaseSeat sends it.
		MatchHistory: matchHistoryDTO(t),
	})
	if finished {
		// Whoever is left may have been waiting on exactly this player.
		h.releaseRematchOffer(t, leavingID)
	}
}

// scheduleReconnectExpiry arms the close of a held seat's reconnect window.
//
// time.AfterFunc rather than a goroutine per absent seat. If the expire channel
// is full the send is retried once after 5s: dropping it permanently would
// leave the seat in table.awayAt forever, held for a player who is not coming
// back and reclaimable by nobody else.
//
// Shared with the snapshot restore, which arms exactly this window on every
// seat of a match carried across a restart.
func (h *Hub) scheduleReconnectExpiry(t *table, playerID int, at time.Time) {
	em := expireMsg{roomCode: t.code, playerID: playerID, disconnectedAt: at}
	time.AfterFunc(reconnectHold(t), func() {
		h.postCritical(t, "reconnect_expiry", 5*time.Second, func() {
			h.handleExpireReconnect(t, em)
		})
	})
}

// reindexLobbyDisconnect removes the leaving client from a lobby table and
// re-bases every seat above it. Returns true when at least one human remains.
func (h *Hub) reindexLobbyDisconnect(c *Client, t *table) (hasHuman bool) {
	leavingID := c.playerID()
	if _, err := t.room.RemoveLobbyPlayer(leavingID); err != nil {
		log.Printf("WARN RemoveLobbyPlayer failed code=%s player=%d err=%v", t.code, leavingID, err)
	}
	hasHuman = t.dropClient(c, leavingID)
	// The host's departure re-bases the seats above it, and the seat that moves
	// into 0 is whatever was next — a bot as readily as a player. See
	// keepHostHuman.
	h.keepHostHuman(t)
	return hasHuman
}

// handleExpireReconnect fires when a disconnected player's reconnect window closes.
func (h *Hub) handleExpireReconnect(t *table, em expireMsg) {
	// Matched on the instant the hold began, not on the seat number the timer
	// was armed with: a finished table drops seats as their holds run out, and
	// every hold above a dropped seat moves down a key. See heldSeatAt. A hold
	// that answers to neither was cleared (the player came back, or the seat
	// went another way) or superseded by a newer disconnect, whose own timer
	// handles it.
	seat, ok := t.heldSeatAt(em.playerID, em.disconnectedAt)
	if !ok {
		log.Printf("reconnect expiry skipped, hold cleared or superseded code=%s player=%d", em.roomCode, em.playerID)
		return
	}
	h.metrics.reconnectExpirations.Add(1)
	log.Printf("reconnect window expired code=%s player=%d", em.roomCode, seat)

	delete(t.awayAt, seat)

	room := t.room
	nickname := ""
	if seat < len(room.Players) {
		nickname = room.Players[seat].Nickname
	}

	// The entry that made this seat absent has just been deleted, and `connected`
	// is derived from it, so without this the player_left below would announce a
	// departure and carry a roster saying that player is present. A running match
	// cannot simply drop the seat: hands, scores and turn order are indexed by it
	// until the round ends. See table.gone.
	t.gone[seat] = struct{}{}

	// A room that is not playing has no such constraint, and a phantom seat there
	// is worse than a stale flag: the next match would deal a hand to nobody. So
	// the seat goes for real, exactly as a lobby departure removes one.
	removed := false
	if room.Status != game.StatusPlaying {
		if _, err := room.RemoveLobbyPlayer(seat); err != nil {
			log.Printf("WARN expiry remove failed code=%s player=%d err=%v", em.roomCode, seat, err)
		} else {
			t.dropSeat(seat)
			removed = true
		}
	}

	// The seat rides this one. Every other player_left is a departure that
	// re-bases the roster, so a seat number in it would name somebody else by the
	// time it was read; this is the one that cannot — a running match indexes
	// hands by the seat, so nothing moves. The client needs it to tell "held" from
	// "gone for good", which is what decides whether it still has anybody to play
	// against. See table.abandonedBy for the server's half of the same question.
	left := protocol.ServerMsg{
		Type:     protocol.SMsgPlayerLeft,
		Nickname: nickname,
		Players:  h.playerList(t),
	}
	if !removed {
		left.PlayerIndex = intPtr(seat)
	} else {
		// The seat went for real, so everything keyed on it moved down a column,
		// the recap included. Only sent on the branch that re-bases: the other one
		// leaves every index exactly where the game-over screen found it. The
		// scoreboard and the round history travel for the same reason — a
		// finished table's standings are still on screen, and the client cannot
		// re-base them itself.
		left.MatchHistory = matchHistoryDTO(t)
		if len(room.Scores) > 0 {
			left.Scoreboard = h.buildScoreboard(room)
			left.RoundHistory = room.RoundHistory
		}
	}
	h.broadcastToRoomAll(t, left)

	// Whoever is left at a finished table may have been waiting on exactly this
	// player. Their asks have just been re-based with the seat.
	if removed && room.Status == game.StatusFinished {
		h.releaseRematchOffer(t, seat)
	}

	// A seat held through the reveal and never reclaimed: the pairing fell
	// apart before it dealt, and whoever is left goes back to searching rather
	// than sitting in a two-seat room that can never start. Reachable only if
	// the deal itself was refused, since the hold outlasts the reveal.
	if removed && room.Status == game.StatusLobby && t.isMatchmade() {
		h.requeueSurvivor(t)
		return
	}

	// In a matchmade room the hold is the whole wait: nobody here agreed to sit
	// through an opponent who is not coming back, so the match is given to
	// whoever is still at the table instead of grinding on with a seat that
	// auto-passes every turn until the round runs out.
	if room.Status == game.StatusPlaying && t.isMatchmade() {
		h.forfeitMatch(t, seat)
	}

	// An ordinary match answers the same event the way it answers leave_room:
	// the seat is taken out of the round where the table can spare it, and the
	// match ends where it cannot. See settleExpiredSeat.
	if room.Status == game.StatusPlaying && !t.isMatchmade() {
		h.settleExpiredSeat(t, seat)
	}

	// The seat that just expired may have been the last one anybody could have
	// come back to. If it was, the match ends here rather than auto-passing to
	// itself for five minutes. See closeAbandonedMatch.
	h.closeAbandonedMatch(t)

	// Otherwise no connected members remain and the room cleanup timer handles
	// deletion (already scheduled when the last player disconnected).
}

// settleExpiredSeat decides what a hold running out does to an ordinary match
// that is still being played, and it is leave_room's answer given to the same
// departure: the two are one absence arrived at two ways, and the table used to
// treat them differently in the one way that mattered to everybody else.
//
// The seat used to stay in the round. It held its cards, it kept its place in
// the turn order, and the clock auto-drew and auto-passed for it every thirty
// seconds — for the rest of the round, and then for every round of the match,
// because the AFK threshold only ever acts on a seat with a socket to close.
// At a table of four that is one dead half-minute per lap for three people who
// are still playing, for as long as a best-of-seven lasts. Nobody waits for
// somebody who is not there is the rule the matchmade timings were written to,
// and it holds here too: the hold *was* the wait, and it is over.
//
// So, in leaveAtTable's order and with its floor: above WalkOutFloor the seat
// is retired — the hand goes back to the deck, the turn steps over it, the
// scoreboard is left as it stood — and at or below it the match is given to the
// seat that stayed, announced as the forfeit it is. A table with nobody left at
// all, no socket and no hold, is not this function's: closeAbandonedMatch runs
// right after it and closes the room instead of awarding a match to a bot.
func (h *Hub) settleExpiredSeat(t *table, seat int) {
	room := t.room
	if room.Status != game.StatusPlaying || t.isMatchmade() || room.IsRetired(seat) {
		return
	}
	if t.connected() == 0 && len(t.awayAt) == 0 {
		return
	}
	// The expired seat is already out of playableSeats: it is neither held nor
	// seated, so the count is what is left without it.
	if t.playableSeats() >= WalkOutFloor {
		h.retireAbsentSeat(t, seat)
		return
	}
	h.forfeitMatch(t, seat)
}

// findHeldSeat returns the seat held for a disconnected player of that
// nickname, if any.
func (t *table) findHeldSeat(nickname string) (int, bool) {
	for playerID := range t.awayAt {
		if playerID < len(t.room.Players) && t.room.Players[playerID].Nickname == nickname {
			return playerID, true
		}
	}
	return 0, false
}

// handleReconnect restores a held seat and sends its player their game state.
func (h *Hub) handleReconnect(c *Client, t *table, playerID int, nickname string) {
	code := t.code
	h.seatClient(t, c, playerID)
	delete(t.awayAt, playerID)
	// The counter measured a connection that died. A reclaim is somebody
	// there, and the timeouts that stacked up while they were not must not
	// leave them one clock from a forfeit on their first turn back.
	delete(t.afk, playerID)

	log.Printf("player reconnected code=%s nickname=%s playerID=%d", code, nickname, playerID)

	// The token that opened this seat is spent here and replaced.
	//
	// It has been on a socket that died, it is in sessionStorage, and if the
	// process restarted on the way it has also been written to a snapshot on
	// disk. A one-shot proof is worth far more than a permanent one, and the
	// client already stores whatever the server hands it, so rotating costs
	// nothing: the returning player keeps their seat, and a copy of the old
	// token is now worth nothing to anybody who obtained one.
	tok := t.issueToken(playerID)

	// A reclaim at a finished table gets no game state, and the branch is on the
	// status rather than on `State != nil`: a match that ended normally leaves
	// its last state standing, so reading that field would have sent the final
	// board of a match that is over and put the client back at it. The client is
	// already holding the scoreboard it arrived with; what it is missing is the
	// fresh token and where the rematch has got to.
	var state *protocol.GameStateDTO
	if t.room.Status == game.StatusPlaying {
		state = h.playerGameState(t, playerID)
	}

	// Send full game state to the reconnecting player.
	c.Send(protocol.ServerMsg{
		Type:         protocol.SMsgPlayerReconnected,
		RoomCode:     code,
		PlayerID:     intPtr(playerID),
		State:        state,
		Players:      h.playerList(t),
		SessionToken: tok,
	})

	// Notify others of the reconnect.
	h.broadcastToRoom(t, protocol.ServerMsg{
		Type:        protocol.SMsgPlayerReconnected,
		PlayerIndex: intPtr(playerID),
		Nickname:    nickname,
		Players:     h.playerList(t),
	}, c)

	// A seat reclaimed at a finished table is back in an agreement that may have
	// moved on while it was away. The whole offer state travels, like everywhere
	// else, so nobody has to merge an increment into a picture they do not have.
	if t.room.Status == game.StatusFinished {
		h.broadcastRematchOffers(t, nil)
	}

	// Someone who comes back mid-drain missed the announcement: they were on a
	// dead socket when it went out, and their table is one of the ones being
	// waited on.
	if h.draining.Load() {
		c.Send(protocol.ServerMsg{Type: protocol.SMsgServerUpdating})
	}

	// Someone who comes back while the table is still shut has to be told so,
	// their client would otherwise never send map_ready, and the room would wait
	// out the full MapLoadTimeout on a player who is right there.
	if t.isLoading() {
		c.Send(protocol.ServerMsg{
			Type:         protocol.SMsgMatchLoading,
			PlayersReady: t.readySeats(),
		})
	}
}
