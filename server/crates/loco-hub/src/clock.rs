//! The hub's one clock: unix milliseconds for the domain and the wire, and
//! `tokio` instants for the deadlines, kept on the same timeline.
//!
//! The domain takes `now: Millis` and the wire carries absolute server
//! instants, while a table sleeps on `tokio::time::Instant`. Reading the two
//! from two clocks would let them drift apart under `tokio::time::pause`, where
//! a test advances one and not the other: a catch window that has expired by
//! the domain's reckoning would still be open by the deadline's. So the unix
//! time is derived from the tokio clock, anchored once per process.
//!
//! The anchor keeps the wall clock to the nanosecond. Rounding it down to the
//! millisecond put every derived reading up to a millisecond behind the wall
//! clock for the life of the process, so a `server_now` could be stamped
//! *earlier* than the moment its request was sent.

use loco_game::Millis;
use std::sync::OnceLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::time::Instant;

struct Anchor {
    at: std::time::Instant,
    /// The wall clock at `at`, since the unix epoch, unrounded.
    wall: Duration,
}

impl Anchor {
    /// The wall clock at `i`, since the unix epoch.
    fn wall_at(&self, i: std::time::Instant) -> Duration {
        if i >= self.at {
            self.wall + i.duration_since(self.at)
        } else {
            self.wall.saturating_sub(self.at.duration_since(i))
        }
    }

    fn ms_of(&self, i: std::time::Instant) -> Millis {
        self.wall_at(i).as_millis() as Millis
    }

    fn instant_of(&self, ms: Millis) -> std::time::Instant {
        let target = Duration::from_millis(ms.max(0) as u64);
        if target >= self.wall {
            self.at + (target - self.wall)
        } else {
            self.at.checked_sub(self.wall - target).unwrap_or(self.at)
        }
    }
}

static ANCHOR: OnceLock<Anchor> = OnceLock::new();

fn anchor() -> &'static Anchor {
    ANCHOR.get_or_init(|| Anchor {
        at: std::time::Instant::now(),
        wall: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default(),
    })
}

/// The unix milliseconds of a tokio instant.
pub fn ms_of(i: Instant) -> Millis {
    anchor().ms_of(i.into_std())
}

/// Now, in unix milliseconds, on the tokio clock.
pub fn now_ms() -> Millis {
    ms_of(Instant::now())
}

/// The tokio instant a unix millisecond falls on.
pub fn instant_of(ms: Millis) -> Instant {
    Instant::from_std(anchor().instant_of(ms))
}

/// Now as a wall-clock value, for what travels in the snapshot.
///
/// Sub-millisecond precision is kept: a match's duration is the difference
/// of two of these, and a played match must never measure zero (zero is
/// "cannot say" on the wire).
pub fn system_now() -> SystemTime {
    UNIX_EPOCH + anchor().wall_at(Instant::now().into_std())
}

/// A wall-clock value as unix milliseconds.
pub fn ms_of_system(t: SystemTime) -> Millis {
    t.duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test(start_paused = true)]
    async fn the_two_clocks_move_together() {
        let before = now_ms();
        tokio::time::advance(Duration::from_secs(5)).await;
        let moved = now_ms() - before;
        assert!((4999..=5001).contains(&moved), "{moved}");
        let at = instant_of(before + 2500);
        assert_eq!(ms_of(at), before + 2500);
    }

    // The anchor is taken at 1000.9 ms past the epoch and read 0.5 ms later:
    // the wall clock then says 1001.4 ms, so the millisecond is 1001. Rounding
    // the anchor down first read 1000 — a server_now earlier than the request
    // it answered, about one message in three under load.
    #[test]
    fn a_reading_is_never_behind_the_wall_clock_it_was_anchored_on() {
        let a = Anchor {
            at: std::time::Instant::now(),
            wall: Duration::from_micros(1_000_900),
        };
        assert_eq!(a.ms_of(a.at + Duration::from_micros(500)), 1001);
        assert_eq!(a.ms_of(a.at), 1000);
        // And a deadline on the wire lands back on the millisecond it named.
        for ms in [999, 1000, 1001, 5000] {
            assert_eq!(a.ms_of(a.instant_of(ms)), ms, "{ms}");
        }
    }
}
