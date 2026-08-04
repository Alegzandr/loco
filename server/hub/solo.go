package hub

import (
	"log"

	"loco/server/game"
	"loco/server/protocol"
)

// A 1v1 against the server.
//
// The mode is the queue's *experience* with the queue taken out: a nickname, one
// press, a hand. It is deliberately not "open a table and add a bot" — that is
// three screens, a code nobody is going to share and a host control set for a
// table of one, and the whole point of this entry is that a first-time visitor
// who has just been told the queue may take a while gets to play in one press
// instead of closing the tab.
//
// So the table it opens is the matchmade shape rather than the ordinary one:
// there is no host, no lobby config, no bots to add and nothing to start. What
// it does *not* borrow is the matchmade timing — the 15 s hold and the two-timeout
// AFK threshold exist because a stranger will not wait for you, and the seat
// opposite this player is not a stranger. Reconnect, drain and the snapshot treat
// it as any other table in progress.
//
// It touches nothing the queue owns: no `h.queue`, no `matchmaking_queue` gauge.
// That is a property the E2E suite depends on — the queue is the one
// server-global the suite has to serialise around, and this mode must not join
// it.

// SoloFormat is what a solo match plays: one round, like the queue's.
//
// The entry point promises a hand now, so what it deals has to be the shortest
// complete thing this game has. Somebody who wants another presses the button
// again, which is one press either way and never a commitment made in advance.
var SoloFormat = game.BO1

// handlePlayBot deals a solo match. Runs on the hub: it allocates a table.
//
// A player who is sitting somewhere they are not playing — the game-over screen
// of the match they just finished, a lobby they gave up on — is released rather
// than refused, exactly as find_match does it and for the same reason: "play the
// bot again" is one button, and making the client choreograph a leave_room in
// front of it would put an ordering bug between the two for no gain.
func (h *Hub) handlePlayBot(c *Client, msg protocol.ClientMsg) {
	// Dealing during a drain is what would keep a deploy waiting without bound.
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
			// alreadySeated releases a client pointing at a table that has gone,
			// so this is the case where it just did.
			h.openSoloTable(c, nickname)
			return
		}
		// Whether the seat can be given up is the table's answer and opening a
		// table is the hub's, so the two halves are ordered rather than raced.
		if !t.post(tableJob{what: "play_bot_release", c: c, run: func() {
			if t.room.Status == game.StatusPlaying {
				c.sendError("already in a room")
				return
			}
			h.releaseSeat(t, c)
			h.postToRouter("open_solo", func() { h.openSoloTable(c, nickname) })
		}}) {
			c.sendError("server busy, please retry")
		}
		return
	}
	h.openSoloTable(c, nickname)
}

// openSoloTable builds the table, seats the player and the bot, and deals.
func (h *Hub) openSoloTable(c *Client, nickname string) {
	// The same ceiling create_room answers, for the same reason: this message
	// allocates a table that outlives the connection asking for one.
	if len(h.tables) >= MaxRooms {
		log.Printf("WARN room cap reached rooms=%d conn=%s", len(h.tables), c.connID)
		c.sendError("the server is full, try again in a moment")
		return
	}

	code := h.generateCode()
	room := game.NewRoom(code)
	// Two seats, one round. Both are lobby-only settings on a room nobody else
	// can reach, so neither can fail; log rather than swallow if that changes.
	if err := room.SetMaxPlayers(2); err != nil {
		log.Printf("WARN solo SetMaxPlayers code=%s err=%v", code, err)
	}
	if err := room.SetFormat(SoloFormat); err != nil {
		log.Printf("WARN solo SetFormat code=%s err=%v", code, err)
	}
	if err := room.Join(nickname); err != nil {
		c.sendError(err.Error())
		return
	}
	botName := nextBotName(room)
	if err := room.Join(botName); err != nil {
		c.sendError(err.Error())
		return
	}

	t := newTable(code, room)
	t.solo = true
	h.tables[code] = t
	h.seatClient(t, c, 0)
	// The bot's seat carries no socket, so its members entry is nil. Asked of the
	// table rather than appended here: members is its own.
	t.addEmptySeat()
	t.bots[1] = struct{}{}
	h.metrics.rooms.Add(1)
	h.metrics.botsActive.Add(1)
	h.metrics.matchesSolo.Add(1)

	if err := room.Start(); err != nil {
		// Nothing here can produce it — two seats, a fresh lobby — but a table
		// left dealt-less would be a screen that never opens, so it is answered.
		log.Printf("WARN solo start failed code=%s err=%v", code, err)
		c.sendError(err.Error())
		h.deleteRoom(code)
		return
	}

	log.Printf("solo match started code=%s nickname=%s bot=%s", code, nickname, botName)

	// Started before the deal is announced: dealMatch opens the map-loading gate,
	// which arms a timer, and a table has to be running to receive one. Everything
	// above is the hub filling this table in. See table.start.
	t.start(h)
	h.dealSoloMatch(t, c)
}

// dealSoloMatch is dealMatch's one-seat form: it carries the identity this mode
// has no earlier message to have carried.
//
// Every other way into a match announces the seat first — room_created,
// room_joined, match_found — and this one deliberately has no screen before the
// board, so there is no message to hang the room code, the seat and the session
// token on but this one. Without them a reload could not reclaim the seat.
func (h *Hub) dealSoloMatch(t *table, c *Client) {
	h.metrics.matchesStarted.Add(1)
	c.Send(protocol.ServerMsg{
		Type:         protocol.SMsgGameStarted,
		RoomCode:     t.code,
		PlayerID:     intPtr(c.playerID()),
		SessionToken: t.issueToken(c.playerID()),
		State:        h.playerGameState(t, c.playerID()),
	})
	// The clock and the bot are armed by the loading gate, not here: the match
	// begins at match_ready. See maploading.go.
	h.beginMapLoading(t)
}
