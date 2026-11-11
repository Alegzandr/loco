//! The hub's tunables and ceilings: one value handed to the hub, never a
//! global, so two tests running at once can each narrow their own.

use crate::net::privacy::{NetPolicy, split_list};
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
    /// Live tables one network may have opened (private and solo). Without it
    /// one network opening and leaving tables fills `max_rooms` for everybody.
    pub max_tables_per_net: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Limits {
            max_rooms: 2000,
            max_clients: 5000,
            max_conns_per_net: 64,
            max_failed_joins: 20,
            max_tables_per_net: 32,
        }
    }
}

/// The game's clocks the hub arms, in one place.
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
    /// How long the table waits for every client to load the map before it
    /// opens without the stragglers.
    pub map_load_timeout: Duration,
    /// The span `Limits::max_failed_joins` is counted over.
    pub failed_join_window: Duration,
    /// A stale-state correction is throttled to one per socket per this.
    pub resync_period: Duration,
    /// The 1v1 queue's own clocks.
    pub matchmaking: MatchmakingTimings,
    /// Every bot delay. Only think and jitter are tunable from the
    /// environment, and only with `LOCO_E2E=1`: every other one is a reaction
    /// window somebody is meant to be able to win.
    pub bots: BotTimings,
}

/// What a matchmade table runs on: a stranger will not wait for you.
#[derive(Clone, Debug)]
pub struct MatchmakingTimings {
    /// The versus reveal, between the pairing and the deal.
    pub reveal_delay: Duration,
    /// The reveal's deal is armed a second time this long after the first:
    /// every other dropped job is lossy, that one is unbounded.
    pub reveal_backstop: Duration,
    pub reconnect_timeout: Duration,
    pub afk_threshold: u32,
}

impl Default for MatchmakingTimings {
    fn default() -> Self {
        MatchmakingTimings {
            reveal_delay: Duration::from_millis(2500),
            reveal_backstop: Duration::from_secs(3),
            reconnect_timeout: Duration::from_secs(15),
            afk_threshold: 2,
        }
    }
}

/// The bots' clocks and odds.
#[derive(Clone, Debug)]
pub struct BotTimings {
    pub think: Duration,
    pub jitter_max: Duration,
    pub uno_delay: Duration,
    pub uno_jitter_max: Duration,
    pub catch_delay: Duration,
    pub catch_jitter_max: Duration,
    pub catch_prob: f32,
    pub interrupt_delay: Duration,
    pub interrupt_jitter_max: Duration,
    pub interrupt_prob: f32,
    pub finish_delay: Duration,
    pub finish_jitter_max: Duration,
}

impl Default for BotTimings {
    fn default() -> Self {
        BotTimings {
            think: Duration::from_millis(1200),
            jitter_max: Duration::from_millis(1000),
            uno_delay: Duration::from_millis(1600),
            uno_jitter_max: Duration::from_millis(1200),
            catch_delay: Duration::from_millis(3200),
            catch_jitter_max: Duration::from_millis(1200),
            catch_prob: 0.8,
            // A slam answers a card the human has to see land, read and
            // match before they can reach for their own copy: 0.7s was before
            // the flight had finished on a phone, and read as a bot that
            // played its doubles the instant they existed.
            interrupt_delay: Duration::from_millis(1500),
            interrupt_jitter_max: Duration::from_millis(1000),
            interrupt_prob: 0.40,
            finish_delay: Duration::from_millis(1800),
            finish_jitter_max: Duration::from_millis(800),
        }
    }
}

impl BotTimings {
    /// `LOCO_BOT_THINK_MS` / `LOCO_BOT_JITTER_MS`, read only when
    /// `LOCO_E2E=1`. Returns whether either was applied.
    pub fn apply_env(&mut self, getenv: &dyn Fn(&str) -> String) -> bool {
        if getenv("LOCO_E2E") != "1" {
            return false;
        }
        let mut ok = false;
        if let Some(d) = millis_env(getenv, "LOCO_BOT_THINK_MS") {
            self.think = d;
            ok = true;
        }
        if let Some(d) = millis_env(getenv, "LOCO_BOT_JITTER_MS") {
            self.jitter_max = d;
            ok = true;
        }
        if ok {
            tracing::warn!(
                "bot think delay overridden think_ms={} jitter_ms={} (LOCO_E2E=1; test builds only)",
                self.think.as_millis(),
                self.jitter_max.as_millis()
            );
        }
        ok
    }
}

fn millis_env(getenv: &dyn Fn(&str) -> String, name: &str) -> Option<Duration> {
    let raw = getenv(name);
    if raw.is_empty() {
        return None;
    }
    match raw.parse::<u64>() {
        Ok(ms) => Some(Duration::from_millis(ms)),
        Err(_) => {
            tracing::warn!("ignoring {name}={raw:?} (want a non-negative integer of milliseconds)");
            None
        }
    }
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
            map_load_timeout: Duration::from_secs(20),
            failed_join_window: Duration::from_secs(60),
            resync_period: Duration::from_secs(1),
            matchmaking: MatchmakingTimings::default(),
            bots: BotTimings::default(),
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
            timings: {
                let mut t = Timings::default();
                t.bots.apply_env(getenv);
                t
            },
            ..HubConfig::default()
        }
    }
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
        assert_eq!(c.limits.max_tables_per_net, 32);
        assert_eq!(c.timings.ping_period, Duration::from_secs(5));
        assert_eq!(c.timings.snapshot_max_age, Duration::from_secs(120));
        assert!(
            c.allowed_origins.is_empty(),
            "an empty list is the same-host rule"
        );
        assert!(!c.debug_mode);
    }

    /// A bot's slam is a reaction somebody at the table is meant to be able
    /// to beat: never sooner than a human sees the card land, reads it and
    /// presses. At 0.7s the bot answered a card still in flight on a phone.
    #[test]
    fn a_bot_slam_waits_for_a_human_to_read_the_pile() {
        let b = BotTimings::default();
        assert!(
            b.interrupt_delay >= Duration::from_millis(1500),
            "a bot's interject at {:?} is faster than a player can read the pile",
            b.interrupt_delay
        );
        assert!(b.interrupt_delay + b.interrupt_jitter_max <= b.finish_delay + b.finish_jitter_max);
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
