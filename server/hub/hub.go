// Package hub manages WebSocket connections and routes game messages.
// This file carries the Hub itself: its tunables, the messages its loop
// receives, and the loop. Everything a message leads to lives beside it.
package hub

import (
	"log"
	"os"
	"runtime"
	"sync"
	"sync/atomic"
	"time"

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

// The ceilings. Nothing bounded this server's memory: the per-client token
// bucket limits one socket's message rate and says nothing about how many
// sockets there are, and a table outlives the connection that opened it by
// EmptyRoomTimeout. So connect, create_room, disconnect, repeat was an
// unbounded allocation loop costing an attacker one TCP handshake a table.
//
// All three are deliberately generous: they are there to make the abusive case
// terminate, not to shape the legitimate one. A server that refuses a real
// player is a worse outcome than a server that carries a few thousand idle
// rooms, so if one of these is ever reached in production it is a signal to
// read the logs, not a number to lower. Exported so tests can narrow them.
var (
	// MaxRooms caps live tables, matchmade and private together.
	MaxRooms = 2000
	// MaxClients caps concurrent sockets, refused at the upgrade.
	MaxClients = 5000
	// MaxConnsPerNet caps concurrent sockets from one /24 or /48 (see
	// truncateAddr, which is also what the logs are keyed by). High enough for a
	// household, a LAN party or a office behind one address; low enough that a
	// single origin cannot spend the global budget on its own.
	MaxConnsPerNet = 64
	// MaxFailedJoins is how many table codes one network may get wrong per
	// failedJoinWindow before it is refused for the rest of it.
	//
	// A wrong code used to cost nothing at all. The space is 32^6, but a sweep is
	// not looking for one table, it is looking for any of them, so the odds scale
	// with how many are open and a busy server was walkable. A player who
	// mistypes theirs is nowhere near this.
	MaxFailedJoins = 20
)

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

// Hub manages all active tables and connected clients.
type Hub struct {
	// tables is every live table, keyed by its code. One entry is one table's
	// whole existence: see table.go for what that entry holds and for what the
	// eleven parallel maps it replaced used to cost.
	tables  map[string]*table
	clients map[*Client]struct{}

	// queue is the 1v1 matchmaking queue, oldest wait first. Its length is a
	// metric and nothing else: no client is ever told how long it is.
	// See matchmaking.go.
	queue []queuedPlayer

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
	stopped        chan struct{}          // closed by Run() on its way out; what Stop() waits on

	// draining is read from the HTTP goroutines (/health, /metrics) as well as
	// from the event loop, which is the only reason it is atomic; every write
	// goes through the drain channel and lands in Run.
	draining atomic.Bool
	// drained is closed once the last match in flight has ended. drainedClosed
	// guards the close, and is only ever touched by the event loop.
	drained       chan struct{}
	drainedClosed bool

	// connMu guards connsPerNet. It is the one piece of hub state written from
	// outside the event loop: ServeWS runs in an HTTP goroutine and has to decide
	// before a Client exists, which is the whole point of refusing there.
	connMu      sync.Mutex
	connsPerNet map[string]int
	connTotal   int

	// joinBudgets[netPrefix] is how many table codes that network has got wrong
	// recently. Event-loop only, like every other map here.
	joinBudgets map[string]*joinBudget

	// afterRegisterHook is called in the register case after the client is added
	// to h.clients but before c.start(). Runs in the hub event-loop goroutine.
	// Nil by default; set via export_test.go for deterministic race tests only.
	afterRegisterHook func()
	// dispatchProbe is fired at the top of dispatch. Test-only; see
	// export_test.go.
	dispatchProbe func()

	// Everything an operator reads, and the loop's own saturation. See
	// metrics.go: they are one struct because they are one concern, and every
	// one of them is atomic because /health and /metrics are served from HTTP
	// goroutines while this loop is writing.
	metrics   hubMetrics
	startTime time.Time
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
	// The three abuse counters. HandlerPanics is the one to alert on: it is a
	// bug by definition, recovered rather than fatal, and nothing else surfaces
	// it. The other two are load signals, not incidents, until they climb.
	HandlerPanics  int64 `json:"handler_panics"`
	ConnsRefused   int64 `json:"conns_refused"`
	JoinsThrottled int64 `json:"joins_throttled"`
	// How close one event loop is to being the ceiling. Every room on this
	// process is served by that one goroutine, so what bounds the number of
	// tables it can carry is not MaxRooms: it is how long one pass through
	// dispatch takes and how deep the queue gets behind it. MessagesDroppedBusy
	// is that ceiling *after* it has been hit; these are the approach to it.
	// Peak and slowest are high-water marks since startup, never reset.
	LoopQueueDepth    int32 `json:"loop_queue_depth"`
	LoopQueueCapacity int32 `json:"loop_queue_capacity"`
	LoopQueuePeak     int32 `json:"loop_queue_peak"`
	LoopSlowestUs     int64 `json:"loop_slowest_us"`
	LoopEvents        int64 `json:"loop_events"`
}

// New creates and returns a Hub.
func New() *Hub {
	return &Hub{
		tables:         make(map[string]*table),
		clients:        make(map[*Client]struct{}),
		connsPerNet:    make(map[string]int),
		joinBudgets:    make(map[string]*joinBudget),
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
		stopped:        make(chan struct{}),
		startTime:      time.Now(),
	}
}

// GetStats returns a snapshot of hub metrics safe to call from any goroutine.
func (h *Hub) GetStats() HealthStats {
	return HealthStats{
		Status:    "ok",
		Rooms:     h.metrics.rooms.Load(),
		Clients:   h.metrics.clients.Load(),
		UptimeSec: int64(time.Since(h.startTime).Seconds()),
		Draining:  h.draining.Load(),
	}
}

// GetMetrics returns the full metrics payload safe to call from any goroutine.
func (h *Hub) GetMetrics() MetricsStats {
	return MetricsStats{
		RoomsActive:          h.metrics.rooms.Load(),
		PlayersConnected:     h.metrics.clients.Load(),
		MatchesStarted:       h.metrics.matchesStarted.Load(),
		MatchesFinished:      h.metrics.matchesFinished.Load(),
		BotsActive:           h.metrics.botsActive.Load(),
		UptimeSec:            int64(time.Since(h.startTime).Seconds()),
		GoroutineCount:       runtime.NumGoroutine(),
		MessagesRateLimited:  h.metrics.messagesRateLimited.Load(),
		MessagesDroppedBusy:  h.metrics.messagesDroppedBusy.Load(),
		SlowClientsClosed:    h.metrics.slowClientsClosed.Load(),
		ChannelRetries:       h.metrics.channelRetries.Load(),
		SuspectedCheats:      h.metrics.suspectedCheats.Load(),
		ReconnectExpirations: h.metrics.reconnectExpirations.Load(),
		MatchmakingQueue:     h.metrics.matchmakingQueue.Load(),
		MatchesMatchmade:     h.metrics.matchesMatchmade.Load(),
		DebugModeActive:      os.Getenv("LOCO_E2E") == "1",
		Draining:             h.draining.Load(),
		MatchesInFlight:      h.metrics.matchesInFlight.Load(),
		HandlerPanics:        h.metrics.handlerPanics.Load(),
		ConnsRefused:         h.metrics.connsRefused.Load(),
		JoinsThrottled:       h.metrics.joinsThrottled.Load(),
		LoopQueueDepth:       int32(len(h.inbound)),
		LoopQueueCapacity:    int32(cap(h.inbound)),
		LoopQueuePeak:        h.metrics.loopQueuePeak.Load(),
		LoopSlowestUs:        h.metrics.loopSlowestUs.Load(),
		LoopEvents:           h.metrics.loopEventCount.Load(),
	}
}

// Stop terminates the Run loop and waits for it to be gone. Safe to call once;
// further calls panic on the closed channel. Every caller must have started Run
// in a goroutine, or this blocks forever.
//
// The wait is not politeness. Stop used to close the channel and return, so the
// loop was still dispatching after it: in production the process could exit
// mid-handler, and in tests every `t.Cleanup` restoring a tunable
// (BotThinkDelay and the dozen others every timing test narrows) raced the loop
// reading it. That was a genuine data race — `go test -race ./hub/` reported it
// on fourteen tests — and it was invisible because CI does not pass -race.
// Waiting here removes the whole class rather than one test's ordering.
func (h *Hub) Stop() {
	close(h.quit)
	<-h.stopped
}

// Run starts the hub event loop. Call in a goroutine.
func (h *Hub) Run() {
	defer close(h.stopped)
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
			h.metrics.clients.Add(1)
			log.Printf("player connected conn=%s addr=%s", c.connID, c.netPrefix())
			if h.afterRegisterHook != nil {
				h.afterRegisterHook()
			}
			// Start pumps after registration so readPump's unregister call is
			// never processed before the register, preventing zombie clients.
			c.start()

		case c := <-h.unregister:
			if _, ok := h.clients[c]; ok {
				delete(h.clients, c)
				h.metrics.clients.Add(-1)
				h.releaseConn(c.netKey)
				c.close()
				h.handleDisconnect(c)
			}

		case im := <-h.inbound:
			// The one hot path, and the only one worth timing: everything else
			// on this select is a timer the server armed itself. See
			// hubMetrics.noteEvent for why the marks are high-water rather than
			// averages.
			queued := len(h.inbound)
			start := time.Now()
			h.dispatch(im.client, im.msg)
			h.metrics.noteEvent(queued, time.Since(start))

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
