//! The hub's one clock: unix milliseconds for the domain and the wire, and
//! `tokio` instants for the deadlines, kept on the same timeline.
//!
//! The domain takes `now: Millis` and the wire carries absolute server
//! instants, while a table sleeps on `tokio::time::Instant`. Reading the two
//! from two clocks would let them drift apart under `tokio::time::pause`, where
//! a test advances one and not the other: a catch window that has expired by
//! the domain's reckoning would still be open by the deadline's. So the unix
//! time is derived from the tokio clock, anchored once per process.

use loco_game::Millis;
use std::sync::OnceLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::time::Instant;

struct Anchor {
    at: std::time::Instant,
    unix_ms: i64,
}

static ANCHOR: OnceLock<Anchor> = OnceLock::new();

fn anchor() -> &'static Anchor {
    ANCHOR.get_or_init(|| Anchor {
        at: std::time::Instant::now(),
        unix_ms: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0),
    })
}

/// The unix milliseconds of a tokio instant.
pub fn ms_of(i: Instant) -> Millis {
    let a = anchor();
    let i = i.into_std();
    if i >= a.at {
        a.unix_ms + i.duration_since(a.at).as_millis() as i64
    } else {
        a.unix_ms - a.at.duration_since(i).as_millis() as i64
    }
}

/// Now, in unix milliseconds, on the tokio clock.
pub fn now_ms() -> Millis {
    ms_of(Instant::now())
}

/// The tokio instant a unix millisecond falls on.
pub fn instant_of(ms: Millis) -> Instant {
    let a = anchor();
    let at = Instant::from_std(a.at);
    let delta = ms - a.unix_ms;
    if delta >= 0 {
        at + Duration::from_millis(delta as u64)
    } else {
        at.checked_sub(Duration::from_millis(delta.unsigned_abs()))
            .unwrap_or(at)
    }
}

/// Now as a wall-clock value, for what travels in the snapshot.
///
/// Sub-millisecond precision is kept: a match's duration is the difference
/// of two of these, and a played match must never measure zero (zero is
/// "cannot say" on the wire).
pub fn system_now() -> SystemTime {
    let a = anchor();
    let now = Instant::now().into_std();
    let base = UNIX_EPOCH + Duration::from_millis(a.unix_ms.max(0) as u64);
    if now >= a.at {
        base + now.duration_since(a.at)
    } else {
        base.checked_sub(a.at.duration_since(now)).unwrap_or(base)
    }
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
}
