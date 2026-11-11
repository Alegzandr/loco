//! When a bot's round-taking move may land (`bot_finish_due`).

use crate::ops::config::BotTimings;
use crate::table::bots::bot_finish_due;
use loco_game::{Card, Color, GameState, Hand, Kind, Millis, SeatState};
use std::collections::HashSet;
use std::time::Duration;

/// A seat on two cards: `bot_finish_due` is then `since` plus the finish delay
/// plus `moment_jitter(seat, since, SALT_FINISH, finish_jitter_max)`, with no
/// declaration floor over it.
fn two_card_state(seats: usize) -> GameState {
    let card = Card {
        color: Color::Red,
        kind: Kind::Number,
        value: 7,
    };
    GameState {
        hands: vec![
            Hand {
                cards: vec![card, card],
            };
            seats
        ],
        seats: vec![SeatState::default(); seats],
        ..GameState::default()
    }
}

// One moment, one answer: the window is armed again by every action taken
// inside it, and a fresh draw per arming made the busiest table the fastest
// one.
//
// `moment_jitter` is private to `bots.rs`, so it is read through
// `bot_finish_due` with a zero finish delay and no declaration floor, which
// is exactly `since + moment_jitter(seat, since, SALT_FINISH, max)`. Moments
// are milliseconds.
#[test]
fn moment_jitter_same_moment_same_answer_inside_the_bound() {
    let at: Millis = 1_700_000_000_123;
    let max = Duration::from_millis(800);
    let b = BotTimings {
        finish_delay: Duration::ZERO,
        finish_jitter_max: max,
        ..BotTimings::default()
    };
    let s = two_card_state(6);
    let jitter =
        |seat: usize, moment: Millis, b: &BotTimings| bot_finish_due(b, &s, seat, moment) - moment;
    let mut seen = HashSet::new();
    for seat in 0..6 {
        for i in 0..50 {
            let moment = at + i;
            let j = jitter(seat, moment, &b);
            assert!(
                (0..=max.as_millis() as i64).contains(&j),
                "moment_jitter = {j}ms, want inside [0, {max:?}]"
            );
            let again = jitter(seat, moment, &b);
            assert_eq!(
                again, j,
                "moment_jitter answered two values for the same moment"
            );
            seen.insert(j);
        }
    }
    assert!(
        seen.len() >= 50,
        "moment_jitter took {} distinct values over 300 moments: it is not jitter",
        seen.len()
    );
    let none = BotTimings {
        finish_jitter_max: Duration::ZERO,
        ..b.clone()
    };
    assert_eq!(jitter(0, at, &none), 0, "moment_jitter with no range");
}

// The later of the two floors holds: an undeclared last card keeps the bot's
// finish behind its own declaration, and a declared one only behind the delay.
#[test]
fn bot_finish_due_the_later_floor_holds() {
    let b = BotTimings {
        uno_delay: Duration::from_secs(2),
        uno_jitter_max: Duration::ZERO,
        finish_delay: Duration::from_millis(500),
        finish_jitter_max: Duration::ZERO,
        ..BotTimings::default()
    };
    let window: Millis = 1_700_000_000_000;
    let since = window + 100;
    let mut s = GameState {
        hands: vec![
            Hand::default(),
            Hand {
                cards: vec![Card {
                    color: Color::Red,
                    kind: Kind::Number,
                    value: 7,
                }],
            },
        ],
        seats: vec![
            SeatState::default(),
            SeatState {
                last_card_at: Some(window),
                ..SeatState::default()
            },
        ],
        ..GameState::default()
    };
    let got = bot_finish_due(&b, &s, 1, since);
    assert_eq!(
        got - window,
        2000,
        "undeclared: due {}ms after the window, want 2000ms",
        got - window
    );
    s.seats[1].declared = true;
    let got = bot_finish_due(&b, &s, 1, since);
    assert_eq!(
        got - since,
        500,
        "declared: due {}ms after since, want 500ms",
        got - since
    );
}
