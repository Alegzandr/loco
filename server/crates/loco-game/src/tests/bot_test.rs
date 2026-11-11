//! A bot's turn (`bot_think`): what it plays, holds, batches and names.
//!
//! `bot_think` takes its source as a parameter; where a test loops to cover the
//! randomness, the loop draws from one seeded source.

use super::support::*;
use crate::bot::{BotActionKind, bot_think};
use crate::card::{Card, Color, Kind};
use crate::hand::Hand;
use crate::rules::can_play;
use crate::state::{GameState, SeatState};

fn state_with(hands: Vec<Hand>, top: Card, pending_draw: u32) -> GameState {
    GameState {
        seats: vec![SeatState::default(); hands.len()],
        hands,
        discard: vec![top],
        active_color: Color::Red,
        current_turn: 0,
        direction: 1,
        pending_draw,
        ..GameState::default()
    }
}

fn blue(v: i32) -> Card {
    num(Color::Blue, v)
}

#[test]
fn bot_think_plays_legal_card() {
    // Setup: bot has a red 5 and blue skip; top card is red 3
    let state = state_with(
        vec![Hand::of([num(Color::Red, 5), act(Color::Blue, Kind::Skip)])],
        num(Color::Red, 3),
        0,
    );

    let mut rng = test_rng(1);
    let action = bot_think(&state, 0, &mut rng);
    assert_eq!(action.kind, BotActionKind::Play, "expected BotPlay");
    assert!(
        can_play(action.card, state.discard[0], state.active_color),
        "bot chose illegal card {:?}",
        action.card
    );
}

#[test]
fn bot_think_draws_when_no_legal_card() {
    let state = state_with(vec![Hand::of([num(Color::Blue, 7)])], num(Color::Red, 3), 0);

    let action = bot_think(&state, 0, &mut test_rng(2));
    assert_eq!(action.kind, BotActionKind::Draw, "expected BotDraw");
}

// TestBotThink_CountersDraw verifies the bot can produce BotCounter when it has a matching
// draw card. The bot counters ~70% of the time (probabilistic), so we run enough iterations
// to confirm it both counters and draws across trials, proving both paths are reachable.
#[test]
fn bot_think_counters_draw() {
    // Same colour as the top card: a counter is the same card, so a blue +2
    // would not be a legal answer to a red one here.
    let state = state_with(
        vec![Hand::of([act(Color::Red, Kind::DrawTwo)])],
        act(Color::Red, Kind::DrawTwo),
        2,
    );

    let mut rng = test_rng(3);
    let mut saw_counter = false;
    let mut saw_draw = false;
    for _ in 0..200 {
        let action = bot_think(&state, 0, &mut rng);
        match action.kind {
            BotActionKind::Counter => saw_counter = true,
            BotActionKind::Draw => saw_draw = true,
            k => panic!("unexpected action kind {k:?}"),
        }
        if saw_counter && saw_draw {
            break;
        }
    }
    assert!(
        saw_counter,
        "bot never countered across 200 trials; counter path appears broken"
    );
    assert!(
        saw_draw,
        "bot always countered across 200 trials; draw path appears broken"
    );
}

#[test]
fn bot_think_draws_when_cannot_counter() {
    let state = state_with(
        vec![Hand::of([num(Color::Blue, 5)])],
        act(Color::Red, Kind::DrawTwo),
        2,
    );

    let action = bot_think(&state, 0, &mut test_rng(4));
    assert_eq!(action.kind, BotActionKind::Draw, "expected BotDraw");
}

#[test]
fn bot_think_prefers_wild_color_from_hand() {
    let state = state_with(
        vec![Hand::of([
            wild(Kind::WildCard),
            num(Color::Green, 1),
            num(Color::Green, 2),
        ])],
        num(Color::Red, 3),
        0,
    );

    let mut rng = test_rng(5);
    for _ in 0..50 {
        let action = bot_think(&state, 0, &mut rng);
        assert_eq!(action.kind, BotActionKind::Play, "expected BotPlay");
        if action.card.is_wild() {
            assert_eq!(
                action.chosen_color,
                Color::Green,
                "expected bot to choose Green (most in hand)"
            );
        }
    }
}

// A Swap is the one card whose value depends on the table: it exchanges hands,
// so the target is the seat with the fewest cards and never the fullest one.
#[test]
fn bot_think_swap_targets_the_smallest_hand() {
    let state = state_with(
        vec![
            Hand::of([
                act(Color::Red, Kind::Swap),
                blue(1),
                blue(2),
                blue(3),
                blue(4),
            ]),
            Hand::of([blue(5), blue(6), blue(7), blue(8), blue(9)]),
            Hand::of([blue(0)]),
        ],
        num(Color::Red, 3),
        0,
    );
    let action = bot_think(&state, 0, &mut test_rng(6));
    assert!(
        action.kind == BotActionKind::Play && action.card.kind == Kind::Swap,
        "action = {action:?}, want the Swap played"
    );
    assert_eq!(
        action.target,
        Some(2),
        "ChosenPlayer = {:?}, want 2 (the one-card hand)",
        action.target
    );
}

// A retired seat's hand went back to the deck, so it is the smallest at the
// table and the one target the domain refuses. It is never chosen.
#[test]
fn bot_think_swap_skips_a_retired_seat() {
    let mut state = state_with(
        vec![
            Hand::of([
                act(Color::Red, Kind::Swap),
                blue(1),
                blue(2),
                blue(3),
                blue(4),
            ]),
            Hand::of([blue(5), blue(6)]),
            Hand::default(),
        ],
        num(Color::Red, 3),
        0,
    );
    state.seats[2].retired = true;
    let action = bot_think(&state, 0, &mut test_rng(7));
    assert!(
        action.kind == BotActionKind::Play && action.card.kind == Kind::Swap,
        "action = {action:?}, want the Swap played"
    );
    assert_eq!(
        action.target,
        Some(1),
        "ChosenPlayer = {:?}, want 1, never the retired seat",
        action.target
    );
}

// When every opponent holds more than the bot would after the play, the Swap
// is a self-inflicted draw: the bot plays something else, and with nothing
// else legal it draws one card rather than take a whole hand.
#[test]
fn bot_think_holds_a_swap_that_hurts() {
    let full = Hand::of([blue(5), blue(6), blue(7), blue(8), blue(9)]);
    let swap = act(Color::Red, Kind::Swap);
    let red3 = num(Color::Red, 3);

    let with_alternative = state_with(
        vec![Hand::of([swap, num(Color::Red, 7)]), full.clone()],
        red3,
        0,
    );
    let mut rng = test_rng(8);
    for _ in 0..50 {
        let action = bot_think(&with_alternative, 0, &mut rng);
        assert!(
            action.kind == BotActionKind::Play && action.card.kind != Kind::Swap,
            "action = {action:?}, want the red 7 played instead of the Swap"
        );
    }

    let only_swap = state_with(vec![Hand::of([swap, blue(1)]), full.clone()], red3, 0);
    let action = bot_think(&only_swap, 0, &mut rng);
    assert_eq!(
        action.kind,
        BotActionKind::Draw,
        "action = {action:?}, want a draw over a Swap into five cards"
    );

    // A Swap that empties the hand takes the round before any exchange.
    let last_card = state_with(vec![Hand::of([swap]), full], red3, 0);
    let action = bot_think(&last_card, 0, &mut rng);
    assert!(
        action.kind == BotActionKind::Play && action.card.kind == Kind::Swap,
        "action = {action:?}, want the Swap played as the last card"
    );
}

// A plain Wild is nothing but the colour it names, so one that names the colour
// already on the table is a colour change that changes no colour. It is held
// while anything else is playable, and played when it is all there is.
#[test]
fn bot_think_holds_a_wild_that_changes_nothing() {
    let w = wild(Kind::WildCard);
    let red3 = num(Color::Red, 3);
    let mut rng = test_rng(9);

    // The hand is red, the table is red: naming red moves nothing, so the red 7
    // is the card. The wild is the "preferred" pool's only member, which is
    // what used to make it the pick every single time.
    let on_red = state_with(vec![Hand::of([w, num(Color::Red, 7)])], red3, 0);
    for _ in 0..50 {
        let action = bot_think(&on_red, 0, &mut rng);
        assert!(
            action.kind == BotActionKind::Play && action.card.kind != Kind::WildCard,
            "action = {action:?}, want the red 7 played instead of an idle wild"
        );
    }

    // Same hand, and the wild now buys the whole board: the table is red and the
    // bot is holding blue.
    let on_blue = state_with(vec![Hand::of([w, num(Color::Blue, 7)])], red3, 0);
    let action = bot_think(&on_blue, 0, &mut rng);
    assert!(
        action.kind == BotActionKind::Play
            && action.card.kind == Kind::WildCard
            && action.chosen_color == Color::Blue,
        "action = {action:?}, want the wild played for blue"
    );

    // Nothing else to play: the wild goes out rather than a card off the deck,
    // and it is the card that empties the hand.
    let last_card = state_with(vec![Hand::of([w])], red3, 0);
    let action = bot_think(&last_card, 0, &mut rng);
    assert!(
        action.kind == BotActionKind::Play && action.card.kind == Kind::WildCard,
        "action = {action:?}, want the wild played as the last card"
    );
}

// The two wilds that pay whatever they name — the +4 draws four, the Rotation
// turns every hand — are never held. What they must not do is name the colour
// already active when another colour is free: a tie goes to the change.
#[test]
fn bot_think_breaks_a_colour_tie_towards_a_change() {
    let red3 = num(Color::Red, 3);
    let mut rng = test_rng(10);

    let tied = state_with(
        vec![Hand::of([
            wild(Kind::WildDrawFour),
            num(Color::Red, 5),
            num(Color::Blue, 5),
        ])],
        red3,
        0,
    );
    let action = bot_think(&tied, 0, &mut rng);
    assert!(
        action.card.kind == Kind::WildDrawFour && action.chosen_color == Color::Blue,
        "action = {action:?}, want the +4 naming blue over the red already active"
    );

    // The tie-break is free or it is not taken: a colour the bot holds less of
    // is paying for the change, which is a worse hand for a better picture.
    let ahead = state_with(
        vec![Hand::of([
            wild(Kind::WildDrawFour),
            num(Color::Red, 5),
            num(Color::Red, 6),
            num(Color::Blue, 5),
        ])],
        red3,
        0,
    );
    let action = bot_think(&ahead, 0, &mut rng);
    assert!(
        action.card.kind == Kind::WildDrawFour && action.chosen_color == Color::Red,
        "action = {action:?}, want the +4 staying on red, which the hand is longest in"
    );
}

// A bot plays its identical copies together on its own turn when a copy buys
// something: two +2s are a +4, and two identical last cards take the round with
// the call on the message. Its interject never batches — see BotInterrupt.
#[test]
fn bot_think_batches_copies_that_buy_something() {
    let plus2 = act(Color::Red, Kind::DrawTwo);
    let red3 = num(Color::Red, 3);
    let mut rng = test_rng(11);

    let state = state_with(
        vec![
            Hand::of([plus2, plus2, num(Color::Blue, 4)]),
            Hand::of([num(Color::Blue, 5)]),
        ],
        red3,
        0,
    );
    let action = bot_think(&state, 0, &mut rng);
    assert!(
        action.kind == BotActionKind::Play && action.card.kind == Kind::DrawTwo,
        "action = {action:?}, want the +2 played"
    );
    assert_eq!(
        action.cards.len(),
        2,
        "Cards = {:?}, want both copies",
        action.cards
    );
    assert!(
        !action.declare_loco,
        "DeclareLoco = true on a batch that leaves a card"
    );

    let last = state_with(
        vec![Hand::of([plus2, plus2]), Hand::of([num(Color::Blue, 5)])],
        red3,
        0,
    );
    let action = bot_think(&last, 0, &mut rng);
    assert!(
        action.cards.len() == 2 && action.declare_loco,
        "action = {action:?}, want both copies with the call"
    );

    // A plain wild buys nothing with its second copy: one at a time.
    let w = wild(Kind::WildCard);
    let wilds = state_with(
        vec![
            Hand::of([w, w, num(Color::Blue, 4)]),
            Hand::of([num(Color::Blue, 5)]),
        ],
        red3,
        0,
    );
    let action = bot_think(&wilds, 0, &mut rng);
    assert!(
        !(action.card.kind == Kind::WildCard && !action.cards.is_empty()),
        "Cards = {:?}, want a single wild",
        action.cards
    );
}
