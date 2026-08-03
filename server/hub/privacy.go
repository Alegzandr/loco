package hub

import (
	"net"
	"net/http"
	"net/netip"
	"os"
	"strings"
)

// truncateAddr reduces a remote address to its network prefix for logging.
//
// The server keeps no account and stores no personal data, but a full IP in a
// log line is personal data on its own, and the logs are the only place any
// ever appeared. Nothing here ever needed the host identifier: addresses are
// read to correlate a burst of connections or to recognise an abusive network,
// and a /24 (IPv4) or /48 (IPv6) answers both. So the identifier is dropped at
// the point of writing rather than retained and then promised away in a policy.
//
// Anything that does not parse as an IP becomes "unknown". Returning the input
// would defeat the whole function the first time something unexpected (a proxy
// header, a unix socket) reached it.
func truncateAddr(addr string) string {
	host := addr
	if h, _, err := net.SplitHostPort(addr); err == nil {
		host = h
	}

	ip, err := netip.ParseAddr(host)
	if err != nil {
		return "unknown"
	}

	bits := 24
	if ip.Is6() && !ip.Is4In6() {
		bits = 48
	}
	if ip.Is4In6() {
		ip = ip.Unmap()
	}

	prefix, err := ip.Prefix(bits)
	if err != nil {
		return "unknown"
	}
	return prefix.String()
}

// ClientIPHeader is the request header carrying the address of the browser that
// actually opened the socket, read once from LOCO_CLIENT_IP_HEADER at startup.
//
// In production this server never sees a player: the path is browser →
// Cloudflare → Traefik → nginx → here, so r.RemoteAddr is the nginx container on
// the internal Docker network and it is *the same address for everybody*. That
// is not a cosmetic problem. Three things are keyed by network prefix, and all
// three collapsed onto one bucket:
//
//   - MaxConnsPerNet (64) stopped being a per-network ceiling and became the
//     server's total concurrent socket count. The 65th player on the site was
//     refused with a 429 before the upgrade, and the logs blamed one network.
//   - MaxFailedJoins (20 per minute) became global: twenty mistyped table codes
//     across every player alive locked the whole site out of join_room.
//   - Every `addr=` in the log was a constant, leaving `conn=` as the only
//     correlator.
//
// There are two of them because production has two paths to this server, and a
// player can be on either within one match:
//
//   - The page and everything cacheable go through the CDN, which sets
//     CF-Connecting-IP.
//   - The socket is dialled on a hostname that resolves straight to the origin,
//     because a proxied WebSocket cost 389 ms per round trip against 8.5 ms
//     direct. Nothing sets CF-Connecting-IP there; Traefik overwrites X-Real-IP
//     with the peer it actually accepted.
//
// Tried in order, first one that parses wins. The order matters: on the proxied
// path a client can send an X-Real-IP of its own invention and the CDN forwards
// it, so the header the CDN controls has to be read first.
//
// X-Forwarded-For is deliberately absent and a multi-value header is refused
// below. Cloudflare *appends* the real address to an X-Forwarded-For the client
// wrote, so its leftmost entry is attacker-controlled, and reading it hands
// anybody a connection budget of their own.
var ClientIPHeaders = headersOrDefault(os.Getenv("LOCO_CLIENT_IP_HEADERS"), "CF-Connecting-IP", "X-Real-IP")

func headersOrDefault(raw string, fallback ...string) []string {
	var out []string
	for _, part := range strings.Split(raw, ",") {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	if len(out) == 0 {
		return fallback
	}
	return out
}

// TrustedProxies is the set of peers whose ClientIPHeader is believed, read from
// LOCO_TRUSTED_PROXIES (comma-separated CIDRs) at startup. Empty means the
// defaults below.
var TrustedProxies = parsePrefixes(os.Getenv("LOCO_TRUSTED_PROXIES"))

// defaultTrustedProxies is loopback plus the private ranges, which is the whole
// set of addresses that can reach this server in production: the Go container
// publishes 8080 on the `internal` Docker network only and nginx is the single
// peer on it (`expose`, never `ports` — see deploy/compose.yml). A public peer
// therefore never reaches here, and if one ever did it would be believed by
// nothing: the header is read only when the peer is in this set.
var defaultTrustedProxies = parsePrefixes(
	"127.0.0.0/8,::1/128,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,169.254.0.0/16,fc00::/7,fe80::/10",
)

func parsePrefixes(raw string) []netip.Prefix {
	var out []netip.Prefix
	for _, part := range strings.Split(raw, ",") {
		trimmed := strings.TrimSpace(part)
		if trimmed == "" {
			continue
		}
		if p, err := netip.ParsePrefix(trimmed); err == nil {
			out = append(out, p)
		}
	}
	return out
}

// clientNet is the network prefix a socket is admitted, budgeted and logged
// under: the forwarded address when there is a trustworthy one, the peer
// otherwise. Already truncated, so no caller ever holds a full address.
func clientNet(r *http.Request) string {
	if forwarded, ok := forwardedAddr(r); ok {
		return truncateAddr(forwarded)
	}
	return truncateAddr(r.RemoteAddr)
}

// forwardedAddr reads ClientIPHeaders in order, if and only if the peer is a
// trusted proxy and the value is exactly one address. Every other case falls
// through to the next header and finally to the peer rather than guessing: a
// header that is absent, empty, a list or unparseable is a topology this server
// has not been told about, and inventing a network key from it is how one player
// would get a budget of their own.
func forwardedAddr(r *http.Request) (string, bool) {
	if !peerIsTrustedProxy(r.RemoteAddr) {
		return "", false
	}
	for _, name := range ClientIPHeaders {
		raw := strings.TrimSpace(r.Header.Get(name))
		if raw == "" || strings.Contains(raw, ",") {
			continue
		}
		if _, err := netip.ParseAddr(raw); err != nil {
			continue
		}
		return raw, true
	}
	return "", false
}

func peerIsTrustedProxy(addr string) bool {
	host := addr
	if h, _, err := net.SplitHostPort(addr); err == nil {
		host = h
	}
	ip, err := netip.ParseAddr(host)
	if err != nil {
		return false
	}
	ip = ip.Unmap()

	nets := TrustedProxies
	if len(nets) == 0 {
		nets = defaultTrustedProxies
	}
	for _, p := range nets {
		if p.Contains(ip) {
			return true
		}
	}
	return false
}

// netPrefix is what every `addr=` field in a connection-scoped log line carries.
// Correlation across lines is `conn=` (the connection ID), which is what those
// lines are actually read by; the prefix is only there to tell two networks
// apart. Never log c.conn.RemoteAddr() directly.
//
// It answers with netKey, decided once by clientNet at admission, so a log line
// names the network the ceilings were charged against rather than a second
// opinion derived from the peer. The fallback is for a Client built without a
// socket, which is a test and a benchmark.
func (c *Client) netPrefix() string {
	if c.netKey != "" {
		return c.netKey
	}
	if c.conn == nil {
		return "unknown"
	}
	return truncateAddr(c.conn.RemoteAddr().String())
}
