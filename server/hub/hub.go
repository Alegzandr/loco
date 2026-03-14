// Package hub manages WebSocket connections and routes game messages.
package hub

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log"
	mrand "math/rand"
	"net/http"
	"strings"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
	"loco/server/game"
	"loco/server/protocol"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true // allow all origins in development; restrict in production
	},
}

const reconnectTimeout = 60 * time.Second

type inboundMsg struct {
	client *Client
	msg    protocol.ClientMsg
}

// expireMsg is sent internally when a disconnected player's reconnect window closes.
type expireMsg struct {
	roomCode       string
	playerID       int
	disconnectedAt time.Time
}

// botMoveMsg is sent internally when a bot should take its turn.
type botMoveMsg struct {
	roomCode string
	playerID int
}

// Hub manages all active rooms and connected clients.
type Hub struct {
	rooms          map[string]*game.Room
	clients        map[*Client]struct{}
	// roomMembers[code] is indexed by playerID; nil means that slot is currently disconnected.
	roomMembers    map[string][]*Client
	// disconnectedAt[code][playerID] = time of disconnect (only set during StatusPlaying).
	disconnectedAt map[string]map[int]time.Time
	// sessionTokens[code][playerID] = opaque token for reconnect authentication.
	sessionTokens  map[string]map[int]string

	// botSlots[code] is a set of playerIDs that are bots.
	botSlots map[string]map[int]struct{}

	register   chan *Client
	unregister chan *Client
	inbound    chan inboundMsg
	expire     chan expireMsg
	botMove    chan botMoveMsg // scheduled bot actions

	// Atomic stats read by the health endpoint without entering the event loop.
	statRooms   atomic.Int32
	statClients atomic.Int32
	startTime   time.Time
}

// HealthStats is a snapshot of hub metrics for the health endpoint.
type HealthStats struct {
	Status    string `json:"status"`
	Rooms     int32  `json:"rooms"`
	Clients   int32  `json:"clients"`
	UptimeSec int64  `json:"uptime_sec"`
}

// New creates and returns a Hub.
func New() *Hub {
	return &Hub{
		rooms:          make(map[string]*game.Room),
		clients:        make(map[*Client]struct{}),
		roomMembers:    make(map[string][]*Client),
		disconnectedAt: make(map[string]map[int]time.Time),
		sessionTokens:  make(map[string]map[int]string),
		botSlots:       make(map[string]map[int]struct{}),
		register:       make(chan *Client, 16),
		unregister:     make(chan *Client, 16),
		inbound:        make(chan inboundMsg, 256),
		expire:         make(chan expireMsg, 64),
		botMove:        make(chan botMoveMsg, 64),
		startTime:      time.Now(),
	}
}

// generateSessionToken produces a cryptographically random 32-hex-char token.
func generateSessionToken() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		// fallback: use math/rand (should never happen)
		for i := range b {
			b[i] = byte(mrand.Intn(256))
		}
	}
	return hex.EncodeToString(b)
}

// issueToken creates and stores a session token for the given player slot.
func (h *Hub) issueToken(code string, playerID int) string {
	if h.sessionTokens[code] == nil {
		h.sessionTokens[code] = make(map[int]string)
	}
	tok := generateSessionToken()
	h.sessionTokens[code][playerID] = tok
	return tok
}

// validateToken checks the provided token against the stored one for the slot.
func (h *Hub) validateToken(code string, playerID int, token string) bool {
	slots, ok := h.sessionTokens[code]
	if !ok {
		return false
	}
	stored, ok := slots[playerID]
	if !ok {
		return false
	}
	return stored == token && token != ""
}

// GetStats returns a snapshot of hub metrics safe to call from any goroutine.
func (h *Hub) GetStats() HealthStats {
	return HealthStats{
		Status:    "ok",
		Rooms:     h.statRooms.Load(),
		Clients:   h.statClients.Load(),
		UptimeSec: int64(time.Since(h.startTime).Seconds()),
	}
}

// Run starts the hub event loop. Call in a goroutine.
func (h *Hub) Run() {
	for {
		select {
		case c := <-h.register:
			h.clients[c] = struct{}{}
			h.statClients.Add(1)

		case c := <-h.unregister:
			if _, ok := h.clients[c]; ok {
				delete(h.clients, c)
				h.statClients.Add(-1)
				c.close()
				h.handleDisconnect(c)
			}

		case im := <-h.inbound:
			h.dispatch(im.client, im.msg)

		case em := <-h.expire:
			h.handleExpireReconnect(em)

		case bm := <-h.botMove:
			h.executeBotMove(bm)
		}
	}
}

// ServeWS upgrades an HTTP connection to WebSocket and registers the client.
func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("upgrade error: %v", err)
		return
	}
	c := newClient(h, conn)
	h.register <- c
}

// dispatch routes a client message to the appropriate handler.
func (h *Hub) dispatch(c *Client, msg protocol.ClientMsg) {
	switch msg.Type {
	case protocol.CMsgCreateRoom:
		h.handleCreateRoom(c, msg)
	case protocol.CMsgJoinRoom:
		h.handleJoinRoom(c, msg)
	case protocol.CMsgStartGame:
		h.handleStartGame(c, msg)
	case protocol.CMsgPlayCard:
		h.handlePlayCard(c, msg)
	case protocol.CMsgDrawCard:
		h.handleDrawCard(c, msg)
	case protocol.CMsgPassTurn:
		h.handlePassTurn(c, msg)
	case protocol.CMsgDeclareUno:
		h.handleDeclareUno(c, msg)
	case protocol.CMsgCatchUno:
		h.handleCatchUno(c, msg)
	case protocol.CMsgCounterDraw:
		h.handleCounterDraw(c, msg)
	case protocol.CMsgAddBot:
		h.handleAddBot(c, msg)
	default:
		c.sendError("unknown message type")
	}
}

// --- Lobby handlers ---

func (h *Hub) handleCreateRoom(c *Client, msg protocol.ClientMsg) {
	if msg.Nickname == "" {
		c.sendError("nickname required")
		return
	}
	code := h.generateCode()
	room := game.NewRoom(code)
	if err := room.Join(msg.Nickname); err != nil {
		c.sendError(err.Error())
		return
	}
	h.rooms[code] = room
	c.roomCode = code
	c.playerID = 0
	h.roomMembers[code] = []*Client{c}
	h.statRooms.Add(1)

	tok := h.issueToken(code, 0)
	c.Send(protocol.ServerMsg{
		Type:         protocol.SMsgRoomCreated,
		RoomCode:     code,
		PlayerID:     0,
		Players:      h.playerList(room),
		SessionToken: tok,
	})
}

func (h *Hub) handleJoinRoom(c *Client, msg protocol.ClientMsg) {
	if msg.Nickname == "" {
		c.sendError("nickname required")
		return
	}
	code := strings.ToUpper(msg.RoomCode)
	room, ok := h.rooms[code]
	if !ok {
		c.sendError("room not found")
		return
	}

	// If the game is already in progress, check for a disconnected slot with this nickname.
	if room.Status == game.StatusPlaying {
		if playerID, found := h.findDisconnectedSlot(code, msg.Nickname); found {
			// Validate session token to prevent slot hijacking.
			if !h.validateToken(code, playerID, msg.SessionToken) {
				c.sendError("invalid session token for reconnect")
				return
			}
			h.handleReconnect(c, room, code, playerID, msg.Nickname)
			return
		}
		c.sendError("game already in progress")
		return
	}

	if err := room.Join(msg.Nickname); err != nil {
		c.sendError(err.Error())
		return
	}
	playerID := len(room.Players) - 1
	c.roomCode = code
	c.playerID = playerID
	h.roomMembers[code] = append(h.roomMembers[code], c)

	tok := h.issueToken(code, playerID)
	// Notify the joining client
	c.Send(protocol.ServerMsg{
		Type:         protocol.SMsgRoomJoined,
		RoomCode:     code,
		PlayerID:     playerID,
		Players:      h.playerList(room),
		SessionToken: tok,
	})

	// Notify others
	h.broadcastToRoom(code, protocol.ServerMsg{
		Type:     protocol.SMsgPlayerJoined,
		Nickname: msg.Nickname,
		Players:  h.playerList(room),
	}, c)
}

func (h *Hub) handleStartGame(c *Client, msg protocol.ClientMsg) {
	room, ok := h.roomOf(c)
	if !ok {
		return
	}
	if c.playerID != 0 {
		c.sendError("only the room owner can start the game")
		return
	}
	if err := room.Start(); err != nil {
		c.sendError(err.Error())
		return
	}

	// Send each player their personalized game state
	members := h.roomMembers[c.roomCode]
	for i, member := range members {
		if member == nil {
			// Bot slot: send no WebSocket message, but we still need to know their index.
			_ = i
			continue
		}
		member.Send(protocol.ServerMsg{
			Type:  protocol.SMsgGameStarted,
			State: h.playerGameState(room, member.playerID),
		})
	}
	h.maybeScheduleBot(c.roomCode, room)
}

// --- Gameplay handlers ---

func (h *Hub) handlePlayCard(c *Client, msg protocol.ClientMsg) {
	room, ok := h.roomOf(c)
	if !ok {
		return
	}
	if msg.Card == nil {
		c.sendError("card required")
		return
	}
	card, chosenColor, err := dtoToCard(msg.Card, msg.ChosenColor)
	if err != nil {
		c.sendError(err.Error())
		return
	}
	if err := room.PlayCard(c.playerID, card, chosenColor); err != nil {
		c.sendError(err.Error())
		return
	}

	state := room.State
	topCard := state.Discard[len(state.Discard)-1]

	h.broadcastToRoomAll(c.roomCode, protocol.ServerMsg{
		Type:        protocol.SMsgCardPlayed,
		PlayerIndex: c.playerID,
		Card:        cardToDTO(topCard),
		Turn:        state.CurrentTurn,
		PendingDraw: state.PendingDraw,
	})

	if room.Status == game.StatusFinished {
		h.broadcastToRoomAll(c.roomCode, protocol.ServerMsg{
			Type:   protocol.SMsgGameOver,
			Winner: room.Winner,
		})
		return
	}
	h.maybeScheduleBot(c.roomCode, room)
}

func (h *Hub) handleDrawCard(c *Client, msg protocol.ClientMsg) {
	room, ok := h.roomOf(c)
	if !ok {
		return
	}
	if err := room.DrawCard(c.playerID); err != nil {
		c.sendError(err.Error())
		return
	}
	state := room.State
	hand := state.Hands[c.playerID]
	drawn := hand.Cards[len(hand.Cards)-1]

	// Tell the drawing player their new card
	c.Send(protocol.ServerMsg{
		Type: protocol.SMsgCardDrawn,
		Card: cardToDTO(drawn),
		Turn: state.CurrentTurn,
	})
	// Tell others hand size changed
	h.broadcastToRoom(c.roomCode, protocol.ServerMsg{
		Type:        protocol.SMsgCardDrawn,
		PlayerIndex: c.playerID,
		Turn:        state.CurrentTurn,
	}, c)
	h.maybeScheduleBot(c.roomCode, room)
}

func (h *Hub) handlePassTurn(c *Client, msg protocol.ClientMsg) {
	room, ok := h.roomOf(c)
	if !ok {
		return
	}
	if err := room.PassTurn(c.playerID); err != nil {
		c.sendError(err.Error())
		return
	}
	h.broadcastToRoomAll(c.roomCode, protocol.ServerMsg{
		Type: protocol.SMsgTurnChanged,
		Turn: room.State.CurrentTurn,
	})
	h.maybeScheduleBot(c.roomCode, room)
}

func (h *Hub) handleDeclareUno(c *Client, msg protocol.ClientMsg) {
	room, ok := h.roomOf(c)
	if !ok {
		return
	}
	if err := room.DeclareLastCard(c.playerID); err != nil {
		c.sendError(err.Error())
		return
	}
	h.broadcastToRoomAll(c.roomCode, protocol.ServerMsg{
		Type:        protocol.SMsgUnoDeclared,
		PlayerIndex: c.playerID,
	})
}

func (h *Hub) handleCatchUno(c *Client, msg protocol.ClientMsg) {
	room, ok := h.roomOf(c)
	if !ok {
		return
	}
	// The target is specified in PlayerIndex field (re-use Turn field)
	target := msg.Card // we borrow card DTO for the target index; see below
	// Actually: add a TargetIndex field. For now, use a convention:
	// The client sends { "type": "catch_uno", "player_index": <target> }
	// We'll parse it from a field we haven't added yet. Let me use an int in ClientMsg.
	// Since we don't have a dedicated field, we'll use the room-level default: try to catch
	// whoever last played to 1 card.
	_ = target
	targetIdx := room.State.LastCardPlayer
	if err := room.CatchUndeclared(c.playerID, targetIdx, time.Now()); err != nil {
		c.sendError(err.Error())
		return
	}
	h.broadcastToRoomAll(c.roomCode, protocol.ServerMsg{
		Type:        protocol.SMsgUnoCaught,
		PlayerIndex: targetIdx,
	})
}

func (h *Hub) handleCounterDraw(c *Client, msg protocol.ClientMsg) {
	room, ok := h.roomOf(c)
	if !ok {
		return
	}
	if msg.Card == nil {
		c.sendError("card required")
		return
	}
	card, chosenColor, err := dtoToCard(msg.Card, msg.ChosenColor)
	if err != nil {
		c.sendError(err.Error())
		return
	}
	if err := room.CounterDraw(c.playerID, card, chosenColor); err != nil {
		c.sendError(err.Error())
		return
	}
	state := room.State
	h.broadcastToRoomAll(c.roomCode, protocol.ServerMsg{
		Type:        protocol.SMsgCardPlayed,
		PlayerIndex: c.playerID,
		Card:        cardToDTO(state.Discard[len(state.Discard)-1]),
		Turn:        state.CurrentTurn,
		PendingDraw: state.PendingDraw,
	})
	h.maybeScheduleBot(c.roomCode, room)
}

// --- Disconnect handling ---

func (h *Hub) handleDisconnect(c *Client) {
	if c.roomCode == "" {
		return
	}
	room, ok := h.rooms[c.roomCode]
	if !ok {
		return
	}
	members := h.roomMembers[c.roomCode]
	nickname := ""
	if c.playerID < len(room.Players) {
		nickname = room.Players[c.playerID].Nickname
	}

	// During an active game: mark slot as nil, record disconnect time, allow reconnect.
	if room.Status == game.StatusPlaying {
		if c.playerID < len(members) {
			members[c.playerID] = nil
		}
		if h.disconnectedAt[c.roomCode] == nil {
			h.disconnectedAt[c.roomCode] = make(map[int]time.Time)
		}
		disconnectTime := time.Now()
		h.disconnectedAt[c.roomCode][c.playerID] = disconnectTime

		h.broadcastToRoomAll(c.roomCode, protocol.ServerMsg{
			Type:        protocol.SMsgPlayerDisconnected,
			PlayerIndex: c.playerID,
			Nickname:    nickname,
			Players:     h.playerList(room),
		})

		// Schedule reconnect expiry.
		go func(code string, pid int, t time.Time) {
			time.Sleep(reconnectTimeout)
			h.expire <- expireMsg{roomCode: code, playerID: pid, disconnectedAt: t}
		}(c.roomCode, c.playerID, disconnectTime)
		return
	}

	// Lobby / finished: remove from member list entirely.
	newMembers := make([]*Client, 0, len(members))
	for _, m := range members {
		if m != c {
			newMembers = append(newMembers, m)
		}
	}
	h.roomMembers[c.roomCode] = newMembers

	if len(newMembers) == 0 {
		delete(h.rooms, c.roomCode)
		delete(h.roomMembers, c.roomCode)
		delete(h.sessionTokens, c.roomCode)
		h.statRooms.Add(-1)
		return
	}

	h.broadcastToRoomAll(c.roomCode, protocol.ServerMsg{
		Type:     protocol.SMsgPlayerLeft,
		Nickname: nickname,
		Players:  h.playerList(room),
	})
}

// handleExpireReconnect fires when a disconnected player's reconnect window closes.
func (h *Hub) handleExpireReconnect(em expireMsg) {
	slots, ok := h.disconnectedAt[em.roomCode]
	if !ok {
		return // player already reconnected, slots map was cleaned up
	}
	at, ok := slots[em.playerID]
	if !ok {
		return // player already reconnected
	}
	// If the recorded time differs, the player disconnected again more recently;
	// a newer expire goroutine will handle that one.
	if at != em.disconnectedAt {
		return
	}

	delete(slots, em.playerID)
	if len(slots) == 0 {
		delete(h.disconnectedAt, em.roomCode)
	}

	room, ok := h.rooms[em.roomCode]
	if !ok {
		return
	}
	nickname := ""
	if em.playerID < len(room.Players) {
		nickname = room.Players[em.playerID].Nickname
	}

	h.broadcastToRoomAll(em.roomCode, protocol.ServerMsg{
		Type:     protocol.SMsgPlayerLeft,
		Nickname: nickname,
		Players:  h.playerList(room),
	})

	// If no connected members remain, delete the room.
	members := h.roomMembers[em.roomCode]
	for _, m := range members {
		if m != nil {
			return // at least one connected player remains
		}
	}
	delete(h.rooms, em.roomCode)
	delete(h.roomMembers, em.roomCode)
	delete(h.sessionTokens, em.roomCode)
	h.statRooms.Add(-1)
}

// findDisconnectedSlot returns the playerID of a disconnected player matching nickname, if any.
func (h *Hub) findDisconnectedSlot(code, nickname string) (int, bool) {
	slots, ok := h.disconnectedAt[code]
	if !ok {
		return 0, false
	}
	room, ok := h.rooms[code]
	if !ok {
		return 0, false
	}
	for playerID := range slots {
		if playerID < len(room.Players) && room.Players[playerID].Nickname == nickname {
			return playerID, true
		}
	}
	return 0, false
}

// handleReconnect restores a disconnected player's slot and sends them their game state.
func (h *Hub) handleReconnect(c *Client, room *game.Room, code string, playerID int, nickname string) {
	members := h.roomMembers[code]
	if playerID < len(members) {
		members[playerID] = c
	}
	c.roomCode = code
	c.playerID = playerID

	// Clear disconnected entry.
	if slots := h.disconnectedAt[code]; slots != nil {
		delete(slots, playerID)
		if len(slots) == 0 {
			delete(h.disconnectedAt, code)
		}
	}

	// Send full game state to the reconnecting player.
	c.Send(protocol.ServerMsg{
		Type:     protocol.SMsgPlayerReconnected,
		RoomCode: code,
		PlayerID: playerID,
		State:    h.playerGameState(room, playerID),
		Players:  h.playerList(room),
	})

	// Notify others of the reconnect.
	h.broadcastToRoom(code, protocol.ServerMsg{
		Type:        protocol.SMsgPlayerReconnected,
		PlayerIndex: playerID,
		Nickname:    nickname,
		Players:     h.playerList(room),
	}, c)
}

// --- Bot support ---

const botThinkDelay = 800 * time.Millisecond

// handleAddBot adds a bot player to the lobby (host-only).
func (h *Hub) handleAddBot(c *Client, msg protocol.ClientMsg) {
	room, ok := h.roomOf(c)
	if !ok {
		return
	}
	if c.playerID != 0 {
		c.sendError("only the room owner can add bots")
		return
	}
	if room.Status != game.StatusLobby {
		c.sendError("can only add bots in the lobby")
		return
	}
	botNum := len(room.Players) + 1
	nickname := fmt.Sprintf("Bot%d", botNum)
	if err := room.Join(nickname); err != nil {
		c.sendError(err.Error())
		return
	}
	botID := len(room.Players) - 1
	code := c.roomCode
	if h.botSlots[code] == nil {
		h.botSlots[code] = make(map[int]struct{})
	}
	h.botSlots[code][botID] = struct{}{}
	// Bots occupy a nil slot in roomMembers.
	h.roomMembers[code] = append(h.roomMembers[code], nil)

	h.broadcastToRoomAll(code, protocol.ServerMsg{
		Type:     protocol.SMsgPlayerJoined,
		Nickname: nickname,
		Players:  h.playerList(room),
	})
}

// scheduleBotMove fires a bot turn after a short think delay.
func (h *Hub) scheduleBotMove(code string, playerID int) {
	go func() {
		time.Sleep(botThinkDelay)
		h.botMove <- botMoveMsg{roomCode: code, playerID: playerID}
	}()
}

// maybeScheduleBot checks whether the current turn belongs to a bot and schedules its move.
func (h *Hub) maybeScheduleBot(code string, room *game.Room) {
	if room.Status != game.StatusPlaying {
		return
	}
	bots, ok := h.botSlots[code]
	if !ok {
		return
	}
	turn := room.State.CurrentTurn
	if _, isBot := bots[turn]; isBot {
		h.scheduleBotMove(code, turn)
	}
}

// executeBotMove runs the bot's chosen action on behalf of its player slot.
func (h *Hub) executeBotMove(bm botMoveMsg) {
	room, ok := h.rooms[bm.roomCode]
	if !ok {
		return
	}
	if room.Status != game.StatusPlaying {
		return
	}
	if room.State.CurrentTurn != bm.playerID {
		return // turn moved on (e.g. another bot already acted)
	}
	bots := h.botSlots[bm.roomCode]
	if _, isBot := bots[bm.playerID]; !isBot {
		return
	}

	action := game.BotThink(room.State, bm.playerID)
	code := bm.roomCode

	switch action.Kind {
	case game.BotPlay:
		if err := room.PlayCard(bm.playerID, action.Card, action.ChosenColor); err != nil {
			log.Printf("bot play error: %v", err)
			return
		}
		state := room.State
		topCard := state.Discard[len(state.Discard)-1]
		h.broadcastToRoomAll(code, protocol.ServerMsg{
			Type:        protocol.SMsgCardPlayed,
			PlayerIndex: bm.playerID,
			Card:        cardToDTO(topCard),
			Turn:        state.CurrentTurn,
			PendingDraw: state.PendingDraw,
		})
		if room.Status == game.StatusFinished {
			h.broadcastToRoomAll(code, protocol.ServerMsg{
				Type:   protocol.SMsgGameOver,
				Winner: room.Winner,
			})
			return
		}
		// Auto-declare UNO if bot is at 1 card
		if room.State.Hands[bm.playerID].Size() == 1 {
			_ = room.DeclareLastCard(bm.playerID)
			h.broadcastToRoomAll(code, protocol.ServerMsg{
				Type:        protocol.SMsgUnoDeclared,
				PlayerIndex: bm.playerID,
			})
		}

	case game.BotCounter:
		if err := room.CounterDraw(bm.playerID, action.Card, action.ChosenColor); err != nil {
			log.Printf("bot counter error: %v", err)
			return
		}
		state := room.State
		h.broadcastToRoomAll(code, protocol.ServerMsg{
			Type:        protocol.SMsgCardPlayed,
			PlayerIndex: bm.playerID,
			Card:        cardToDTO(state.Discard[len(state.Discard)-1]),
			Turn:        state.CurrentTurn,
			PendingDraw: state.PendingDraw,
		})

	case game.BotDraw:
		if err := room.DrawCard(bm.playerID); err != nil {
			log.Printf("bot draw error: %v", err)
			return
		}
		state := room.State
		h.broadcastToRoomAll(code, protocol.ServerMsg{
			Type:        protocol.SMsgCardDrawn,
			PlayerIndex: bm.playerID,
			Turn:        state.CurrentTurn,
		})
		// After drawing, bot passes if it can't play
		if state.CurrentTurn == bm.playerID {
			hand := state.Hands[bm.playerID]
			topCard := state.Discard[len(state.Discard)-1]
			canPlay := false
			for _, c := range hand.Cards {
				if game.CanPlay(c, topCard, state.ActiveColor) {
					canPlay = true
					break
				}
			}
			if !canPlay {
				if err := room.PassTurn(bm.playerID); err == nil {
					h.broadcastToRoomAll(code, protocol.ServerMsg{
						Type: protocol.SMsgTurnChanged,
						Turn: room.State.CurrentTurn,
					})
				}
			} else {
				// Schedule another bot move to play the drawn card
				h.scheduleBotMove(code, bm.playerID)
				return
			}
		}
	}

	h.maybeScheduleBot(code, room)
}

// --- Broadcast helpers ---

func (h *Hub) broadcastToRoom(code string, msg protocol.ServerMsg, exclude *Client) {
	for _, c := range h.roomMembers[code] {
		if c != nil && c != exclude {
			c.Send(msg)
		}
	}
}

func (h *Hub) broadcastToRoomAll(code string, msg protocol.ServerMsg) {
	h.broadcastToRoom(code, msg, nil)
}

// --- State helpers ---

func (h *Hub) roomOf(c *Client) (*game.Room, bool) {
	if c.roomCode == "" {
		c.sendError("not in a room")
		return nil, false
	}
	room, ok := h.rooms[c.roomCode]
	if !ok {
		c.sendError("room not found")
		return nil, false
	}
	return room, true
}

func (h *Hub) playerList(room *game.Room) []protocol.PlayerDTO {
	code := room.Code
	slots := h.disconnectedAt[code]
	ps := make([]protocol.PlayerDTO, len(room.Players))
	for i, p := range room.Players {
		handSize := 0
		if room.State != nil {
			handSize = room.State.Hands[i].Size()
		}
		connected := true
		if slots != nil {
			if _, disconnected := slots[i]; disconnected {
				connected = false
			}
		}
		ps[i] = protocol.PlayerDTO{
			Index:     p.Index,
			Nickname:  p.Nickname,
			HandSize:  handSize,
			Connected: connected,
		}
	}
	return ps
}

func (h *Hub) playerGameState(room *game.Room, playerIdx int) *protocol.GameStateDTO {
	state := room.State
	hand := make([]protocol.CardDTO, len(state.Hands[playerIdx].Cards))
	for i, c := range state.Hands[playerIdx].Cards {
		hand[i] = *cardToDTO(c)
	}
	top := state.Discard[len(state.Discard)-1]

	eventLog := make([]protocol.GameEventDTO, len(state.EventLog))
	for i, ev := range state.EventLog {
		dto := protocol.GameEventDTO{
			Kind:        string(ev.Kind),
			PlayerIndex: ev.PlayerIndex,
			At:          ev.At.UnixMilli(),
		}
		if ev.Card != nil {
			dto.Card = cardToDTO(*ev.Card)
		}
		if ev.ChosenColor != 0 {
			dto.ChosenColor = colorName(ev.ChosenColor)
		}
		eventLog[i] = dto
	}

	return &protocol.GameStateDTO{
		YourIndex:   playerIdx,
		Hand:        hand,
		Players:     h.playerList(room),
		Discard:     *cardToDTO(top),
		ActiveColor: colorName(state.ActiveColor),
		Turn:        state.CurrentTurn,
		Direction:   state.Direction,
		PendingDraw: state.PendingDraw,
		EventLog:    eventLog,
	}
}

// --- Code generation ---

func (h *Hub) generateCode() string {
	const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	for {
		code := make([]byte, 4)
		for i := range code {
			code[i] = chars[mrand.Intn(len(chars))]
		}
		s := string(code)
		if _, exists := h.rooms[s]; !exists {
			return s
		}
	}
}

// --- DTO conversion ---

func cardToDTO(c game.Card) *protocol.CardDTO {
	return &protocol.CardDTO{
		Color: colorName(c.Color),
		Kind:  c.Kind.String(),
		Value: c.Value,
	}
}

func dtoToCard(dto *protocol.CardDTO, chosenColorStr string) (game.Card, game.Color, error) {
	col, err := parseColor(dto.Color)
	if err != nil {
		return game.Card{}, 0, err
	}
	kind, err := parseKind(dto.Kind)
	if err != nil {
		return game.Card{}, 0, err
	}
	chosen := col
	if dto.Color == "wild" || dto.Color == "" {
		chosen, err = parseColor(chosenColorStr)
		if err != nil {
			return game.Card{}, 0, fmt.Errorf("chosen_color required for wild: %w", err)
		}
	}
	return game.Card{Color: col, Kind: kind, Value: dto.Value}, chosen, nil
}

func colorName(c game.Color) string { return c.String() }

func parseColor(s string) (game.Color, error) {
	switch strings.ToLower(s) {
	case "red":
		return game.Red, nil
	case "yellow":
		return game.Yellow, nil
	case "green":
		return game.Green, nil
	case "blue":
		return game.Blue, nil
	case "wild", "":
		return game.Wild, nil
	}
	return 0, fmt.Errorf("unknown color: %q", s)
}

func parseKind(s string) (game.Kind, error) {
	switch strings.ToLower(s) {
	case "number":
		return game.Number, nil
	case "skip":
		return game.Skip, nil
	case "reverse":
		return game.Reverse, nil
	case "draw_two":
		return game.DrawTwo, nil
	case "wild":
		return game.WildCard, nil
	case "wild_draw_four":
		return game.WildDrawFour, nil
	}
	return 0, fmt.Errorf("unknown kind: %q", s)
}
