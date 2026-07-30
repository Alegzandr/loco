package hub

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
	"loco/server/protocol"
)

const (
	writeWait = 10 * time.Second
	pongWait  = 60 * time.Second
	// Ping frames double as the latency probe behind the in-game score table,
	// so they go out far more often than keeping the connection alive requires.
	// Browsers answer a ping in the WebSocket layer with no client code
	// involved, which makes this a real network RTT rather than something the
	// client reports about itself (and could lie about). pongWait, the read
	// deadline, is deliberately unchanged: a client is still only dropped
	// after a full minute of silence.
	maxMsgSize = 4096

	// A single sample carries the jitter of one packet, and a ping readout that
	// jumps 40, then 180, then 50 reads as broken rather than as informative, so each
	// measurement is folded into the previous one: 0.6 old + 0.4 new.
	latencySmoothOld = 3
	latencySmoothNew = 2
	// Anything past this is "unplayable" either way; the cap keeps a stalled
	// connection from parking the display on a five-digit number.
	maxLatencyMs = 9999

	// Rate limiter: token bucket per client.
	// Allow bursts of up to rateBurst messages, refilling at ratePerSec tokens/sec.
	ratePerSec = 10
	rateBurst  = 20
)

// PingPeriod is how often a ping frame goes out (see the comment above).
// Exported as a var so tests can shorten it; production never changes it.
var PingPeriod = 5 * time.Second

// rateLimiter is a simple token bucket for per-client message rate limiting.
type rateLimiter struct {
	mu       sync.Mutex
	tokens   float64
	lastFill time.Time
}

func newRateLimiter() *rateLimiter {
	return &rateLimiter{tokens: rateBurst, lastFill: time.Now()}
}

// allow returns true if the message should be processed, false if rate limit exceeded.
func (r *rateLimiter) allow() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := time.Now()
	elapsed := now.Sub(r.lastFill).Seconds()
	r.tokens += elapsed * ratePerSec
	if r.tokens > rateBurst {
		r.tokens = rateBurst
	}
	r.lastFill = now
	if r.tokens < 1 {
		return false
	}
	r.tokens--
	return true
}

// Client represents a single WebSocket connection.
type Client struct {
	hub      *Hub
	conn     *websocket.Conn
	send     chan []byte
	mu       sync.Mutex
	roomCode string
	playerID int
	closed   bool
	limiter  *rateLimiter
	// connID is a short random tag included in every log line involving this
	// connection, so operators can grep a single player's actions across the
	// log even when they move between rooms or before they have joined one.
	connID string
	// suspectMu / suspectCount / suspectWindowStart implement a lightweight
	// rolling counter of gameplay validation rejections. A real player taps the
	// occasional illegal play; a tampering client triggers many in a row. We
	// emit a single WARN per burst so the operator can investigate.
	suspectMu          sync.Mutex
	suspectCount       int
	suspectWindowStart time.Time

	// latencyMs is the smoothed ping/pong round trip in milliseconds, or -1
	// while nothing has been measured yet. pingSentAt is the unix-nano stamp of
	// the last ping frame written. Written by the write/read pumps, read by the
	// hub event loop when it builds a latency broadcast, hence atomic.
	latencyMs  atomic.Int32
	pingSentAt atomic.Int64
}

// newClient creates a client. The hub's register handler calls start() after
// adding the client to h.clients, ensuring readPump/writePump never send to
// h.unregister before the client is registered (which would cause the unregister
// to be silently dropped, leaving a zombie entry in h.clients).
func newClient(h *Hub, conn *websocket.Conn) *Client {
	c := &Client{
		hub:     h,
		conn:    conn,
		send:    make(chan []byte, 256),
		limiter: newRateLimiter(),
		connID:  generateConnID(),
	}
	c.latencyMs.Store(-1) // "not measured yet", not "0 ms"
	return c
}

// generateConnID produces a short (8-hex-char) correlation ID for log tracing.
// Not used for security; uniqueness within a server lifetime is sufficient.
func generateConnID() string {
	var b [4]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "00000000"
	}
	return hex.EncodeToString(b[:])
}

// start launches the read and write pump goroutines. Must be called by the hub
// after the client has been added to h.clients.
func (c *Client) start() {
	go c.writePump()
	go c.readPump()
}

func (c *Client) readPump() {
	connectedAt := time.Now()
	defer func() {
		uptime := time.Since(connectedAt)
		if uptime < 5*time.Second {
			log.Printf("ws immediate disconnect conn=%s addr=%s uptime=%v", c.connID, c.conn.RemoteAddr(), uptime)
		} else {
			log.Printf("ws readPump exit conn=%s addr=%s uptime=%v", c.connID, c.conn.RemoteAddr(), uptime)
		}
		c.hub.unregister <- c
		c.conn.Close()
	}()
	c.conn.SetReadLimit(maxMsgSize)
	_ = c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		_ = c.conn.SetReadDeadline(time.Now().Add(pongWait))
		c.notePong(time.Now())
		return nil
	})
	for {
		_, data, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("ws unexpected close conn=%s addr=%s err=%v", c.connID, c.conn.RemoteAddr(), err)
			} else {
				// Log all other close reasons (normal close, read deadline, network reset, etc.)
				// so we can see exactly why the connection ended.
				log.Printf("ws connection closed conn=%s addr=%s reason=%v", c.connID, c.conn.RemoteAddr(), err)
			}
			break
		}
		if !c.limiter.allow() {
			c.hub.statMessagesRateLimited.Add(1)
			c.sendError("rate limit exceeded")
			continue
		}
		var msg protocol.ClientMsg
		if err := json.Unmarshal(data, &msg); err != nil {
			c.sendError("invalid message format")
			continue
		}
		// Non-blocking send: if the hub event loop is saturated (inbound cap 256),
		// drop this message and notify the client. This is intentional — it prevents
		// readPump goroutines from parking forever on a full channel, which would
		// cascade into a deadlock on the unregister channel (cap 16).
		select {
		case c.hub.inbound <- inboundMsg{client: c, msg: msg}:
		default:
			c.hub.statMessagesDroppedBusy.Add(1)
			log.Printf("inbound channel full, dropping message conn=%s addr=%s", c.connID, c.conn.RemoteAddr())
			c.sendError("server busy, please retry")
		}
	}
}

func (c *Client) writePump() {
	ticker := time.NewTicker(PingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()
	for {
		select {
		case data, ok := <-c.send:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, data); err != nil {
				return
			}
		case <-ticker.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			c.pingSentAt.Store(time.Now().UnixNano())
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// Send marshals a server message and queues it for delivery.
// See SendBytes for the overflow / slow-client policy.
func (c *Client) Send(msg protocol.ServerMsg) {
	data, err := json.Marshal(msg)
	if err != nil {
		log.Printf("marshal error: %v", err)
		return
	}
	c.SendBytes(data)
}

// SendBytes queues a pre-marshaled payload for delivery. Used by broadcast
// helpers to marshal once and fan-out the same []byte to many recipients.
//
// Slow-client policy: if the per-client send buffer (cap 256) is full, the
// client cannot keep up with the broadcast rate. Silently dropping a message
// would leave the client desynced with no way to recover (the missed message
// could be a card_played, round_end, etc.). Instead we force-close the
// underlying connection: readPump will error, the hub will unregister the
// client and (during gameplay) hold the slot for the reconnect window. The
// client's WebSocket auto-reconnect then triggers handleReconnect, which
// delivers a full game_state snapshot and recovers cleanly.
func (c *Client) SendBytes(data []byte) {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return
	}
	select {
	case c.send <- data:
		c.mu.Unlock()
		return
	default:
		c.mu.Unlock()
	}
	c.hub.statSlowClientsClosed.Add(1)
	log.Printf("WARN slow client, force-closing for clean reconnect conn=%s addr=%s", c.connID, c.conn.RemoteAddr())
	// Closing the underlying conn triggers readPump exit → hub.unregister →
	// c.close() (which closes c.send and lets writePump exit). gorilla/websocket
	// treats a second Close() as a no-op error, so repeated overflow is safe.
	_ = c.conn.Close()
}

// notePong records the round trip of the ping frame this pong answers, folded
// into the previous measurement (see latencySmoothOld/New). A pong that arrives
// before any ping was sent, or with a clock that went backwards, is ignored
// rather than published as a bogus 0 ms.
func (c *Client) notePong(now time.Time) {
	sent := c.pingSentAt.Load()
	if sent == 0 {
		return
	}
	rtt := now.Sub(time.Unix(0, sent)).Milliseconds()
	if rtt < 0 {
		return
	}
	if rtt > maxLatencyMs {
		rtt = maxLatencyMs
	}
	prev := c.latencyMs.Load()
	if prev < 0 {
		c.latencyMs.Store(int32(rtt))
		return
	}
	smoothed := (int64(prev)*latencySmoothOld + rtt*latencySmoothNew) / (latencySmoothOld + latencySmoothNew)
	c.latencyMs.Store(int32(smoothed))
}

// latency returns the smoothed round trip in milliseconds, or -1 if unknown.
func (c *Client) latency() int { return int(c.latencyMs.Load()) }

func (c *Client) sendError(msg string) {
	c.Send(protocol.ServerMsg{Type: protocol.SMsgError, Error: msg})
}

// noteSuspect tags a gameplay-validation rejection on this client. The first
// rejection within a 30-second window starts the count; once the window's
// count crosses suspectThreshold we emit a single WARN with the connID so an
// operator can investigate, then reset the window. Genuine fat-fingered plays
// are noisy enough to never trip the threshold.
const (
	suspectThreshold  = 5
	suspectWindowSpan = 30 * time.Second
)

func (c *Client) noteSuspect(reason string) {
	now := time.Now()
	c.suspectMu.Lock()
	if now.Sub(c.suspectWindowStart) > suspectWindowSpan {
		c.suspectWindowStart = now
		c.suspectCount = 0
	}
	c.suspectCount++
	count := c.suspectCount
	c.suspectMu.Unlock()
	if count == suspectThreshold {
		c.hub.statSuspectedCheats.Add(1)
		log.Printf("WARN suspected cheat: %d validation rejections in 30s conn=%s code=%s player=%d last_reason=%q",
			count, c.connID, c.roomCode, c.playerID, reason)
	}
}

func (c *Client) close() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.closed {
		c.closed = true
		close(c.send)
	}
}
