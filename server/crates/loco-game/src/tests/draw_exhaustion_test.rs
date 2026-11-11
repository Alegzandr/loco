//! Drawing against exhausted piles: a draw shrinks, it never fails.
//!
//! `exhaust_piles` (in `support.rs`) leaves exactly `keep` cards in the deck and
//! a single card on the discard, which is the state `ensure_deck` cannot recover
//! from: there is nothing to reshuffle back in once every other card sits in
//! somebody's hand.

use super::support::*;
use crate::card::Color;
use crate::deck::Deck;
use crate::hand::Hand;

// A draw never fails. The victim of a stack bigger than what is left takes
// whatever the piles can give and then plays normally: the alternative is an
// error returned on an already-mutated state, which evaporates the penalty and
// leaves the seat unable to act.
#[test]
fn draw_card_pending_stack_larger_than_the_deck() {
    let mut r = started_room(&["Alice", "Bob", "Carol", "Dave"]);
    let turn = st_ref(&r).current_turn;
    exhaust_piles(&mut r, 3);
    st(&mut r).pending_draw = 16;
    let before = st_ref(&r).hands[turn].len();

    if let Err(e) = r.draw_card(turn, NOW) {
        panic!("DrawCard with 3 cards left: {e}, want Ok");
    }
    let s = st_ref(&r);
    let got = s.hands[turn].len();
    assert_eq!(
        got,
        before + 3,
        "hand = {got}, want {} (every remaining card)",
        before + 3
    );
    assert_eq!(
        s.pending_draw, 0,
        "PendingDraw = {}, want 0",
        s.pending_draw
    );
    assert!(
        s.has_drawn,
        "HasDrawn = false; the seat could neither draw again nor pass"
    );
    assert_eq!(s.current_turn, turn, "a forced draw must not cost the turn");
}

// The degenerate end state: every card is in a hand. The draw is a no-op that
// still leaves the seat able to play or pass, rather than an error nobody at
// the table has a legal answer to.
#[test]
fn draw_card_nothing_left_to_draw() {
    let mut r = started_room(&["Alice", "Bob"]);
    let turn = st_ref(&r).current_turn;
    exhaust_piles(&mut r, 0);
    let before = st_ref(&r).hands[turn].len();

    if let Err(e) = r.draw_card(turn, NOW) {
        panic!("DrawCard on empty piles: {e}, want Ok");
    }
    let got = st_ref(&r).hands[turn].len();
    assert_eq!(got, before, "hand = {got}, want {before} unchanged");
    assert!(
        st_ref(&r).has_drawn,
        "HasDrawn = false after a draw that came up empty"
    );
    if let Err(e) = r.pass_turn(turn, NOW) {
        panic!("PassTurn after an empty draw: {e} — the round is frozen");
    }
}

// The refusal path must leave the state exactly as it found it. Clearing
// PendingDraw and setting HasDrawn before the draw could fail is what made a
// pending stack disappear without anybody drawing it.
#[test]
fn draw_card_refusal_leaves_state_untouched() {
    let mut r = started_room(&["Alice", "Bob"]);
    let turn = st_ref(&r).current_turn;
    r.draw_card(turn, NOW)
        .unwrap_or_else(|e| panic!("first DrawCard: {e}"));
    let size = st_ref(&r).hands[turn].len();

    assert!(
        r.draw_card(turn, NOW).is_err(),
        "second DrawCard in one turn was accepted"
    );
    let got = st_ref(&r).hands[turn].len();
    assert_eq!(
        got, size,
        "hand = {got}, want {size} — a refused draw handed over cards"
    );
    assert!(st_ref(&r).has_drawn, "a refused draw cleared HasDrawn");

    // Same for the out-of-turn refusal, which is the one an attacker controls.
    let other = (turn + 1) % st_ref(&r).hands.len();
    let other_size = st_ref(&r).hands[other].len();
    st(&mut r).pending_draw = 4;
    assert!(
        r.draw_card(other, NOW).is_err(),
        "out-of-turn DrawCard was accepted"
    );
    let pending = st_ref(&r).pending_draw;
    assert_eq!(
        pending, 4,
        "PendingDraw = {pending}, want 4 — an out-of-turn draw cleared the stack"
    );
    let got = st_ref(&r).hands[other].len();
    assert_eq!(got, other_size, "hand = {got}, want {other_size}");
}

// A successful Contre-LOCO! is not cancelled by an empty deck. The penalty
// shrinks; the catch itself stands, exactly like the failed-catch penalty
// right next to it.
#[test]
fn catch_undeclared_empty_deck_still_catches() {
    let mut r = started_room(&["Alice", "Bob"]);
    st(&mut r).hands[0] = Hand::of([num(Color::Red, 5)]);
    st(&mut r).open_catch_window(0, NOW);
    exhaust_piles(&mut r, 0);

    if let Err(e) = r.catch_undeclared(1, 0, NOW) {
        panic!("CatchUndeclared on empty piles: {e}, want Ok");
    }
    assert!(
        st_ref(&r).seats[0].declared,
        "the catch did not settle the target's obligation"
    );
    let got = st_ref(&r).hands[0].len();
    assert_eq!(
        got, 1,
        "target hand = {got}, want 1 — there was nothing to draw"
    );
}

#[test]
fn catch_undeclared_partial_penalty() {
    let mut r = started_room(&["Alice", "Bob"]);
    st(&mut r).hands[0] = Hand::of([num(Color::Red, 5)]);
    st(&mut r).open_catch_window(0, NOW);
    exhaust_piles(&mut r, 1);

    if let Err(e) = r.catch_undeclared(1, 0, NOW) {
        panic!("CatchUndeclared with 1 card left: {e}, want Ok");
    }
    let got = st_ref(&r).hands[0].len();
    assert_eq!(
        got, 2,
        "target hand = {got}, want 2 (1 card + the single card left)"
    );
}

#[test]
fn deck_draw_up_to() {
    let mut d = Deck::standard();
    let full = d.cards.len();

    let got = d.draw_up_to(8);
    assert_eq!(
        got.len(),
        8,
        "DrawUpTo(8) returned {} cards, want 8",
        got.len()
    );
    assert_eq!(
        d.cards.len(),
        full - 8,
        "deck len = {}, want {}",
        d.cards.len(),
        full - 8
    );
    let got = d.draw_up_to(full);
    assert_eq!(
        got.len(),
        full - 8,
        "DrawUpTo({full}) returned {} cards, want the {} that were left",
        got.len(),
        full - 8
    );
    let got = d.draw_up_to(3);
    assert!(
        got.is_empty(),
        "DrawUpTo on an empty deck returned {got:?}, want nothing"
    );
    // Asking a full deck for nothing hands over nothing and leaves the deck
    // whole (a negative count cannot be expressed: `draw_up_to` takes a
    // `usize`).
    let mut d = Deck::standard();
    let got = d.draw_up_to(0);
    assert!(got.is_empty(), "DrawUpTo(0) returned {got:?}, want nothing");
    assert_eq!(d.cards.len(), full, "DrawUpTo(0) took cards off the deck");
}
