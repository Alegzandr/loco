//! A bot's Contre-LOCO!: when it presses, and how often.

use crate::ops::clock;
use crate::ops::config::BotTimings;
use crate::table::bots::bot_catch_attempt;
use loco_game::{Millis, Room};
use std::collections::HashSet;
use std::time::Duration;

/// Asks the domain how long a seat stays on the hook instead of restating the
/// 5 s here. The domain answers `None` for a closed window, so the window is
/// opened by hand first.
fn catch_window_length() -> Duration {
    let mut r = Room::from_u64_seed("WINDOW", 1);
    r.join("Alice").expect("join");
    r.join("Bob").expect("join");
    let now = clock::now_ms();
    r.start(now).expect("start");
    let s = r.state.as_mut().expect("dealt");
    s.seats[0].last_card_at = Some(now);
    let end = s.catch_window_end(0).expect("an open window has an end");
    Duration::from_millis((end - now) as u64)
}

// Pins both ends of the bot's Contre-LOCO!, because both of them are the
// feature.
//
// The floor: the seat that forgot the call is looking at an armed chip for the
// whole window, so a bot answering in the first half takes the press away from
// the player who was already going for it.
//
// The ceiling: a call that lands after the window costs its caller a card, so
// a bot must never be scheduled into a race it cannot win.
#[test]
fn bot_catch_timing_late_and_inside_the_window() {
    let window = catch_window_length();
    let b = BotTimings::default();

    assert!(
        b.catch_delay >= window / 2,
        "catch_delay = {:?}, want at least half of the {window:?} window",
        b.catch_delay
    );
    let latest = b.catch_delay + b.catch_jitter_max;
    assert!(
        latest < window,
        "catch_delay+catch_jitter_max = {latest:?}, want inside the {window:?} window"
    );
    // Half a second of it is kept clear: the job still has to cross the
    // table's box.
    let margin = window - latest;
    assert!(
        margin >= Duration::from_millis(500),
        "only {margin:?} of the {window:?} window left after the latest bot catch, want at least 500ms"
    );
}

// The property that keeps a table of four bots as winnable as a table of one:
// the verdict belongs to the window, not to each arming of it.
#[test]
fn bot_catch_attempt_one_verdict_per_window() {
    let b = BotTimings::default();
    let at = clock::now_ms();
    let first = bot_catch_attempt(&b, 2, at);
    for _ in 0..50 {
        assert_eq!(
            bot_catch_attempt(&b, 2, at),
            first,
            "arming the same window twice answered two verdicts"
        );
    }
}

// The other half: one answer per window is only right *within* a window. Two
// windows a millisecond apart, or the same instant on two seats, must not
// share a moment to strike.
#[test]
fn bot_catch_attempt_varies_across_windows() {
    let b = BotTimings::default();
    assert!(!b.catch_jitter_max.is_zero(), "no jitter configured");
    let base = clock::now_ms();
    let mut seen = HashSet::new();
    for i in 0..200i64 {
        let (d, _) = bot_catch_attempt(&b, (i % 4) as usize, base + i);
        assert!(
            d >= b.catch_delay && d <= b.catch_delay + b.catch_jitter_max,
            "delay {d:?} outside [{:?}, {:?}]",
            b.catch_delay,
            b.catch_delay + b.catch_jitter_max
        );
        seen.insert(d);
    }
    assert!(
        seen.len() >= 20,
        "only {} distinct delays over 200 windows; the jitter is not spreading",
        seen.len()
    );
}

/// The windows the two probability tests walk, one millisecond apart: the
/// clock's own unit.
fn windows(n: i64) -> impl Iterator<Item = (usize, Millis)> {
    let base = clock::now_ms();
    (0..n).map(move |i| ((i % 4) as usize, base + i))
}

// The two ends every other test leans on when it pins catch_prob to 0 or 1 to
// make the bots deterministic.
#[test]
fn bot_catch_attempt_probability_bounds() {
    let never = BotTimings {
        catch_prob: 0.0,
        ..BotTimings::default()
    };
    for (seat, at) in windows(200) {
        assert!(
            !bot_catch_attempt(&never, seat, at).1,
            "catch_prob = 0 must never attempt"
        );
    }
    let always = BotTimings {
        catch_prob: 1.0,
        ..BotTimings::default()
    };
    for (seat, at) in windows(200) {
        assert!(
            bot_catch_attempt(&always, seat, at).1,
            "catch_prob = 1 must always attempt"
        );
    }
}

// Keeps the middle honest: the point of the hash is that it answers one window
// the same way twice, not that it leans.
#[test]
fn bot_catch_attempt_honours_its_probability() {
    let b = BotTimings {
        catch_prob: 0.5,
        ..BotTimings::default()
    };
    const N: i64 = 4000;
    let attempts = windows(N)
        .filter(|&(seat, at)| bot_catch_attempt(&b, seat, at).1)
        .count() as i64;
    assert!(
        (N * 4 / 10..=N * 6 / 10).contains(&attempts),
        "{attempts}/{N} windows answered at p=0.5; want roughly half"
    );
}
