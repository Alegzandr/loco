package hub

import (
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"loco/server/protocol"
)

const (
	writeWait  = 10 * time.Second
	pongWait   = 60 * time.Second
	pingPeriod = (pongWait * 9) / 10
	maxMsgSize = 4096

	// Rate limiter: token bucket per client.
	// Allow bursts of up to rateBurst messages, refilling at ratePerSec tokens/sec.
	ratePerSec = 10
	rateBurst  = 20
)

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
}

// newClient creates a client and starts its read/write pumps.
func newClient(h *Hub, conn *websocket.Conn) *Client {
	c := &Client{
		hub:     h,
		conn:    conn,
		send:    make(chan []byte, 256),
		limiter: newRateLimiter(),
	}
	go c.writePump()
	go c.readPump()
	return c
}

func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()
	c.conn.SetReadLimit(maxMsgSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})
	for {
		_, data, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("ws read error: %v", err)
			}
			break
		}
		if !c.limiter.allow() {
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
			log.Printf("inbound channel full, dropping message from addr=%s", c.conn.RemoteAddr())
			c.sendError("server busy, please retry")
		}
	}
}

func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()
	for {
		select {
		case data, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, data); err != nil {
				return
			}
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// Send queues a server message for delivery.
// Non-blocking: if the per-client send buffer (cap 256) is full, the message is
// dropped and logged. A full buffer means the client is not draining fast enough
// (slow network or unresponsive tab); dropping prevents head-of-line blocking
// that would stall the hub event loop for all other clients.
func (c *Client) Send(msg protocol.ServerMsg) {
	data, err := json.Marshal(msg)
	if err != nil {
		log.Printf("marshal error: %v", err)
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return
	}
	select {
	case c.send <- data:
	default:
		log.Printf("client send buffer full, dropping message")
	}
}

func (c *Client) sendError(msg string) {
	c.Send(protocol.ServerMsg{Type: protocol.SMsgError, Error: msg})
}

func (c *Client) close() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.closed {
		c.closed = true
		close(c.send)
	}
}
