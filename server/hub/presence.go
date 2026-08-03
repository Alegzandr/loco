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
	at, ok := t.awayAt[em.playerID]
	if !ok {
		// Player's slot was already cleared (reconnected or room deleted).
		log.Printf("reconnect expiry skipped, slot cleared code=%s player=%d", em.roomCode, em.playerID)
		return
	}
	// If the recorded time differs, the player disconnected again more recently;
	// a newer timer will handle that disconnect.
	if at != em.disconnectedAt {
		log.Printf("reconnect expiry skipped, superseded by newer disconnect code=%s player=%d", em.roomCode, em.playerID)
		return
	}
	h.metrics.reconnectExpirations.Add(1)
	log.Printf("reconnect window expired code=%s player=%d", em.roomCode, em.playerID)

	delete(t.awayAt, em.playerID)

	room := t.room
	nickname := ""
	if em.playerID < len(room.Players) {
		nickname = room.Players[em.playerID].Nickname
	}

	// The entry that made this seat absent has just been deleted, and `connected`
	// is derived from it, so without this the player_left below would announce a
	// departure and carry a roster saying that player is present. A running match
	// cannot simply drop the seat: hands, scores and turn order are indexed by it
	// until the round ends. See table.gone.
	t.gone[em.playerID] = struct{}{}

	// A room that is not playing has no such constraint, and a phantom seat there
	// is worse than a stale flag: the next match would deal a hand to nobody. So
	// the seat goes for real, exactly as a lobby departure removes one.
	removed := false
	if room.Status != game.StatusPlaying {
		if _, err := room.RemoveLobbyPlayer(em.playerID); err != nil {
			log.Printf("WARN expiry remove failed code=%s player=%d err=%v", em.roomCode, em.playerID, err)
		} else {
			t.dropSeat(em.playerID)
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
		left.PlayerIndex = intPtr(em.playerID)
	}
	h.broadcastToRoomAll(t, left)

	// Whoever is left at a finished table may have been waiting on exactly this
	// player. Their asks have just been re-based with the seat.
	if removed && room.Status == game.StatusFinished {
		h.releaseRematchOffer(t, em.playerID)
	}

	// In a matchmade room the hold is the whole wait: nobody here agreed to sit
	// through an opponent who is not coming back, so the match is given to
	// whoever is still at the table instead of grinding on with a seat that
	// auto-passes every turn until the round runs out.
	if room.Status == game.StatusPlaying && t.isMatchmade() {
		h.forfeitMatch(t, em.playerID)
	}

	// The seat that just expired may have been the last one anybody could have
	// come back to. If it was, the match ends here rather than auto-passing to
	// itself for five minutes. See closeAbandonedMatch.
	h.closeAbandonedMatch(t)

	// Otherwise no connected members remain and the room cleanup timer handles
	// deletion (already scheduled when the last player disconnected).
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
