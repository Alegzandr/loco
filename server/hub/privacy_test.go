package hub

import (
	"net/http/httptest"
	"testing"
)

func TestTruncateAddr(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		// The last octet is the household. Keeping the /24 still tells an
		// operator "these forty connections are one network", which is the only
		// thing the address was ever read for here.
		{"ipv4 with port", "192.168.1.42:51234", "192.168.1.0/24"},
		{"ipv4 without port", "203.0.113.7", "203.0.113.0/24"},
		{"ipv4 loopback", "127.0.0.1:8080", "127.0.0.0/24"},

		// /48 is the routed prefix an ISP hands out; everything below it is the
		// subscriber's own subnetting and their interface identifier.
		{"ipv6 with port", "[2001:db8:abcd:1234::1]:443", "2001:db8:abcd::/48"},
		{"ipv6 without port", "2001:db8:abcd:1234::1", "2001:db8:abcd::/48"},
		{"ipv6 loopback", "[::1]:9000", "::/48"},

		// An unparseable address must not fall through to the raw string: that
		// is exactly the path a proxy header would take.
		{"garbage", "not-an-address", "unknown"},
		{"empty", "", "unknown"},
		{"hostname", "example.com:80", "unknown"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := truncateAddr(tc.in); got != tc.want {
				t.Errorf("truncateAddr(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

// clientNet is what decides which network a socket is admitted and budgeted
// against. Behind the production proxy chain the peer is always the same nginx
// container, so getting this wrong does not fail: it quietly makes every player
// on the internet share one connection budget of 64 and one failed-join budget
// of 20 a minute.
func TestClientNet(t *testing.T) {
	const proxy = "172.18.0.4:41022"

	cases := []struct {
		name   string
		peer   string
		header string
		value  string
		want   string
	}{
		{
			// The case the whole function exists for.
			name: "trusted proxy forwards the player's network",
			peer: proxy, header: "CF-Connecting-IP", value: "203.0.113.7",
			want: "203.0.113.0/24",
		},
		{
			// An IPv6 player is truncated to the routed /48 like any other, which
			// is why this server needs nothing resembling Cloudflare's Pseudo
			// IPv4: it understands the real address it is given.
			name: "trusted proxy forwards an IPv6 player",
			peer: proxy, header: "CF-Connecting-IP", value: "2001:861:3240:54b0::1",
			want: "2001:861:3240::/48",
		},
		{
			// No edge in front: unchanged from before this existed.
			name: "no header falls back to the peer",
			peer: "198.51.100.9:5000",
			want: "198.51.100.0/24",
		},
		{
			// The header only means something coming from the proxy. A public
			// peer sending it is claiming a network, not reporting one.
			name: "untrusted peer is not believed",
			peer: "198.51.100.9:5000", header: "CF-Connecting-IP", value: "203.0.113.7",
			want: "198.51.100.0/24",
		},
		{
			// Cloudflare appends to an X-Forwarded-For the client invented, so a
			// list is exactly the shape an attacker controls. Refused whole.
			name: "a multi-value header is refused",
			peer: proxy, header: "CF-Connecting-IP", value: "1.2.3.4, 203.0.113.7",
			want: "172.18.0.0/24",
		},
		{
			name: "an unparseable header is refused",
			peer: proxy, header: "CF-Connecting-IP", value: "not-an-address",
			want: "172.18.0.0/24",
		},
		{
			name: "an empty header is refused",
			peer: proxy, header: "CF-Connecting-IP", value: "",
			want: "172.18.0.0/24",
		},
		{
			// The direct socket path has no CDN in front of it, so nothing sets
			// CF-Connecting-IP and Traefik's X-Real-IP is what carries the peer.
			name: "the direct path is read from X-Real-IP",
			peer: proxy, header: "X-Real-IP", value: "203.0.113.7",
			want: "203.0.113.0/24",
		},
		{
			// X-Forwarded-For is not on the list at any position, because the CDN
			// appends to it rather than setting it.
			name: "X-Forwarded-For is ignored",
			peer: proxy, header: "X-Forwarded-For", value: "203.0.113.7",
			want: "172.18.0.0/24",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest("GET", "/ws", nil)
			r.RemoteAddr = tc.peer
			if tc.header != "" {
				r.Header.Set(tc.header, tc.value)
			}
			if got := clientNet(r); got != tc.want {
				t.Errorf("clientNet() = %q, want %q", got, tc.want)
			}
		})
	}
}

// The order of ClientIPHeaders is a security property, not a preference. On the
// proxied path a client can put an X-Real-IP of its own choosing on the request
// and the CDN forwards it; the header the CDN itself sets has to win, or the
// per-network budgets are handed out on request.
func TestClientNetPrefersTheHeaderTheProxySets(t *testing.T) {
	r := httptest.NewRequest("GET", "/ws", nil)
	r.RemoteAddr = "172.18.0.4:41022"
	r.Header.Set("CF-Connecting-IP", "203.0.113.7")
	r.Header.Set("X-Real-IP", "198.51.100.4") // what the client invented

	if got := clientNet(r); got != "203.0.113.0/24" {
		t.Errorf("clientNet() = %q, want 203.0.113.0/24 (the proxy's header, not the client's)", got)
	}
}

// The forwarded address is truncated on the way in like every other, so a full
// one never reaches a counter, a map key or a log line.
func TestClientNetTruncatesTheForwardedAddress(t *testing.T) {
	r := httptest.NewRequest("GET", "/ws", nil)
	r.RemoteAddr = "172.18.0.4:41022"
	r.Header.Set("CF-Connecting-IP", "203.0.113.7")

	if got := clientNet(r); got == "203.0.113.7" {
		t.Errorf("clientNet() returned the forwarded address verbatim: %q", got)
	}
}

// A forwarded header that does not name an address a browser on the internet
// could have is not read, whatever wrote it.
//
// It is the server-side half of the rule client/ws-proxy.conf enforces at the
// proxy: each host forwards only the address its own path guarantees. The case
// that makes it worth a check of its own is the private one — a forged public
// address only buys its sender a bucket of their own, but a forged private one
// can be aimed at the bucket everybody with no trustworthy header falls back
// into, and filling that one refuses them all at the upgrade.
func TestClientNetIgnoresAForwardedAddressNoBrowserCouldHave(t *testing.T) {
	// One entry per shape isRoutableClient refuses. The peer is the same trusted
	// proxy throughout, so the header is the only thing under test.
	for _, forged := range []string{
		"127.0.0.1",       // loopback
		"::1",             // loopback, v6
		"10.0.0.7",        // private
		"172.18.0.4",      // private — the proxy's own network
		"192.168.1.5",     // private
		"169.254.10.1",    // link-local
		"fe80::1",         // link-local, v6
		"fd00::1",         // unique local
		"0.0.0.0",         // unspecified
		"224.0.0.1",       // multicast
		"::ffff:10.0.0.7", // private, wearing a v6 mapping
	} {
		r := httptest.NewRequest("GET", "/ws", nil)
		r.RemoteAddr = "172.18.0.4:41022"
		r.Header.Set("CF-Connecting-IP", forged)

		// The peer, which is what the fallback answers with — never a key derived
		// from the header.
		if got, want := clientNet(r), "172.18.0.0/24"; got != want {
			t.Errorf("CF-Connecting-IP %q: clientNet() = %q, want %q (the peer)", forged, got, want)
		}
	}
}

// And the refusal falls through to the next header rather than to the peer: a
// deployment reading two of them has one path per header, and an unusable value
// on the first says nothing about the second.
func TestClientNetFallsThroughToTheNextHeader(t *testing.T) {
	r := httptest.NewRequest("GET", "/ws", nil)
	r.RemoteAddr = "172.18.0.4:41022"
	r.Header.Set("CF-Connecting-IP", "10.0.0.7") // unusable
	r.Header.Set("X-Real-IP", "203.0.113.7")     // the real one

	if got, want := clientNet(r), "203.0.113.0/24"; got != want {
		t.Errorf("clientNet() = %q, want %q", got, want)
	}
}

// LOCO_TRUSTED_PROXIES replaces the defaults rather than adding to them, so a
// deployment that names its proxy stops believing everything else private.
func TestClientNetHonoursAnExplicitProxyList(t *testing.T) {
	prev := TrustedProxies
	TrustedProxies = parsePrefixes("10.9.0.0/16")
	defer func() { TrustedProxies = prev }()

	r := httptest.NewRequest("GET", "/ws", nil)
	r.Header.Set("CF-Connecting-IP", "203.0.113.7")

	r.RemoteAddr = "10.9.0.2:5000"
	if got := clientNet(r); got != "203.0.113.0/24" {
		t.Errorf("listed proxy: clientNet() = %q, want 203.0.113.0/24", got)
	}

	// Private, and trusted by the defaults, but not on the list.
	r.RemoteAddr = "192.168.1.5:5000"
	if got := clientNet(r); got != "192.168.1.0/24" {
		t.Errorf("unlisted proxy: clientNet() = %q, want 192.168.1.0/24", got)
	}
}

// The whole point of the function is that no full address survives it.
func TestTruncateAddrNeverEchoesTheHostIdentifier(t *testing.T) {
	for _, in := range []string{"192.168.1.42:51234", "2001:db8:abcd:1234::1", "not-an-address"} {
		got := truncateAddr(in)
		if got == in {
			t.Errorf("truncateAddr(%q) returned its input verbatim", in)
		}
	}
}
