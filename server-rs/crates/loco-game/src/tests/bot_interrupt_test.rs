//! Ported from `server/game/bot_interrupt_test.go`. `interruptState` lives in
//! `support.rs` as `interrupt_state`.

use super::support::*;
use crate::bot::bot_interrupt;
use crate::card::{Card, Color, Kind};
use crate::hand::Hand;
use crate::room::GameState;

fn blue(v: i32) -> Card {
    num(Color::Blue, v)
}

// A bot gets no move a human does not: an interject is one card, however many
// copies the hand holds, and the copies left are presses the bot has to win
// again.
#[test]
fn bot_interrupt_slams_one_copy() {
    let top = num(Color::Red, 5);
    let s = interrupt_state(top, Color::Red, &[top, num(Color::Blue, 9), top]);

    let action = bot_interrupt(&s, 1).expect("BotInterrupt = nil, want one copy");
    assert_eq!(
        action.cards.len(),
        1,
        "slammed {} cards, want 1 — an interject is one card",
        action.cards.len()
    );
    assert_eq!(
        action.cards[0], top,
        "slammed {:?}, want {top:?}",
        action.cards[0]
    );
}

#[test]
fn bot_interrupt_nothing_without_an_exact_match() {
    let top = num(Color::Red, 5);
    let cases = [
        ("same kind, other colour", num(Color::Blue, 5)),
        ("same colour, other value", num(Color::Red, 6)),
        ("same colour, other kind", act(Color::Red, Kind::Skip)),
    ];
    for (name, held) in cases {
        let got = bot_interrupt(&interrupt_state(top, Color::Red, &[held]), 1);
        assert!(got.is_none(), "{name}: BotInterrupt = {got:?}, want nil");
    }
}

// The window is what makes it an interject rather than an out-of-turn play.
#[test]
fn bot_interrupt_closed_window() {
    let top = num(Color::Red, 5);
    let mut s = interrupt_state(top, Color::Red, &[top]);
    s.close_interrupt_window();

    let got = bot_interrupt(&s, 1);
    assert!(
        got.is_none(),
        "BotInterrupt into a closed window = {got:?}, want nil"
    );
}

// The opening discard is the one live window bots stay out of: it is open to
// every human at the table, but a bot slamming it would take the round's first
// turn off the seat the deal handed it, before that player touched anything.
#[test]
fn bot_interrupt_leaves_the_opening_discard_alone() {
    let top = num(Color::Red, 5);
    let mut s = interrupt_state(top, Color::Red, &[top]);
    // What dealRound produces: window open, nobody played the card on the pile.
    s.last_play_by = -1;

    assert!(
        s.interrupt_open,
        "fixture is wrong: the opening window must be open"
    );
    let got = bot_interrupt(&s, 1);
    assert!(
        got.is_none(),
        "BotInterrupt on the opening discard = {got:?}, want nil"
    );
}

// Under a draw chain only an identical draw card may be interjected. A bot that
// sent anything else would just collect a refusal.
#[test]
fn bot_interrupt_draw_chain() {
    let plus_two = act(Color::Red, Kind::DrawTwo);
    let mut s = interrupt_state(plus_two, Color::Red, &[plus_two]);
    s.pending_draw = 2;
    assert!(
        bot_interrupt(&s, 1).is_some(),
        "an identical +2 must extend the chain"
    );

    let number = num(Color::Red, 5);
    let mut s2 = interrupt_state(number, Color::Red, &[number]);
    s2.pending_draw = 2;
    let got = bot_interrupt(&s2, 1);
    assert!(
        got.is_none(),
        "BotInterrupt = {got:?} under a draw chain, want nil for a number"
    );
}

// Every wild names a colour, GlobalSwitch included — and never `Wild`, which
// matches no coloured card and would strand the whole table.
#[test]
fn bot_interrupt_wilds_name_a_colour() {
    for kind in [Kind::WildCard, Kind::WildDrawFour, Kind::GlobalSwitch] {
        let top = wild(kind);
        let hand = [top, num(Color::Green, 2), act(Color::Green, Kind::Skip)];
        let action = bot_interrupt(&interrupt_state(top, Color::Red, &hand), 1)
            .unwrap_or_else(|| panic!("{kind:?}: BotInterrupt = nil"));
        assert_ne!(
            action.chosen_color,
            Color::Wild,
            "{kind:?}: chose Wild, which is not a playable colour"
        );
        assert_eq!(
            action.chosen_color,
            Color::Green,
            "{kind:?}: chose {:?}, want the colour it holds most of (Green)",
            action.chosen_color
        );
    }
}

// Swap and GlobalSwitch cannot be batch-interjected: which target, how many
// rotations? The domain refuses it, so the bot must not offer it.
#[test]
fn bot_interrupt_rearranging_cards_stay_single() {
    for top in [act(Color::Red, Kind::Swap), wild(Kind::GlobalSwitch)] {
        // A third card so the Swap pays (seat 0 holds one): what is under
        // test is the batch size, not whether the exchange is worth it.
        let action = bot_interrupt(
            &interrupt_state(top, Color::Red, &[top, top, num(Color::Blue, 1)]),
            1,
        )
        .unwrap_or_else(|| panic!("{:?}: BotInterrupt = nil", top.kind));
        assert_eq!(
            action.cards.len(),
            1,
            "{:?}: slammed {} cards, want 1",
            top.kind,
            action.cards.len()
        );
    }
}

#[test]
fn bot_interrupt_swap_picks_a_real_target() {
    let top = act(Color::Red, Kind::Swap);
    // The bot holds four, seat 0 holds one: the exchange pays, and seat 0 is
    // the only target there is.
    let mut s = interrupt_state(top, Color::Red, &[top, blue(1), blue(2), blue(3)]);
    s.hands[0] = Hand::of([blue(4)]);

    let action = bot_interrupt(&s, 1).expect("BotInterrupt = nil");
    assert_eq!(
        action.chosen_player, 0,
        "ChosenPlayer = {}, want 0",
        action.chosen_player
    );
}

// A Swap exchanges the whole hand, so slamming one into a fuller hand is a
// forced draw the bot inflicted on itself. The interject is not made.
#[test]
fn bot_interrupt_swap_that_hurts_is_not_made() {
    let top = act(Color::Red, Kind::Swap);
    let mut s = interrupt_state(top, Color::Red, &[top, blue(1)]);
    s.hands[0] = Hand::of([blue(2), blue(3), blue(4), blue(5)]);

    let got = bot_interrupt(&s, 1);
    assert!(
        got.is_none(),
        "BotInterrupt = {got:?}, want nil: the exchange costs three cards"
    );
}

#[test]
fn bot_interrupt_out_of_range_seat() {
    let top = num(Color::Red, 5);
    let s = interrupt_state(top, Color::Red, &[top]);
    let got = bot_interrupt(&s, 7);
    assert!(got.is_none(), "BotInterrupt(seat 7) = {got:?}, want nil");
    // Go also passed a nil state; a reference cannot be null, so the nearest
    // thing is a state with no hands at all.
    let got = bot_interrupt(&GameState::default(), 0);
    assert!(
        got.is_none(),
        "BotInterrupt(empty state) = {got:?}, want nil"
    );
    let got = bot_interrupt(&s, -1);
    assert!(got.is_none(), "BotInterrupt(seat -1) = {got:?}, want nil");
}

// Same for every kind, and the two that used to be exceptions are the ones
// worth naming: a plain Wild (N of them name one colour) and a +4 (each copy
// used to raise the stack, which is precisely how one press became three).
#[test]
fn bot_interrupt_plain_wild_spends_one_copy() {
    let top = wild(Kind::WildCard);
    let hand = [top, top, num(Color::Green, 2)];

    let action = bot_interrupt(&interrupt_state(top, Color::Red, &hand), 1)
        .expect("BotInterrupt = nil, want one copy");
    assert_eq!(
        action.cards.len(),
        1,
        "slammed {} wilds, want 1 — a second one names the same colour",
        action.cards.len()
    );
}

// Not even the hand that used to take the round in one slam: two identical
// cards go down one at a time, and the seat sits catchable on one card in
// between, exactly as a human does.
#[test]
fn bot_interrupt_two_copies_are_not_one_win() {
    let top = wild(Kind::WildCard);

    let action = bot_interrupt(&interrupt_state(top, Color::Red, &[top, top]), 1)
        .expect("BotInterrupt = nil, want one copy");
    assert_eq!(
        action.cards.len(),
        1,
        "slammed {} wilds, want 1 — no batch takes a round any more",
        action.cards.len()
    );
}

// The +4 above all: three of them used to leave the hand on a single press.
#[test]
fn bot_interrupt_plus_four_spends_one_copy() {
    let top = wild(Kind::WildDrawFour);
    let hand = [top, top, top, num(Color::Green, 2)];

    let action = bot_interrupt(&interrupt_state(top, Color::Red, &hand), 1)
        .expect("BotInterrupt = nil, want one copy");
    assert_eq!(
        action.cards.len(),
        1,
        "slammed {} +4s, want 1 — the chain is emptied one press at a time",
        action.cards.len()
    );
}
