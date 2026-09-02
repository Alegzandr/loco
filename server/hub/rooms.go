// The table itself: opening one, taking a seat at it, the host controls, and
// the bookkeeping that frees a seat or deletes an empty room.
package hub

import (
	"log"
	"regexp"
	"strings"
	"time"

	"loco/server/game"
	"loco/server/protocol"
)

var roomCodeRe = regexp.MustCompile(`^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$`)

// validRoomCode returns true if code matches the 6-character room code alphabet.
func validRoomCode(code string) bool { return roomCodeRe.MatchString(strings.ToUpper(code)) }

func (h *Hub) handleCreateRoom(c *Client, msg protocol.ClientMsg) {
	if h.refuseWhileDraining(c) {
		return
	}
	if h.alreadySeated(c) {
		c.sendError("already in a room")
		return
	}
	nickname := validateNickname(c, msg.Nickname)
	if nickname == "" {
		return
	}
	// The ceiling is here rather than at the socket because this is the message
	// that allocates: a table plus its members, tokens, timers and cleanup
	// outlive the connection that asked for one by EmptyRoomTimeout.
	if len(h.tables) >= MaxRooms {
		log.Printf("WARN room cap reached rooms=%d conn=%s", len(h.tables), c.connID)
		c.sendError("the server is full, try again in a moment")
		return
	}
	msg.Nickname = nickname
	code := h.generateCode()
	room := game.NewRoom(code)
	if err := room.Join(msg.Nickname); err != nil {
		c.sendError(err.Error())
		return
	}
	t := newTable(code, room)
	h.tables[code] = t
	h.seatClient(t, c, 0)
	h.metrics.rooms.Add(1)
	log.Printf("room created code=%s host=%s", code, msg.Nickname)

	tok := t.issueToken(0)
	c.Send(protocol.ServerMsg{
		Type:         protocol.SMsgRoomCreated,
		RoomCode:     code,
		PlayerID:     intPtr(0),
		Players:      h.playerList(t),
		SessionToken: tok,
		MatchFormat:  matchFormatString(room.Format),
		MaxPlayers:   room.MaxPlayers,
	})

	// Last, when the hub has finished filling this table in: from here on it is
	// the table's goroutine that reads it. See table.start.
	t.start(h)
}

func (h *Hub) handleJoinRoom(c *Client, msg protocol.ClientMsg) {
	if h.alreadySeated(c) {
		c.sendError("already in a room")
		return
	}
	nickname := validateNickname(c, msg.Nickname)
	if nickname == "" {
		return
	}
	msg.Nickname = nickname
	if !validRoomCode(msg.RoomCode) {
		h.noteFailedJoin(c)
		c.sendError("invalid room code")
		return
	}
	// A sweep is refused before the lookup, so a throttled network learns nothing
	// from the answer either. See noteFailedJoin: a player who mistypes their
	// code once is nowhere near this.
	if h.joinThrottled(c) {
		h.metrics.joinsThrottled.Add(1)
		c.sendError("too many attempts, wait a moment")
		return
	}
	code := strings.ToUpper(msg.RoomCode)
	t, ok := h.tables[code]
	if !ok {
		// While draining, a table this process does not have is very likely a
		// table the *previous* process had: saying "no table with that code"
		// would blame the player for a code that was real. Reconnects are not
		// affected, they land in the branch below on a room that exists.
		if h.refuseWhileDraining(c) {
			return
		}
		h.noteFailedJoin(c)
		c.sendError("room not found")
		return
	}

	// The rest of a join is the table's: the roster, the held seats, the tokens.
	// Running it there is also what makes two people typing the same code in the
	// same instant a queue rather than a race for the last chair.
	if !t.post(tableJob{what: string(protocol.CMsgJoinRoom), c: c, run: func() {
		h.joinAtTable(t, c, msg)
	}}) {
		c.sendError("server busy, please retry")
	}
}

// joinAtTable is the half of join_room that belongs to the table. It runs on
// the table's goroutine; the wrong-code budget it spends does not, so that one
// goes back to the hub.
func (h *Hub) joinAtTable(t *table, c *Client, msg protocol.ClientMsg) {
	code, room := t.code, t.room
	// If the game is already in progress, check for a disconnected slot with
	// this nickname.
	//
	// The two refusals below are deliberately the same string. They used to
	// differ, and the difference was a roster oracle: "invalid session token"
	// came back only when the nickname matched a seat that was actually held at
	// that table, so anyone with a code could test names against it. A stranger
	// and a returning player whose token has gone stale now get the same answer,
	// and the returning player's client already owns that case (the restore
	// timeout in useSessionRestore), so nothing legitimate reads the difference.
	//
	// The check is "not a lobby" rather than "playing" because a finished
	// ordinary table holds its seats too, for the length of the rematch: see
	// disconnectAtTable. A stranger gets the same one string at either, which is
	// the point of it. A matchmade table is never joinable by code at all — its
	// lobby is the versus reveal, whose seats are held for a reload and are
	// reclaimed the same way — so it takes this branch at every status.
	if room.Status != game.StatusLobby || t.isMatchmade() {
		if playerID, found := t.findHeldSeat(msg.Nickname); found &&
			t.validateToken(playerID, msg.SessionToken) {
			h.handleReconnect(c, t, playerID, msg.Nickname)
			return
		}
		h.postToRouter("failed_join", func() { h.noteFailedJoin(c) })
		c.sendError("game already in progress")
		return
	}

	if err := room.Join(msg.Nickname); err != nil {
		c.sendError(err.Error())
		return
	}
	h.seatClient(t, c, len(room.Players)-1)

	// A table whose last human dropped keeps its bots, and the first of them is
	// sitting in the host's seat. This arrival is what takes it back: nobody was
	// there to promote when the seats were re-based. See keepHostHuman.
	h.keepHostHuman(t)

	playerID := c.playerID()
	tok := t.issueToken(playerID)
	// Notify the joining client
	c.Send(protocol.ServerMsg{
		Type:         protocol.SMsgRoomJoined,
		RoomCode:     code,
		PlayerID:     intPtr(playerID),
		Players:      h.playerList(t),
		SessionToken: tok,
		MatchFormat:  matchFormatString(room.Format),
		MaxPlayers:   room.MaxPlayers,
		// The host may have set it long before this player typed the code.
		StreamerMode: t.streamerMode,
	})

	// Notify others
	h.broadcastToRoom(t, protocol.ServerMsg{
		Type:     protocol.SMsgPlayerJoined,
		Nickname: msg.Nickname,
		Players:  h.playerList(t),
	}, c)
}

func (h *Hub) handleStartGame(t *table, c *Client, msg protocol.ClientMsg) {
	// Dealing during a drain is what would keep the deploy waiting without
	// bound; see drain.go.
	if h.refuseWhileDraining(c) {
		return
	}
	if refuseWithoutHost(c, t) {
		return
	}
	if c.playerID() != 0 {
		c.sendError("only the room owner can start the game")
		return
	}
	if err := t.room.Start(); err != nil {
		c.sendError(err.Error())
		return
	}
	h.dealMatch(t)
}

// startMatch is the matchmaking entry point into the same deal a host's
// start_game produces: nobody presses anything in a matchmade room, so the
// reveal timer calls this instead.
func (h *Hub) startMatch(t *table) {
	if err := t.room.Start(); err != nil {
		log.Printf("WARN matchmade start failed code=%s err=%v", t.code, err)
		return
	}
	h.dealMatch(t)
}

// dealMatch broadcasts the freshly dealt match and opens the loading gate. The
// two callers differ only in who decided to start.
func (h *Hub) dealMatch(t *table) {
	room := t.room
	h.metrics.matchesStarted.Add(1)
	log.Printf("match started code=%s players=%d format=%s matchmade=%t solo=%t",
		t.code, len(room.Players), matchFormatString(room.Format), t.isMatchmade(), t.solo)

	// Send each player their personalized game state. Build the shared player
	// list once and reuse it across all recipients.
	pl := h.playerList(t)
	shared := h.sharedGameState(t)
	for seat, member := range t.members {
		if member == nil {
			continue
		}
		member.Send(protocol.ServerMsg{
			Type:  protocol.SMsgGameStarted,
			State: h.playerGameStateWith(t, seat, pl, shared),
		})
	}

	// The turn clock and the bots are deliberately NOT armed here. game_started
	// only tells each client what it has to render; the match begins at
	// match_ready, once everybody has the map decoded. See maploading.go: the
	// first turn used to start ticking while somebody's table was still a grey
	// rectangle, which in a game decided by arrival order is a head start, not
	// a cosmetic problem.
	h.beginMapLoading(t)
}

func (h *Hub) handleSetMatchFormat(t *table, c *Client, msg protocol.ClientMsg) {
	if refuseWithoutHost(c, t) {
		return
	}
	if c.playerID() != 0 {
		c.sendError("only the host can change match format")
		return
	}
	f, err := parseMatchFormat(msg.MatchFormat)
	if err != nil {
		c.sendError(err.Error())
		return
	}
	if err := t.room.SetFormat(f); err != nil {
		c.sendError(err.Error())
		return
	}
	h.broadcastLobbyConfig(t)
}

func (h *Hub) handleSetMaxPlayers(t *table, c *Client, msg protocol.ClientMsg) {
	if refuseWithoutHost(c, t) {
		return
	}
	if c.playerID() != 0 {
		c.sendError("only the host can change max players")
		return
	}
	if err := t.room.SetMaxPlayers(msg.MaxPlayers); err != nil {
		c.sendError(err.Error())
		return
	}
	h.broadcastLobbyConfig(t)
}

// handleSetStreamerMode is the host saying the table code must not be readable
// on anybody's screen.
//
// Every other preference in this game is presentation and stays on the client
// that set it. This one cannot: the code is one string shared by everybody who
// can see it, so a host who is streaming with it on screen is exposed by the
// *other* players' screens too — the friend who joins and leaves their waiting
// room up on a second monitor, the seat that reads it out. Blurring only the
// host's copy protects the one screen that was already going to be careful.
//
// The host and nobody else. It is a table setting, and a table's settings are
// seat 0's, exactly like the format and the seat count — and a table with no
// host (matchmade, solo) has no code on screen at all, which is why they are
// refused here rather than special-cased.
//
// Deliberately not a lobby control: a host streams the match, not the wait. It
// is accepted at every status, which is also why it does not ride
// lobby_config_changed.
//
// A repeat of the state the table is already in is answered by nobody. It is
// not an error — a client whose switch was flipped twice is correct — but a
// broadcast that changes nothing is a send to every seat for free, and this
// switch sits under a thumb in a panel.
func (h *Hub) handleSetStreamerMode(t *table, c *Client, msg protocol.ClientMsg) {
	if refuseWithoutHost(c, t) {
		return
	}
	if c.playerID() != 0 {
		c.sendError("only the host can change streamer mode")
		return
	}
	if t.streamerMode == msg.StreamerMode {
		return
	}
	t.streamerMode = msg.StreamerMode
	h.broadcastToRoomAll(t, protocol.ServerMsg{
		Type:         protocol.SMsgStreamerModeChanged,
		StreamerMode: t.streamerMode,
	})
}

// broadcastLobbyConfig publishes the two things the host owns about a table
// that has not dealt yet. Both controls answer with the whole pair, so a client
// never has to merge one field into a picture of the other.
func (h *Hub) broadcastLobbyConfig(t *table) {
	h.broadcastToRoomAll(t, protocol.ServerMsg{
		Type:        protocol.SMsgLobbyConfigChanged,
		MatchFormat: matchFormatString(t.room.Format),
		MaxPlayers:  t.room.MaxPlayers,
	})
}

// handleKickPlayer frees a seat on the host's say-so.
//
// It is the one lobby control that acts on somebody else, so it is the
// strictest: the host only, their own table only, the lobby only, and never
// their own seat — giving up the seat you are sitting in is leave_room, and
// letting a kick do it would hand the table to whoever was sitting in seat 1
// through a button that says nothing of the sort.
//
// A bot is a seat like any other here. It is the only way to take one back, and
// a roster offering the control on every row except those would be lying about
// which of them the host owns.
//
// Deliberately not a ban. The table code is already in the kicked player's
// hands and nothing here stops them typing it again: there is no account to
// refuse and the game holds no identity to build one on, so a ban would be
// theatre, and a mistaken press stays cheap — the player rejoins. What this
// buys is a table the host can shape: an arrival at the wrong code, a seat that
// will not ready up, one bot too many.
func (h *Hub) handleKickPlayer(t *table, c *Client, msg protocol.ClientMsg) {
	room := t.room
	if refuseWithoutHost(c, t) {
		return
	}
	if c.playerID() != 0 {
		c.sendError("only the room owner can remove players")
		return
	}
	if room.Status != game.StatusLobby {
		c.sendError("can only remove players in the lobby")
		return
	}
	if msg.TargetIndex == nil {
		c.sendError("invalid player index")
		return
	}
	seat := *msg.TargetIndex
	// seat 0 is the host's own, and c.playerID() is 0 here by the check above.
	if seat <= 0 || seat >= len(room.Players) {
		c.sendError("invalid player index")
		return
	}

	code := t.code
	nickname := room.Players[seat].Nickname
	target := t.client(seat)
	if target == nil {
		// No socket at that slot: in a lobby that is a bot.
		h.removeUnmannedSeat(t, seat)
		log.Printf("player kicked code=%s nickname=%s bot=true", code, nickname)
		return
	}
	// The seat goes first and the notice second: releaseSeat is what makes it
	// stop being theirs, and it broadcasts the departure to everybody still at
	// the table. The removed client is out of the members list by then, so it
	// gets this message instead of the player_left about itself.
	h.releaseSeat(t, target)
	target.Send(protocol.ServerMsg{Type: protocol.SMsgKicked})
	log.Printf("player kicked code=%s nickname=%s bot=false", code, nickname)
}

// handleTransferHost hands the table to somebody else.
//
// The host is seat 0 and nothing else, so the transfer is a swap of two seats
// rather than a flag: the moment it lands, every host control answers to the
// other player and the roster badge follows, with no second definition of who
// owns the table to keep in step with the first.
//
// It is refused to a bot for the reason keepHostHuman exists — a table whose
// host cannot press start is a table that can never deal — and refused once the
// cards are out, like every other roster control: a seat belongs to a match by
// then, and swapping two would swap two hands.
//
// No confirmation, and it is not a demotion the other player can decline. The
// press costs nothing that cannot be pressed back, and the host who gives the
// table away is the one who decided to.
func (h *Hub) handleTransferHost(t *table, c *Client, msg protocol.ClientMsg) {
	room := t.room
	if refuseWithoutHost(c, t) {
		return
	}
	if c.playerID() != 0 {
		c.sendError("only the room owner can hand over the table")
		return
	}
	if room.Status != game.StatusLobby {
		c.sendError("can only hand over the table in the lobby")
		return
	}
	if msg.TargetIndex == nil {
		c.sendError("invalid player index")
		return
	}
	seat := *msg.TargetIndex
	// Seat 0 is the sender's own by the check above, and handing the table to
	// yourself is not a move.
	if seat <= 0 || seat >= len(room.Players) {
		c.sendError("invalid player index")
		return
	}
	if t.isBot(seat) {
		c.sendError("a bot cannot host the table")
		return
	}

	nickname := room.Players[seat].Nickname
	if err := room.SwapLobbyPlayers(0, seat); err != nil {
		c.sendError(err.Error())
		return
	}
	t.swapSeats(0, seat)

	// Per-recipient, because the two seats that moved read their own player_id
	// out of this message. Everybody else gets it too: the badge moved on their
	// screen as well, and one message saying so beats a roster they have to
	// diff.
	for i, m := range t.members {
		if m == nil {
			continue
		}
		m.Send(protocol.ServerMsg{
			Type:     protocol.SMsgHostChanged,
			PlayerID: intPtr(i),
			Nickname: nickname,
			Players:  h.playerList(t),
		})
	}
	log.Printf("host transferred code=%s nickname=%s", t.code, nickname)
}

// removeUnmannedSeat drops a seat with no socket behind it (a bot) and re-bases
// every playerID-keyed structure above it, exactly as a leaving human's seat is
// re-based. The bot counter is only touched when the slot really was a bot: a
// finished-then-reopened table can carry a seat that is neither.
func (h *Hub) removeUnmannedSeat(t *table, seat int) {
	nickname := t.room.Players[seat].Nickname
	if _, err := t.room.RemoveLobbyPlayer(seat); err != nil {
		log.Printf("WARN RemoveLobbyPlayer failed code=%s player=%d err=%v", t.code, seat, err)
		return
	}
	if t.isBot(seat) {
		h.metrics.botsActive.Add(-1)
	}
	t.dropSeat(seat)

	h.broadcastToRoomAll(t, protocol.ServerMsg{
		Type:     protocol.SMsgPlayerLeft,
		Nickname: nickname,
		Players:  h.playerList(t),
	})
}

// scheduleRoomCleanup starts a timer that will delete the room if it remains empty.
// Uses time.AfterFunc to avoid spawning long-lived goroutines.
// If the cleanup channel is full, retries once after 30s; dropping permanently
// would leave an empty room in memory until the process restarts.
func (h *Hub) scheduleRoomCleanup(t *table) {
	now := time.Now()
	t.emptyAt = now
	cm := cleanupMsg{roomCode: t.code, emptyAt: now}
	time.AfterFunc(EmptyRoomTimeout, func() {
		h.postCritical(t, "room_cleanup", 30*time.Second, func() { h.handleCleanup(t, cm) })
	})
}

// handleCleanup deletes an empty room if it has not been rejoined since the
// timer started. It decides on the table's own goroutine and asks the hub to do
// the deleting, because the map of tables is the one thing a table does not own.
func (h *Hub) handleCleanup(t *table, cm cleanupMsg) {
	if t.emptyAt != cm.emptyAt {
		// Room was rejoined; the cleanup is stale.
		log.Printf("room cleanup skipped, room rejoined code=%s", cm.roomCode)
		return
	}

	// Double-check no connected members (race-safe belt-and-suspenders guard).
	if !t.allSeatsEmpty() {
		t.emptyAt = time.Time{}
		log.Printf("room cleanup skipped, active members still present code=%s", cm.roomCode)
		return
	}

	h.postToRouter("delete_room", func() { h.deleteRoom(cm.roomCode) })
}

// closeAbandonedMatch tears down a match nobody is sitting at and nobody can
// come back to, and reports whether it did.
//
// The empty-room cleanup already deletes such a table, but on a fixed five
// minutes, and a match is not an empty lobby: the room stays StatusPlaying for
// the whole of that wait, so the turn clock keeps re-arming and auto-drawing for
// seats with no one behind them, and the table keeps counting as a match in
// flight — a deploy started anywhere in that window waits on a game nobody is
// playing. Every hold has expired and every socket has gone, so there is nothing
// left to wait for and no information left to protect: the cleanup's job, done
// the moment it is certain instead of on a timer.
func (h *Hub) closeAbandonedMatch(t *table) bool {
	if t.room.Status != game.StatusPlaying {
		return false
	}
	if len(t.awayAt) > 0 || !t.allSeatsEmpty() {
		return false
	}
	code := t.code
	log.Printf("match abandoned, closing table code=%s", code)
	h.postToRouter("delete_abandoned", func() { h.deleteRoom(code) })
	return true
}

// deleteRoom forgets a table entirely, and stops it.
//
// One delete, and that is the whole point: this used to be eleven, and adding a
// twelfth per-table map meant remembering to come back here. Whatever the table
// held goes with it.
//
// The order matters now that a table is also a goroutine. The map entry goes
// first, so nothing new can be routed to a room that is on its way out; then the
// goroutine is stopped and waited for, which is also what makes the read below
// safe — after stop() returns, nobody else is touching this table's fields.
// Runs on the event loop, the only goroutine that may write h.tables.
func (h *Hub) deleteRoom(code string) {
	t, ok := h.tables[code]
	if !ok {
		return
	}
	delete(h.tables, code)
	t.stop()
	h.metrics.botsActive.Add(-int32(len(t.bots)))
	h.metrics.rooms.Add(-1)
	log.Printf("room deleted code=%s", code)
}
