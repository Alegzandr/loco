//! The rule these pin: a seat cannot forget LOCO! and still take the round.
//!
//! It used to be enforceable only through the 5 s catch window, which left two
//! ways to win having told the table nothing. The quiet one is a seat that goes
//! down to one card, is not caught, and wins a turn later without ever calling.
//! The loud one is a hand of two identical cards put down in a single batch —
//! 2 → 0, never through one card, so no window ever opened and no call was ever
//! possible. Out of turn, by interject, that is a round taken from a hand nobody
//! at the table saw coming.

use super::support::*;
use crate::card::{Color, Kind};
use crate::error::{ErrorKind, GameError};
use crate::event::EventKind;

// --- The batch that empties a hand, on the actor's own turn ---

#[test]
fn play_cards_finishing_batch_without_the_call_is_refused() {
    let mut r = setup_three_player_game();
    let pair = num(Color::Red, 3);
    {
        let s = st(&mut r);
        s.current_turn = 0;
        s.active_color = Color::Red;
        s.pending_draw = 0;
        s.discard = vec![num(Color::Red, 3)];
        s.hands[0].cards = vec![pair, pair];
    }

    let err = r.play_cards(0, &[pair, pair], Color::Red, None, false, NOW);
    assert_eq!(
        err,
        Err(GameError::MustDeclareLoco),
        "finishing batch without the call"
    );
    // A refusal mutates nothing: the hand, the pile and the round are untouched.
    let s = st_ref(&r);
    assert_eq!(s.hands[0].len(), 2, "hand size after refusal");
    assert_eq!(
        s.discard.len(),
        1,
        "discard grew on a refused batch: {} entries, want 1",
        s.discard.len()
    );
    assert!(!r.round_ended, "a refused batch ended the round");
}

#[test]
fn play_cards_finishing_batch_carrying_the_call_wins() {
    let mut r = setup_three_player_game();
    let pair = num(Color::Red, 3);
    {
        let s = st(&mut r);
        s.current_turn = 0;
        s.active_color = Color::Red;
        s.pending_draw = 0;
        s.discard = vec![num(Color::Red, 3)];
        s.hands[0].cards = vec![pair, pair];
    }

    if let Err(e) = r.play_cards(0, &[pair, pair], Color::Red, None, true, NOW) {
        panic!("finishing batch carrying the call: {e}");
    }
    assert!(
        r.round_ended,
        "a batch that empties the hand must end the round"
    );
    assert_eq!(r.winner, "alice", "round winner");
    // The call is recorded, not merely accepted: the log and the broadcast both
    // read the state rather than the message that carried it.
    assert!(
        st_ref(&r).seats[0].declared,
        "the call the batch carried was not recorded on the seat"
    );
    assert!(
        has_event(&r, EventKind::UnoDeclared, 0),
        "no uno_declared event: the table would take the loss in silence"
    );
}

// The flag only ever answers a finish. A batch that leaves cards behind is an
// ordinary play, and the seat that sends one has made no claim about anything.
#[test]
fn play_cards_non_finishing_batch_ignores_the_flag() {
    let mut r = setup_three_player_game();
    let pair = num(Color::Red, 3);
    {
        let s = st(&mut r);
        s.current_turn = 0;
        s.active_color = Color::Red;
        s.pending_draw = 0;
        s.discard = vec![num(Color::Red, 3)];
        s.hands[0].cards = vec![pair, pair, num(Color::Blue, 8)];
    }

    if let Err(e) = r.play_cards(0, &[pair, pair], Color::Red, None, false, NOW) {
        panic!("non-finishing batch without the flag: {e}");
    }
    let s = st_ref(&r);
    assert_eq!(s.hands[0].len(), 1, "hand size");
    // Down to one card the ordinary way: the seat owes a call and is catchable,
    // which is precisely what the batch rule must not hand out for free.
    assert!(
        !s.seats[0].declared,
        "a non-finishing batch declared on the seat's behalf"
    );
    assert!(
        s.seats[0].last_card_at.is_some(),
        "no catch window opened on a seat left holding one card"
    );
}

// --- Emptying a hand out of turn, one card at a time ---

// The batch interject is gone: a press puts down one card, and the domain says
// so rather than trusting the tap. This is the hand that used to take the round
// in a single slam.
#[test]
fn interrupt_play_cards_batch_is_refused() {
    let mut r = setup_three_player_game();
    {
        let s = st(&mut r);
        s.current_turn = 1; // bob's turn; carol interjects
        s.active_color = Color::Red;
        s.pending_draw = 0;
        s.discard = vec![num(Color::Red, 6)];
    }
    arm_interrupt(&mut r, 0);

    let pair = num(Color::Red, 6);
    st(&mut r).hands[2].cards = vec![pair, pair];

    let err = r.interrupt_play(2, &[pair, pair], Color::Red, None, NOW);
    assert_eq!(err, Err(GameError::InterruptBatch), "batch interject");
    let s = st_ref(&r);
    assert_eq!(s.hands[2].len(), 2, "hand size after refusal");
    assert!(!r.round_ended, "a refused interject ended the round");
    assert_eq!(s.current_turn, 1, "turn moved on a refused interject");
}

// And the round is still there to be taken, in two presses instead of one. The
// first lands the seat on a single card, where it owes the table a call and can
// be caught for it; the second takes the round once the call is made. That is
// the whole trade the batch used to skip.
#[test]
fn interrupt_play_cards_two_copies_take_two_presses() {
    let mut r = setup_three_player_game();
    {
        let s = st(&mut r);
        s.current_turn = 1;
        s.active_color = Color::Red;
        s.pending_draw = 0;
        s.discard = vec![num(Color::Red, 6)];
    }
    arm_interrupt(&mut r, 0);

    let pair = num(Color::Red, 6);
    st(&mut r).hands[2].cards = vec![pair, pair];

    if let Err(e) = r.interrupt_play(2, &[pair], Color::Red, None, NOW) {
        panic!("first interject: {e}");
    }
    assert_eq!(
        st_ref(&r).hands[2].len(),
        1,
        "hand size after the first press"
    );
    assert!(!r.round_ended, "one card of two ended the round");
    // The seat is on the hook exactly as it would be after any other play down
    // to one card: nothing declared on its behalf, and a window open on it.
    assert!(
        !st_ref(&r).seats[2].declared,
        "an interject declared on the seat's behalf"
    );
    assert!(
        st_ref(&r).seats[2].last_card_at.is_some(),
        "no catch window opened on a seat left holding one card"
    );

    // Second press, and the round is refused until the call is made.
    let err = r.interrupt_play(2, &[pair], Color::Red, None, NOW);
    assert_eq!(
        err,
        Err(GameError::MustDeclareLoco),
        "the winning interject without the call"
    );
    if let Err(e) = r.declare_last_card(2, NOW) {
        panic!("a late call must still be accepted: {e}");
    }
    if let Err(e) = r.interrupt_play(2, &[pair], Color::Red, None, NOW) {
        panic!("the winning interject after the call: {e}");
    }
    assert!(
        r.round_ended,
        "an interject that empties the hand must end the round"
    );
    assert_eq!(r.winner, "carol", "round winner");
    assert!(
        has_event(&r, EventKind::UnoDeclared, 2),
        "the loudest win in the game went out without its call"
    );
}

// --- The quiet way: one card, no call, and a round taken a turn later ---

#[test]
fn play_card_last_card_without_the_call_is_refused() {
    let mut r = setup_two_player_game();
    let win = num(Color::Red, 2);
    {
        let s = st(&mut r);
        s.current_turn = 0;
        s.pending_draw = 0;
        s.active_color = Color::Red;
        s.discard = vec![num(Color::Red, 2)];
        s.hands[0].cards = vec![win];
    }

    let err = r.play_card(0, win, Color::Red, None, NOW);
    assert_eq!(
        err,
        Err(GameError::MustDeclareLoco),
        "last card without the call"
    );
    assert!(!r.round_ended, "a refused last card ended the round");

    // And the seat is never trapped by it: the call can still be made, late, and
    // the round taken immediately after. Forgetting costs the catch risk and a
    // press, never the game.
    if let Err(e) = r.declare_last_card(0, NOW) {
        panic!("a late call must still be accepted: {e}");
    }
    if let Err(e) = r.play_card(0, win, Color::Red, None, NOW) {
        panic!("play after the late call: {e}");
    }
    assert!(
        r.round_ended,
        "the round did not end after the call was made"
    );
}

// A counter is the fourth way to empty a hand, and it is not an exemption.
#[test]
fn counter_draw_last_card_without_the_call_is_refused() {
    let mut r = setup_two_player_game();
    let counter = act(Color::Red, Kind::DrawTwo);
    {
        let s = st(&mut r);
        s.current_turn = 1;
        s.pending_draw = 2;
        s.active_color = Color::Red;
        s.discard = vec![act(Color::Red, Kind::DrawTwo)];
        s.arm_interrupt_window(0, NOW);
        s.hands[1].cards = vec![counter];
    }

    assert_eq!(
        r.counter_draw(1, counter, Color::Red, NOW),
        Err(GameError::MustDeclareLoco),
        "winning counter without the call"
    );
    let pending = st_ref(&r).pending_draw;
    assert_eq!(
        pending, 2,
        "a refused counter resolved the stack: pending = {pending}, want 2"
    );

    declare_last(&mut r, 1);
    if let Err(e) = r.counter_draw(1, counter, Color::Red, NOW) {
        panic!("counter after the call: {e}");
    }
    assert!(
        r.round_ended,
        "a counter that empties the hand must end the round"
    );
}

// A seat that called for the card it holds keeps the right to win with it: the
// gate asks for the declaration, not for a fresh one on every attempt.
#[test]
fn play_card_declared_seat_finishes_freely() {
    let mut r = setup_two_player_game();
    let win = num(Color::Red, 2);
    {
        let s = st(&mut r);
        s.current_turn = 0;
        s.pending_draw = 0;
        s.active_color = Color::Red;
        s.discard = vec![num(Color::Red, 2)];
        s.hands[0].cards = vec![win];
    }
    declare_last(&mut r, 0);

    if let Err(e) = r.play_card(0, win, Color::Red, None, NOW) {
        panic!("a declared seat was refused its own last card: {e}");
    }
    assert!(r.round_ended, "the round did not end");
}

// The refusal is a player forgetting, not a client lying: it must not feed the
// cheat metric, and it must not trigger a resync — the client's board is right,
// it is the table's ears that are missing something.
#[test]
fn must_declare_loco_is_a_lost_race_and_not_a_mismatch() {
    assert!(
        GameError::MustDeclareLoco.kind().is_honest(),
        "ErrMustDeclareLoco must be a lost race: forgetting is not cheating"
    );
    assert!(
        GameError::MustDeclareLoco.kind() != ErrorKind::StaleState,
        "ErrMustDeclareLoco must not read as drift: the client's board is correct"
    );
}
