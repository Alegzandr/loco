//! The shapes the API is built on: the kind of every refusal, the match format
//! as an enum built by conversion, and "nobody" as `None`, written `null` in
//! the snapshot and `-1` only in a refusal's text.

use crate::card::{Card, Color};
use crate::error::{ErrorKind, GameError};
use crate::event::{EventKind, GameEvent};
use crate::room::MatchFormat;
use serde_json::json;
use std::collections::HashSet;

/// One of every refusal. The exhaustive `match` below has no wildcard, so a
/// variant added to `GameError` fails to compile here until it is listed and
/// given a kind.
fn every_refusal() -> Vec<GameError> {
    use GameError as E;
    let all = vec![
        E::NotYourTurn,
        E::IllegalPlay,
        E::CardNotInHand,
        E::MustAnswerPenalty,
        E::NotEnoughCopies { have: 1, need: 2 },
        E::MustDeclareLoco,
        E::DeclareNeedsOneCard,
        E::AlreadyDeclared,
        E::CatchWindowExpired,
        E::TargetNotSingleCard,
        E::NoCatchWindow,
        E::CatchLocked,
        E::InvalidTarget(9),
        E::InvalidCatcher(9),
        E::CannotCatchYourself,
        E::AlreadyDrawn,
        E::MustDrawBeforePass,
        E::InterruptWindowClosed,
        E::InterruptMismatch,
        E::InterruptNotADrawCard,
        E::InterruptBatch,
        E::GameNotInProgress,
        E::MustChooseColor,
        E::InvalidSwapTarget(None),
        E::CannotSwapWithYourself,
        E::SeatHasLeft,
        E::NoCardsSpecified,
        E::BatchNotIdentical,
        E::BatchOfRearrangers,
        E::NoPendingDraw,
        E::NoDrawCardToCounter,
        E::CounterKindMismatch,
        E::CounterColorMismatch,
        E::GameAlreadyInProgress,
        E::RoomFull(7),
        E::NicknameTaken("alice".into()),
        E::GameAlreadyStarted,
        E::NotEnoughPlayers(2),
        E::FormatLocked,
        E::InvalidMatchFormat(2),
        E::MaxPlayersLocked,
        E::MaxPlayersTooLow(2),
        E::MaxPlayersTooHigh(7),
        E::MaxPlayersBelowRoster { n: 2, seated: 3 },
        E::ReorderOnlyInLobby,
        E::InvalidSeatPair,
        E::RemoveOnlyInLobby,
        E::InvalidPlayerIndex(9),
        E::ForfeitNotPlaying,
        E::SeatAlreadyRetired,
        E::NextRoundAfterMatchOver,
        E::NextRoundNotPlaying,
        E::RematchUnavailable,
        E::NicknameLength,
        E::NicknameCharset,
        E::NicknameBlocked,
    ];
    for e in &all {
        // Compile-time completeness: no wildcard arm.
        match e {
            E::NotYourTurn
            | E::IllegalPlay
            | E::CardNotInHand
            | E::MustAnswerPenalty
            | E::NotEnoughCopies { .. }
            | E::MustDeclareLoco
            | E::DeclareNeedsOneCard
            | E::AlreadyDeclared
            | E::CatchWindowExpired
            | E::TargetNotSingleCard
            | E::NoCatchWindow
            | E::CatchLocked
            | E::InvalidTarget(_)
            | E::InvalidCatcher(_)
            | E::CannotCatchYourself
            | E::AlreadyDrawn
            | E::MustDrawBeforePass
            | E::InterruptWindowClosed
            | E::InterruptMismatch
            | E::InterruptNotADrawCard
            | E::InterruptBatch
            | E::GameNotInProgress
            | E::MustChooseColor
            | E::InvalidSwapTarget(_)
            | E::CannotSwapWithYourself
            | E::SeatHasLeft
            | E::NoCardsSpecified
            | E::BatchNotIdentical
            | E::BatchOfRearrangers
            | E::NoPendingDraw
            | E::NoDrawCardToCounter
            | E::CounterKindMismatch
            | E::CounterColorMismatch
            | E::GameAlreadyInProgress
            | E::RoomFull(_)
            | E::NicknameTaken(_)
            | E::GameAlreadyStarted
            | E::NotEnoughPlayers(_)
            | E::FormatLocked
            | E::InvalidMatchFormat(_)
            | E::MaxPlayersLocked
            | E::MaxPlayersTooLow(_)
            | E::MaxPlayersTooHigh(_)
            | E::MaxPlayersBelowRoster { .. }
            | E::ReorderOnlyInLobby
            | E::InvalidSeatPair
            | E::RemoveOnlyInLobby
            | E::InvalidPlayerIndex(_)
            | E::ForfeitNotPlaying
            | E::SeatAlreadyRetired
            | E::NextRoundAfterMatchOver
            | E::NextRoundNotPlaying
            | E::RematchUnavailable
            | E::NicknameLength
            | E::NicknameCharset
            | E::NicknameBlocked => {}
        }
    }
    all
}

/// The refusals in `all` whose kind is `kind`, by their text.
fn of_kind(all: &[GameError], keep: impl Fn(ErrorKind) -> bool) -> HashSet<String> {
    all.iter()
        .filter(|e| keep(e.kind()))
        .map(ToString::to_string)
        .collect()
}

fn texts(errs: &[GameError]) -> HashSet<String> {
    errs.iter().map(ToString::to_string).collect()
}

#[test]
fn error_kinds() {
    use GameError as E;
    let all = every_refusal();

    // A stale board: the five a correct client produces only after a drift.
    assert_eq!(
        of_kind(&all, |k| k == ErrorKind::StaleState),
        texts(&[
            E::NotYourTurn,
            E::IllegalPlay,
            E::CardNotInHand,
            E::MustAnswerPenalty,
            E::NotEnoughCopies { have: 1, need: 2 },
        ])
    );

    // A Contre-LOCO! that lost its race.
    let missed = [
        E::AlreadyDeclared,
        E::CatchWindowExpired,
        E::TargetNotSingleCard,
    ];
    assert_eq!(
        of_kind(&all, |k| k == ErrorKind::MissedCatch),
        texts(&missed)
    );

    // The lost races: every one of them is honest.
    let lost_race = [
        E::AlreadyDrawn,
        E::MustDrawBeforePass,
        E::InterruptWindowClosed,
        E::InterruptMismatch,
        E::InterruptNotADrawCard,
        E::AlreadyDeclared,
        E::CatchLocked,
        E::MustDeclareLoco,
    ];
    for e in &lost_race {
        assert!(e.kind().is_honest(), "{e:?} is a lost race");
    }
    // The honest set is the lost races plus the two missed catches beyond
    // `AlreadyDeclared`: a wager lost to the clock or to a hand that moved is
    // ordinary play too.
    let honest = of_kind(&all, ErrorKind::is_honest);
    let mut want = texts(&lost_race);
    want.extend(texts(&[E::CatchWindowExpired, E::TargetNotSingleCard]));
    assert_eq!(honest, want);
    // A missed catch is honest; a stale board is not suspicious either, but
    // it is answered with a snapshot rather than excused.
    assert!(ErrorKind::MissedCatch.is_honest());
    assert!(ErrorKind::LostRace.is_honest());
    assert!(!ErrorKind::StaleState.is_honest());
    assert!(!ErrorKind::Invalid.is_honest());
    assert!(!ErrorKind::NicknameRejected.is_honest());

    // The three nickname rules, which reach the player as one refusal.
    assert_eq!(
        of_kind(&all, |k| k == ErrorKind::NicknameRejected),
        texts(&[E::NicknameLength, E::NicknameCharset, E::NicknameBlocked])
    );

    // Everything else is a message a correct client does not compose; the
    // two that matter most are named.
    assert_eq!(E::NoCatchWindow.kind(), ErrorKind::Invalid);
    assert_eq!(E::InterruptBatch.kind(), ErrorKind::Invalid);
    let classified = of_kind(&all, |k| k != ErrorKind::Invalid).len();
    assert_eq!(
        of_kind(&all, |k| k == ErrorKind::Invalid).len() + classified,
        all.len(),
        "two refusals share a text"
    );
}

#[test]
fn match_format_try_from() {
    for (n, want) in [
        (1, MatchFormat::Bo1),
        (3, MatchFormat::Bo3),
        (5, MatchFormat::Bo5),
        (7, MatchFormat::Bo7),
    ] {
        assert_eq!(MatchFormat::try_from(n), Ok(want), "BO{n}");
        assert_eq!(i64::from(want.rounds()), n);
    }
    for n in [0, 2, 8, -1] {
        let err = MatchFormat::try_from(n).expect_err("not a format");
        assert_eq!(err, GameError::InvalidMatchFormat(n));
        assert_eq!(err.to_string(), format!("invalid match format: {n}"));
    }
}

#[test]
fn nobody_is_null_in_the_snapshot() {
    // An event's actor: `None` for the deal and a match end.
    let ev = GameEvent {
        kind: EventKind::MatchEnd,
        player: None,
        card: None::<Card>,
        chosen_color: Color::Red,
        at: 0,
    };
    let v = serde_json::to_value(&ev).unwrap();
    assert_eq!(v["player"], json!(null));
    assert_eq!(v["kind"], json!("match_end"));
    let back: GameEvent = serde_json::from_value(v).unwrap();
    assert_eq!(back, ev);

    // A swap aimed at nobody: the refusal's text is the wire contract, and it
    // says -1.
    assert_eq!(
        GameError::InvalidSwapTarget(None).to_string(),
        "invalid chosen_player -1 for swap"
    );
    assert_eq!(
        GameError::InvalidSwapTarget(Some(4)).to_string(),
        "invalid chosen_player 4 for swap"
    );
}
