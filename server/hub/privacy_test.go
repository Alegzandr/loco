package hub

import "testing"

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

// The whole point of the function is that no full address survives it.
func TestTruncateAddrNeverEchoesTheHostIdentifier(t *testing.T) {
	for _, in := range []string{"192.168.1.42:51234", "2001:db8:abcd:1234::1", "not-an-address"} {
		got := truncateAddr(in)
		if got == in {
			t.Errorf("truncateAddr(%q) returned its input verbatim", in)
		}
	}
}
