// The socket, from the HTTP request to a registered client: which origins may
// open one, and the two ceilings refused before the upgrade rather than after
// it, because the window between the upgrade and the register is where a flood
// lives.
package hub

import (
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"

	"github.com/gorilla/websocket"
)

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
	CheckOrigin:       originAllowed,
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

// ServeWS upgrades an HTTP connection to WebSocket and registers the client.
func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request) {
	addr := truncateAddr(r.RemoteAddr)
	log.Printf("ws request addr=%s origin=%q method=%s", addr, r.Header.Get("Origin"), r.Method)

	// Admission is decided here, before the upgrade, on purpose: a connection
	// this server is not going to serve should not cost it a hijacked socket, a
	// 256-slot send buffer and two goroutines first. 429 rather than a close, so
	// a client (and an operator reading nginx's log) can tell a refusal from a
	// network failure.
	if !h.admitConn(addr) {
		h.metrics.connsRefused.Add(1)
		http.Error(w, "too many connections", http.StatusTooManyRequests)
		log.Printf("WARN ws admission refused addr=%s", addr)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		h.releaseConn(addr)
		log.Printf("ws upgrade FAILED addr=%s origin=%q err=%v", addr, r.Header.Get("Origin"), err)
		return
	}
	log.Printf("ws upgrade OK addr=%s", addr)
	c := newClient(h, conn)
	c.netKey = addr
	h.register <- c
}

// admitConn takes one slot against the global and per-network ceilings, and
// reports whether there was one. releaseConn gives it back.
//
// The counter is its own, not h.metrics.clients: that one is maintained by the event
// loop and would let an unbounded number of sockets arrive in the window
// between the upgrade and the register, which is exactly the window a flood
// lives in.
func (h *Hub) admitConn(netKey string) bool {
	h.connMu.Lock()
	defer h.connMu.Unlock()
	if h.connTotal >= MaxClients || h.connsPerNet[netKey] >= MaxConnsPerNet {
		return false
	}
	h.connsPerNet[netKey]++
	h.connTotal++
	return true
}

func (h *Hub) releaseConn(netKey string) {
	h.connMu.Lock()
	defer h.connMu.Unlock()
	if h.connsPerNet[netKey] <= 1 {
		delete(h.connsPerNet, netKey)
	} else {
		h.connsPerNet[netKey]--
	}
	if h.connTotal > 0 {
		h.connTotal--
	}
}
