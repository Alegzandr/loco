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
	"net/url"
	"os"
	"runtime"
	"strconv"
	"strings"
	"sync"
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

// writeBufferPool is shared by every connection. gorilla otherwise allocates a
// per-connection write buffer that lives as long as the socket; at a ten-seat
// table that is ten buffers held for the whole match, and the garbage a
// broadcast produces is what the event loop pays for in pause time.
var writeBufferPool = &sync.Pool{}

var upgrader = websocket.Upgrader{
	// Sized so a personalised game_state (hand + players + round history) goes
	// out in a single write syscall. At 1024 the exact message the board is
	// rebuilt from was being split across several writes, each its own segment.
	ReadBufferSize:  2048,
	WriteBufferSize: 4096,
	WriteBufferPool: writeBufferPool,
	// Deliberately off. permessage-deflate would compress payloads that are a
	// few hundred bytes: no bandwidth worth having, and it puts a deflate pass
	// on both ends of every card play plus a flush the receiver has to wait on.
	// latency outranks bandwidth here (see "Engineering priorities").
	EnableCompression: false,
	CheckOrigin: originAllowed,
}

// AllowedOrigins is the exact set of browser origins permitted to open a socket,
// read once from LOCO_ALLOWED_ORIGINS (comma-separated) at startup. Empty means
// "same host as the request", which is what the production topology already is:
// nginx serves the SPA and proxies /ws on one hostname.
//
// Exported as a var so tests can set it; production sets the environment.
var AllowedOrigins = splitOrigins(os.Getenv("LOCO_ALLOWED_ORIGINS"))

func splitOrigins(raw string) []string {
	var out []string
	for _, part := range strings.Split(raw, ",") {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

// originAllowed decides whether a browser at Origin may upgrade.
//
// `return true` accepted a socket from any page on the internet. The exposure is
// genuinely small — LOCO has no login, no cookie and no ambient credential, so
// there is nothing for a cross-site socket to borrow — but "small" is not the
// same as "none": an unrestricted upgrade is a free room-creation and
// message-flood endpoint pointed at this server from anybody's page, and the
// per-connection rate limit is the only thing standing behind it.
//
// The default rule needs no configuration and holds in dev: hostnames must
// match, ports need not, so the Vite client on :5173 reaches the server on
// :8080 while evil.example is refused either way.
func originAllowed(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		// Not a browser. Nothing here is authenticated by anything a
		// non-browser client could be tricked into replaying.
		return true
	}
	u, err := url.Parse(origin)
	if err != nil || u.Host == "" {
		return false
	}
	if len(AllowedOrigins) > 0 {
		for _, allowed := range AllowedOrigins {
			if strings.EqualFold(allowed, origin) {
				return true
			}
		}
		return false
	}
	return strings.EqualFold(u.Hostname(), hostname(r.Host))
}

// hostname strips any :port from a Host header, IPv6 literals included.
func hostname(host string) string {
	if strings.HasPrefix(host, "[") {
		if end := strings.Index(host, "]"); end >= 0 {
			return host[1:end]
		}
		return host
	}
	if i := strings.LastIndex(host, ":"); i >= 0 {
		return host[:i]
	}
	return host
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

// unoMsg is sent internally when a bot's deferred UNO declaration comes due.
type unoMsg struct {
	roomCode     string
	playerIndex  int
	lastCardTime time.Time // stale-check: must match room.State.LastCardAt at execution
}

// botCatchMsg is sent internally when a bot should attempt to catch an undeclared UNO.
type botCatchMsg struct {
	roomCode     string
	targetPlayer int
	lastCardTime time.Time // stale-check: must match room.State.LastCardTime at execution
}

// botInterruptMsg is sent internally when a bot should consider slamming an
// identical card into an open interrupt window.
type botInterruptMsg struct {
	roomCode string
	// stale-check: the discard must still be the card this was scheduled for.
	// Anything else and the bot is answering a board that no longer exists.
	lastPlayAt time.Time
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

	// mapLoading[code] is set while a freshly started match waits for every
	// client to finish downloading its map. Its presence means the table is
	// shut: no turn timer, no bots, no gameplay message accepted. See
	// maploading.go for why that wait exists at all.
	mapLoading map[string]*mapLoadState

	// afkTimeouts[code][playerID] = consecutive turn-timeout count (reset on any voluntary action).
	// When the count reaches AFKKickThreshold the player is force-disconnected.
	afkTimeouts map[string]map[int]int

	// queue is the 1v1 matchmaking queue, oldest wait first. Its length is a
	// metric and nothing else: no client is ever told how long it is.
	// See matchmaking.go.
	queue []queuedPlayer
	// rematchOffers[code] is the set of seats that have asked for another match
	// in a finished matchmade room. Both have to be in before it is dealt.
	rematchOffers map[string]map[int]struct{}
	// matchmade[code] = the instant that room was paired. Its presence means the
	// room came out of the queue, which shortens the reconnect hold and the AFK
	// threshold, refuses every host-only lobby control, and turns an abandoned
	// seat into a forfeit instead of an indefinite wait.
	matchmade map[string]time.Time

	register       chan *Client
	unregister     chan *Client
	inbound        chan inboundMsg
	expire         chan expireMsg
	botMove        chan botMoveMsg        // scheduled bot actions
	cleanup        chan cleanupMsg        // empty-room cleanup timers
	turnTimeout    chan turnTimerMsg      // per-turn timeout actions
	unoAnnounce    chan unoMsg            // delayed bot UNO declaration broadcasts
	botCatch       chan botCatchMsg       // scheduled bot catch-UNO attempts
	botInterrupt   chan botInterruptMsg   // scheduled bot interject attempts
	mapLoadTimeout chan mapLoadTimeoutMsg // "start without the stragglers" deadline
	mmStart        chan mmStartMsg        // matchmade pair: the versus reveal is over, deal them in
	drain          chan struct{}          // BeginDrain(): stop accepting new matches (see drain.go)
	snapshotSave   chan snapshotReq       // SaveSnapshot(): read every room, on the loop (see snapshot.go)
	snapshotLoad   chan snapshotReq       // LoadSnapshot(): put rooms back, on the loop
	quit           chan struct{}          // closed by Stop() to terminate Run()

	// draining is read from the HTTP goroutines (/health, /metrics) as well as
	// from the event loop, which is the only reason it is atomic; every write
	// goes through the drain channel and lands in Run.
	draining atomic.Bool
	// drained is closed once the last match in flight has ended. drainedClosed
	// guards the close, and is only ever touched by the event loop.
	drained       chan struct{}
	drainedClosed bool

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
	statMatchmakingQueue     atomic.Int32 // players currently waiting for a 1v1 opponent (operator-only)
	statMatchesMatchmade     atomic.Int32 // matches created by pairing two queued players
	statMatchesInFlight      atomic.Int32 // matches a shutdown would interrupt; only maintained while draining
	startTime                time.Time
}

// HealthStats is a snapshot of hub metrics for the health endpoint.
type HealthStats struct {
	Status    string `json:"status"`
	Rooms     int32  `json:"rooms"`
	Clients   int32  `json:"clients"`
	UptimeSec int64  `json:"uptime_sec"`
	// Draining means this process has been asked to go and is only finishing
	// the matches it already had. It stays on /health rather than turning the
	// endpoint red: a draining server is serving its players perfectly well,
	// and a container Docker considers unhealthy is a container something
	// else may decide to kill out from under them.
	Draining bool `json:"draining"`
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
	// MatchmakingQueue is the only place the queue's size is ever readable, and
	// /metrics is an operator surface that no compose file publishes. It is what
	// tells an operator whether an empty-feeling queue is empty or broken.
	MatchmakingQueue int32 `json:"matchmaking_queue"`
	MatchesMatchmade int32 `json:"matches_matchmade"`
	DebugModeActive  bool  `json:"debug_mode_active"`
	// Draining, plus MatchesInFlight, is what an operator watches during a
	// deploy: the second is the number the shutdown is waiting to reach zero.
	// It is only maintained while draining and reads 0 before that, because
	// counting it the rest of the time would mean scanning every room after
	// every event for a number nobody is looking at.
	Draining        bool  `json:"draining"`
	MatchesInFlight int32 `json:"matches_in_flight"`
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
		mapLoading:     make(map[string]*mapLoadState),
		afkTimeouts:    make(map[string]map[int]int),
		matchmade:      make(map[string]time.Time),
		rematchOffers:  make(map[string]map[int]struct{}),
		register:       make(chan *Client, 16),
		unregister:     make(chan *Client, 16),
		inbound:        make(chan inboundMsg, 256),
		expire:         make(chan expireMsg, 64),
		botMove:        make(chan botMoveMsg, 64),
		cleanup:        make(chan cleanupMsg, 64),
		turnTimeout:    make(chan turnTimerMsg, 64),
		unoAnnounce:    make(chan unoMsg, 64),
		botCatch:       make(chan botCatchMsg, 64),
		botInterrupt:   make(chan botInterruptMsg, 64),
		mapLoadTimeout: make(chan mapLoadTimeoutMsg, 64),
		mmStart:        make(chan mmStartMsg, 64),
		drain:          make(chan struct{}),
		drained:        make(chan struct{}),
		snapshotSave:   make(chan snapshotReq),
		snapshotLoad:   make(chan snapshotReq),
		quit:           make(chan struct{}),
		startTime:      time.Now(),
	}
}

// generateSessionToken produces a cryptographically random 32-hex-char token.
//
// There is no math/rand fallback, and there must not be one: this token is the
// only thing proving that whoever claims a held seat is the player who left it.
// Degrading it to a predictable source on an error path would turn the one
// authentication check in the game into a guessable number, and it was dead
// code besides: since Go 1.24 rand.Read never returns an error, it panics if
// the OS entropy source is genuinely broken, which is the correct outcome for a
// server that can no longer issue a trustworthy token.
func generateSessionToken() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// randIndex returns a uniformly distributed index in [0, n) drawn from
// crypto/rand. The mask-and-retry keeps the distribution flat for any n; for
// the 32-character room alphabet the mask is exact and nothing is ever redrawn.
func randIndex(n int) int {
	if n <= 1 {
		return 0
	}
	mask := 1
	for mask < n {
		mask <<= 1
	}
	mask--
	var b [1]byte
	for {
		_, _ = rand.Read(b[:])
		if v := int(b[0]) & mask; v < n {
			return v
		}
	}
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
		Draining:  h.draining.Load(),
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
		MatchmakingQueue:     h.statMatchmakingQueue.Load(),
		MatchesMatchmade:     h.statMatchesMatchmade.Load(),
		DebugModeActive:      os.Getenv("LOCO_E2E") == "1",
		Draining:             h.draining.Load(),
		MatchesInFlight:      h.statMatchesInFlight.Load(),
	}
}

// Run starts the hub event loop. Call in a goroutine.
// Stop terminates the Run loop. Safe to call once; further calls panic on the
// closed channel. Used by tests to avoid leaking the hub goroutine across
// tests, which under suite load can starve unrelated WebSocket reads.
func (h *Hub) Stop() {
	close(h.quit)
}

func (h *Hub) Run() {
	latencyTicker := time.NewTicker(LatencyBroadcastPeriod)
	defer latencyTicker.Stop()
	for {
		select {
		case <-h.quit:
			return

		case <-latencyTicker.C:
			h.broadcastLatencies()
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

		case bim := <-h.botInterrupt:
			h.handleBotInterrupt(bim)

		case mlm := <-h.mapLoadTimeout:
			h.handleMapLoadTimeout(mlm)

		case sm := <-h.mmStart:
			h.handleMatchmakingStart(sm)

		case <-h.drain:
			h.beginDrain()

		case req := <-h.snapshotSave:
			req.done <- h.saveSnapshot(req.path)

		case req := <-h.snapshotLoad:
			req.done <- h.loadSnapshot(req.path)
		}

		// After every event, not hooked onto the handful that can end a match.
		// A match stops being in flight through several paths — the last card,
		// a forfeit, an expired reconnect window, the empty-room cleanup — and
		// the one that gets forgotten is the one that leaves a deploy hanging
		// until its timeout. Scanning a map of rooms costs nothing next to the
		// work the loop just did.
		if h.draining.Load() {
			h.checkDrained()
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
	// The table is shut while the room downloads its map. Refusing gameplay here
	// rather than trusting the client's own loading screen is the whole point of
	// the gate: a client that skipped it would otherwise be the only one able to
	// act, in a game whose reaction windows are decided by arrival order.
	if isGameplayMsg(msg.Type) && h.isMapLoading(c.roomCode) {
		c.sendError("waiting for every player to load the table")
		return
	}
	switch msg.Type {
	case protocol.CMsgMapReady:
		h.handleMapReady(c)
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
	case protocol.CMsgRematch:
		h.handleRematch(c, msg)
	case protocol.CMsgFindMatch:
		h.handleFindMatch(c, msg)
	case protocol.CMsgCancelMatchmaking:
		h.handleCancelMatchmaking(c)
	case protocol.CMsgLeaveRoom:
		h.handleLeaveRoom(c)
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

// validateNickname trims and length-checks an inbound nickname. Returns the
// canonical form on success, or sends an error to the client and returns "".
func validateNickname(c *Client, raw string) string {
	n := strings.TrimSpace(raw)
	if len(n) == 0 || len(n) > 20 {
		c.sendError("nickname must be 1–20 characters")
		return ""
	}
	return n
}

// alreadySeated reports whether this socket already holds a seat, and is the
// guard on both room-entry handlers.
//
// A seat lives in two places at once: the socket knows it as c.roomCode /
// c.playerID, and the room knows it as the *Client pointer at index playerID in
// h.roomMembers. Re-entering a room moves only the first. The pointer stays
// behind at the old index while c.playerID names a seat in the new room, and
// every personalised broadcast for the old room (broadcastPersonalizedGameState,
// the per-recipient game_started of a new round) is then built from the wrong
// index. A player seated at 1 who rebinds to 0 elsewhere is handed seat 0's
// hand here, which is the entire hidden state the server exists to keep.
//
// The stale slot also never empties, so the room outlives its players and the
// abandoned seat never opens its reconnect window.
//
// Reconnects do not come through here: they arrive on a fresh socket, whose
// roomCode is still "". A room that no longer exists is not a seat, so a client
// left pointing at a deleted room is released rather than locked out.
func (h *Hub) alreadySeated(c *Client) bool {
	if c.roomCode == "" {
		return false
	}
	if _, ok := h.rooms[c.roomCode]; !ok {
		c.roomCode = ""
		c.playerID = 0
		return false
	}
	return true
}

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
		PlayerID:     intPtr(0),
		Players:      h.playerList(room),
		SessionToken: tok,
		MatchFormat:  matchFormatString(room.Format),
		MaxPlayers:   room.MaxPlayers,
	})
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
		c.sendError("invalid room code")
		return
	}
	code := strings.ToUpper(msg.RoomCode)
	room, ok := h.rooms[code]
	if !ok {
		// While draining, a table this process does not have is very likely a
		// table the *previous* process had: saying "no table with that code"
		// would blame the player for a code that was real. Reconnects are not
		// affected, they land in the branch below on a room that exists.
		if h.refuseWhileDraining(c) {
			return
		}
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
		PlayerID:     intPtr(playerID),
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
	// Dealing during a drain is what would keep the deploy waiting without
	// bound; see drain.go.
	if h.refuseWhileDraining(c) {
		return
	}
	if h.refuseInMatchmade(c) {
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
	h.dealMatch(c.roomCode, room)
}

// startMatch is the matchmaking entry point into the same deal a host's
// start_game produces: nobody presses anything in a matchmade room, so the
// reveal timer calls this instead.
func (h *Hub) startMatch(code string, room *game.Room) {
	if err := room.Start(); err != nil {
		log.Printf("WARN matchmade start failed code=%s err=%v", code, err)
		return
	}
	h.dealMatch(code, room)
}

// dealMatch broadcasts the freshly dealt match and opens the loading gate. The
// two callers differ only in who decided to start.
func (h *Hub) dealMatch(code string, room *game.Room) {
	h.statMatchesStarted.Add(1)
	log.Printf("match started code=%s players=%d format=%s matchmade=%t",
		code, len(room.Players), matchFormatString(room.Format), h.isMatchmade(code))

	// Send each player their personalized game state. Build the shared player
	// list once and reuse it across all recipients.
	members := h.roomMembers[code]
	pl := h.playerList(room)
	for seat, member := range members {
		if member == nil {
			continue
		}
		member.Send(protocol.ServerMsg{
			Type:  protocol.SMsgGameStarted,
			State: h.playerGameStateUsing(room, seat, pl),
		})
	}

	// The turn clock and the bots are deliberately NOT armed here. game_started
	// only tells each client what it has to render; the match begins at
	// match_ready, once everybody has the map decoded. See maploading.go: the
	// first turn used to start ticking while somebody's table was still a grey
	// rectangle, which in a game decided by arrival order is a head start, not
	// a cosmetic problem.
	h.beginMapLoading(code, room)
}

// handleRematch reopens a finished room as a lobby so the same group can play
// again without recreating the room and re-sharing the code. Players who never
// came back from a mid-match disconnect are pruned first, so the next match is
// dealt only to people who are actually present.
func (h *Hub) handleRematch(c *Client, msg protocol.ClientMsg) {
	room, ok := h.roomOf(c)
	if !ok {
		return
	}
	// A matchmade rematch deals immediately, and an ordinary one leads to a
	// start_game the drain is going to refuse anyway. Refusing here is the
	// honest version of both.
	if h.refuseWhileDraining(c) {
		return
	}
	// A matchmade room has no host, so a rematch there is an agreement rather
	// than a decision: see handleRematchOffer.
	if h.isMatchmade(c.roomCode) {
		h.handleRematchOffer(c, room)
		return
	}
	if c.playerID != 0 {
		c.sendError("only the host can start a rematch")
		return
	}
	if room.Status != game.StatusFinished {
		c.sendError("rematch is only available once the match is over")
		return
	}

	h.pruneAbsentPlayers(c.roomCode, room)

	if err := room.ResetForRematch(); err != nil {
		c.sendError(err.Error())
		return
	}

	// Per-match hub bookkeeping must not leak into the new match.
	delete(h.turnStartedAt, c.roomCode)
	// A gate belonging to the match that just ended would otherwise keep the next
	// one shut: its timeout has already fired and nothing would ever reopen it.
	delete(h.mapLoading, c.roomCode)
	delete(h.afkTimeouts, c.roomCode)
	delete(h.disconnectedAt, c.roomCode)
	delete(h.emptyRooms, c.roomCode)

	log.Printf("rematch opened code=%s players=%d format=%s",
		c.roomCode, len(room.Players), matchFormatString(room.Format))

	// Sent per-recipient: pruning may have shifted playerIDs, and each client
	// needs its own new index to render the waiting room correctly.
	for _, member := range h.roomMembers[c.roomCode] {
		if member == nil {
			continue
		}
		member.Send(protocol.ServerMsg{
			Type:        protocol.SMsgRematchStarted,
			RoomCode:    c.roomCode,
			PlayerID:    intPtr(member.playerID),
			Players:     h.playerList(room),
			MatchFormat: matchFormatString(room.Format),
			MaxPlayers:  room.MaxPlayers,
		})
	}
}

// pruneAbsentPlayers drops every seat with neither a live connection nor a bot
// behind it, re-indexing all playerID-keyed structures. Iterates high→low so
// each removal only shifts indices already processed.
func (h *Hub) pruneAbsentPlayers(code string, room *game.Room) {
	members := h.roomMembers[code]
	bots := h.botSlots[code]
	for id := len(members) - 1; id >= 0; id-- {
		if members[id] != nil {
			continue
		}
		if _, isBot := bots[id]; isBot {
			continue
		}
		if _, err := room.RemoveLobbyPlayer(id); err != nil {
			log.Printf("WARN prune failed code=%s player=%d err=%v", code, id, err)
			continue
		}
		members = append(members[:id], members[id+1:]...)
		h.roomMembers[code] = members
		for newIdx, m := range members {
			if m != nil {
				m.playerID = newIdx
			}
		}
		h.botSlots[code] = shiftIntKeySet(h.botSlots[code], id)
		h.sessionTokens[code] = shiftIntKeyMap(h.sessionTokens[code], id)
		bots = h.botSlots[code]
		log.Printf("pruned absent player code=%s player=%d", code, id)
	}
}

func (h *Hub) handleSetMatchFormat(c *Client, msg protocol.ClientMsg) {
	room, ok := h.roomOf(c)
	if !ok {
		return
	}
	if h.refuseInMatchmade(c) {
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
	if h.refuseInMatchmade(c) {
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

// parseCardsFromMsg extracts the card(s) the player wants to play from a
// ClientMsg. The batch field (PlayCards) takes precedence over the singular
// Card. Returns (cards, chosenColor, ok); ok=false means an error has already
// been sent to the client and the caller should return.
func (h *Hub) parseCardsFromMsg(c *Client, msg protocol.ClientMsg) ([]game.Card, game.Color, bool) {
	if len(msg.PlayCards) > 0 {
		cards := make([]game.Card, len(msg.PlayCards))
		var chosenColor game.Color
		for i, dto := range msg.PlayCards {
			card, cc, err := dtoToCard(&dto, msg.ChosenColor)
			if err != nil {
				c.sendError(err.Error())
				return nil, 0, false
			}
			cards[i] = card
			chosenColor = cc
		}
		return cards, chosenColor, true
	}
	if msg.Card == nil {
		c.sendError("card required")
		return nil, 0, false
	}
	card, chosenColor, err := dtoToCard(msg.Card, msg.ChosenColor)
	if err != nil {
		c.sendError(err.Error())
		return nil, 0, false
	}
	return []game.Card{card}, chosenColor, true
}

func (h *Hub) handlePlayCard(c *Client, msg protocol.ClientMsg) {
	room, ok := h.roomOf(c)
	if !ok {
		return
	}
	chosenPlayer := -1
	if msg.ChosenPlayer != nil {
		chosenPlayer = *msg.ChosenPlayer
	}
	cards, chosenColor, ok := h.parseCardsFromMsg(c, msg)
	if !ok {
		return
	}

	var err error
	if len(cards) > 1 {
		err = room.PlayCards(c.playerID, cards, chosenColor, chosenPlayer)
	} else {
		err = room.PlayCard(c.playerID, cards[0], chosenColor, chosenPlayer)
	}
	if err != nil {
		h.refuseAction(c, room, err)
		return
	}

	// Batch plays don't carry a meaningful chosenPlayer (Swap/GlobalSwitch are
	// excluded from batch); send -1 so card_played's swap target is omitted.
	cpForBroadcast := chosenPlayer
	if len(cards) > 1 {
		cpForBroadcast = -1
	}
	h.broadcastCardPlayed(c.roomCode, c.playerID, room, cpForBroadcast)
	if len(cards) == 1 && (cards[0].Kind == game.Swap || cards[0].Kind == game.GlobalSwitch) {
		h.broadcastPersonalizedGameState(c.roomCode, room)
	}
	h.maybeScheduleBotCatch(c.roomCode, room)
	h.maybeScheduleBotDeclarations(c.roomCode, room)
	h.maybeScheduleBotInterrupt(c.roomCode, room)
	h.handleRoundOrMatchEnd(c.roomCode, room)
}

func (h *Hub) handleRoundOrMatchEnd(code string, room *game.Room) {
	if !room.RoundEnded {
		h.maybeScheduleBot(code, room)
		return
	}

	room.RoundEnded = false
	scoreboard := h.buildScoreboard(room)

	// Broadcast round_end with scoreboard.
	// At this point room.State still reflects the round-winning play (BeginNextRound
	// has not yet been called), so RoundNumber is the just-completed round.
	h.broadcastToRoomAll(code, protocol.ServerMsg{
		Type:         protocol.SMsgRoundEnd,
		RoundNumber:  room.RoundNumber,
		RoundWinner:  room.Winner,
		Scoreboard:   scoreboard,
		RoundHistory: room.RoundHistory,
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
	for seat, member := range members {
		if member == nil {
			continue
		}
		member.Send(protocol.ServerMsg{
			Type:  protocol.SMsgGameStarted,
			State: h.playerGameStateUsing(room, seat, pl),
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
		h.refuseAction(c, room, err)
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

	// Drawing re-arms the turn clock. A forced draw does not cost the turn
	// (rules.md §14.5), but the timer was armed when the +2 landed, so every
	// second the victim spent deciding whether to counter came off the turn they
	// are owed *after* the draw — take the stack late and the seat is auto-passed
	// moments later, which is the exact double punishment the deviation forbids.
	// A voluntary draw follows the same rule for the same reason: the player
	// still has to decide play-or-pass with cards they have only just seen. There
	// is one draw per turn, so this can extend a turn once and never repeatedly.
	h.scheduleTurnTimer(c.roomCode, room)
	dl := h.turnDeadlineMs(c.roomCode)

	// Tell the drawing player all their new cards plus the updated turn state.
	c.Send(protocol.ServerMsg{
		Type:         protocol.SMsgCardDrawn,
		PlayerIndex:  intPtr(c.playerID),
		Cards:        cardDTOs,
		Turn:         state.CurrentTurn,
		PendingDraw:  intPtr(state.PendingDraw),
		HasDrawn:     boolPtr(state.HasDrawn),
		TurnDeadline: dl,
	})
	// Tell others how many cards changed hands so they can update the hand-size
	// counter. They get the same turn state: has_drawn / pending_draw describe
	// the table, not the recipient, and a client left to infer them desyncs.
	h.broadcastToRoom(c.roomCode, protocol.ServerMsg{
		Type:         protocol.SMsgCardDrawn,
		PlayerIndex:  intPtr(c.playerID),
		DrawnCount:   drawnCount,
		Turn:         state.CurrentTurn,
		PendingDraw:  intPtr(state.PendingDraw),
		HasDrawn:     boolPtr(state.HasDrawn),
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
		h.refuseAction(c, room, err)
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
		// A second call on the same single card is a double tap or a message in
		// flight when the first one landed, not an attack — the client already
		// spends its own button. game.IsLostRace covers it (ErrAlreadyDeclared),
		// so this is the same rule every other handler now applies, rather than
		// a string comparison that a reworded error would silently break.
		c.noteRejection(err)
		return
	}
	h.broadcastToRoomAll(c.roomCode, protocol.ServerMsg{
		Type:        protocol.SMsgUnoDeclared,
		PlayerIndex: intPtr(c.playerID),
	})
}

func (h *Hub) handleCatchUno(c *Client, msg protocol.ClientMsg) {
	room, ok := h.roomOf(c)
	if !ok {
		return
	}
	// A Swap or a GlobalSwitch can leave several seats catchable at once, so the
	// catcher names the one they spotted. Older clients send nothing: fall back
	// to the window closest to expiring, which is the catch about to be lost.
	targetIdx := -1
	if msg.TargetIndex != nil {
		targetIdx = *msg.TargetIndex
	} else if open := room.State.CatchableTargets(time.Now()); len(open) > 0 {
		targetIdx = open[0]
	}
	if targetIdx < 0 || targetIdx >= len(room.State.Hands) {
		c.sendError("target does not have exactly 1 card")
		return
	}
	priorSize := len(room.State.Hands[targetIdx].Cards)
	if err := room.CatchUndeclared(c.playerID, targetIdx, time.Now()); err != nil {
		// A lost race is the mechanic working, not an attack: the button was
		// armed when it was pressed and the target's LOCO! (or a hand that grew,
		// or the last millisecond of the window) simply reached the hub first.
		// It costs the caller a card and nothing else — no error toast, no
		// suspicion, since the client shows the penalty itself.
		if game.IsMissedCatch(err) {
			h.penalizeFailedCatch(c.roomCode, room, c.playerID)
			return
		}
		c.sendError(err.Error())
		c.noteRejection(err)
		return
	}
	h.broadcastToRoomAll(c.roomCode, protocol.ServerMsg{
		Type:        protocol.SMsgUnoCaught,
		PlayerIndex: intPtr(targetIdx),
	})
	// The penalty cards are a hand change like any other: the caught player must
	// be sent the cards themselves, everyone else the new count.
	h.sendHandGrowth(c.roomCode, room, targetIdx, room.State.Hands[targetIdx].Cards[priorSize:])
}

// penalizeFailedCatch charges one card for a Contre-LOCO! that lost its race and
// tells the room whose call it was. Shared by the human and the bot path — a bot
// that guesses wrong pays the same price, or the two are playing different games.
func (h *Hub) penalizeFailedCatch(code string, room *game.Room, catcherIdx int) {
	drawn := room.PenalizeFailedCatch(catcherIdx)
	h.broadcastToRoomAll(code, protocol.ServerMsg{
		Type:        protocol.SMsgCatchFailed,
		PlayerIndex: intPtr(catcherIdx),
	})
	if len(drawn) == 0 {
		return // deck and discard exhausted — the call goes unpunished
	}
	h.sendHandGrowth(code, room, catcherIdx, drawn)
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
		h.refuseAction(c, room, err)
		return
	}
	h.broadcastCardPlayed(c.roomCode, c.playerID, room, -1)
	h.maybeScheduleBotCatch(c.roomCode, room)
	h.maybeScheduleBotDeclarations(c.roomCode, room)
	h.maybeScheduleBotInterrupt(c.roomCode, room)
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
	cards, chosenColor, ok := h.parseCardsFromMsg(c, msg)
	if !ok {
		return
	}

	if err := room.InterruptPlayCards(c.playerID, cards, chosenColor, chosenPlayer); err != nil {
		h.refuseAction(c, room, err)
		return
	}

	h.broadcastInterrupt(c.roomCode, room, c.playerID, cards, chosenPlayer)
	h.maybeScheduleBotCatch(c.roomCode, room)
	h.maybeScheduleBotDeclarations(c.roomCode, room)
	h.maybeScheduleBotInterrupt(c.roomCode, room)
	h.handleRoundOrMatchEnd(c.roomCode, room)
}

// broadcastInterrupt announces a successful interject. Shared by the human and
// the bot path so both produce the same sequence on the wire — a bot that took
// the lead has to look exactly like a player who did.
func (h *Hub) broadcastInterrupt(code string, room *game.Room, playerID int, cards []game.Card, chosenPlayer int) {
	// Emit a typed interrupt_success notification (in addition to the standard
	// card_played broadcast) so clients can render distinct lead-taking visuals.
	successCards := make([]*protocol.CardDTO, len(cards))
	for i, card := range cards {
		successCards[i] = cardToDTO(card)
	}
	h.broadcastToRoomAll(code, protocol.ServerMsg{
		Type:        protocol.SMsgInterruptSuccess,
		PlayerIndex: intPtr(playerID),
		Cards:       successCards,
	})
	h.broadcastCardPlayed(code, playerID, room, chosenPlayer)
	// Same rule as handlePlayCard: Swap and GlobalSwitch rearrange hands, so every
	// client needs a fresh personalised snapshot. A GlobalSwitch interject is
	// ordinary play (the deck ships four of them); the Swap case is only reachable
	// if the deck ever ships two copies of a coloured Swap (today it ships one),
	// but the domain permits it and a silent hand desync — the client keeps a hand
	// it can no longer play and every tap comes back "card not in hand" — is
	// exactly the bug this guards against.
	if len(cards) == 1 && (cards[0].Kind == game.Swap || cards[0].Kind == game.GlobalSwitch) {
		h.broadcastPersonalizedGameState(code, room)
	}
}

// --- Disconnect handling ---

func (h *Hub) handleDisconnect(c *Client) {
	// A socket that has gone away must not be paired with somebody who is still
	// there, so the queue is the first thing it leaves.
	h.dequeue(c)
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

		// The forfeit deadline rides this message in a matchmade room: the player
		// still at the table is owed a number rather than an open-ended notice,
		// and 15s of "they might come back" is short enough to sit through only
		// because it is visibly counting down.
		h.broadcastToRoomAll(c.roomCode, protocol.ServerMsg{
			Type:            protocol.SMsgPlayerDisconnected,
			PlayerIndex:     intPtr(c.playerID),
			Nickname:        nickname,
			Players:         h.playerList(room),
			ForfeitDeadline: h.forfeitDeadlineMs(c.roomCode, disconnectTime),
		})

		// A seat that left during the loading gate is no longer a seat the table
		// is waiting on. Without this the room sits on the loading screen until
		// MapLoadTimeout for a player who is provably gone.
		if h.isMapLoading(c.roomCode) {
			h.broadcastLoadingProgress(c.roomCode)
			h.maybeOpenTable(c.roomCode, room)
		}

		h.scheduleReconnectExpiry(c.roomCode, c.playerID, disconnectTime)

		// If all slots are now empty, start the room cleanup timer.
		if h.allSlotsEmpty(c.roomCode) {
			h.scheduleRoomCleanup(c.roomCode)
		}
		return
	}

	// Finished room: treat it exactly like a lobby. The host may call rematch to
	// reopen the room, so the roster and every playerID-keyed structure must stay
	// consistent — leaving a phantom player here would deal a hand to nobody in
	// the next match.
	if room.Status == game.StatusFinished {
		if !h.reindexLobbyDisconnect(c, room, members) {
			h.scheduleRoomCleanup(c.roomCode)
			return
		}
		h.broadcastToRoomAll(c.roomCode, protocol.ServerMsg{
			Type:     protocol.SMsgPlayerLeft,
			Nickname: nickname,
			Players:  h.playerList(room),
		})
		return
	}

	// Lobby: remove the player from room.Players and re-index everything keyed
	// on playerID. Without this, a disconnected host (playerID 0) leaves a
	// phantom slot and no surviving player can ever start the game.
	if !h.reindexLobbyDisconnect(c, room, members) {
		// Only bots (or nothing) remain — no human can start the game.
		h.scheduleRoomCleanup(c.roomCode)
		return
	}
	h.broadcastToRoomAll(c.roomCode, protocol.ServerMsg{
		Type:     protocol.SMsgPlayerLeft,
		Nickname: nickname,
		Players:  h.playerList(room),
	})
}

// scheduleReconnectExpiry arms the close of a held seat's reconnect window.
//
// time.AfterFunc rather than a goroutine per absent seat. If the expire channel
// is full the send is retried once after 5s: dropping it permanently would
// leave the slot in disconnectedAt forever, held for a player who is not
// coming back and reclaimable by nobody else.
//
// Shared with the snapshot restore, which arms exactly this window on every
// seat of a match carried across a restart.
func (h *Hub) scheduleReconnectExpiry(code string, playerID int, at time.Time) {
	em := expireMsg{roomCode: code, playerID: playerID, disconnectedAt: at}
	time.AfterFunc(h.reconnectHold(code), func() {
		select {
		case h.expire <- em:
		default:
			h.statChannelRetries.Add(1)
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

// reindexLobbyDisconnect removes the leaving client from a lobby room and
// shifts every playerID-keyed structure (members, surviving clients' playerID,
// bot slots, session tokens) so indices > leavingID drop by 1. Returns true
// when at least one human remains.
func (h *Hub) reindexLobbyDisconnect(c *Client, room *game.Room, members []*Client) (hasHuman bool) {
	leavingID := c.playerID
	if _, err := room.RemoveLobbyPlayer(leavingID); err != nil {
		log.Printf("WARN RemoveLobbyPlayer failed code=%s player=%d err=%v", c.roomCode, leavingID, err)
	}

	newMembers := make([]*Client, 0, len(members))
	for _, m := range members {
		if m != c {
			newMembers = append(newMembers, m)
		}
	}
	h.roomMembers[c.roomCode] = newMembers

	for newIdx, m := range newMembers {
		if m != nil {
			m.playerID = newIdx
			hasHuman = true
		}
	}

	h.botSlots[c.roomCode] = shiftIntKeySet(h.botSlots[c.roomCode], leavingID)
	h.sessionTokens[c.roomCode] = shiftIntKeyMap(h.sessionTokens[c.roomCode], leavingID)
	return hasHuman
}

// shiftIntKeySet returns a copy of m with the entry at `removed` dropped and
// every key > removed shifted down by 1. Returns nil when the input is nil.
func shiftIntKeySet(m map[int]struct{}, removed int) map[int]struct{} {
	if m == nil {
		return nil
	}
	out := make(map[int]struct{}, len(m))
	for k := range m {
		if k == removed {
			continue
		}
		if k > removed {
			k--
		}
		out[k] = struct{}{}
	}
	return out
}

// shiftIntKeyMap is shiftIntKeySet for map[int]string (session tokens).
func shiftIntKeyMap(m map[int]string, removed int) map[int]string {
	if m == nil {
		return nil
	}
	out := make(map[int]string, len(m))
	for k, v := range m {
		if k == removed {
			continue
		}
		if k > removed {
			k--
		}
		out[k] = v
	}
	return out
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
	delete(h.mapLoading, code)
	delete(h.afkTimeouts, code)
	delete(h.matchmade, code)
	delete(h.rematchOffers, code)
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

	// In a matchmade room the hold is the whole wait: nobody here agreed to sit
	// through an opponent who is not coming back, so the match is given to
	// whoever is still at the table instead of grinding on with a seat that
	// auto-passes every turn until the round runs out.
	if room.Status == game.StatusPlaying && h.isMatchmade(em.roomCode) {
		h.forfeitMatch(em.roomCode, room, em.playerID)
	}

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
		PlayerID: intPtr(playerID),
		State:    h.playerGameState(room, playerID),
		Players:  h.playerList(room),
	})

	// Notify others of the reconnect.
	h.broadcastToRoom(code, protocol.ServerMsg{
		Type:        protocol.SMsgPlayerReconnected,
		PlayerIndex: intPtr(playerID),
		Nickname:    nickname,
		Players:     h.playerList(room),
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
	if h.isMapLoading(code) {
		c.Send(protocol.ServerMsg{
			Type:         protocol.SMsgMatchLoading,
			PlayersReady: h.readySeats(code),
		})
	}
}

// --- Bot support ---

// BotThinkDelay is the simulated thinking time before a bot acts.
// Exported so tests can reduce it to speed up bot-game tests.
var BotThinkDelay = 1200 * time.Millisecond

// BotJitterMax is the maximum random jitter added to bot think delays.
// Exported so tests can set it to 0 to make bot timing deterministic.
var BotJitterMax = 1000 * time.Millisecond

// ApplyBotTimingEnv shortens the bot think delay from the environment
// (LOCO_BOT_THINK_MS / LOCO_BOT_JITTER_MS), for CI only.
//
// The think delay is the one bot timing that is pure dead time: nothing races
// it, so a shorter one changes how long a test takes and not what it proves.
// Every *other* bot delay is a reaction window somebody is meant to be able to
// win — BotCatchDelay against a human's Contre-LOCO!, BotUnoDelay against the
// catch it invites, BotInterruptDelay against an open interrupt window — and
// shortening those would quietly rewrite the verdict of the tests that cover
// them. They are deliberately not tunable here.
//
// Gated on LOCO_E2E for the same reason debug_set_state is: a production server
// must not grow instant bots because a stray variable was set on the host.
// Called once from main, before the hub starts.
func ApplyBotTimingEnv() {
	think, jitter, ok := botTimingOverride(os.Getenv, BotThinkDelay, BotJitterMax)
	if !ok {
		return
	}
	BotThinkDelay, BotJitterMax = think, jitter
	log.Printf("WARN bot think delay overridden think_ms=%d jitter_ms=%d (LOCO_E2E=1; test builds only)",
		think.Milliseconds(), jitter.Milliseconds())
}

// botTimingOverride resolves the think-delay override. Pure, so the precedence
// rules are testable without touching package state or the real environment.
// An absent or malformed value leaves that field on its shipped default rather
// than falling back to zero: a typo must not silently produce an instant bot.
func botTimingOverride(getenv func(string) string, defThink, defJitter time.Duration) (think, jitter time.Duration, ok bool) {
	think, jitter = defThink, defJitter
	if getenv("LOCO_E2E") != "1" {
		return think, jitter, false
	}
	if d, valid := millisEnv(getenv, "LOCO_BOT_THINK_MS"); valid {
		think, ok = d, true
	}
	if d, valid := millisEnv(getenv, "LOCO_BOT_JITTER_MS"); valid {
		jitter, ok = d, true
	}
	return think, jitter, ok
}

// millisEnv reads a non-negative millisecond count. Zero is a value (an instant
// bot is a legitimate thing to ask a test harness for); negative is not.
func millisEnv(getenv func(string) string, name string) (time.Duration, bool) {
	raw := getenv(name)
	if raw == "" {
		return 0, false
	}
	ms, err := strconv.Atoi(raw)
	if err != nil || ms < 0 {
		log.Printf("WARN ignoring %s=%q (want a non-negative integer of milliseconds)", name, raw)
		return 0, false
	}
	return time.Duration(ms) * time.Millisecond, true
}

// BotUnoDelay is the base delay before a bot declares its UNO after playing to
// 1 card. It is the window in which a human can beat it to the Contre-LOCO!
// button, so it is measured against a person spotting the one-card seat, moving
// to the button and clicking — not against how fast a machine could react.
// Together with the jitter it spans 1.6–2.8 s of the 5 s catch window: enough to
// be winnable, short enough that a bot still usually declares in time.
// Exported so tests can set it to 0.
var BotUnoDelay = 1600 * time.Millisecond

// BotUnoJitterMax is the max random jitter added to BotUnoDelay, so the moment
// to strike is never the same twice.
// Exported so tests can set it to 0.
var BotUnoJitterMax = 1200 * time.Millisecond

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

// BotInterruptDelay and BotInterruptJitterMax bound how long a bot takes to
// slam an identical card into an open window (0.7–1.5s).
//
// This is the one bot reaction with no deadline to respect — an interrupt
// window stays open until somebody draws, passes or the round ends — so the
// number is set by fairness, not by a timeout: a human has to see the card
// land, recognise the match and click. Instant would make every contested
// window the bot's, which is worse than the bots never interrupting at all.
// Exported so tests can set them to 0.
var (
	BotInterruptDelay     = 700 * time.Millisecond
	BotInterruptJitterMax = 800 * time.Millisecond
)

// BotInterruptProb is the probability that a bot holding an identical card
// actually uses it. Deliberately below BotCatchProb: an interject takes the
// lead outright, so a bot that always took the one it could see would answer
// every play a human made.
// Exported so tests can set it to a deterministic value.
var BotInterruptProb float32 = 0.40

// handleAddBot adds a bot player to the lobby (host-only).
// nextBotName returns the lowest free "BotN" name (1-based). Scanning for a free
// name rather than counting seats keeps the first bot named Bot1 and avoids
// colliding with a bot that survived a rematch or a human using that nickname.
func nextBotName(room *game.Room) string {
	taken := make(map[string]struct{}, len(room.Players))
	for _, p := range room.Players {
		taken[p.Nickname] = struct{}{}
	}
	for n := 1; ; n++ {
		name := fmt.Sprintf("Bot%d", n)
		if _, clash := taken[name]; !clash {
			return name
		}
	}
}

func (h *Hub) handleAddBot(c *Client, msg protocol.ClientMsg) {
	room, ok := h.roomOf(c)
	if !ok {
		return
	}
	if h.refuseInMatchmade(c) {
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
	nickname := nextBotName(room)
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

// scheduleBotUnoAnnounce defers a bot's UNO declaration for a bot that just
// played to 1 card. The declaration itself is deferred, not just its broadcast:
// declaring on the spot settled the seat server-side while every client was
// still showing the 5 s catch window it opened on the same card_played, so a
// bot's LOCO! could never be caught and every Contre-LOCO! tap came back
// "player already declared".
func (h *Hub) scheduleBotUnoAnnounce(code string, playerIndex int, lastCardTime time.Time) {
	var jitter time.Duration
	if jm := int(BotUnoJitterMax.Milliseconds()); jm > 0 {
		jitter = time.Duration(mrand.Intn(jm)) * time.Millisecond
	}
	um := unoMsg{roomCode: code, playerIndex: playerIndex, lastCardTime: lastCardTime}
	time.AfterFunc(BotUnoDelay+jitter, func() {
		select {
		case h.unoAnnounce <- um:
		default:
			// Non-critical: drop if channel full; the bot simply never declares
			// and stays catchable until its window expires.
		}
	})
}

// handleUnoAnnounce declares and broadcasts a bot's UNO if the situation it was
// scheduled for still holds. Every guard here is a way the bot can lose the
// race: it was caught (hand no longer at 1), the round moved on, or this seat
// opened a different window in the meantime (a Swap handed it another single
// card, which is a declaration it has not made yet).
func (h *Hub) handleUnoAnnounce(um unoMsg) {
	room, ok := h.rooms[um.roomCode]
	if !ok {
		return // room deleted between schedule and fire
	}
	if room.Status != game.StatusPlaying || room.State == nil {
		return
	}
	if um.playerIndex < 0 || um.playerIndex >= len(room.State.Hands) {
		return // seat pruned between schedule and fire
	}
	if !room.State.LastCardAt[um.playerIndex].Equal(um.lastCardTime) {
		return // different one-card moment
	}
	if err := room.DeclareLastCard(um.playerIndex); err != nil {
		return // caught, or no longer on one card
	}
	h.broadcastToRoomAll(um.roomCode, protocol.ServerMsg{
		Type:        protocol.SMsgUnoDeclared,
		PlayerIndex: intPtr(um.playerIndex),
	})
}

// maybeScheduleBotCatch checks whether the most recent card play left anybody at
// 1 card without declaring UNO, and if so, schedules a bot catch attempt per
// catchable seat, because a Swap or a GlobalSwitch puts several of them on the
// hook at once and a bot that only ever saw the first would let the rest walk.
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
	for _, target := range state.CatchableTargets(time.Now()) {
		// Check at least one eligible bot exists (not the target).
		anyEligible := false
		for botID := range bots {
			if botID != target {
				anyEligible = true
				break
			}
		}
		if !anyEligible {
			continue
		}

		var jitter time.Duration
		if jm := int(BotCatchJitterMax.Milliseconds()); jm > 0 {
			jitter = time.Duration(mrand.Intn(jm)) * time.Millisecond
		}
		cm := botCatchMsg{roomCode: code, targetPlayer: target, lastCardTime: state.LastCardAt[target]}
		time.AfterFunc(BotCatchDelay+jitter, func() {
			select {
			case h.botCatch <- cm:
			default:
				// Non-critical: drop if channel full; catch window just closes naturally.
			}
		})
	}
}

// maybeScheduleBotInterrupt arms one interject attempt against the card that
// was just played. Called at the same points as maybeScheduleBotCatch, i.e.
// after a *human* action: bots deliberately do not answer each other, which is
// the existing rule for catches and also what keeps an all-bot table from
// slamming cards back and forth with nobody watching.
//
// One message per play, not one per bot: the handler picks among whoever can
// actually answer, so a table with four bots does not get four rolls of the die
// on the same card.
func (h *Hub) maybeScheduleBotInterrupt(code string, room *game.Room) {
	if room.Status != game.StatusPlaying || room.RoundEnded || room.State == nil {
		return
	}
	if room.State.LastPlayBy < 0 {
		return // window already closed (round-winning play, draw, pass)
	}
	if bots, ok := h.botSlots[code]; !ok || len(bots) == 0 {
		return
	}
	var jitter time.Duration
	if jm := int(BotInterruptJitterMax.Milliseconds()); jm > 0 {
		jitter = time.Duration(mrand.Intn(jm)) * time.Millisecond
	}
	bim := botInterruptMsg{roomCode: code, lastPlayAt: room.State.LastPlayAt}
	time.AfterFunc(BotInterruptDelay+jitter, func() {
		select {
		case h.botInterrupt <- bim:
		default:
			// Non-critical: dropping it means the bot did not react in time,
			// which is a legal outcome of the mechanic rather than a fault.
		}
	})
}

// handleBotInterrupt fires when a scheduled interject is due. Every guard is a
// way the moment can have passed between the schedule and the fire, and each
// one simply means the bot lost the race.
func (h *Hub) handleBotInterrupt(bim botInterruptMsg) {
	room, ok := h.rooms[bim.roomCode]
	if !ok || room.Status != game.StatusPlaying || room.State == nil || room.RoundEnded {
		return
	}
	state := room.State
	// Stale check: a different card is on the pile, so this answer is to a
	// board that no longer exists. Interjecting anyway would be answering the
	// wrong play with the right card.
	if !state.LastPlayAt.Equal(bim.lastPlayAt) {
		return
	}
	bots, ok := h.botSlots[bim.roomCode]
	if !ok || len(bots) == 0 {
		return
	}
	// Probabilistic, like every other bot reaction: they do not always spot it.
	if mrand.Float32() >= BotInterruptProb {
		return
	}

	// Whoever can actually answer, minus the seat that just played — taking the
	// lead back from itself is legal for a human but pointless for a bot, and
	// it would let two bots trade a pair of identical cards on one play.
	//
	// The seat holding the turn is deliberately NOT excluded. In a two-player
	// game the bot is always the next player, so excluding it would mean the
	// mechanic stays one-way in the single most common setup. It is also not
	// redundant with its ordinary turn: an interject slams *every* identical
	// copy at once, where BotThink plays one.
	type candidate struct {
		seat   int
		action *game.BotInterruptAction
	}
	candidates := make([]candidate, 0, len(bots))
	for botID := range bots {
		if botID == state.LastPlayBy {
			continue
		}
		if action := game.BotInterrupt(state, botID); action != nil {
			candidates = append(candidates, candidate{botID, action})
		}
	}
	if len(candidates) == 0 {
		return
	}
	picked := candidates[mrand.Intn(len(candidates))]
	botID, action := picked.seat, picked.action
	if err := room.InterruptPlayCards(botID, action.Cards, action.ChosenColor, action.ChosenPlayer); err != nil {
		// Lost the race to a human or to the state moving on. Nothing to do:
		// the bot simply did not get there, exactly like a mistimed click.
		log.Printf("bot interrupt refused code=%s player=%d err=%v", bim.roomCode, botID, err)
		return
	}
	h.broadcastInterrupt(bim.roomCode, room, botID, action.Cards, action.ChosenPlayer)
	h.maybeScheduleBotDeclarations(bim.roomCode, room)
	h.handleRoundOrMatchEnd(bim.roomCode, room)
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
	if cm.targetPlayer < 0 || cm.targetPlayer >= len(state.Hands) {
		return // seat pruned between schedule and fire
	}
	// Stale check: if this seat's window was reopened, it is a different one.
	if !state.LastCardAt[cm.targetPlayer].Equal(cm.lastCardTime) {
		return
	}
	if state.LastCardDeclared[cm.targetPlayer] {
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
	priorSize := len(state.Hands[cm.targetPlayer].Cards)
	if err := room.CatchUndeclared(catcherID, cm.targetPlayer, time.Now()); err != nil {
		// Window may have expired or state changed — normal race condition, and
		// the bot pays for it exactly like a human who mistimed the button.
		if game.IsMissedCatch(err) {
			h.penalizeFailedCatch(cm.roomCode, room, catcherID)
		}
		return
	}
	h.broadcastToRoomAll(cm.roomCode, protocol.ServerMsg{
		Type:        protocol.SMsgUnoCaught,
		PlayerIndex: intPtr(cm.targetPlayer),
	})
	h.sendHandGrowth(cm.roomCode, room, cm.targetPlayer, state.Hands[cm.targetPlayer].Cards[priorSize:])
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
		h.botPlay(code, room, bm.playerID, action)
		return
	case game.BotCounter:
		h.botCounter(code, room, bm.playerID, action)
		return
	case game.BotDraw:
		if h.botDraw(code, room, bm.playerID) {
			return // self-rescheduled to play the drawn card
		}
	}

	h.maybeScheduleBot(code, room)
}

// botPlay handles a BotPlay action: PlayCard + post-play broadcasts + auto-UNO + round-end check.
func (h *Hub) botPlay(code string, room *game.Room, playerID int, action game.BotAction) {
	if err := room.PlayCard(playerID, action.Card, action.ChosenColor, action.ChosenPlayer); err != nil {
		log.Printf("bot play error: %v", err)
		return
	}
	h.broadcastCardPlayed(code, playerID, room, action.ChosenPlayer)
	if action.Card.Kind == game.Swap || action.Card.Kind == game.GlobalSwitch {
		h.broadcastPersonalizedGameState(code, room)
	}
	h.maybeScheduleBotDeclarations(code, room)
	h.handleRoundOrMatchEnd(code, room)
}

// botCounter handles a BotCounter action: CounterDraw + broadcast + auto-UNO + round-end check.
func (h *Hub) botCounter(code string, room *game.Room, playerID int, action game.BotAction) {
	if err := room.CounterDraw(playerID, action.Card, action.ChosenColor); err != nil {
		log.Printf("bot counter error: %v", err)
		return
	}
	h.broadcastCardPlayed(code, playerID, room, -1)
	h.maybeScheduleBotDeclarations(code, room)
	h.handleRoundOrMatchEnd(code, room)
}

// botDraw handles a BotDraw action: DrawCard + broadcast + post-draw turn handling.
// Returns true when it self-reschedules to play the drawn card (caller should NOT
// fall through to maybeScheduleBot).
func (h *Hub) botDraw(code string, room *game.Room, playerID int) (rescheduled bool) {
	priorSize := len(room.State.Hands[playerID].Cards)
	if err := room.DrawCard(playerID); err != nil {
		log.Printf("bot draw error: %v", err)
		return false
	}
	state := room.State
	h.broadcastToRoomAll(code, protocol.ServerMsg{
		Type:        protocol.SMsgCardDrawn,
		PlayerIndex: intPtr(playerID),
		DrawnCount:  len(state.Hands[playerID].Cards) - priorSize,
		Turn:        state.CurrentTurn,
		PendingDraw: intPtr(state.PendingDraw),
		HasDrawn:    boolPtr(state.HasDrawn),
	})
	// A forced draw does not cost the turn (rules.md §14.5), so the seat is
	// still ours: play the drawn card or pass. The branch that used to handle a
	// penalty draw advancing the turn was unreachable from the day that
	// deviation landed — same dead code as in autoDrawOnTimeout.
	if botCanPlayDrawn(state, playerID) {
		// Schedule another bot move to play the drawn card.
		h.scheduleBotMove(code, playerID)
		return true
	}
	if err := room.PassTurn(playerID); err == nil {
		h.scheduleTurnTimer(code, room)
		h.broadcastToRoomAll(code, protocol.ServerMsg{
			Type:         protocol.SMsgTurnChanged,
			Turn:         room.State.CurrentTurn,
			TurnDeadline: h.turnDeadlineMs(code),
		})
	}
	return false
}

// maybeScheduleBotDeclarations arms a deferred LOCO! for every bot seat that
// currently owes one, not only for the seat that happened to act.
//
// Playing down to one card is not the only way to owe a declaration: a Swap or
// a GlobalSwitch hands one over, and receiving your last card is exactly as
// declarable as playing to it (rules.md §8). Keyed on the acting seat, a human
// who swapped a bot down to one card left it silently catchable for the whole
// 5 s window: a free +2 that no human ever offers, since bots do catch humans.
// A bot's own Swap had the same hole against a *second* bot.
//
// CatchableTargets is the same set maybeScheduleBotCatch reads: seats on one
// card, undeclared, window still open. Filtering it to bots is the entire rule.
// Nothing is declared here: see scheduleBotUnoAnnounce. Scheduling twice for
// one moment is harmless: the second announce finds the seat settled and
// returns.
func (h *Hub) maybeScheduleBotDeclarations(code string, room *game.Room) {
	if room.Status != game.StatusPlaying || room.RoundEnded || room.State == nil {
		return
	}
	bots, ok := h.botSlots[code]
	if !ok || len(bots) == 0 {
		return
	}
	for _, seat := range room.State.CatchableTargets(time.Now()) {
		if _, isBot := bots[seat]; !isBot {
			continue // a human's own call is theirs to make or lose
		}
		h.scheduleBotUnoAnnounce(code, seat, room.State.LastCardAt[seat])
	}
}

// botCanPlayDrawn reports whether the bot can play any card in its hand against
// the current top discard / active color.
func botCanPlayDrawn(state *game.GameState, playerID int) bool {
	topCard := state.Discard[len(state.Discard)-1]
	for _, c := range state.Hands[playerID].Cards {
		if game.CanPlay(c, topCard, state.ActiveColor) {
			return true
		}
	}
	return false
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
			// Drop the previous turn's start time on the way out. turnDeadlineMs
			// reads this map with no notion of whose turn it is, so leaving the
			// human's entry behind made every card_played that hands the turn to
			// a bot carry a deadline that had already half expired: the client
			// mounts its countdown bar on any non-null deadline, so it drained
			// the rest of somebody else's clock under a seat that has no clock.
			// Zero here really is an absence: turn_deadline is omitempty, so the
			// field never reaches the client and the bar stays down.
			delete(h.turnStartedAt, code)
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
	room, ok := h.turnTimeoutTarget(tm)
	if !ok {
		return
	}
	code := tm.roomCode

	log.Printf("turn timeout code=%s player=%d auto-acting", code, tm.playerID)

	timedOutClient := h.memberClient(code, tm.playerID)

	if h.kickIfAFK(code, tm.playerID, timedOutClient) {
		return
	}

	if !h.autoDrawOnTimeout(code, room, tm.playerID) {
		return
	}

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

// turnTimeoutTarget validates that the timer message still applies: the room
// exists and is playing, the current turn matches, and the recorded turn-start
// timestamp is the same one the timer was armed against (not a stale callback).
func (h *Hub) turnTimeoutTarget(tm turnTimerMsg) (*game.Room, bool) {
	room, ok := h.rooms[tm.roomCode]
	if !ok || room.Status != game.StatusPlaying {
		return nil, false
	}
	if room.State.CurrentTurn != tm.playerID {
		return nil, false
	}
	recorded, ok := h.turnStartedAt[tm.roomCode]
	if !ok || !recorded.Equal(tm.turnStartedAt) {
		return nil, false
	}
	return room, true
}

func (h *Hub) memberClient(code string, playerID int) *Client {
	members := h.roomMembers[code]
	if playerID < len(members) {
		return members[playerID]
	}
	return nil
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
func (h *Hub) kickIfAFK(code string, playerID int, client *Client) bool {
	if bots, ok := h.botSlots[code]; ok {
		if _, isBot := bots[playerID]; isBot {
			return false
		}
	}
	if h.bumpAFK(code, playerID) < h.afkThreshold(code) {
		return false
	}
	if h.isMatchmade(code) {
		room, ok := h.rooms[code]
		if !ok || room.Status != game.StatusPlaying {
			return false
		}
		log.Printf("AFK forfeit code=%s player=%d threshold=%d", code, playerID, h.afkThreshold(code))
		if client != nil {
			client.Send(protocol.ServerMsg{Type: protocol.SMsgError, Error: "afk_forfeit"})
		}
		h.forfeitMatch(code, room, playerID)
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
func (h *Hub) autoDrawOnTimeout(code string, room *game.Room, playerID int) bool {
	if room.State.HasDrawn {
		return true
	}
	priorSize := len(room.State.Hands[playerID].Cards)
	if err := room.DrawCard(playerID); err != nil {
		log.Printf("turn timeout draw error code=%s player=%d err=%v", code, playerID, err)
		return false
	}
	h.sendHandGrowth(code, room, playerID, room.State.Hands[playerID].Cards[priorSize:])
	return true
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

// sendHandGrowth tells the affected player exactly WHICH cards just entered
// their hand, and everyone else only how many. Every path that grows a hand
// must go through here: a client that is told a count but not the cards keeps
// a hand shorter than the server's, empties it, and the round then never ends
// (the server still holds cards for a player whose screen shows none).
//
// Callers must have (re)armed the turn timer first — the deadline is read here.
func (h *Hub) sendHandGrowth(code string, room *game.Room, playerID int, newCards []game.Card) {
	if len(newCards) == 0 {
		return
	}
	state := room.State
	dl := h.turnDeadlineMs(code)
	client := h.memberClient(code, playerID)
	if client != nil {
		cardDTOs := make([]*protocol.CardDTO, len(newCards))
		for i, card := range newCards {
			cardDTOs[i] = cardToDTO(card)
		}
		client.Send(protocol.ServerMsg{
			Type:         protocol.SMsgCardDrawn,
			PlayerIndex:  intPtr(playerID),
			Cards:        cardDTOs,
			Turn:         state.CurrentTurn,
			PendingDraw:  intPtr(state.PendingDraw),
			HasDrawn:     boolPtr(state.HasDrawn),
			TurnDeadline: dl,
		})
	}
	// client == nil (bot seat, or a player mid-reconnect) still needs the count fan-out.
	h.broadcastToRoom(code, protocol.ServerMsg{
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
func (h *Hub) refuseAction(c *Client, room *game.Room, err error) {
	c.sendError(err.Error())
	c.noteRejection(err)
	if !game.IsStateMismatch(err) {
		return
	}
	log.Printf("state resync conn=%s code=%s player=%d reason=%v", c.connID, c.roomCode, c.playerID, err)
	c.Send(protocol.ServerMsg{
		Type:  protocol.SMsgGameState,
		State: h.playerGameStateUsing(room, c.playerID, h.playerList(room)),
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
func (h *Hub) broadcastPersonalizedGameState(code string, room *game.Room) {
	pl := h.playerList(room)
	for seat, member := range h.roomMembers[code] {
		if member == nil {
			continue
		}
		member.Send(protocol.ServerMsg{
			Type:  protocol.SMsgGameState,
			State: h.playerGameStateUsing(room, seat, pl),
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

// LatencyBroadcastPeriod is how often a playing room is told every seat's ping.
// One small message per member: slow enough to disappear next to gameplay
// traffic, fast enough that a score table opened on TAB is never showing a
// number from a previous minute. Exported so tests can shorten it.
var LatencyBroadcastPeriod = 3 * time.Second

// broadcastLatencies fans the current per-seat round trips out to every room
// that is actually playing: the score table is an in-game overlay, and a lobby
// has nothing to put the numbers next to.
//
// Runs on the hub event loop, so reading h.rooms / h.roomMembers is safe; the
// RTT itself comes from an atomic written by the connection's pumps.
func (h *Hub) broadcastLatencies() {
	for code, room := range h.rooms {
		if room.Status != game.StatusPlaying {
			continue
		}
		members := h.roomMembers[code]
		bots := h.botSlots[code]
		entries := make([]protocol.LatencyEntryDTO, len(room.Players))
		measured := false
		for i := range room.Players {
			entry := protocol.LatencyEntryDTO{PlayerIndex: i, RTTMs: -1}
			if _, isBot := bots[i]; isBot {
				entry.Bot = true
			} else if i < len(members) && members[i] != nil {
				entry.RTTMs = members[i].latency()
				measured = measured || entry.RTTMs >= 0
			}
			entries[i] = entry
		}
		// Nothing has answered a ping yet (the first seconds of a round, or a
		// table of bots): a payload of "unknown" tells the client exactly what
		// its own default already says.
		if !measured {
			continue
		}
		h.broadcastToRoomAll(code, protocol.ServerMsg{
			Type:      protocol.SMsgLatency,
			Latencies: entries,
		})
	}
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

// playerGameState builds the full recovery snapshot for one player: the
// personalized state plus the event log. Used for the single-recipient sends
// that have to rebuild a client from nothing (reconnect). For broadcast loops
// over every member of a room, use playerGameStateUsing: it skips both the
// per-recipient player list and the log (see exportEventLog).
func (h *Hub) playerGameState(room *game.Room, playerIdx int) *protocol.GameStateDTO {
	dto := h.playerGameStateUsing(room, playerIdx, h.playerList(room))
	dto.EventLog = exportEventLog(room.State)
	return dto
}

// maxEventLogExport caps how much history a reconnecting client is handed.
const maxEventLogExport = 50

// exportEventLog converts the tail of the room's event log to the wire format.
//
// It is deliberately NOT part of every game_state. The log is the one
// unbounded field in the snapshot (up to 50 entries, each with a nested card)
// and a personalized game_state is built per recipient, so a GlobalSwitch at a
// ten-seat table used to serialise the same 50 events ten times over. Nothing
// in the client reads it: it exists so a reconnecting player's history can be
// rebuilt, which is exactly the one send that still carries it.
func exportEventLog(state *game.GameState) []protocol.GameEventDTO {
	if state == nil {
		return nil
	}
	src := state.EventLog
	if len(src) > maxEventLogExport {
		src = src[len(src)-maxEventLogExport:]
	}
	out := make([]protocol.GameEventDTO, len(src))
	for i, ev := range src {
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
		out[i] = dto
	}
	return out
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
			MapID:       string(room.MapID),
		}
	}
	hand := make([]protocol.CardDTO, len(state.Hands[playerIdx].Cards))
	for i, c := range state.Hands[playerIdx].Cards {
		hand[i] = *cardToDTO(c)
	}
	top := state.Discard[len(state.Discard)-1]

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
		RoundNumber:  room.RoundNumber,
		MatchFormat:  matchFormatString(room.Format),
		MaxPlayers:   room.MaxPlayers,
		MapID:        string(room.MapID),
		Scoreboard:   scoreboard,
		RoundHistory: room.RoundHistory,
		TurnDeadline: h.turnDeadlineMs(room.Code),
	}
}

// --- Debug / E2E helpers ---

// handleDebugSetState is a dev-only handler that lets E2E tests inject specific game
// state (hand, discard, pending draw, active color, turn, direction) without relying
// on deck randomness or on what the bots happened to play first.
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

	// Override the play direction. A test that reasons about "the next seat" has
	// no other way to pin it: the bots play before the local player's first turn,
	// and one Reverse among them silently mirrors the whole table.
	if msg.DebugDirection != nil {
		if *msg.DebugDirection != 1 && *msg.DebugDirection != -1 {
			c.sendError(fmt.Sprintf("debug_direction: must be 1 or -1, got %d", *msg.DebugDirection))
			return
		}
		state.Direction = *msg.DebugDirection
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
//
// crypto/rand, not math/rand: the code is the only thing standing between a
// private lobby and a stranger: there is no login and no invite to check
// behind it. math/rand is a predictable sequence, and an attacker who creates
// rooms in a loop is reading that sequence's output directly, which is exactly
// the observation needed to infer its state and name the codes handed to
// everyone else in between. A 32-character alphabet is 5 bits per byte, so the
// rejection loop below keeps the draw uniform rather than folding 256 values
// onto 32 and skewing the first eight letters.
func (h *Hub) generateCode() string {
	const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	for {
		code := make([]byte, 6)
		for i := range code {
			code[i] = chars[randIndex(len(chars))]
		}
		s := string(code)
		if _, exists := h.rooms[s]; !exists {
			return s
		}
	}
}
