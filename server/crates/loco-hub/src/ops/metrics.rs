//! The counters, and the numbers that say how close this process is to the load
//! it can carry, and the two payloads `/health` and `/metrics` serve.
//!
//! The counters are atomics on one struct, written from every task, because
//! the high-water marks need a compare-and-swap and `/health` needs a few of
//! them as plain numbers. `/metrics` renders them through the `metrics` crate's
//! Prometheus exporter, **under fixed names**: the E2E helpers and every
//! operator's muscle memory read `matchmaking_queue`, `handler_panics`,
//! `log_lines_dropped` and the rest by those spellings. Each hub keeps its own
//! recorder rather than installing a global one, so two hubs in one test
//! process never add up into one page.

use metrics_exporter_prometheus::{PrometheusBuilder, PrometheusHandle, PrometheusRecorder};
use serde::Serialize;
use std::sync::atomic::{AtomicI32, AtomicI64, Ordering};
use std::time::Duration;

/// Every counter the hub keeps. Safe from any task.
#[derive(Debug, Default)]
pub struct HubMetrics {
    pub rooms: AtomicI32,
    pub clients: AtomicI32,
    pub matches_started: AtomicI32,
    pub matches_finished: AtomicI32,
    pub bots_active: AtomicI32,
    /// Inbound messages dropped for exceeding the per-client token bucket.
    pub messages_rate_limited: AtomicI64,
    /// Inbound messages dropped because a queue was full: the hub's, or the
    /// table's the message was for.
    pub messages_dropped_busy: AtomicI64,
    /// Clients force-closed because their send buffer overflowed.
    pub slow_clients_closed: AtomicI64,
    /// Posts that found a box full and were retried.
    pub channel_retries: AtomicI64,
    pub suspected_cheats: AtomicI64,
    pub reconnect_expirations: AtomicI64,
    /// Players waiting for a 1v1 right now. Operator-only: never on the wire.
    pub matchmaking_queue: AtomicI32,
    pub matches_matchmade: AtomicI32,
    pub matches_solo: AtomicI32,
    /// Only maintained while draining.
    pub matches_in_flight: AtomicI32,
    /// Panics a job's `catch_unwind` recovered from. **Above zero is a bug.**
    pub handler_panics: AtomicI64,
    pub conns_refused: AtomicI64,
    pub live_streams: AtomicI64,
    pub joins_throttled: AtomicI64,
    /// The deepest any one table's box has been seen. High-water, never reset.
    pub loop_queue_peak: AtomicI32,
    /// The longest a single job has taken anywhere on this process, in µs.
    pub loop_slowest_us: AtomicI64,
    pub loop_event_count: AtomicI64,
}

impl HubMetrics {
    /// Records one job: how deep that table's box was when it was taken, and
    /// how long it took. Called from every table's task at once.
    pub fn note_event(&self, queued: usize, took: Duration) {
        self.loop_event_count.fetch_add(1, Ordering::Relaxed);
        raise32(&self.loop_queue_peak, queued as i32);
        raise64(&self.loop_slowest_us, took.as_micros() as i64);
    }
}

/// Lifts a high-water mark. Load-then-store loses the higher of two marks
/// written at once, and the one lost is the slow pass somebody is looking for.
pub fn raise32(mark: &AtomicI32, v: i32) {
    mark.fetch_max(v, Ordering::Relaxed);
}

pub fn raise64(mark: &AtomicI64, v: i64) {
    mark.fetch_max(v, Ordering::Relaxed);
}

/// What `/health` answers, in JSON.
#[derive(Clone, Debug, Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct HealthStats {
    pub status: String,
    pub rooms: i32,
    pub clients: i32,
    pub uptime_sec: i64,
    /// Stays on a `200`: a draining server is serving its players perfectly
    /// well, and a container Docker considers unhealthy may be killed out from
    /// under them.
    pub draining: bool,
}

/// What `/metrics` reports about the poller.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
pub struct LiveStats {
    pub twitch_polls: i64,
    pub twitch_poll_errors: i64,
    pub live_rows_screened: i64,
    pub twitch_thumb_errors: i64,
    pub twitch_streams_live: i64,
}

/// Everything `/metrics` reports, read at one instant.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct MetricsStats {
    pub rooms_active: i32,
    pub players_connected: i32,
    pub matches_started: i32,
    pub matches_finished: i32,
    pub bots_active: i32,
    pub uptime_sec: i64,
    /// The runtime's live tasks, low and stable unless something leaks. The
    /// name is the one `/health` and `/metrics` have always used.
    pub runtime_tasks: i64,
    pub messages_rate_limited: i64,
    pub messages_dropped_busy: i64,
    pub slow_clients_closed: i64,
    pub channel_retries: i64,
    pub suspected_cheats: i64,
    pub reconnect_expirations: i64,
    pub matchmaking_queue: i32,
    pub matches_matchmade: i32,
    pub matches_solo: i32,
    pub debug_mode_active: bool,
    pub draining: bool,
    pub matches_in_flight: i32,
    pub handler_panics: i64,
    pub conns_refused: i64,
    pub joins_throttled: i64,
    pub loop_queue_depth: i32,
    pub loop_queue_capacity: i32,
    pub loop_queue_peak: i32,
    pub loop_slowest_us: i64,
    pub loop_events: i64,
    pub log_lines_dropped: i64,
    pub live: LiveStats,
}

/// A per-hub Prometheus recorder.
pub struct Exporter {
    recorder: PrometheusRecorder,
    handle: PrometheusHandle,
}

impl std::fmt::Debug for Exporter {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Exporter")
    }
}

impl Default for Exporter {
    fn default() -> Self {
        let recorder = PrometheusBuilder::new().build_recorder();
        let handle = recorder.handle();
        Exporter { recorder, handle }
    }
}

impl Exporter {
    /// The Prometheus text page for one reading. Counters are what only ever
    /// grows; gauges are everything that can come down, the two flags
    /// included (0 or 1).
    pub fn render(&self, m: &MetricsStats) -> String {
        metrics::with_local_recorder(&self.recorder, || {
            use metrics::{counter, describe_counter, describe_gauge, gauge};
            macro_rules! g {
                ($name:literal, $v:expr, $help:literal) => {{
                    describe_gauge!($name, $help);
                    gauge!($name).set($v as f64);
                }};
            }
            macro_rules! c {
                ($name:literal, $v:expr, $help:literal) => {{
                    describe_counter!($name, $help);
                    counter!($name).absolute($v.max(0) as u64);
                }};
            }
            g!(
                "rooms_active",
                m.rooms_active,
                "Live tables, matchmade and private."
            );
            g!(
                "players_connected",
                m.players_connected,
                "Registered sockets."
            );
            c!(
                "matches_started",
                m.matches_started,
                "Matches dealt since boot."
            );
            c!(
                "matches_finished",
                m.matches_finished,
                "Matches finished since boot."
            );
            g!("bots_active", m.bots_active, "Seats played by the server.");
            g!("uptime_sec", m.uptime_sec, "Seconds since the hub started.");
            g!(
                "runtime_tasks",
                m.runtime_tasks,
                "Live tokio runtime tasks; low and stable."
            );
            c!(
                "messages_rate_limited",
                m.messages_rate_limited,
                "Inbound messages over a socket's token bucket."
            );
            c!(
                "messages_dropped_busy",
                m.messages_dropped_busy,
                "Inbound messages dropped on a full queue; about 0."
            );
            c!(
                "slow_clients_closed",
                m.slow_clients_closed,
                "Sockets force-closed on a full send buffer."
            );
            c!(
                "channel_retries",
                m.channel_retries,
                "Posts retried on a full box; about 0."
            );
            c!(
                "suspected_cheats",
                m.suspected_cheats,
                "Sockets with a burst of refused gameplay."
            );
            c!(
                "reconnect_expirations",
                m.reconnect_expirations,
                "Held seats whose window closed."
            );
            g!(
                "matchmaking_queue",
                m.matchmaking_queue,
                "Players waiting for a 1v1 now. Never on the wire."
            );
            c!(
                "matches_matchmade",
                m.matches_matchmade,
                "Pairings the queue made since boot."
            );
            c!(
                "matches_solo",
                m.matches_solo,
                "1v1s dealt against the server since boot."
            );
            g!(
                "debug_mode_active",
                u8::from(m.debug_mode_active),
                "LOCO_E2E=1. Must be 0 in production."
            );
            g!(
                "draining",
                u8::from(m.draining),
                "1 while this process finishes what it has."
            );
            g!(
                "matches_in_flight",
                m.matches_in_flight,
                "What a shutdown waits on; only kept while draining."
            );
            c!(
                "handler_panics",
                m.handler_panics,
                "Recovered handler panics. Any value above 0 is a bug."
            );
            c!(
                "conns_refused",
                m.conns_refused,
                "Upgrades refused by a connection ceiling."
            );
            c!(
                "joins_throttled",
                m.joins_throttled,
                "join_room refused for a burnt wrong-code budget."
            );
            g!(
                "loop_queue_depth",
                m.loop_queue_depth,
                "The hub's inbound queue right now."
            );
            g!(
                "loop_queue_capacity",
                m.loop_queue_capacity,
                "The hub's inbound queue's capacity."
            );
            g!(
                "loop_queue_peak",
                m.loop_queue_peak,
                "Deepest any table's box has been. High-water."
            );
            g!(
                "loop_slowest_us",
                m.loop_slowest_us,
                "Longest single job anywhere, in microseconds. High-water."
            );
            c!("loop_events", m.loop_events, "Jobs run by the tables.");
            c!(
                "log_lines_dropped",
                m.log_lines_dropped,
                "Log lines the asynchronous sink threw away."
            );
            c!("twitch_polls", m.live.twitch_polls, "Live-streams polls.");
            c!(
                "twitch_poll_errors",
                m.live.twitch_poll_errors,
                "Live-streams polls that failed."
            );
            c!(
                "live_rows_screened",
                m.live.live_rows_screened,
                "Channels dropped by the screen."
            );
            c!(
                "twitch_thumb_errors",
                m.live.twitch_thumb_errors,
                "Previews that could not be had."
            );
            g!(
                "twitch_streams_live",
                m.live.twitch_streams_live,
                "Channels in the last good poll."
            );
        });
        self.handle.render()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn high_water_marks_only_rise() {
        let m = HubMetrics::default();
        m.note_event(3, Duration::from_micros(50));
        m.note_event(1, Duration::from_micros(10));
        assert_eq!(m.loop_queue_peak.load(Ordering::Relaxed), 3);
        assert_eq!(m.loop_slowest_us.load(Ordering::Relaxed), 50);
        assert_eq!(m.loop_event_count.load(Ordering::Relaxed), 2);
    }

    // Two tables reading the same old maximum and both storing must not lose
    // the higher of the two.
    #[test]
    fn concurrent_marks_keep_the_highest() {
        let m = Arc::new(HubMetrics::default());
        let threads: Vec<_> = (0..8)
            .map(|t| {
                let m = m.clone();
                std::thread::spawn(move || {
                    for i in 0..1000 {
                        m.note_event(t * 1000 + i, Duration::from_micros((t * 1000 + i) as u64));
                    }
                })
            })
            .collect();
        for t in threads {
            t.join().unwrap();
        }
        assert_eq!(m.loop_queue_peak.load(Ordering::Relaxed), 7999);
        assert_eq!(m.loop_slowest_us.load(Ordering::Relaxed), 7999);
    }

    // The fixed names, in Prometheus text: what matchmakingQueue.ts and the
    // operators read.
    #[test]
    fn the_page_keeps_the_go_names() {
        let e = Exporter::default();
        let page = e.render(&MetricsStats {
            matchmaking_queue: 2,
            handler_panics: 1,
            log_lines_dropped: 7,
            debug_mode_active: true,
            ..Default::default()
        });
        for line in [
            "matchmaking_queue 2",
            "handler_panics 1",
            "log_lines_dropped 7",
            "debug_mode_active 1",
            "messages_dropped_busy 0",
            "loop_queue_depth 0",
            "loop_queue_peak 0",
            "loop_slowest_us 0",
        ] {
            assert!(
                page.lines().any(|l| l == line),
                "missing {line:?} in:\n{page}"
            );
        }
        assert!(page.contains("# TYPE handler_panics counter"), "{page}");
        assert!(page.contains("# TYPE matchmaking_queue gauge"), "{page}");
    }

    #[test]
    fn two_exporters_do_not_add_up() {
        let a = Exporter::default();
        let b = Exporter::default();
        a.render(&MetricsStats {
            handler_panics: 5,
            ..Default::default()
        });
        let page = b.render(&MetricsStats::default());
        assert!(page.lines().any(|l| l == "handler_panics 0"), "{page}");
    }
}
