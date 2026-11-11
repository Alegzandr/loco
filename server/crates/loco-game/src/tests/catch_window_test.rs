//! The catch window and the price of a Contre-LOCO! that finds nobody.
//!
//! A Contre-LOCO! costs the caller a card whenever it loses a race, which is
//! what makes the wager honest. These tests own the line between a race and a
//! call on a seat that was never on the hook: everything on the wrong side of it
//! used to be charged, announced to the whole table, and — once the piles ran
//! dry and the penalty draw came back empty — free.

use super::support::*;
use crate::card::Color;
use crate::error::{ErrorKind, GameError};
use crate::hand::Hand;
use crate::room::{
    CATCH_GRACE_MS, CATCH_LOCKOUT_MS, CATCH_NEAR_GRACE_MS, CATCH_WINDOW_MS, FAILED_CATCH_PENALTY,
    UNDECLARED_PENALTY,
};

// A press lands on the instant it arrives, however early in the window that
// is. The opening 1.5s of every window used to be held for the seat that owed
// the call, so a Contre-LOCO! that beat their LOCO! to the server by being
// faster was made to wait and could be overtaken by the seat it had already
// caught. The reflex is what the button measures; nothing may stand between
// the press and the verdict.
#[test]
fn catch_undeclared_lands_on_the_instant_the_window_opens() {
    let mut r = two_seat_room(&[3, 1]);
    st(&mut r).open_catch_window(1, NOW);

    if let Err(e) = r.catch_undeclared(0, 1, NOW) {
        panic!("a press on the opening frame of the window must land: {e}");
    }
    let got = st_ref(&r).hands[1].len();
    assert_eq!(
        got,
        1 + UNDECLARED_PENALTY,
        "penalty not applied: hand {got}"
    );
}

// And the seat that spoke first still wins: being early is a wager, not a
// guarantee. This is the losing half of the same press.
#[test]
fn catch_undeclared_declared_first_is_a_race_lost() {
    let mut r = two_seat_room(&[3, 1]);
    st(&mut r).open_catch_window(1, NOW);
    r.declare_last_card(1, NOW)
        .unwrap_or_else(|e| panic!("declare: {e}"));
    let err = r.catch_undeclared(0, 1, NOW);
    assert_eq!(err, Err(GameError::AlreadyDeclared));
    assert!(
        err.unwrap_err().kind() == ErrorKind::MissedCatch,
        "losing that race is a miss, and a miss costs a card"
    );
}

// The late half of the mistake, and the one the interface used to make
// impossible. A seat leaves the near-finish picture without anybody playing a
// card — it draws, it swallows a stack of four, a catch lands on it — and read
// off the hand alone the offer vanished on that frame: the press already on its
// way down was answered by nobody and charged to nobody. The window is what a
// press is aimed at, so it outlives the hand it opened on.
#[test]
fn catch_offered_survives_the_hand_growing_out_of_reach() {
    let mut r = two_seat_room(&[3, 1]);
    st(&mut r).open_catch_window(1, NOW);
    // Seat 1 takes a stack of four the instant after the window opened.
    st(&mut r).hands[1].add(&[
        num(Color::Red, 4),
        num(Color::Red, 5),
        num(Color::Red, 6),
        num(Color::Red, 7),
    ]);

    assert!(
        r.catch_offered(0, NOW),
        "the window is still running: a press aimed at it is still a wager"
    );
    let charged = is_charged(&r.penalize_failed_catch(0, NOW));
    assert!(
        charged,
        "a press that missed because the hand grew must cost its card"
    );
}

// The same on the clock: past the window but inside catchGrace, a call is late
// rather than imaginary, and late is a mistake a player is allowed to make.
#[test]
fn catch_offered_covers_the_grace_after_the_window() {
    let mut r = two_seat_room(&[3, 1]);
    st(&mut r).open_catch_window(1, NOW);
    let opened = st_ref(&r).seats[1].last_card_at.expect("window opened");
    let late = opened + CATCH_WINDOW_MS + CATCH_GRACE_MS / 2;

    assert!(
        r.catch_offered(0, late),
        "a press inside the grace is a wager that came too late"
    );
    let charged = is_charged(&r.penalize_failed_catch(0, late));
    assert!(charged, "too late costs the same card as too early");
    // And out the other side of the grace it is nothing at all: no honest
    // screen still has the button live, so there is nobody to charge.
    let past = opened + CATCH_WINDOW_MS + CATCH_GRACE_MS + 1000;
    assert!(
        !r.catch_offered(0, past),
        "past the grace the offer is gone"
    );
}

// One press per offer, whatever the hand does inside the window. The ration is
// the whole of what stops the button being mashed now that nothing delays a
// press, so it has to survive the board moving underneath it: keyed on the hand
// size, a seat drawing between two presses read as a fresh offer and charged
// the same misread twice.
#[test]
fn penalize_failed_catch_one_card_per_window_through_a_growing_hand() {
    let mut r = two_seat_room(&[3, 1]);
    st(&mut r).open_catch_window(1, NOW);

    let charged = is_charged(&r.penalize_failed_catch(0, NOW));
    assert!(charged, "the first press against an offer is charged");
    st(&mut r).hands[1].add(&[num(Color::Blue, 2)]);
    let charged = is_charged(&r.penalize_failed_catch(0, NOW));
    assert!(
        !charged,
        "the same misread, a beat later, is not a second one"
    );
    let got = st_ref(&r).hands[0].len();
    assert_eq!(
        got,
        3 + FAILED_CATCH_PENALTY,
        "catcher paid more than once: hand {got}"
    );
}

// The two-card offer has a late half too. A seat on two draws instead of
// playing, its hand goes to three, and on that frame the button used to go dark
// under a thumb already on its way down. For catchNearGrace the press is still
// a wager — a late one — and it costs the card a miss costs.
#[test]
fn catch_offered_outlives_a_draw_out_of_the_two_card_picture() {
    let mut r = two_seat_room(&[3, 2]);
    {
        let s = st(&mut r);
        s.current_turn = 1;
        s.pending_draw = 0;
        s.has_drawn = false;
    }
    r.draw_card(1, NOW).unwrap_or_else(|e| panic!("draw: {e}"));
    let left = st_ref(&r).seats[1]
        .near_left_at
        .expect("a seat drawing from two cards must stamp the instant it left them");
    assert!(
        r.catch_offered(0, left + CATCH_NEAR_GRACE_MS / 2),
        "a spasm just after the draw is a late call, and a late call is a wager"
    );
    assert!(
        !r.catch_offered(0, left + CATCH_NEAR_GRACE_MS + 1),
        "past the near grace the offer is gone"
    );
    let charged = is_charged(&r.penalize_failed_catch(0, left + CATCH_NEAR_GRACE_MS / 2));
    assert!(
        charged,
        "too late on the two-card picture costs the same card as too early"
    );
}

// Pressed before the draw and again just after it, that is one misread of one
// picture, and it pays one card.
#[test]
fn penalize_failed_catch_one_card_across_a_draw_out_of_two() {
    let mut r = two_seat_room(&[3, 2]);
    {
        let s = st(&mut r);
        s.current_turn = 1;
        s.pending_draw = 0;
        s.has_drawn = false;
    }
    let charged = is_charged(&r.penalize_failed_catch(0, NOW));
    assert!(charged, "the press against a seat on two is charged");
    r.draw_card(1, NOW).unwrap_or_else(|e| panic!("draw: {e}"));
    let charged = is_charged(&r.penalize_failed_catch(0, NOW));
    assert!(
        !charged,
        "the same misread a beat later is not a second card"
    );
}

// A seat that was never on two leaves no grace behind it: three to four is not
// a picture anybody was aiming at.
#[test]
fn catch_offered_no_near_grace_from_three_cards() {
    let mut r = two_seat_room(&[3, 3]);
    {
        let s = st(&mut r);
        s.current_turn = 1;
        s.pending_draw = 0;
        s.has_drawn = false;
    }
    r.draw_card(1, NOW).unwrap_or_else(|e| panic!("draw: {e}"));
    assert!(
        st_ref(&r).seats[1].near_left_at.is_none(),
        "three to four is not leaving the two-card picture"
    );
    assert!(
        !r.catch_offered(0, NOW),
        "nothing is offered at a table of threes and fours"
    );
}

#[test]
fn catch_undeclared_seat_that_was_never_on_the_hook() {
    let mut r = two_seat_room(&[3, 5]);
    // Seat 1 holds five cards and has never played down to one: its LastCardAt
    // is the zero value, so nothing about it was ever catchable.
    let err = r.catch_undeclared(0, 1, NOW);
    assert_eq!(err, Err(GameError::NoCatchWindow));
    let err = err.unwrap_err();
    assert!(
        err.kind() != ErrorKind::MissedCatch,
        "a call on a seat that was never on the hook must not be charged as a lost race"
    );
    assert!(
        !err.kind().is_honest(),
        "and it must not be excused as one either: nothing a correct client sends reaches here"
    );
}

#[test]
fn catch_undeclared_long_closed_window_is_not_a_race() {
    let mut r = two_seat_room(&[3, 1]);
    // The window opened, nobody called it, and it shut a long time ago. Every
    // client stopped drawing the button when it did.
    st(&mut r).seats[1].last_card_at = Some(NOW - 60_000);

    let err = r.catch_undeclared(0, 1, NOW);
    assert_eq!(err, Err(GameError::NoCatchWindow));
    let got = st_ref(&r).hands[0].len();
    assert_eq!(
        got, 3,
        "caller was charged for a window nobody could still see: hand {got}"
    );
}

#[test]
fn catch_undeclared_just_missed_is_still_a_race() {
    let mut r = two_seat_room(&[3, 1]);
    // Shut a moment ago: the button was live when it was pressed and the
    // message lost the trip. That is the wager, and it is charged.
    st(&mut r).seats[1].last_card_at = Some(NOW - (CATCH_WINDOW_MS + 500));

    let err = r.catch_undeclared(0, 1, NOW);
    assert_eq!(err, Err(GameError::CatchWindowExpired));
    assert!(
        err.unwrap_err().kind() == ErrorKind::MissedCatch,
        "a window that shut inside the grace is a lost race and must still cost a card"
    );
}

#[test]
fn catch_undeclared_open_window_still_catches() {
    let mut r = two_seat_room(&[3, 1]);
    st(&mut r).open_catch_window(1, NOW);

    if let Err(e) = r.catch_undeclared(0, 1, NOW) {
        panic!("an open window must still be catchable: {e}");
    }
    let got = st_ref(&r).hands[1].len();
    assert_eq!(
        got,
        1 + UNDECLARED_PENALTY,
        "penalty not applied: hand {got}"
    );
}

#[test]
fn catch_undeclared_declared_inside_the_window_is_still_a_race() {
    let mut r = two_seat_room(&[3, 1]);
    st(&mut r).open_catch_window(1, NOW);
    r.declare_last_card(1, NOW)
        .unwrap_or_else(|e| panic!("declare: {e}"));

    let err = r.catch_undeclared(0, 1, NOW);
    assert_eq!(err, Err(GameError::AlreadyDeclared));
    assert!(
        err.unwrap_err().kind() == ErrorKind::MissedCatch,
        "beaten to the declaration is the race this mechanic is made of"
    );
}

#[test]
fn catch_undeclared_catcher_out_of_range() {
    let mut r = two_seat_room(&[3, 1]);
    st(&mut r).open_catch_window(1, NOW);

    assert!(
        r.catch_undeclared(9, 1, NOW).is_err(),
        "a catcher this deal has no hand for must be refused, not indexed"
    );
}

// ─── The lockout ────────────────────────────────────────────────────────────
//
// The card a fruitless call costs is rationed per *offer*, which bounds what
// mashing costs and not what it buys: after the first one, every press against
// the same near-finish picture was silent and free, and the one that landed on
// the frame a window opened took the catch for nothing, because a catch that
// lands spends no offer. So the lockout is rationed per *press* instead.

// The whole exploit, in the domain. A seat is one play from the finish, the
// masher's press finds nobody and pays for it, the seat plays down to its last
// card — and the press that used to collect that window is refused.
#[test]
fn catch_lockout_mashing_cannot_take_the_window_it_opens_on() {
    let mut r = two_seat_room(&[3, 2]);
    let now = NOW;

    assert!(
        r.catch_offered(0, now),
        "a seat on two cards is the offer this whole mechanic is priced on"
    );
    let charged = is_charged(&r.penalize_failed_catch(0, now));
    assert!(charged, "the press found nobody and must be charged a card");
    r.lock_catch(0, now);

    // The window opens a beat later, well inside the lockout.
    st(&mut r).hands[1] = Hand::of([num(Color::Red, 1)]);
    st(&mut r).open_catch_window(1, now);

    let at = now + 150;
    assert!(
        r.catch_locked(0, at),
        "the lockout must still be running when the window opens"
    );
    let err = r.catch_undeclared(0, 1, at);
    assert_eq!(err, Err(GameError::CatchLocked));
    let got = st_ref(&r).hands[1].len();
    assert_eq!(
        got,
        1,
        "the caught seat drew {} cards for a press that was refused",
        got as i64 - 1
    );
    // Refused, but not suspicious and not a miss: the press cost a card once
    // already, and both clocks are honest.
    let err = err.unwrap_err();
    assert!(
        err.kind() != ErrorKind::MissedCatch,
        "a locked press is not a lost race"
    );
    assert!(
        err.kind().is_honest(),
        "a locked press is ordinary play, not a tampered client"
    );
}

// And a press made inside it costs nothing more. The card stays rationed per
// offer: billing every press of a held button is the farm this mechanic spent
// two rewrites closing.
#[test]
fn catch_lockout_a_press_inside_it_is_free() {
    let mut r = two_seat_room(&[3, 2]);
    let now = NOW;
    r.lock_catch(0, now);

    let before = st_ref(&r).hands[0].len();
    let charged = is_charged(&r.penalize_failed_catch(0, now + 100));
    assert!(
        !charged,
        "a press inside the lockout must be charged nothing"
    );
    let got = st_ref(&r).hands[0].len();
    assert_eq!(
        got,
        before,
        "the locked seat drew {} cards, want none",
        got as i64 - before as i64
    );
}

// It ends on the clock, like every other deadline here, and a press made while
// it runs pushes that clock out. That is the whole of what a held thumb pays,
// and the reason it is never live at the instant a window opens.
#[test]
fn catch_lockout_ends_on_the_clock_and_every_press_rearms_it() {
    let mut r = two_seat_room(&[3, 2]);
    let now = NOW;

    let first = r.lock_catch(0, now).expect("seat 0 exists");
    assert!(
        r.catch_locked(0, now + CATCH_LOCKOUT_MS - 1),
        "the lockout ended early"
    );
    assert!(
        !r.catch_locked(0, now + CATCH_LOCKOUT_MS),
        "the lockout outlived its own deadline"
    );

    // A second press, a beat before it would have expired.
    let second = r
        .lock_catch(0, now + CATCH_LOCKOUT_MS - 100)
        .expect("seat 0 exists");
    assert!(
        second > first,
        "a press inside the lockout must push its deadline out"
    );
    assert!(
        r.catch_locked(0, now + CATCH_LOCKOUT_MS),
        "the seat came back live at the deadline the first press set"
    );
}

// Nothing about it survives the deal: a lockout is a price paid on one board,
// and the next round is another one.
#[test]
fn catch_lockout_is_cleared_by_the_deal() {
    let mut r = two_seat_room(&[3, 2]);
    let now = NOW;
    r.lock_catch(0, now);

    r.begin_next_round(now)
        .unwrap_or_else(|e| panic!("BeginNextRound: {e}"));
    assert!(!r.catch_locked(0, now), "the lockout survived the deal");
}

// A seat this deal has no hand for answers zero rather than panicking: these
// are read on the way to the wire, on every snapshot.
#[test]
fn catch_locked_at_out_of_range_seat() {
    let mut r = two_seat_room(&[3, 1]);
    assert!(
        r.catch_locked_at(9).is_none(),
        "a seat the table does not have must answer zero"
    );
    assert!(
        r.lock_catch(9, NOW).is_none(),
        "locking a seat the table does not have must change nothing"
    );
}
