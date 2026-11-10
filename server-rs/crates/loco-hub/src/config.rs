//! The hub's tunables and ceilings. In Go these were package variables that
//! tests narrowed and restored; here they are one value handed to the hub, so
//! two tests running at once can each have their own. Defaults are Go's.

use crate::privacy::{NetPolicy, split_list};
use std::time::Duration;

/// The ceilings. Deliberately generous: they make the abusive case terminate,
/// not shape the legitimate one. **Reaching one in production is a signal to
/// read the logs, not a number to lower.**
#[derive(Clone, Debug)]
pub struct Limits {
    /// Live tables, matchmade and private together.
    pub max_rooms: usize,
    /// Concurrent sockets, refused at the upgrade.
    pub max_clients: usize,
    /// Concurrent sockets from one `/24` or `/48`.
    pub max_conns_per_net: usize,
    /// Table codes one network may get wrong per minute.
    pub max_failed_joins: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Limits {
            max_rooms: 2000,
            max_clients: 5000,
            max_conns_per_net: 64,
            max_failed_joins: 20,
        }
    }
}

/// The game's clocks the hub arms. Carried here so the handler port finds them
/// in one place; each is documented where Go declared it (`hub/hub.go`).
#[derive(Clone, Debug)]
pub struct Timings {
    pub empty_room_timeout: Duration,
    pub reconnect_timeout: Duration,
    pub turn_timeout: Duration,
    /// The server's patience past the deadline the client is shown. Never on
    /// the wire.
    pub turn_timeout_grace: Duration,
    pub afk_kick_threshold: u32,
    /// A latency probe first, a keepalive second.
    pub ping_period: Duration,
    /// The read deadline: a client is only dropped after a minute of silence.
    pub pong_wait: Duration,
    pub write_wait: Duration,
    pub latency_broadcast_period: Duration,
    pub players_online_period: Duration,
    /// How old a snapshot may be and still be worth restoring.
    pub snapshot_max_age: Duration,
}

impl Default for Timings {
    fn default() -> Self {
        Timings {
            empty_room_timeout: Duration::from_secs(5 * 60),
            reconnect_timeout: Duration::from_secs(60),
            turn_timeout: Duration::from_secs(30),
            turn_timeout_grace: Duration::from_millis(400),
            afk_kick_threshold: 4,
            ping_period: Duration::from_secs(5),
            pong_wait: Duration::from_secs(60),
            write_wait: Duration::from_secs(10),
            latency_broadcast_period: Duration::from_secs(3),
            players_online_period: Duration::from_secs(5),
            snapshot_max_age: Duration::from_secs(2 * 60),
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct HubConfig {
    pub limits: Limits,
    pub timings: Timings,
    /// The exact browser origins allowed to open a socket
    /// (`LOCO_ALLOWED_ORIGINS`). Empty means "same host as the request".
    /// **Mandatory in production**, where the page and the socket are on two
    /// hostnames: it names the page's origin, never the socket's.
    pub allowed_origins: Vec<String>,
    pub net: NetPolicy,
    /// `LOCO_E2E=1`: `debug_set_state` is reachable. Must be false in prod.
    pub debug_mode: bool,
}

impl HubConfig {
    /// Everything the environment can say about the hub. A pure function over
    /// an injected `getenv`, like every other env reader in this server.
    pub fn from_env(getenv: &dyn Fn(&str) -> String) -> HubConfig {
        HubConfig {
            allowed_origins: split_list(&getenv("LOCO_ALLOWED_ORIGINS")),
            net: NetPolicy::from_env(
                &getenv("LOCO_CLIENT_IP_HEADERS"),
                &getenv("LOCO_TRUSTED_PROXIES"),
            ),
            debug_mode: getenv("LOCO_E2E") == "1",
            ..HubConfig::default()
        }
    }
}

/// Go's `time.ParseDuration`, for the positive values an env file carries:
/// `90s`, `1m30s`, `1.5h`, `250ms`. Negative or malformed is `None`.
///
/// One implementation, in `loco-twitch` (which may not import the hub, while
/// the hub already depends on it for the live-streams DTO).
pub fn parse_go_duration(s: &str) -> Option<Duration> {
    loco_twitch::parse_go_duration(s)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn env(pairs: &[(&str, &str)]) -> impl Fn(&str) -> String + use<> {
        let m: HashMap<String, String> = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        move |k| m.get(k).cloned().unwrap_or_default()
    }

    #[test]
    fn the_defaults_are_go_s() {
        let c = HubConfig::from_env(&env(&[]));
        assert_eq!(c.limits.max_rooms, 2000);
        assert_eq!(c.limits.max_clients, 5000);
        assert_eq!(c.limits.max_conns_per_net, 64);
        assert_eq!(c.limits.max_failed_joins, 20);
        assert_eq!(c.timings.ping_period, Duration::from_secs(5));
        assert_eq!(c.timings.snapshot_max_age, Duration::from_secs(120));
        assert!(
            c.allowed_origins.is_empty(),
            "an empty list is the same-host rule"
        );
        assert!(!c.debug_mode);
    }

    #[test]
    fn the_environment_is_read() {
        let c = HubConfig::from_env(&env(&[
            (
                "LOCO_ALLOWED_ORIGINS",
                " https://a.example , ,https://b.example ",
            ),
            ("LOCO_E2E", "1"),
        ]));
        assert_eq!(
            c.allowed_origins,
            vec!["https://a.example", "https://b.example"]
        );
        assert!(c.debug_mode);
    }
}
