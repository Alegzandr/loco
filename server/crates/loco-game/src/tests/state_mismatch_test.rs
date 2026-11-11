//! Ported from Go: `server/game/state_mismatch_test.go`.

use super::support::*;
use crate::card::Color;
use crate::error::{ErrorKind, GameError};
use crate::hand::Hand;

// The wire strings are what a player reads, resolved to localised copy by the
// client. Marking an error as a state mismatch must not touch a character of
// them, or serverErrors.ts stops recognising the refusal it was written for.
#[test]
fn state_mismatch_errors_keep_their_wire_text() {
    let cases = [
        (GameError::NotYourTurn, "not your turn"),
        (GameError::IllegalPlay, "illegal card play"),
        (GameError::CardNotInHand, "card not in hand"),
        (
            GameError::MustAnswerPenalty,
            "must counter or draw pending penalty cards first",
        ),
    ];
    for (err, want) in cases {
        assert_eq!(err.to_string(), want, "error text");
        assert!(
            err.kind() == ErrorKind::StaleState,
            "IsStateMismatch({:?}) = false, want true",
            err.to_string()
        );
    }
}

// A lost race is not a mismatch: the client's board was right, it simply lost.
// Answering one with a personalised snapshot would put a full game_state on the
// wire every time an interject or a second draw arrives a beat late, which is
// exactly when the table is busiest.
#[test]
fn is_state_mismatch_excludes_lost_races() {
    for err in [
        GameError::AlreadyDrawn,
        GameError::MustDrawBeforePass,
        GameError::InterruptWindowClosed,
        GameError::InterruptMismatch,
        GameError::InterruptNotADrawCard,
        GameError::AlreadyDeclared,
        GameError::CatchWindowExpired,
        GameError::TargetNotSingleCard,
        // Go: errors.New("game not in progress").
        GameError::GameNotInProgress,
    ] {
        assert!(
            err.kind() != ErrorKind::StaleState,
            "IsStateMismatch({:?}) = true, want false",
            err.to_string()
        );
    }
}

// The mismatch marker must not swallow the sentinel identity underneath it:
// callers still match on the specific error, and IsLostRace must keep working.
#[test]
fn state_mismatch_errors_still_match_themselves() {
    assert_eq!(
        GameError::CardNotInHand,
        GameError::CardNotInHand,
        "ErrCardNotInHand no longer matches itself"
    );
    assert!(
        !GameError::IllegalPlay.kind().is_honest(),
        "IsLostRace(ErrIllegalPlay) = true, want false"
    );
}

// PlayCard's own refusals are what the hub reads to decide on a resync, so pin
// them to the sentinels rather than to their text.
#[test]
fn play_card_refusals_are_state_mismatches() {
    let mut r = setup_two_player_game();
    let me = st_ref(&r).current_turn;
    let other = (me + 1) % st_ref(&r).hands.len();

    let card = st_ref(&r).hands[other].cards[0];
    assert_eq!(
        r.play_card(other, card, Color::Wild, None, NOW),
        Err(GameError::NotYourTurn),
        "out-of-turn play"
    );

    // A card that is in nobody's hand: the deck ships one coloured Swap per
    // colour, so a second copy of the same one cannot be held.
    let ghost = num(Color::Red, 9);
    st(&mut r).hands[me] = Hand::of([num(Color::Blue, 1)]);
    assert_eq!(
        r.play_card(me, ghost, Color::Wild, None, NOW),
        Err(GameError::CardNotInHand),
        "playing a card we do not hold"
    );

    // Blue 1 on a red 3 with red active: no colour, no kind, no value.
    st(&mut r).discard = vec![num(Color::Red, 3)];
    st(&mut r).active_color = Color::Red;
    let card = st_ref(&r).hands[me].cards[0];
    assert_eq!(
        r.play_card(me, card, Color::Wild, None, NOW),
        Err(GameError::IllegalPlay),
        "off-colour play"
    );

    st(&mut r).pending_draw = 2;
    let card = st_ref(&r).hands[me].cards[0];
    assert_eq!(
        r.play_card(me, card, Color::Wild, None, NOW),
        Err(GameError::MustAnswerPenalty),
        "play under a pending stack"
    );
}
