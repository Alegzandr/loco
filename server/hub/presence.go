// Leaving and coming back: what a disconnect costs at a table that has dealt
// and at one that has not, the 60s the slot is held for, and the reclaim.
package hub

import (
	"log"
	"time"

	"loco/server/game"
	"loco/server/protocol"
)

func (h *Hub) handleDisconnect(c *Client) {
	// A socket that has gone away must not be paired with somebody who is still
	// there, so the queue is the first thing it leaves.
	h.dequeue(c)
	if c.roomCode == "" {
		log.Printf("player disconnected conn=%s addr=%s (no room)", c.connID, c.netPrefix())
		return
	}
	t, ok := h.tables[c.roomCode]
	if !ok {
		return
	}
	room := t.room
	nickname := ""
	if c.playerID < len(room.Players) {
		nickname = room.Players[c.playerID].Nickname
	}

	log.Printf("player disconnected code=%s nickname=%s playerID=%d", t.code, nickname, c.playerID)

	// During an active game the seat is held rather than removed: the player has
	// the reconnect window to come back into it.
	if room.Status == game.StatusPlaying {
		disconnectTime := time.Now()
		t.hold(c.playerID, disconnectTime)

		// The forfeit deadline rides this message in a matchmade room: the player
		// still at the table is owed a number rather than an open-ended notice,
		// and 15s of "they might come back" is short enough to sit through only
		// because it is visibly counting down.
		h.broadcastToRoomAll(t, protocol.ServerMsg{
			Type:            protocol.SMsgPlayerDisconnected,
			PlayerIndex:     intPtr(c.playerID),
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

		h.scheduleReconnectExpiry(t, c.playerID, disconnectTime)

		// If all slots are now empty, start the room cleanup timer.
		if t.allSeatsEmpty() {
			h.scheduleRoomCleanup(t)
		}
		return
	}

	// Finished room: treat it exactly like a lobby. The room can be reopened by
	// a rematch, so the roster and every playerID-keyed structure must stay
	// consistent — leaving a phantom player here would deal a hand to nobody in
	// the next match.
	leavingID := c.playerID
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
	code := t.code
	em := expireMsg{roomCode: code, playerID: playerID, disconnectedAt: at}
	time.AfterFunc(reconnectHold(t), func() {
		select {
		case h.expire <- em:
		default:
			h.metrics.channelRetries.Add(1)
			log.Printf("expire channel full, retrying in 5s code=%s player=%d", code, playerID)
			time.AfterFunc(5*time.Second, func() {
				select {
				case h.expire <- em:
				default:
					log.Printf("WARN expire retry dropped, slot may not be reclaimed code=%s player=%d", code, playerID)
				}
			})
		}
	})
}

// reindexLobbyDisconnect removes the leaving client from a lobby table and
// re-bases every seat above it. Returns true when at least one human remains.
func (h *Hub) reindexLobbyDisconnect(c *Client, t *table) (hasHuman bool) {
	leavingID := c.playerID
	if _, err := t.room.RemoveLobbyPlayer(leavingID); err != nil {
		log.Printf("WARN RemoveLobbyPlayer failed code=%s player=%d err=%v", t.code, leavingID, err)
	}
	return t.dropClient(c, leavingID)
}

// handleExpireReconnect fires when a disconnected player's reconnect window closes.
func (h *Hub) handleExpireReconnect(em expireMsg) {
	t, ok := h.tables[em.roomCode]
	if !ok {
		log.Printf("reconnect expiry skipped, room gone code=%s player=%d", em.roomCode, em.playerID)
		return
	}
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

	h.broadcastToRoomAll(t, protocol.ServerMsg{
		Type:     protocol.SMsgPlayerLeft,
		Nickname: nickname,
		Players:  h.playerList(t),
	})

	// In a matchmade room the hold is the whole wait: nobody here agreed to sit
	// through an opponent who is not coming back, so the match is given to
	// whoever is still at the table instead of grinding on with a seat that
	// auto-passes every turn until the round runs out.
	if room.Status == game.StatusPlaying && t.isMatchmade() {
		h.forfeitMatch(t, em.playerID)
	}

	// If no connected members remain, let the room cleanup timer handle deletion
	// (already scheduled when the last player disconnected).
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

	// Send full game state to the reconnecting player.
	c.Send(protocol.ServerMsg{
		Type:         protocol.SMsgPlayerReconnected,
		RoomCode:     code,
		PlayerID:     intPtr(playerID),
		State:        h.playerGameState(t, playerID),
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
