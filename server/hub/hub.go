// Package hub manages WebSocket connections and routes game messages.
package hub

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	mrand "math/rand"
	"net/http"
	"os"
	"runtime"
	"strings"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
	"loco/server/game"
	"loco/server/protocol"
)

// EmptyRoomTimeout is how long an empty room is kept before deletion.
// Exported so tests can override it.
var EmptyRoomTimeout = 5 * time.Minute

// ReconnectTimeout is how long a disconnected in-game player's slot is held.
// Exported so tests can override it.
var ReconnectTimeout = 60 * time.Second

// TurnTimeout is how long a human player has to act before the server auto-draws or auto-passes.
// Exported so tests can override it.
var TurnTimeout = 30 * time.Second

// AFKKickThreshold is the number of consecutive turn-timeouts (without any voluntary
// action) after which a human player is kicked from the game. Default 4 ≈ two full
// rounds in a 2-player game. Exported so tests can override it.
var AFKKickThreshold = 4

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true // allow all origins in development; restrict in production
	},
}

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

// cleanupMsg is sent internally when an empty room's cleanup timer fires.
type cleanupMsg struct {
	roomCode string
	emptyAt  time.Time
}

// turnTimerMsg is sent internally when a player's turn timer expires.
type turnTimerMsg struct {
	roomCode      string
	playerID      int
	turnStartedAt time.Time
}

// unoMsg is sent internally to broadcast a delayed bot UNO declaration.
type unoMsg struct {
	roomCode    string
	playerIndex int
}

// botCatchMsg is sent internally when a bot should attempt to catch an undeclared UNO.
type botCatchMsg struct {
	roomCode     string
	targetPlayer int
	lastCardTime time.Time // stale-check: must match room.State.LastCardTime at execution
}

// Hub manages all active rooms and connected clients.
type Hub struct {
	rooms   map[string]*game.Room
	clients map[*Client]struct{}
	// roomMembers[code] is indexed by playerID; nil means that slot is currently disconnected.
	roomMembers map[string][]*Client
	// disconnectedAt[code][playerID] = time of disconnect (only set during StatusPlaying).
	disconnectedAt map[string]map[int]time.Time
	// sessionTokens[code][playerID] = opaque token for reconnect authentication.
	sessionTokens map[string]map[int]string
	// emptyRooms[code] = time when room became empty; used to race-safely cancel cleanup.
	emptyRooms map[string]time.Time

	// botSlots[code] is a set of playerIDs that are bots.
	botSlots map[string]map[int]struct{}

	// turnStartedAt[code] = time when the current turn began (for stale-timer detection).
	turnStartedAt map[string]time.Time

	// afkTimeouts[code][playerID] = consecutive turn-timeout count (reset on any voluntary action).
	// When the count reaches AFKKickThreshold the player is force-disconnected.
	afkTimeouts map[string]map[int]int

	register    chan *Client
	unregister  chan *Client
	inbound     chan inboundMsg
	expire      chan expireMsg
	botMove      chan botMoveMsg   // scheduled bot actions
	cleanup      chan cleanupMsg   // empty-room cleanup timers
	turnTimeout  chan turnTimerMsg // per-turn timeout actions
	unoAnnounce  chan unoMsg       // delayed bot UNO declaration broadcasts
	botCatch     chan botCatchMsg  // scheduled bot catch-UNO attempts

	// afterRegisterHook is called in the register case after the client is added
	// to h.clients but before c.start(). Runs in the hub event-loop goroutine.
	// Nil by default; set via export_test.go for deterministic race tests only.
	afterRegisterHook func()

	// Atomic stats — safe to read from any goroutine (health/metrics endpoints).
	statRooms                atomic.Int32
	statClients              atomic.Int32
	statMatchesStarted       atomic.Int32
	statMatchesFinished      atomic.Int32
	statBotsActive           atomic.Int32
	statMessagesRateLimited  atomic.Int64 // inbound messages dropped for exceeding the per-client token bucket
	statMessagesDroppedBusy  atomic.Int64 // inbound messages dropped because h.inbound was full
	statSlowClientsClosed    atomic.Int64 // clients force-closed because their send buffer overflowed
	statChannelRetries       atomic.Int64 // botMove/expire/cleanup channel-pressure retries
	statSuspectedCheats      atomic.Int64 // gameplay validation rejections that look like exploit attempts
	statReconnectExpirations atomic.Int64 // reconnect windows that expired without the player coming back
	startTime                time.Time
}

// HealthStats is a snapshot of hub metrics for the health endpoint.
type HealthStats struct {
	Status    string `json:"status"`
	Rooms     int32  `json:"rooms"`
	Clients   int32  `json:"clients"`
	UptimeSec int64  `json:"uptime_sec"`
}

// MetricsStats is the full metrics payload for GET /metrics.
type MetricsStats struct {
	RoomsActive          int32 `json:"rooms_active"`
	PlayersConnected     int32 `json:"players_connected"`
	MatchesStarted       int32 `json:"matches_started"`
	MatchesFinished      int32 `json:"matches_finished"`
	BotsActive           int32 `json:"bots_active"`
	UptimeSec            int64 `json:"uptime_sec"`
	GoroutineCount       int   `json:"goroutine_count"`
	MessagesRateLimited  int64 `json:"messages_rate_limited"`
	MessagesDroppedBusy  int64 `json:"messages_dropped_busy"`
	SlowClientsClosed    int64 `json:"slow_clients_closed"`
	ChannelRetries       int64 `json:"channel_retries"`
	SuspectedCheats      int64 `json:"suspected_cheats"`
	ReconnectExpirations int64 `json:"reconnect_expirations"`
	DebugModeActive      bool  `json:"debug_mode_active"`
}

// New creates and returns a Hub.
func New() *Hub {
	return &Hub{
		rooms:          make(map[string]*game.Room),
		clients:        make(map[*Client]struct{}),
		roomMembers:    make(map[string][]*Client),
		disconnectedAt: make(map[string]map[int]time.Time),
		sessionTokens:  make(map[string]map[int]string),
		emptyRooms:     make(map[string]time.Time),
		botSlots:       make(map[string]map[int]struct{}),
		turnStartedAt:  make(map[string]time.Time),
		afkTimeouts:    make(map[string]map[int]int),
		register:       make(chan *Client, 16),
		unregister:     make(chan *Client, 16),
		inbound:        make(chan inboundMsg, 256),
		expire:         make(chan expireMsg, 64),
		botMove:        make(chan botMoveMsg, 64),
		cleanup:        make(chan cleanupMsg, 64),
		turnTimeout:    make(chan turnTimerMsg, 64),
		unoAnnounce:    make(chan unoMsg, 64),
		botCatch:       make(chan botCatchMsg, 64),
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

// GetMetrics returns the full metrics payload safe to call from any goroutine.
func (h *Hub) GetMetrics() MetricsStats {
	return MetricsStats{
		RoomsActive:          h.statRooms.Load(),
		PlayersConnected:     h.statClients.Load(),
		MatchesStarted:       h.statMatchesStarted.Load(),
		MatchesFinished:      h.statMatchesFinished.Load(),
		BotsActive:           h.statBotsActive.Load(),
		UptimeSec:            int64(time.Since(h.startTime).Seconds()),
		GoroutineCount:       runtime.NumGoroutine(),
		MessagesRateLimited:  h.statMessagesRateLimited.Load(),
		MessagesDroppedBusy:  h.statMessagesDroppedBusy.Load(),
		SlowClientsClosed:    h.statSlowClientsClosed.Load(),
		ChannelRetries:       h.statChannelRetries.Load(),
		SuspectedCheats:      h.statSuspectedCheats.Load(),
		ReconnectExpirations: h.statReconnectExpirations.Load(),
		DebugModeActive:      os.Getenv("LOCO_E2E") == "1",
	}
}

// Run starts the hub event loop. Call in a goroutine.
func (h *Hub) Run() {
	for {
		select {
		case c := <-h.register:
			h.clients[c] = struct{}{}
			h.statClients.Add(1)
			log.Printf("player connected conn=%s addr=%s", c.connID, c.conn.RemoteAddr())
			if h.afterRegisterHook != nil {
				h.afterRegisterHook()
			}
			// Start pumps after registration so readPump's unregister call is
			// never processed before the register, preventing zombie clients.
			c.start()

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

		case cm := <-h.cleanup:
			h.handleCleanup(cm)

		case tm := <-h.turnTimeout:
			h.handleTurnTimeout(tm)

		case um := <-h.unoAnnounce:
			h.handleUnoAnnounce(um)

		case cm := <-h.botCatch:
			h.handleBotCatch(cm)
		}
	}
}

// ServeWS upgrades an HTTP connection to WebSocket and registers the client.
func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request) {
	log.Printf("ws request addr=%s origin=%q method=%s", r.RemoteAddr, r.Header.Get("Origin"), r.Method)
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("ws upgrade FAILED addr=%s origin=%q err=%v", r.RemoteAddr, r.Header.Get("Origin"), err)
		return
	}
	log.Printf("ws upgrade OK addr=%s", conn.RemoteAddr())
	c := newClient(h, conn)
	h.register <- c
}

// dispatch routes a client message to the appropriate handler.
//
// Replay protection: the protocol carries no nonces or sequence numbers.
// Replay defense is implicit in every gameplay handler — they validate
// against current authoritative state (CurrentTurn, top discard, PendingDraw,
// Hands[*].Contains, LastCardTime catch window, RoundEnded, MatchOver). A
// captured-and-replayed message will fail one of these checks the moment
// state has advanced past it, with the existing "not your turn" / "card not
// in hand" / "catch window expired" / "game not in progress" error responses.
// All identity fields (playerID, roomCode) are server-assigned at registration
// and never sourced from msg, so a replayed envelope cannot impersonate.
func (h *Hub) dispatch(c *Client, msg protocol.ClientMsg) {
	switch msg.Type {
	case protocol.CMsgCreateRoom:
		h.handleCreateRoom(c, msg)
	case protocol.CMsgJoinRoom:
		h.handleJoinRoom(c, msg)
	case protocol.CMsgStartGame:
		h.handleStartGame(c, msg)
	case protocol.CMsgAddBot:
		h.handleAddBot(c, msg)
	case protocol.CMsgSetMatchFormat:
		h.handleSetMatchFormat(c, msg)
	case protocol.CMsgSetMaxPlayers:
		h.handleSetMaxPlayers(c, msg)
	case protocol.CMsgPlayCard:
		h.resetAFK(c.roomCode, c.playerID)
		h.handlePlayCard(c, msg)
	case protocol.CMsgDrawCard:
		h.resetAFK(c.roomCode, c.playerID)
		h.handleDrawCard(c, msg)
	case protocol.CMsgPassTurn:
		h.resetAFK(c.roomCode, c.playerID)
		h.handlePassTurn(c, msg)
	case protocol.CMsgDeclareUno:
		h.resetAFK(c.roomCode, c.playerID)
		h.handleDeclareUno(c, msg)
	case protocol.CMsgCatchUno:
		h.resetAFK(c.roomCode, c.playerID)
		h.handleCatchUno(c, msg)
	case protocol.CMsgCounterDraw:
		h.resetAFK(c.roomCode, c.playerID)
		h.handleCounterDraw(c, msg)
	case protocol.CMsgInterruptPlay, protocol.CMsgInterruptPlayCard:
		h.resetAFK(c.roomCode, c.playerID)
		h.handleInterruptPlay(c, msg)
	case protocol.CMsgDebugSetState:
		h.handleDebugSetState(c, msg)
	default:
		c.sendError("unknown message type")
	}
}

// --- Lobby handlers ---

func (h *Hub) handleCreateRoom(c *Client, msg protocol.ClientMsg) {
	nickname := strings.TrimSpace(msg.Nickname)
	if len(nickname) == 0 || len(nickname) > 20 {
		c.sendError("nickname must be 1–20 characters")
		return
	}
	msg.Nickname = nickname
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
	// Room is no longer empty (host just joined).
	delete(h.emptyRooms, code)
	h.statRooms.Add(1)
	log.Printf("room created code=%s host=%s", code, msg.Nickname)

	tok := h.issueToken(code, 0)
	c.Send(protocol.ServerMsg{
		Type:         protocol.SMsgRoomCreated,
		RoomCode:     code,
		PlayerID:     0,
		Players:      h.playerList(room),
		SessionToken: tok,
		MatchFormat:  matchFormatString(room.Format),
		MaxPlayers:   room.MaxPlayers,
	})
}

func (h *Hub) handleJoinRoom(c *Client, msg protocol.ClientMsg) {
	nickname := strings.TrimSpace(msg.Nickname)
	if len(nickname) == 0 || len(nickname) > 20 {
		c.sendError("nickname must be 1–20 characters")
		return
	}
	msg.Nickname = nickname
	if !validRoomCode(msg.RoomCode) {
		c.sendError("invalid room code")
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
	// Room has a player — cancel any pending empty-room cleanup.
	delete(h.emptyRooms, code)

	tok := h.issueToken(code, playerID)
	// Notify the joining client
	c.Send(protocol.ServerMsg{
		Type:         protocol.SMsgRoomJoined,
		RoomCode:     code,
		PlayerID:     playerID,
		Players:      h.playerList(room),
		SessionToken: tok,
		MatchFormat:  matchFormatString(room.Format),
		MaxPlayers:   room.MaxPlayers,
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

	h.statMatchesStarted.Add(1)
	log.Printf("match started code=%s players=%d format=%s", c.roomCode, len(room.Players), matchFormatString(room.Format))

	h.scheduleTurnTimer(c.roomCode, room)

	// Send each player their personalized game state. Build the shared player
	// list once and reuse it across all recipients.
	members := h.roomMembers[c.roomCode]
	pl := h.playerList(room)
	for _, member := range members {
		if member == nil {
			continue
		}
		member.Send(protocol.ServerMsg{
			Type:  protocol.SMsgGameStarted,
			State: h.playerGameStateUsing(room, member.playerID, pl),
		})
	}
	h.maybeScheduleBot(c.roomCode, room)
}

func (h *Hub) handleSetMatchFormat(c *Client, msg protocol.ClientMsg) {
	room, ok := h.roomOf(c)
	if !ok {
		return
	}
	if c.playerID != 0 {
		c.sendError("only the host can change match format")
		return
	}
	f, err := parseMatchFormat(msg.MatchFormat)
	if err != nil {
		c.sendError(err.Error())
		return
	}
	if err := room.SetFormat(f); err != nil {
		c.sendError(err.Error())
		return
	}
	h.broadcastToRoomAll(c.roomCode, protocol.ServerMsg{
		Type:        protocol.SMsgLobbyConfigChanged,
		MatchFormat: matchFormatString(room.Format),
		MaxPlayers:  room.MaxPlayers,
	})
}

func (h *Hub) handleSetMaxPlayers(c *Client, msg protocol.ClientMsg) {
	room, ok := h.roomOf(c)
	if !ok {
		return
	}
	if c.playerID != 0 {
		c.sendError("only the host can change max players")
		return
	}
	if err := room.SetMaxPlayers(msg.MaxPlayers); err != nil {
		c.sendError(err.Error())
		return
	}
	h.broadcastToRoomAll(c.roomCode, protocol.ServerMsg{
		Type:        protocol.SMsgLobbyConfigChanged,
		MatchFormat: matchFormatString(room.Format),
		MaxPlayers:  room.MaxPlayers,
	})
}

// --- Gameplay handlers ---

func (h *Hub) handlePlayCard(c *Client, msg protocol.ClientMsg) {
	room, ok := h.roomOf(c)
	if !ok {
		return
	}
	chosenPlayer := -1
	if msg.ChosenPlayer != nil {
		chosenPlayer = *msg.ChosenPlayer
	}

	// Batch path: PlayCards (plural) takes precedence over singular Card.
	if len(msg.PlayCards) > 0 {
		cards := make([]game.Card, len(msg.PlayCards))
		var chosenColor game.Color
		for i, dto := range msg.PlayCards {
			card, cc, err := dtoToCard(&dto, msg.ChosenColor)
			if err != nil {
				c.sendError(err.Error())
				return
			}
			cards[i] = card
			chosenColor = cc
		}
		if err := room.PlayCards(c.playerID, cards, chosenColor, chosenPlayer); err != nil {
			c.sendError(err.Error())
			c.noteSuspect(err.Error())
			return
		}
		h.broadcastCardPlayed(c.roomCode, c.playerID, room, -1)
		h.maybeScheduleBotCatch(c.roomCode, room)
		h.handleRoundOrMatchEnd(c.roomCode, room)
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
	if err := room.PlayCard(c.playerID, card, chosenColor, chosenPlayer); err != nil {
		c.sendError(err.Error())
		c.noteSuspect(err.Error())
		return
	}

	h.broadcastCardPlayed(c.roomCode, c.playerID, room, chosenPlayer)
	if card.Kind == game.Swap || card.Kind == game.GlobalSwitch {
		h.broadcastPersonalizedGameState(c.roomCode, room)
	}
	h.maybeScheduleBotCatch(c.roomCode, room)
	h.handleRoundOrMatchEnd(c.roomCode, room)
}

func (h *Hub) handleRoundOrMatchEnd(code string, room *game.Room) {
	if !room.RoundEnded {
		if room.Status == game.StatusFinished {
			// Shouldn't happen with new system, but handle defensively
			h.broadcastToRoomAll(code, protocol.ServerMsg{
				Type:   protocol.SMsgGameOver,
				Winner: room.Winner,
			})
			return
		}
		h.maybeScheduleBot(code, room)
		return
	}

	room.RoundEnded = false
	scoreboard := h.buildScoreboard(room)

	// Broadcast round_end with scoreboard.
	// At this point room.State still reflects the round-winning play (BeginNextRound
	// has not yet been called), so RoundNumber is the just-completed round.
	h.broadcastToRoomAll(code, protocol.ServerMsg{
		Type:        protocol.SMsgRoundEnd,
		RoundNumber: room.RoundNumber,
		RoundWinner: room.Winner,
		Scoreboard:  scoreboard,
	})

	if room.MatchOver {
		h.statMatchesFinished.Add(1)
		log.Printf("match finished code=%s winner=%s", code, room.MatchWinner)
		h.broadcastToRoomAll(code, protocol.ServerMsg{
			Type:        protocol.SMsgMatchEnd,
			MatchWinner: room.MatchWinner,
			Scoreboard:  scoreboard,
		})
		return
	}

	// Deal the next round NOW that round_end has been broadcast.
	if err := room.BeginNextRound(); err != nil {
		log.Printf("WARN BeginNextRound failed code=%s err=%v", code, err)
		return
	}

	// New round started: schedule turn timer then send each player their
	// personalized state. Build the player list once and share across recipients.
	h.scheduleTurnTimer(code, room)
	members := h.roomMembers[code]
	pl := h.playerList(room)
	for _, member := range members {
		if member == nil {
			continue
		}
		member.Send(protocol.ServerMsg{
			Type:  protocol.SMsgGameStarted,
			State: h.playerGameStateUsing(room, member.playerID, pl),
		})
	}
	h.maybeScheduleBot(code, room)
}

func (h *Hub) handleDrawCard(c *Client, msg protocol.ClientMsg) {
	room, ok := h.roomOf(c)
	if !ok {
		return
	}
	priorSize := len(room.State.Hands[c.playerID].Cards)
	if err := room.DrawCard(c.playerID); err != nil {
		c.sendError(err.Error())
		c.noteSuspect(err.Error())
		return
	}
	state := room.State
	hand := state.Hands[c.playerID]
	newCards := hand.Cards[priorSize:]
	drawnCount := len(newCards)

	// Build DTOs for all newly drawn cards (sent privately to the drawing player).
	cardDTOs := make([]*protocol.CardDTO, drawnCount)
	for i, card := range newCards {
		cardDTOs[i] = cardToDTO(card)
	}

	// If drawing advanced the turn (penalty draw), reset the turn timer.
	if state.CurrentTurn != c.playerID {
		h.scheduleTurnTimer(c.roomCode, room)
	}
	dl := h.turnDeadlineMs(c.roomCode)

	// Tell the drawing player all their new cards plus the updated has_drawn flag.
	c.Send(protocol.ServerMsg{
		Type:         protocol.SMsgCardDrawn,
		PlayerIndex:  c.playerID,
		Cards:        cardDTOs,
		Turn:         state.CurrentTurn,
		HasDrawn:     state.HasDrawn,
		TurnDeadline: dl,
	})
	// Tell others how many cards changed hands so they can update the hand-size counter.
	h.broadcastToRoom(c.roomCode, protocol.ServerMsg{
		Type:         protocol.SMsgCardDrawn,
		PlayerIndex:  c.playerID,
		DrawnCount:   drawnCount,
		Turn:         state.CurrentTurn,
		TurnDeadline: dl,
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
		c.noteSuspect(err.Error())
		return
	}
	h.scheduleTurnTimer(c.roomCode, room)
	h.broadcastToRoomAll(c.roomCode, protocol.ServerMsg{
		Type:         protocol.SMsgTurnChanged,
		Turn:         room.State.CurrentTurn,
		TurnDeadline: h.turnDeadlineMs(c.roomCode),
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
		c.noteSuspect(err.Error())
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
	targetIdx := room.State.LastCardPlayer
	if err := room.CatchUndeclared(c.playerID, targetIdx, time.Now()); err != nil {
		c.sendError(err.Error())
		c.noteSuspect(err.Error())
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
		c.noteSuspect(err.Error())
		return
	}
	h.broadcastCardPlayed(c.roomCode, c.playerID, room, -1)
	h.maybeScheduleBotCatch(c.roomCode, room)
	h.handleRoundOrMatchEnd(c.roomCode, room)
}

func (h *Hub) handleInterruptPlay(c *Client, msg protocol.ClientMsg) {
	room, ok := h.roomOf(c)
	if !ok {
		return
	}
	chosenPlayer := -1
	if msg.ChosenPlayer != nil {
		chosenPlayer = *msg.ChosenPlayer
	}

	// Build the cards slice. PlayCards (batch) takes precedence over singular Card.
	var cards []game.Card
	if len(msg.PlayCards) > 0 {
		cards = make([]game.Card, len(msg.PlayCards))
		for i, dto := range msg.PlayCards {
			card, _, err := dtoToCard(&dto, "")
			if err != nil {
				c.sendError(err.Error())
				return
			}
			cards[i] = card
		}
	} else if msg.Card != nil {
		card, _, err := dtoToCard(msg.Card, "")
		if err != nil {
			c.sendError(err.Error())
			return
		}
		cards = []game.Card{card}
	} else {
		c.sendError("card required")
		return
	}

	if err := room.InterruptPlayCards(c.playerID, cards, chosenPlayer); err != nil {
		c.sendError(err.Error())
		c.noteSuspect(err.Error())
		return
	}

	// Emit a typed interrupt_success notification (in addition to the standard
	// card_played broadcast) so clients can render distinct lead-taking visuals.
	successCards := make([]*protocol.CardDTO, len(cards))
	for i, card := range cards {
		successCards[i] = cardToDTO(card)
	}
	h.broadcastToRoomAll(c.roomCode, protocol.ServerMsg{
		Type:        protocol.SMsgInterruptSuccess,
		PlayerIndex: c.playerID,
		Cards:       successCards,
	})
	h.broadcastCardPlayed(c.roomCode, c.playerID, room, chosenPlayer)
	h.maybeScheduleBotCatch(c.roomCode, room)
	h.handleRoundOrMatchEnd(c.roomCode, room)
}

// --- Disconnect handling ---

func (h *Hub) handleDisconnect(c *Client) {
	if c.roomCode == "" {
		log.Printf("player disconnected conn=%s addr=%s (no room)", c.connID, c.conn.RemoteAddr())
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

	log.Printf("player disconnected code=%s nickname=%s playerID=%d", c.roomCode, nickname, c.playerID)

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

		// Schedule reconnect expiry using time.AfterFunc to avoid long-lived goroutines.
		// If the expire channel is full, retry once after 5s; dropping permanently would
		// leave the player slot in disconnectedAt forever.
		code, pid := c.roomCode, c.playerID
		em := expireMsg{roomCode: code, playerID: pid, disconnectedAt: disconnectTime}
		time.AfterFunc(ReconnectTimeout, func() {
			select {
			case h.expire <- em:
			default:
				h.statChannelRetries.Add(1)
				log.Printf("expire channel full, retrying in 5s code=%s player=%d", code, pid)
				time.AfterFunc(5*time.Second, func() {
					select {
					case h.expire <- em:
					default:
						log.Printf("WARN expire retry dropped, slot may not be reclaimed code=%s player=%d", code, pid)
					}
				})
			}
		})

		// If all slots are now empty, start the room cleanup timer.
		if h.allSlotsEmpty(c.roomCode) {
			h.scheduleRoomCleanup(c.roomCode)
		}
		return
	}

	// Finished room: just drop the member from the slot list; player records are
	// no longer used for gameplay decisions.
	if room.Status == game.StatusFinished {
		newMembers := make([]*Client, 0, len(members))
		for _, m := range members {
			if m != c {
				newMembers = append(newMembers, m)
			}
		}
		h.roomMembers[c.roomCode] = newMembers
		if len(newMembers) == 0 {
			h.scheduleRoomCleanup(c.roomCode)
		}
		return
	}

	// Lobby: remove the player from room.Players and re-index everything keyed
	// on playerID (member slots, bot slots, session tokens, remaining clients'
	// playerID). Without this, a disconnected host (playerID 0) leaves a
	// phantom slot and no surviving player can ever start the game.
	leavingID := c.playerID
	if _, err := room.RemoveLobbyPlayer(leavingID); err != nil {
		log.Printf("WARN RemoveLobbyPlayer failed code=%s player=%d err=%v", c.roomCode, leavingID, err)
	}

	// Compact roomMembers by skipping the leaving client; remaining indices map
	// to the new room.Players indices because we removed the same slot from both.
	newMembers := make([]*Client, 0, len(members))
	for _, m := range members {
		if m != c {
			newMembers = append(newMembers, m)
		}
	}
	h.roomMembers[c.roomCode] = newMembers

	// Update each remaining client's playerID to match its new slot.
	for newIdx, m := range newMembers {
		if m != nil {
			m.playerID = newIdx
		}
	}

	// Re-index bot slots: every old index > leavingID shifts down by 1.
	if oldBots, ok := h.botSlots[c.roomCode]; ok {
		newBots := make(map[int]struct{}, len(oldBots))
		for oldIdx := range oldBots {
			if oldIdx == leavingID {
				continue
			}
			newIdx := oldIdx
			if oldIdx > leavingID {
				newIdx = oldIdx - 1
			}
			newBots[newIdx] = struct{}{}
		}
		h.botSlots[c.roomCode] = newBots
	}

	// Re-index session tokens the same way; drop the leaving slot's token.
	if oldTokens, ok := h.sessionTokens[c.roomCode]; ok {
		newTokens := make(map[int]string, len(oldTokens))
		for oldIdx, tok := range oldTokens {
			if oldIdx == leavingID {
				continue
			}
			newIdx := oldIdx
			if oldIdx > leavingID {
				newIdx = oldIdx - 1
			}
			newTokens[newIdx] = tok
		}
		h.sessionTokens[c.roomCode] = newTokens
	}

	// If only bots (or nothing) remain, no human can start the game; treat the
	// room as empty so the cleanup timer reclaims it.
	hasHuman := false
	for _, m := range newMembers {
		if m != nil {
			hasHuman = true
			break
		}
	}
	if !hasHuman {
		h.scheduleRoomCleanup(c.roomCode)
		return
	}

	h.broadcastToRoomAll(c.roomCode, protocol.ServerMsg{
		Type:     protocol.SMsgPlayerLeft,
		Nickname: nickname,
		Players:  h.playerList(room),
	})
}

// allSlotsEmpty returns true if every member slot in a room is nil (all disconnected).
func (h *Hub) allSlotsEmpty(code string) bool {
	for _, m := range h.roomMembers[code] {
		if m != nil {
			return false
		}
	}
	return true
}

// scheduleRoomCleanup starts a timer that will delete the room if it remains empty.
// Uses time.AfterFunc to avoid spawning long-lived goroutines.
// If the cleanup channel is full, retries once after 30s; dropping permanently
// would leave an empty room in memory until the process restarts.
func (h *Hub) scheduleRoomCleanup(code string) {
	t := time.Now()
	h.emptyRooms[code] = t
	cm := cleanupMsg{roomCode: code, emptyAt: t}
	time.AfterFunc(EmptyRoomTimeout, func() {
		select {
		case h.cleanup <- cm:
		default:
			h.statChannelRetries.Add(1)
			log.Printf("cleanup channel full, retrying room cleanup in 30s code=%s", code)
			time.AfterFunc(30*time.Second, func() {
				select {
				case h.cleanup <- cm:
				default:
					log.Printf("WARN cleanup retry dropped, room may leak code=%s", code)
				}
			})
		}
	})
}

// handleCleanup deletes an empty room if it has not been rejoined since the timer started.
func (h *Hub) handleCleanup(cm cleanupMsg) {
	at, ok := h.emptyRooms[cm.roomCode]
	if !ok || at != cm.emptyAt {
		// Room was rejoined or already deleted; the cleanup is stale.
		log.Printf("room cleanup skipped, room rejoined or already deleted code=%s", cm.roomCode)
		return
	}

	// Double-check no connected members (race-safe belt-and-suspenders guard).
	if !h.allSlotsEmpty(cm.roomCode) {
		delete(h.emptyRooms, cm.roomCode)
		log.Printf("room cleanup skipped, active members still present code=%s", cm.roomCode)
		return
	}

	h.deleteRoom(cm.roomCode)
}

// deleteRoom removes all hub state for a room and updates the stat counter.
func (h *Hub) deleteRoom(code string) {
	if bots, ok := h.botSlots[code]; ok {
		h.statBotsActive.Add(-int32(len(bots)))
	}
	delete(h.rooms, code)
	delete(h.roomMembers, code)
	delete(h.sessionTokens, code)
	delete(h.disconnectedAt, code)
	delete(h.emptyRooms, code)
	delete(h.botSlots, code)
	delete(h.turnStartedAt, code)
	delete(h.afkTimeouts, code)
	h.statRooms.Add(-1)
	log.Printf("room deleted code=%s", code)
}

// handleExpireReconnect fires when a disconnected player's reconnect window closes.
func (h *Hub) handleExpireReconnect(em expireMsg) {
	slots, ok := h.disconnectedAt[em.roomCode]
	if !ok {
		// Player reconnected before the timer fired; disconnectedAt map was cleared.
		log.Printf("reconnect expiry skipped, player reconnected code=%s player=%d", em.roomCode, em.playerID)
		return
	}
	at, ok := slots[em.playerID]
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
	h.statReconnectExpirations.Add(1)
	log.Printf("reconnect window expired code=%s player=%d", em.roomCode, em.playerID)

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

	// If no connected members remain, let the room cleanup timer handle deletion
	// (already scheduled when the last player disconnected).
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

	// Cancel any pending room cleanup (room is no longer empty).
	delete(h.emptyRooms, code)

	log.Printf("player reconnected code=%s nickname=%s playerID=%d", code, nickname, playerID)

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

// BotThinkDelay is the simulated thinking time before a bot acts.
// Exported so tests can reduce it to speed up bot-game tests.
var BotThinkDelay = 1200 * time.Millisecond

// BotJitterMax is the maximum random jitter added to bot think delays.
// Exported so tests can set it to 0 to make bot timing deterministic.
var BotJitterMax = 1000 * time.Millisecond

// BotUnoDelay is the base delay before a bot broadcasts its UNO declaration
// after playing to 1 card. Separate from BotThinkDelay so it feels like a
// distinct reaction rather than part of the card-play decision.
// Exported so tests can set it to 0.
var BotUnoDelay = 400 * time.Millisecond

// BotUnoJitterMax is the max random jitter added to BotUnoDelay.
// Exported so tests can set it to 0.
var BotUnoJitterMax = 400 * time.Millisecond

// BotCatchDelay is the base delay before a bot attempts to catch an undeclared UNO.
// Must be well under catchWindow (5s). 2s base gives bots time to "notice" without
// being instant. Exported so tests can set it to 0.
var BotCatchDelay = 2000 * time.Millisecond

// BotCatchJitterMax is the max random jitter added to BotCatchDelay, giving a
// total reaction window of BotCatchDelay to BotCatchDelay+BotCatchJitterMax (2–3.5s).
// Exported so tests can set it to 0.
var BotCatchJitterMax = 1500 * time.Millisecond

// BotCatchProb is the probability (0–1) that an eligible bot will catch an undeclared UNO.
// 0.65 means bots catch ~65% of the time, making them fallible like human opponents.
// Exported so tests can set it to a deterministic value.
var BotCatchProb float32 = 0.65

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
	h.statBotsActive.Add(1)
	// Bots occupy a nil slot in roomMembers.
	h.roomMembers[code] = append(h.roomMembers[code], nil)

	h.broadcastToRoomAll(code, protocol.ServerMsg{
		Type:     protocol.SMsgPlayerJoined,
		Nickname: nickname,
		Players:  h.playerList(room),
	})
}

// scheduleBotMove fires a bot turn after a short think delay.
// Uses time.AfterFunc to avoid spawning long-lived goroutines.
// If the botMove channel is full, retries once after 1s; dropping permanently
// would stall the game (no player would act on that turn).
func (h *Hub) scheduleBotMove(code string, playerID int) {
	bm := botMoveMsg{roomCode: code, playerID: playerID}
	// Add random jitter so bots don't all act at the same instant and feel more
	// like human reaction times. BotJitterMax can be set to 0 in tests.
	var jitter time.Duration
	if jm := int(BotJitterMax.Milliseconds()); jm > 0 {
		jitter = time.Duration(mrand.Intn(jm)) * time.Millisecond
	}
	time.AfterFunc(BotThinkDelay+jitter, func() {
		select {
		case h.botMove <- bm:
		default:
			h.statChannelRetries.Add(1)
			log.Printf("botMove channel full, retrying in 1s code=%s player=%d", code, playerID)
			time.AfterFunc(1*time.Second, func() {
				select {
				case h.botMove <- bm:
				default:
					log.Printf("WARN botMove retry dropped, game may stall code=%s player=%d", code, playerID)
				}
			})
		}
	})
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

// scheduleBotUnoAnnounce sends a delayed uno_declared broadcast for a bot that just
// played to 1 card. The server state is already updated (DeclareLastCard called);
// only the broadcast is deferred so it feels like a human reaction rather than instant.
func (h *Hub) scheduleBotUnoAnnounce(code string, playerIndex int) {
	var jitter time.Duration
	if jm := int(BotUnoJitterMax.Milliseconds()); jm > 0 {
		jitter = time.Duration(mrand.Intn(jm)) * time.Millisecond
	}
	um := unoMsg{roomCode: code, playerIndex: playerIndex}
	time.AfterFunc(BotUnoDelay+jitter, func() {
		select {
		case h.unoAnnounce <- um:
		default:
			// Non-critical: drop if channel full; catch window just closes without announcement.
		}
	})
}

// handleUnoAnnounce broadcasts a bot's UNO declaration if the room still exists.
func (h *Hub) handleUnoAnnounce(um unoMsg) {
	if _, ok := h.rooms[um.roomCode]; !ok {
		return // room deleted between schedule and fire
	}
	h.broadcastToRoomAll(um.roomCode, protocol.ServerMsg{
		Type:        protocol.SMsgUnoDeclared,
		PlayerIndex: um.playerIndex,
	})
}

// maybeScheduleBotCatch checks whether the most recent card play left a player at
// 1 card without declaring UNO, and if so, schedules a bot catch attempt.
// Must be called immediately after broadcastCardPlayed while room state is fresh.
func (h *Hub) maybeScheduleBotCatch(code string, room *game.Room) {
	if room.Status != game.StatusPlaying {
		return
	}
	bots, ok := h.botSlots[code]
	if !ok || len(bots) == 0 {
		return
	}
	state := room.State
	if state.LastCardDeclared {
		return // player already declared UNO — nothing to catch
	}
	target := state.LastCardPlayer
	if state.Hands[target].Size() != 1 {
		return // target doesn't have exactly 1 card
	}
	// Check at least one eligible bot exists (not the target).
	anyEligible := false
	for botID := range bots {
		if botID != target {
			anyEligible = true
			break
		}
	}
	if !anyEligible {
		return
	}

	var jitter time.Duration
	if jm := int(BotCatchJitterMax.Milliseconds()); jm > 0 {
		jitter = time.Duration(mrand.Intn(jm)) * time.Millisecond
	}
	cm := botCatchMsg{roomCode: code, targetPlayer: target, lastCardTime: state.LastCardTime}
	time.AfterFunc(BotCatchDelay+jitter, func() {
		select {
		case h.botCatch <- cm:
		default:
			// Non-critical: drop if channel full; catch window just closes naturally.
		}
	})
}

// handleBotCatch fires when a bot's catch-UNO timer expires. It re-validates game state,
// rolls the probability die, selects a random eligible bot, and issues the catch.
func (h *Hub) handleBotCatch(cm botCatchMsg) {
	room, ok := h.rooms[cm.roomCode]
	if !ok {
		return // room deleted
	}
	if room.Status != game.StatusPlaying {
		return
	}
	state := room.State
	// Stale check: if LastCardTime changed, a different card was played after we scheduled.
	if !state.LastCardTime.Equal(cm.lastCardTime) {
		return
	}
	if state.LastCardDeclared {
		return // target declared in time — no catch
	}
	if state.Hands[cm.targetPlayer].Size() != 1 {
		return // target no longer at 1 card (e.g. drew penalty cards)
	}
	// Probabilistic: bots don't always notice.
	if mrand.Float32() >= BotCatchProb {
		return
	}
	// Pick a random eligible bot.
	bots, ok := h.botSlots[cm.roomCode]
	if !ok || len(bots) == 0 {
		return
	}
	eligible := make([]int, 0, len(bots))
	for botID := range bots {
		if botID != cm.targetPlayer {
			eligible = append(eligible, botID)
		}
	}
	if len(eligible) == 0 {
		return
	}
	catcherID := eligible[mrand.Intn(len(eligible))]
	if err := room.CatchUndeclared(catcherID, cm.targetPlayer, time.Now()); err != nil {
		// Window may have expired or state changed — normal race condition.
		return
	}
	h.broadcastToRoomAll(cm.roomCode, protocol.ServerMsg{
		Type:        protocol.SMsgUnoCaught,
		PlayerIndex: cm.targetPlayer,
	})
}

// executeBotMove runs the bot's chosen action on behalf of its player slot.
func (h *Hub) executeBotMove(bm botMoveMsg) {
	room, ok := h.rooms[bm.roomCode]
	if !ok {
		// Room was deleted between scheduling and firing — normal after match end or cleanup.
		log.Printf("bot move skipped, room gone code=%s player=%d", bm.roomCode, bm.playerID)
		return
	}
	if room.Status != game.StatusPlaying {
		// Game ended or not yet started between scheduling and firing.
		log.Printf("bot move skipped, room not playing code=%s player=%d", bm.roomCode, bm.playerID)
		return
	}
	if room.State.CurrentTurn != bm.playerID {
		// Turn advanced (e.g. human played or another scheduled move already fired).
		// Very common during normal play — log only at debug level (omitted in prod).
		return
	}
	bots := h.botSlots[bm.roomCode]
	if _, isBot := bots[bm.playerID]; !isBot {
		// Slot is no longer a bot (should not happen under current logic).
		log.Printf("bot move skipped, not a bot slot code=%s player=%d", bm.roomCode, bm.playerID)
		return
	}

	action := game.BotThink(room.State, bm.playerID)
	code := bm.roomCode

	switch action.Kind {
	case game.BotPlay:
		if err := room.PlayCard(bm.playerID, action.Card, action.ChosenColor, action.ChosenPlayer); err != nil {
			log.Printf("bot play error: %v", err)
			return
		}
		h.broadcastCardPlayed(code, bm.playerID, room, action.ChosenPlayer)
		if action.Card.Kind == game.Swap || action.Card.Kind == game.GlobalSwitch {
			h.broadcastPersonalizedGameState(code, room)
		}

		// Auto-declare UNO if bot is at 1 card (broadcast delayed for human-like feel)
		if !room.RoundEnded && room.State.Hands[bm.playerID].Size() == 1 {
			_ = room.DeclareLastCard(bm.playerID)
			h.scheduleBotUnoAnnounce(code, bm.playerID)
		}

		h.handleRoundOrMatchEnd(code, room)
		return

	case game.BotCounter:
		if err := room.CounterDraw(bm.playerID, action.Card, action.ChosenColor); err != nil {
			log.Printf("bot counter error: %v", err)
			return
		}
		h.broadcastCardPlayed(code, bm.playerID, room, -1)

		// Auto-declare UNO if bot is at 1 card after counter (broadcast delayed for human-like feel)
		if !room.RoundEnded && room.State.Hands[bm.playerID].Size() == 1 {
			_ = room.DeclareLastCard(bm.playerID)
			h.scheduleBotUnoAnnounce(code, bm.playerID)
		}

		h.handleRoundOrMatchEnd(code, room)
		return

	case game.BotDraw:
		priorBotSize := len(room.State.Hands[bm.playerID].Cards)
		if err := room.DrawCard(bm.playerID); err != nil {
			log.Printf("bot draw error: %v", err)
			return
		}
		state := room.State
		botDrawnCount := len(state.Hands[bm.playerID].Cards) - priorBotSize
		h.broadcastToRoomAll(code, protocol.ServerMsg{
			Type:        protocol.SMsgCardDrawn,
			PlayerIndex: bm.playerID,
			DrawnCount:  botDrawnCount,
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
					h.scheduleTurnTimer(code, room)
					dl := h.turnDeadlineMs(code)
					h.broadcastToRoomAll(code, protocol.ServerMsg{
						Type:         protocol.SMsgTurnChanged,
						Turn:         room.State.CurrentTurn,
						TurnDeadline: dl,
					})
				}
			} else {
				// Schedule another bot move to play the drawn card
				h.scheduleBotMove(code, bm.playerID)
				return
			}
		} else {
			// Penalty draw (PendingDraw > 0) advanced the turn; the new current
			// player needs a timer or bot schedule so the game keeps progressing.
			h.scheduleTurnTimer(code, room)
		}
	}

	h.maybeScheduleBot(code, room)
}

// --- Turn timer ---

// scheduleTurnTimer records the current turn start time and schedules an auto-action
// if the player (human only) does not act within TurnTimeout.
func (h *Hub) scheduleTurnTimer(code string, room *game.Room) {
	if room.Status != game.StatusPlaying {
		return
	}
	turn := room.State.CurrentTurn
	// Bots handle their own timing; don't schedule a timeout for them.
	if bots, ok := h.botSlots[code]; ok {
		if _, isBot := bots[turn]; isBot {
			return
		}
	}
	now := time.Now()
	h.turnStartedAt[code] = now
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
func (h *Hub) resetAFK(code string, playerID int) {
	if code == "" {
		return
	}
	if m, ok := h.afkTimeouts[code]; ok {
		delete(m, playerID)
		if len(m) == 0 {
			delete(h.afkTimeouts, code)
		}
	}
}

// bumpAFK increments and returns the consecutive-timeout count for a player.
func (h *Hub) bumpAFK(code string, playerID int) int {
	m, ok := h.afkTimeouts[code]
	if !ok {
		m = make(map[int]int)
		h.afkTimeouts[code] = m
	}
	m[playerID]++
	return m[playerID]
}

// handleTurnTimeout fires when a human player's turn clock runs out.
// It auto-draws (if not yet drawn) then auto-passes.
func (h *Hub) handleTurnTimeout(tm turnTimerMsg) {
	room, ok := h.rooms[tm.roomCode]
	if !ok {
		return // room deleted
	}
	if room.Status != game.StatusPlaying {
		return
	}
	if room.State.CurrentTurn != tm.playerID {
		return // turn already advanced
	}
	// Check the timer is for the current turn, not a stale one.
	recorded, ok := h.turnStartedAt[tm.roomCode]
	if !ok || !recorded.Equal(tm.turnStartedAt) {
		return // stale timer
	}
	code := tm.roomCode

	log.Printf("turn timeout code=%s player=%d auto-acting", code, tm.playerID)

	members := h.roomMembers[code]
	var timedOutClient *Client
	if tm.playerID < len(members) {
		timedOutClient = members[tm.playerID]
	}

	// AFK accounting: only count human (non-bot) players. Bot timeouts shouldn't
	// trigger a kick — they're driven by the scheduler, not by player inactivity.
	if _, isBot := h.botSlots[code][tm.playerID]; !isBot {
		if h.bumpAFK(code, tm.playerID) >= AFKKickThreshold && timedOutClient != nil {
			log.Printf("AFK kick code=%s player=%d threshold=%d", code, tm.playerID, AFKKickThreshold)
			timedOutClient.Send(protocol.ServerMsg{Type: protocol.SMsgError, Error: "afk_kicked"})
			timedOutClient.conn.Close()
			return
		}
	}

	// Step 1: auto-draw if the player hasn't drawn yet.
	if !room.State.HasDrawn {
		priorTimeoutSize := len(room.State.Hands[tm.playerID].Cards)
		if err := room.DrawCard(tm.playerID); err != nil {
			log.Printf("turn timeout draw error code=%s player=%d err=%v", code, tm.playerID, err)
			return
		}
		state := room.State
		timeoutNewCards := state.Hands[tm.playerID].Cards[priorTimeoutSize:]
		timeoutDrawnCount := len(timeoutNewCards)
		// If drawing advanced the turn (penalty draw), broadcast and reschedule.
		if state.CurrentTurn != tm.playerID {
			dl := h.turnDeadlineMs(code)
			h.broadcastToRoomAll(code, protocol.ServerMsg{
				Type:         protocol.SMsgCardDrawn,
				PlayerIndex:  tm.playerID,
				DrawnCount:   timeoutDrawnCount,
				Turn:         state.CurrentTurn,
				TurnDeadline: dl,
			})
			h.maybeScheduleBot(code, room)
			h.scheduleTurnTimer(code, room)
			return
		}
		// Private: tell the player all their drawn cards.
		if timedOutClient != nil {
			timeoutCardDTOs := make([]*protocol.CardDTO, timeoutDrawnCount)
			for i, card := range timeoutNewCards {
				timeoutCardDTOs[i] = cardToDTO(card)
			}
			timedOutClient.Send(protocol.ServerMsg{
				Type:        protocol.SMsgCardDrawn,
				PlayerIndex: tm.playerID,
				Cards:       timeoutCardDTOs,
				Turn:        state.CurrentTurn,
				HasDrawn:    state.HasDrawn,
			})
		}
		// Public: others see correct hand size delta.
		h.broadcastToRoom(code, protocol.ServerMsg{
			Type:        protocol.SMsgCardDrawn,
			PlayerIndex: tm.playerID,
			DrawnCount:  timeoutDrawnCount,
			Turn:        state.CurrentTurn,
		}, timedOutClient)
	}

	// Step 2: auto-pass.
	if err := room.PassTurn(tm.playerID); err != nil {
		log.Printf("turn timeout pass error code=%s player=%d err=%v", code, tm.playerID, err)
		return
	}
	dl := h.turnDeadlineMs(code)
	h.broadcastToRoomAll(code, protocol.ServerMsg{
		Type:         protocol.SMsgTurnChanged,
		Turn:         room.State.CurrentTurn,
		TurnDeadline: dl,
	})
	h.maybeScheduleBot(code, room)
	h.scheduleTurnTimer(code, room)
}

// turnDeadlineMs returns the unix-millisecond deadline for the current turn,
// or 0 if no timer is active for this room.
func (h *Hub) turnDeadlineMs(code string) int64 {
	if t, ok := h.turnStartedAt[code]; ok {
		return t.Add(TurnTimeout).UnixMilli()
	}
	return 0
}

// --- Broadcast helpers ---

// broadcastPersonalizedGameState sends each connected player their personalized game state.
// Used after Swap and GlobalSwitch when all hands change simultaneously.
func (h *Hub) broadcastPersonalizedGameState(code string, room *game.Room) {
	pl := h.playerList(room)
	for _, member := range h.roomMembers[code] {
		if member == nil {
			continue
		}
		member.Send(protocol.ServerMsg{
			Type:  protocol.SMsgGameState,
			State: h.playerGameStateUsing(room, member.playerID, pl),
		})
	}
}

// broadcastToRoom marshals msg once and fans the same []byte out to every
// member in the room except `exclude`. This avoids re-marshaling identical
// payloads N times for an N-player room — a significant CPU win on hot paths
// like card_played, round_end, turn_changed.
func (h *Hub) broadcastToRoom(code string, msg protocol.ServerMsg, exclude *Client) {
	members := h.roomMembers[code]
	if len(members) == 0 {
		return
	}
	data, err := json.Marshal(msg)
	if err != nil {
		log.Printf("broadcast marshal error code=%s err=%v", code, err)
		return
	}
	for _, c := range members {
		if c != nil && c != exclude {
			c.SendBytes(data)
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

func (h *Hub) buildScoreboard(room *game.Room) []protocol.ScoreboardEntryDTO {
	sb := make([]protocol.ScoreboardEntryDTO, len(room.Players))
	for i, p := range room.Players {
		sb[i] = protocol.ScoreboardEntryDTO{
			PlayerIndex: i,
			Nickname:    p.Nickname,
			Score:       room.Scores[i],
			RoundsWon:   room.RoundsWon[i],
		}
	}
	return sb
}

// playerGameState builds a personalized game-state snapshot for one player.
// Use this for single-recipient sends (reconnect). For broadcast loops over
// every member of a room, prefer playerGameStateUsing to avoid rebuilding the
// shared player list once per recipient.
func (h *Hub) playerGameState(room *game.Room, playerIdx int) *protocol.GameStateDTO {
	return h.playerGameStateUsing(room, playerIdx, h.playerList(room))
}

// playerGameStateUsing builds a personalized game-state DTO with a precomputed
// player list. Broadcast loops should call playerList(room) once and pass the
// result here for every recipient — this skips ~N redundant playerList rebuilds
// per broadcast (each rebuild iterates Players × State.Placements × Finished ×
// disconnectedAt and allocates a placement map and player slice).
func (h *Hub) playerGameStateUsing(room *game.Room, playerIdx int, players []protocol.PlayerDTO) *protocol.GameStateDTO {
	state := room.State
	// Defensive bounds. A panic here would kill the hub goroutine and take down
	// every active room, so we degrade gracefully when the inputs are unexpected
	// (e.g. message arrives during a status transition or with a corrupted ID).
	if state == nil || playerIdx < 0 || playerIdx >= len(state.Hands) || len(state.Discard) == 0 {
		hands, discard := 0, 0
		if state != nil {
			hands, discard = len(state.Hands), len(state.Discard)
		}
		log.Printf("WARN playerGameState invalid args code=%s playerIdx=%d state_nil=%t hands=%d discard=%d",
			room.Code, playerIdx, state == nil, hands, discard)
		return &protocol.GameStateDTO{
			YourIndex:   playerIdx,
			Hand:        []protocol.CardDTO{},
			Players:     players,
			MatchFormat: matchFormatString(room.Format),
			MaxPlayers:  room.MaxPlayers,
			RoundNumber: room.RoundNumber,
		}
	}
	hand := make([]protocol.CardDTO, len(state.Hands[playerIdx].Cards))
	for i, c := range state.Hands[playerIdx].Cards {
		hand[i] = *cardToDTO(c)
	}
	top := state.Discard[len(state.Discard)-1]

	// Cap the event log to the most recent entries to avoid unbounded serialization.
	const maxEventLogExport = 50
	exportLog := state.EventLog
	if len(exportLog) > maxEventLogExport {
		exportLog = exportLog[len(exportLog)-maxEventLogExport:]
	}

	eventLog := make([]protocol.GameEventDTO, len(exportLog))
	for i, ev := range exportLog {
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

	var scoreboard []protocol.ScoreboardEntryDTO
	if len(room.Scores) > 0 {
		scoreboard = h.buildScoreboard(room)
	}

	return &protocol.GameStateDTO{
		YourIndex:    playerIdx,
		Hand:         hand,
		Players:      players,
		Discard:      *cardToDTO(top),
		ActiveColor:  colorName(state.ActiveColor),
		Turn:         state.CurrentTurn,
		Direction:    state.Direction,
		PendingDraw:  state.PendingDraw,
		HasDrawn:     state.HasDrawn,
		EventLog:     eventLog,
		RoundNumber:  room.RoundNumber,
		MatchFormat:  matchFormatString(room.Format),
		MaxPlayers:   room.MaxPlayers,
		Scoreboard:   scoreboard,
		TurnDeadline: h.turnDeadlineMs(room.Code),
	}
}

// --- Debug / E2E helpers ---

// handleDebugSetState is a dev-only handler that lets E2E tests inject specific game
// state (hand, discard, pending draw, active color) without relying on deck randomness.
//
// It is only active when the LOCO_E2E environment variable is set to "1".  In all
// other environments the message is rejected with an error, making it impossible to
// exploit in production.
//
// Any combination of the debug fields may be provided; omitted fields are left
// unchanged.  After applying the overrides the handler broadcasts a personalised
// game_state message to every connected player in the room so all clients reflect
// the new state.
func (h *Hub) handleDebugSetState(c *Client, msg protocol.ClientMsg) {
	if os.Getenv("LOCO_E2E") != "1" {
		c.sendError("debug commands are not enabled")
		return
	}
	room, ok := h.roomOf(c)
	if !ok {
		return
	}
	if room.Status != game.StatusPlaying {
		c.sendError("debug_set_state requires an active game")
		return
	}

	playerID := c.playerID
	state := room.State
	parseHand := func(cards []protocol.CardDTO) (game.Hand, error) {
		newHand := game.Hand{}
		for _, dto := range cards {
			col, err := parseColor(dto.Color)
			if err != nil {
				return game.Hand{}, fmt.Errorf("bad color %q: %w", dto.Color, err)
			}
			kind, err := parseKind(dto.Kind)
			if err != nil {
				return game.Hand{}, fmt.Errorf("bad kind %q: %w", dto.Kind, err)
			}
			newHand.Add(game.Card{Color: col, Kind: kind, Value: dto.Value})
		}
		return newHand, nil
	}

	// Replace this player's hand.
	if len(msg.DebugHand) > 0 {
		newHand, err := parseHand(msg.DebugHand)
		if err != nil {
			c.sendError(fmt.Sprintf("debug_hand: %v", err))
			return
		}
		state.Hands[playerID] = newHand
	}

	// Replace any explicitly targeted players' hands.
	if len(msg.DebugHands) > 0 {
		for _, override := range msg.DebugHands {
			if override.PlayerIndex < 0 || override.PlayerIndex >= len(state.Hands) {
				c.sendError(fmt.Sprintf("debug_hands: invalid player_index %d", override.PlayerIndex))
				return
			}
			newHand, err := parseHand(override.Hand)
			if err != nil {
				c.sendError(fmt.Sprintf("debug_hands[%d]: %v", override.PlayerIndex, err))
				return
			}
			state.Hands[override.PlayerIndex] = newHand
		}
	}

	// Replace top of discard pile and optionally the active color.
	if msg.DebugDiscard != nil {
		col, err := parseColor(msg.DebugDiscard.Color)
		if err != nil {
			c.sendError(fmt.Sprintf("debug_discard: bad color %q: %v", msg.DebugDiscard.Color, err))
			return
		}
		kind, err := parseKind(msg.DebugDiscard.Kind)
		if err != nil {
			c.sendError(fmt.Sprintf("debug_discard: bad kind %q: %v", msg.DebugDiscard.Kind, err))
			return
		}
		card := game.Card{Color: col, Kind: kind, Value: msg.DebugDiscard.Value}
		if len(state.Discard) == 0 {
			state.Discard = []game.Card{card}
		} else {
			state.Discard[len(state.Discard)-1] = card
		}
		// Active color: use explicit override if provided; otherwise derive from card.
		if msg.DebugActiveColor != "" {
			activeCol, err := parseColor(msg.DebugActiveColor)
			if err != nil {
				c.sendError(fmt.Sprintf("debug_active_color: %v", err))
				return
			}
			state.ActiveColor = activeCol
		} else if col != game.Wild {
			state.ActiveColor = col
		}
	}

	// Override pending draw count.
	if msg.DebugPendingDraw != nil {
		state.PendingDraw = *msg.DebugPendingDraw
	}

	// Override current turn.
	if msg.DebugCurrentTurn != nil {
		if *msg.DebugCurrentTurn < 0 || *msg.DebugCurrentTurn >= len(state.Hands) {
			c.sendError(fmt.Sprintf("debug_current_turn: invalid index %d", *msg.DebugCurrentTurn))
			return
		}
		state.CurrentTurn = *msg.DebugCurrentTurn
		state.HasDrawn = false
	}

	// Broadcast personalised game_state to every connected player.
	pl := h.playerList(room)
	for i, member := range h.roomMembers[c.roomCode] {
		if member != nil {
			member.Send(protocol.ServerMsg{
				Type:  protocol.SMsgGameState,
				State: h.playerGameStateUsing(room, i, pl),
			})
		}
	}
}

// --- Code generation ---

// generateCode produces a unique 6-character room code and guarantees no collision.
func (h *Hub) generateCode() string {
	const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	for {
		code := make([]byte, 6)
		for i := range code {
			code[i] = chars[mrand.Intn(len(chars))]
		}
		s := string(code)
		if _, exists := h.rooms[s]; !exists {
			return s
		}
	}
}
