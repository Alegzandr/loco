package hub

import (
	"net"
	"net/netip"
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

// netPrefix is what every `addr=` field in a connection-scoped log line carries.
// Correlation across lines is `conn=` (the connection ID), which is what those
// lines are actually read by; the prefix is only there to tell two networks
// apart. Never log c.conn.RemoteAddr() directly.
func (c *Client) netPrefix() string {
	if c.conn == nil {
		return "unknown"
	}
	return truncateAddr(c.conn.RemoteAddr().String())
}
