//! Legality and card effects.

use super::support::*;
use crate::card::{Color, Kind};
use crate::rules::can_play;

// can_play

#[test]
fn can_play_match_color() {
    assert!(
        can_play(num(Color::Red, 3), num(Color::Red, 5), Color::Red),
        "should be able to play same-colour card"
    );
}

#[test]
fn can_play_match_number() {
    assert!(
        can_play(num(Color::Blue, 5), num(Color::Red, 5), Color::Red),
        "should be able to play same-number card"
    );
}

#[test]
fn can_play_match_kind() {
    assert!(
        can_play(
            act(Color::Blue, Kind::Skip),
            act(Color::Red, Kind::Skip),
            Color::Red
        ),
        "should be able to play same-kind action card"
    );
}

#[test]
fn can_play_wild() {
    assert!(
        can_play(wild(Kind::WildCard), num(Color::Red, 7), Color::Red),
        "Wild can always be played"
    );
}

#[test]
fn can_play_wild_draw_four() {
    assert!(
        can_play(wild(Kind::WildDrawFour), num(Color::Green, 2), Color::Green),
        "WildDrawFour can always be played"
    );
}

#[test]
fn can_play_mismatch() {
    assert!(
        !can_play(num(Color::Blue, 3), num(Color::Red, 5), Color::Red),
        "mismatched colour and number should not be playable"
    );
}

#[test]
fn can_play_after_wild_uses_chosen_color() {
    // Top card is a wild; active colour is Blue.
    assert!(
        can_play(num(Color::Blue, 4), wild(Kind::WildCard), Color::Blue),
        "should match the chosen wild colour"
    );
}

#[test]
fn can_play_after_wild_wrong_color() {
    assert!(
        !can_play(num(Color::Red, 4), wild(Kind::WildCard), Color::Blue),
        "should not match wrong colour after wild"
    );
}

// apply_effect

#[test]
fn apply_effect_skip() {
    let mut state = new_test_state(4, 0);
    // Current turn is 0; skip means player 1 is skipped, so next is player 2.
    let next = state.apply_effect(act(Color::Red, Kind::Skip), Color::Red);
    assert_eq!(next, 2);
}

#[test]
fn apply_effect_reverse_more_than2_players() {
    let mut state = new_test_state(4, 0);
    state.apply_effect(act(Color::Red, Kind::Reverse), Color::Red);
    assert_eq!(state.direction, -1, "Reverse should change direction to -1");
}

#[test]
fn apply_effect_reverse_2_players() {
    // With 2 players, Reverse acts like Skip: the direction flips and the
    // current player gets another turn.
    let mut state = new_test_state(2, 0);
    let next = state.apply_effect(act(Color::Red, Kind::Reverse), Color::Red);
    assert_eq!(next, 0);
}

#[test]
fn apply_effect_draw_two_penalizes_next() {
    let mut state = new_test_state(4, 0);
    state.apply_effect(act(Color::Red, Kind::DrawTwo), Color::Red);
    assert_eq!(state.pending_draw, 2);
}

#[test]
fn apply_effect_wild_draw_four_penalizes_next() {
    let mut state = new_test_state(4, 0);
    state.apply_effect(wild(Kind::WildDrawFour), Color::Blue);
    assert_eq!(state.pending_draw, 4);
    assert_eq!(state.active_color, Color::Blue);
}

#[test]
fn apply_effect_wild_sets_color() {
    let mut state = new_test_state(4, 0);
    state.apply_effect(wild(Kind::WildCard), Color::Green);
    assert_eq!(state.active_color, Color::Green);
}

#[test]
fn apply_effect_global_switch_sets_chosen_color() {
    // GlobalSwitch is a wild like the other two: the player names the colour.
    let mut state = new_test_state(4, 0);
    state.active_color = Color::Red;
    state.apply_effect(wild(Kind::GlobalSwitch), Color::Yellow);
    assert_eq!(state.active_color, Color::Yellow, "want Yellow (chosen)");
}

#[test]
fn apply_effect_global_switch_never_sets_wild_as_active_color() {
    // Last line of defence: Wild matches no coloured card, so it would leave
    // the whole table holding wilds as its only legal play. The callers reject
    // a colourless GlobalSwitch outright; if one slips through, the colour in
    // play carries over rather than becoming Wild.
    let mut state = new_test_state(4, 0);
    state.active_color = Color::Green;
    state.apply_effect(wild(Kind::GlobalSwitch), Color::Wild);
    assert_eq!(
        state.active_color,
        Color::Green,
        "want Green (carried over)"
    );
}

#[test]
fn apply_effect_wild_never_sets_wild_as_active_color() {
    let mut state = new_test_state(4, 0);
    state.active_color = Color::Blue;
    state.apply_effect(wild(Kind::WildCard), Color::Wild);
    assert_eq!(
        state.active_color,
        Color::Blue,
        "Wild must never become the active colour"
    );
}
