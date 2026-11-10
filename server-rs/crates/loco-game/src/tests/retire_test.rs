//! Ported from `server/game/retire_test.go`. `retireRoom` lives in
//! `support.rs` as `retire_room`.
//!
//! Walking out of a match in progress.
//!
//! The rule the hub enforces is "three seats have to be left able to play"; this
//! is what the domain does once it has said yes. What matters is that the table
//! keeps playing: a seat that walks out must stop being a turn the clock has to
//! auto-pass, which is the whole thing the feature exists to stop.

use super::support::*;
use crate::card::{Color, Kind};
use crate::error::GameError;
use crate::room::INITIAL_HAND_SIZE;

#[test]
fn retire_seat_hand_goes_back_to_the_deck() {
    let mut r = retire_room(4);
    let deck_before = st_ref(&r).deck.cards.len();
    let hand_size = st_ref(&r).hands[2].size();

    r.retire_seat(2, NOW)
        .unwrap_or_else(|e| panic!("RetireSeat: {e}"));

    assert_eq!(st_ref(&r).hands[2].size(), 0, "hand, want 0");
    // Left in a hand nobody holds, those cards would shrink the deck for
    // everybody else every time somebody left.
    assert_eq!(
        st_ref(&r).deck.cards.len(),
        deck_before + hand_size,
        "deck size"
    );
}

#[test]
fn retire_seat_the_turn_steps_over_it() {
    let mut r = retire_room(4);
    st(&mut r).current_turn = 1;
    st(&mut r).direction = 1;
    r.retire_seat(2, NOW)
        .unwrap_or_else(|e| panic!("RetireSeat: {e}"));
    // It was not seat 2's turn, so nothing moved yet — but the next turn skips.
    assert_eq!(
        st_ref(&r).current_turn,
        1,
        "CurrentTurn, want 1 (nothing to move)"
    );
    assert_eq!(
        st_ref(&r).next_turn(1),
        3,
        "nextTurn(1), want 3 (2 has left)"
    );
    assert_eq!(st_ref(&r).next_turn(3), 0, "nextTurn(3), want 0");
}

// The case the feature is for: the player whose turn it is walks out. Waiting
// for the clock to notice is the two spoiled rounds this replaces.
#[test]
fn retire_seat_moves_the_turn_on_immediately() {
    let mut r = retire_room(4);
    {
        let s = st(&mut r);
        s.current_turn = 2;
        s.direction = 1;
        s.pending_draw = 4;
    }
    r.retire_seat(2, NOW)
        .unwrap_or_else(|e| panic!("RetireSeat: {e}"));
    assert_eq!(st_ref(&r).current_turn, 3, "CurrentTurn, want 3");
    // A stack aimed at a seat that has left is not passed on: it is a penalty
    // the next player never earned.
    assert_eq!(st_ref(&r).pending_draw, 0, "PendingDraw, want 0");
}

#[test]
fn retire_seat_closes_its_catch_window() {
    let mut r = retire_room(4);
    st(&mut r).hands[2].cards = vec![num(Color::Red, 3)];
    st(&mut r).open_catch_window(2, NOW);
    assert_eq!(
        st_ref(&r).catchable_targets(NOW).len(),
        1,
        "fixture: seat 2 should be catchable"
    );
    r.retire_seat(2, NOW)
        .unwrap_or_else(|e| panic!("RetireSeat: {e}"));
    let got = st_ref(&r).catchable_targets(NOW);
    assert!(got.is_empty(), "CatchableTargets = {got:?}, want none");
}

// The scoreboard is the record of what happened, and walking out did not change
// what happened.
#[test]
fn retire_seat_leaves_the_scoreboard_alone() {
    let mut r = retire_room(4);
    r.scores = vec![40, 10, 90, 0];
    r.rounds_won = vec![1, 0, 1, 0];
    r.retire_seat(2, NOW)
        .unwrap_or_else(|e| panic!("RetireSeat: {e}"));
    assert!(
        r.scores[2] == 90 && r.rounds_won[2] == 1,
        "score = {}/{}, want 90/1",
        r.scores[2],
        r.rounds_won[2]
    );
    assert!(!r.match_over, "leaving must not end the match");
}

#[test]
fn retire_seat_is_dealt_nothing_in_the_next_round() {
    let mut r = retire_room(4);
    r.retire_seat(2, NOW)
        .unwrap_or_else(|e| panic!("RetireSeat: {e}"));
    r.round_ended = false;
    r.begin_next_round(NOW)
        .unwrap_or_else(|e| panic!("BeginNextRound: {e}"));
    let s = st_ref(&r);
    assert_eq!(
        s.hands[2].size(),
        0,
        "dealt cards to a seat that left, want 0"
    );
    for (i, h) in s.hands.iter().enumerate() {
        if i == 2 {
            continue;
        }
        assert_eq!(
            h.size(),
            INITIAL_HAND_SIZE,
            "seat {i} got {} cards, want {INITIAL_HAND_SIZE}",
            h.size()
        );
    }
    // And the round cannot open on the empty seat, whatever the points say.
    assert_ne!(s.current_turn, 2, "the round opened on the seat that left");
    assert!(s.is_retired(2), "the flag did not survive the deal");
}

// Points pick the seat that opens a round, and a seat that walked out has the
// fewest of them from then on.
#[test]
fn retire_seat_never_opens_the_next_round() {
    let mut r = retire_room(4);
    r.scores = vec![50, 40, 0, 30];
    r.retire_seat(2, NOW)
        .unwrap_or_else(|e| panic!("RetireSeat: {e}"));
    let got = r.biggest_loser();
    assert_ne!(got, 2, "biggestLoser picked the seat that left");
    assert_eq!(got, 3, "biggestLoser = {got}, want 3");
}

// A Global Switch turns the seats that are still in the circle. Handing one to a
// seat that has left takes the next player's hand away into a seat nobody can
// play from, and the round stalls.
#[test]
fn retire_seat_global_switch_skips_it() {
    let mut r = retire_room(4);
    r.retire_seat(1, NOW)
        .unwrap_or_else(|e| panic!("RetireSeat: {e}"));
    let src = st_ref(&r).rotate_seats(1);
    // Seats 0, 2 and 3 are the circle: each takes the previous one's hand.
    assert!(
        src[0] == 3 && src[2] == 0 && src[3] == 2,
        "rotation = {src:?}, want 0<-3, 2<-0, 3<-2"
    );
    assert_eq!(
        src[1], 1,
        "the seat that left was dealt into the rotation: {src:?}"
    );
}

#[test]
fn retire_seat_cannot_be_swapped_with() {
    let mut r = retire_room(4);
    r.retire_seat(2, NOW)
        .unwrap_or_else(|e| panic!("RetireSeat: {e}"));
    let top = st_ref(&r).top_card();
    let swap = act(top.color, Kind::Swap);
    {
        let s = st(&mut r);
        s.current_turn = 0;
        s.pending_draw = 0;
        s.active_color = top.color;
        s.hands[0].cards = vec![swap, num(Color::Blue, 2)];
    }

    assert!(
        r.play_card(0, swap, swap.color, 2, NOW).is_err(),
        "swapping with a seat that left was allowed"
    );
}

#[test]
fn retire_seat_refuses_a_second_departure() {
    let mut r = retire_room(4);
    r.retire_seat(2, NOW)
        .unwrap_or_else(|e| panic!("RetireSeat: {e}"));
    assert_eq!(
        r.retire_seat(2, NOW),
        Err(GameError::SeatAlreadyRetired),
        "second departure"
    );
}

// Three seats with one gone is a duel, and a Reverse in a duel is a Skip.
#[test]
fn retire_seat_reverse_is_a_skip_once_the_table_is_two() {
    let mut r = retire_room(3);
    r.retire_seat(2, NOW)
        .unwrap_or_else(|e| panic!("RetireSeat: {e}"));
    let s = st(&mut r);
    s.current_turn = 0;
    s.direction = 1;
    let next = s.apply_effect(act(Color::Red, Kind::Reverse), Color::Red);
    assert_eq!(
        next, 0,
        "Reverse at an effective two seats: next = {next}, want 0"
    );
}
