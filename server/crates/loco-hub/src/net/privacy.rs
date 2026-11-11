//! Which network a socket belongs to, and the only place the peer's address is
//! ever read.
//!
//! **Nothing outside this file may read the remote address.** `serve.rs` takes a
//! [`ClientNet`] extractor, which is already truncated, and never sees the peer:
//! a full address is personal data, and this server holds no other. Lines are
//! correlated by `conn=`; the prefix only tells two networks apart.

use axum::extract::{ConnectInfo, FromRequestParts};
use axum::http::HeaderMap;
use axum::http::request::Parts;
use ipnet::IpNet;
use std::convert::Infallible;
use std::net::{IpAddr, SocketAddr};

/// Reduces an address to its network prefix: `/24` for IPv4, `/48` for IPv6.
///
/// Anything that does not parse as an IP becomes `unknown`. Returning the input
/// would defeat the whole function the first time something unexpected (a proxy
/// header, a unix socket) reached it.
pub fn truncate_addr(addr: &str) -> String {
    match parse_host(addr) {
        Some(ip) => truncate_ip(ip),
        None => "unknown".into(),
    }
}

/// [`truncate_addr`] for an address already parsed.
pub fn truncate_ip(ip: IpAddr) -> String {
    let ip = unmap(ip);
    let bits = if ip.is_ipv4() { 24 } else { 48 };
    match IpNet::new(ip, bits) {
        Ok(net) => net.trunc().to_string(),
        Err(_) => "unknown".into(),
    }
}

/// `host`, `host:port`, `[v6]:port` or a bare v6 literal, as an address.
fn parse_host(addr: &str) -> Option<IpAddr> {
    if let Ok(sa) = addr.parse::<SocketAddr>() {
        return Some(sa.ip());
    }
    addr.parse::<IpAddr>().ok()
}

fn unmap(ip: IpAddr) -> IpAddr {
    match ip {
        IpAddr::V6(v6) => v6.to_ipv4_mapped().map_or(ip, IpAddr::V4),
        v4 => v4,
    }
}

/// The two settings that decide whose forwarded address is believed, read once
/// at startup (`LOCO_CLIENT_IP_HEADERS`, `LOCO_TRUSTED_PROXIES`).
#[derive(Clone, Debug)]
pub struct NetPolicy {
    /// Tried in order, first one that parses wins. **The order is a security
    /// property**: on the proxied path a client can send an `X-Real-IP` of its
    /// own and the CDN forwards it, so the header the CDN controls is read
    /// first. `X-Forwarded-For` is deliberately absent: Cloudflare *appends* to
    /// one the client wrote, so its leftmost entry is attacker-controlled.
    pub client_ip_headers: Vec<String>,
    /// The peers whose headers are believed. Empty means the defaults:
    /// loopback plus the private ranges, the whole set of addresses that can
    /// reach this server in production. A list replaces the defaults rather
    /// than adding to them.
    pub trusted_proxies: Vec<IpNet>,
}

impl Default for NetPolicy {
    fn default() -> Self {
        NetPolicy {
            client_ip_headers: vec!["CF-Connecting-IP".into(), "X-Real-IP".into()],
            trusted_proxies: Vec::new(),
        }
    }
}

const DEFAULT_TRUSTED_PROXIES: &str =
    "127.0.0.0/8,::1/128,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,169.254.0.0/16,fc00::/7,fe80::/10";

impl NetPolicy {
    pub fn from_env(headers: &str, proxies: &str) -> Self {
        let mut p = NetPolicy::default();
        let h = split_list(headers);
        if !h.is_empty() {
            p.client_ip_headers = h;
        }
        p.trusted_proxies = parse_prefixes(proxies);
        p
    }

    fn peer_is_trusted_proxy(&self, peer: IpAddr) -> bool {
        let peer = unmap(peer);
        static DEFAULTS: std::sync::LazyLock<Vec<IpNet>> =
            std::sync::LazyLock::new(|| parse_prefixes(DEFAULT_TRUSTED_PROXIES));
        let nets = if self.trusted_proxies.is_empty() {
            &*DEFAULTS
        } else {
            &self.trusted_proxies
        };
        nets.iter().any(|n| n.contains(&peer))
    }

    /// The network prefix a socket is admitted, budgeted and logged under: the
    /// forwarded address when there is a trustworthy one, the peer otherwise.
    /// Already truncated, so no caller ever holds a full address.
    pub fn client_net(&self, peer: SocketAddr, headers: &HeaderMap) -> String {
        match self.forwarded_addr(peer.ip(), headers) {
            Some(ip) => truncate_ip(ip),
            None => truncate_ip(peer.ip()),
        }
    }

    /// Reads the headers in order, if and only if the peer is a trusted proxy
    /// and the value is exactly one routable address. A list is refused in both
    /// spellings: one line carrying a comma, and the header sent twice.
    fn forwarded_addr(&self, peer: IpAddr, headers: &HeaderMap) -> Option<IpAddr> {
        if !self.peer_is_trusted_proxy(peer) {
            return None;
        }
        for name in &self.client_ip_headers {
            let mut values = headers.get_all(name.as_str()).iter();
            let (Some(only), None) = (values.next(), values.next()) else {
                continue;
            };
            let Ok(raw) = only.to_str() else { continue };
            let raw = raw.trim();
            if raw.is_empty() || raw.contains(',') {
                continue;
            }
            match raw.parse::<IpAddr>() {
                Ok(ip) if is_routable_client(ip) => return Some(ip),
                _ => continue,
            }
        }
        None
    }
}

/// Whether an address in a forwarded header can be a player's. A loopback,
/// private, link-local or multicast one never is on the path this runs on; a
/// forged *private* one could be aimed at the bucket everybody with no
/// trustworthy header falls back into.
pub fn is_routable_client(ip: IpAddr) -> bool {
    match unmap(ip) {
        IpAddr::V4(v4) => {
            !(v4.is_unspecified()
                || v4.is_loopback()
                || v4.is_private()
                || v4.is_multicast()
                || v4.is_link_local()
                || v4.is_broadcast())
        }
        IpAddr::V6(v6) => {
            let seg0 = v6.segments()[0];
            let unique_local = (seg0 & 0xfe00) == 0xfc00;
            let link_local = (seg0 & 0xffc0) == 0xfe80;
            !(v6.is_unspecified()
                || v6.is_loopback()
                || v6.is_multicast()
                || unique_local
                || link_local)
        }
    }
}

pub fn split_list(raw: &str) -> Vec<String> {
    raw.split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .collect()
}

pub fn parse_prefixes(raw: &str) -> Vec<IpNet> {
    split_list(raw)
        .iter()
        .filter_map(|p| p.parse::<IpNet>().ok())
        .collect()
}

/// The network a request came from, already truncated. The extractor `serve.rs`
/// takes instead of the peer address, which is why that file never holds one.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ClientNet(pub String);

/// Where an extractor finds the policy: the hub's shared state implements it.
pub trait HasNetPolicy {
    fn net_policy(&self) -> &NetPolicy;
}

impl<S: HasNetPolicy + Send + Sync> FromRequestParts<S> for ClientNet {
    type Rejection = Infallible;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let remote_addr = parts
            .extensions
            .get::<ConnectInfo<SocketAddr>>()
            .map(|ConnectInfo(addr)| *addr);
        Ok(ClientNet(match remote_addr {
            Some(peer) => state.net_policy().client_net(peer, &parts.headers),
            None => "unknown".into(),
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    #[test]
    fn truncate_addr_cases() {
        let cases = [
            // The last octet is the household.
            ("ipv4 with port", "192.168.1.42:51234", "192.168.1.0/24"),
            ("ipv4 without port", "203.0.113.7", "203.0.113.0/24"),
            ("ipv4 loopback", "127.0.0.1:8080", "127.0.0.0/24"),
            // /48 is the routed prefix an ISP hands out.
            (
                "ipv6 with port",
                "[2001:db8:abcd:1234::1]:443",
                "2001:db8:abcd::/48",
            ),
            (
                "ipv6 without port",
                "2001:db8:abcd:1234::1",
                "2001:db8:abcd::/48",
            ),
            ("ipv6 loopback", "[::1]:9000", "::/48"),
            // An unparseable address must not fall through to the raw string.
            ("garbage", "not-an-address", "unknown"),
            ("empty", "", "unknown"),
            ("hostname", "example.com:80", "unknown"),
            ("v4-mapped", "[::ffff:203.0.113.7]:1", "203.0.113.0/24"),
        ];
        for (name, input, want) in cases {
            assert_eq!(truncate_addr(input), want, "{name}");
        }
    }

    const PROXY: &str = "172.18.0.4:41022";

    fn net(policy: &NetPolicy, peer: &str, headers: &[(&str, &str)]) -> String {
        let mut h = HeaderMap::new();
        for (k, v) in headers {
            h.append(
                axum::http::HeaderName::from_bytes(k.as_bytes()).unwrap(),
                HeaderValue::from_str(v).unwrap(),
            );
        }
        policy.client_net(peer.parse().unwrap(), &h)
    }

    #[test]
    fn client_net_cases() {
        let p = NetPolicy::default();
        type Case<'a> = (&'a str, &'a str, &'a [(&'a str, &'a str)], &'a str);
        let cases: &[Case] = &[
            (
                "trusted proxy forwards the player's network",
                PROXY,
                &[("CF-Connecting-IP", "203.0.113.7")],
                "203.0.113.0/24",
            ),
            (
                "trusted proxy forwards an IPv6 player",
                PROXY,
                &[("CF-Connecting-IP", "2001:861:3240:54b0::1")],
                "2001:861:3240::/48",
            ),
            (
                "no header falls back to the peer",
                "198.51.100.9:5000",
                &[],
                "198.51.100.0/24",
            ),
            (
                "untrusted peer is not believed",
                "198.51.100.9:5000",
                &[("CF-Connecting-IP", "203.0.113.7")],
                "198.51.100.0/24",
            ),
            (
                "a multi-value header is refused",
                PROXY,
                &[("CF-Connecting-IP", "1.2.3.4, 203.0.113.7")],
                "172.18.0.0/24",
            ),
            (
                "an unparseable header is refused",
                PROXY,
                &[("CF-Connecting-IP", "not-an-address")],
                "172.18.0.0/24",
            ),
            (
                "an empty header is refused",
                PROXY,
                &[("CF-Connecting-IP", "")],
                "172.18.0.0/24",
            ),
            (
                "the direct path is read from X-Real-IP",
                PROXY,
                &[("X-Real-IP", "203.0.113.7")],
                "203.0.113.0/24",
            ),
            (
                "X-Forwarded-For is ignored",
                PROXY,
                &[("X-Forwarded-For", "203.0.113.7")],
                "172.18.0.0/24",
            ),
        ];
        for (name, peer, headers, want) in cases {
            assert_eq!(net(&p, peer, headers), *want, "{name}");
        }
    }

    // The same list sent as two header lines rather than one with a comma.
    #[test]
    fn client_net_refuses_a_repeated_header() {
        let got = net(
            &NetPolicy::default(),
            PROXY,
            &[
                ("CF-Connecting-IP", "1.2.3.4"),
                ("CF-Connecting-IP", "203.0.113.7"),
            ],
        );
        assert_eq!(got, "172.18.0.0/24");
    }

    // The order of the headers is a security property, not a preference.
    #[test]
    fn client_net_prefers_the_header_the_proxy_sets() {
        let got = net(
            &NetPolicy::default(),
            PROXY,
            &[
                ("CF-Connecting-IP", "203.0.113.7"),
                ("X-Real-IP", "198.51.100.4"),
            ],
        );
        assert_eq!(
            got, "203.0.113.0/24",
            "the client's header won over the proxy's"
        );
    }

    #[test]
    fn client_net_truncates_the_forwarded_address() {
        let got = net(
            &NetPolicy::default(),
            PROXY,
            &[("CF-Connecting-IP", "203.0.113.7")],
        );
        assert_ne!(got, "203.0.113.7");
    }

    #[test]
    fn client_net_ignores_a_forwarded_address_no_browser_could_have() {
        for forged in [
            "127.0.0.1",
            "::1",
            "10.0.0.7",
            "172.18.0.4",
            "192.168.1.5",
            "169.254.10.1",
            "fe80::1",
            "fd00::1",
            "0.0.0.0",
            "224.0.0.1",
            "::ffff:10.0.0.7",
        ] {
            let got = net(
                &NetPolicy::default(),
                PROXY,
                &[("CF-Connecting-IP", forged)],
            );
            assert_eq!(
                got, "172.18.0.0/24",
                "CF-Connecting-IP {forged:?} was believed"
            );
        }
    }

    #[test]
    fn client_net_falls_through_to_the_next_header() {
        let got = net(
            &NetPolicy::default(),
            PROXY,
            &[
                ("CF-Connecting-IP", "10.0.0.7"),
                ("X-Real-IP", "203.0.113.7"),
            ],
        );
        assert_eq!(got, "203.0.113.0/24");
    }

    // LOCO_TRUSTED_PROXIES replaces the defaults rather than adding to them.
    #[test]
    fn client_net_honours_an_explicit_proxy_list() {
        let p = NetPolicy::from_env("", "10.9.0.0/16");
        let h = [("CF-Connecting-IP", "203.0.113.7")];
        assert_eq!(
            net(&p, "10.9.0.2:5000", &h),
            "203.0.113.0/24",
            "listed proxy"
        );
        assert_eq!(
            net(&p, "192.168.1.5:5000", &h),
            "192.168.1.0/24",
            "unlisted proxy"
        );
    }

    #[test]
    fn truncate_addr_never_echoes_the_host_identifier() {
        for input in [
            "192.168.1.42:51234",
            "2001:db8:abcd:1234::1",
            "not-an-address",
        ] {
            assert_ne!(truncate_addr(input), input);
        }
    }

    #[test]
    fn the_header_list_comes_from_the_environment() {
        let p = NetPolicy::from_env(" X-Real-IP , ", "");
        assert_eq!(p.client_ip_headers, vec!["X-Real-IP".to_owned()]);
        assert_eq!(NetPolicy::from_env("", "").client_ip_headers.len(), 2);
    }
}
