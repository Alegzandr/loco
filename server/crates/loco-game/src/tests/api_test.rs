//! The shapes the Rust API chose where Go had none: the kind of every refusal
//! (Go's four `errors.Is` predicates), the match format as an enum built by
//! conversion (Go's `SetFormat` validation), and "nobody" as `None` on the
//! inside and Go's -1 on the wire.

use crate::Seat;
use crate::card::{Card, Color};
use crate::error::{ErrorKind, GameError};
use crate::event::{EventKind, GameEvent};
use crate::room::MatchFormat;
use serde::{Deserialize, Serialize};
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

    // Go: `IsStateMismatch` — the five wrapped in `stale(...)`.
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

    // Go: `IsMissedCatch` — a Contre-LOCO! that lost its race.
    let missed = [
        E::AlreadyDeclared,
        E::CatchWindowExpired,
        E::TargetNotSingleCard,
    ];
    assert_eq!(
        of_kind(&all, |k| k == ErrorKind::MissedCatch),
        texts(&missed)
    );

    // Go: `IsLostRace` named these sentinels. Every one of them is honest here.
    let go_lost_race = [
        E::AlreadyDrawn,
        E::MustDrawBeforePass,
        E::InterruptWindowClosed,
        E::InterruptMismatch,
        E::InterruptNotADrawCard,
        E::AlreadyDeclared,
        E::CatchLocked,
        E::MustDeclareLoco,
    ];
    for e in &go_lost_race {
        assert!(e.kind().is_honest(), "{e:?} was a lost race in Go");
    }
    // The honest set is Go's lost races plus the two missed catches Go's
    // `IsLostRace` did not name: a wager lost to the clock or to a hand that
    // moved is ordinary play too.
    let honest = of_kind(&all, ErrorKind::is_honest);
    let mut want = texts(&go_lost_race);
    want.extend(texts(&[E::CatchWindowExpired, E::TargetNotSingleCard]));
    assert_eq!(honest, want);
    // A missed catch is honest; a stale board is not suspicious either, but
    // it is answered with a snapshot rather than excused.
    assert!(ErrorKind::MissedCatch.is_honest());
    assert!(ErrorKind::LostRace.is_honest());
    assert!(!ErrorKind::StaleState.is_honest());
    assert!(!ErrorKind::Invalid.is_honest());
    assert!(!ErrorKind::NicknameRejected.is_honest());

    // Go: `IsNicknameRejected`.
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

#[derive(Debug, PartialEq, Serialize, Deserialize)]
struct Seated {
    #[serde(with = "crate::gojson::opt_seat")]
    seat: Option<Seat>,
}

#[test]
fn opt_seat_json() {
    assert_eq!(
        serde_json::to_value(Seated { seat: None }).unwrap(),
        json!({"seat": -1})
    );
    assert_eq!(
        serde_json::to_value(Seated { seat: Some(3) }).unwrap(),
        json!({"seat": 3})
    );
    let read = |v| serde_json::from_value::<Seated>(v).unwrap().seat;
    assert_eq!(read(json!({"seat": -1})), None);
    assert_eq!(read(json!({"seat": 0})), Some(0));
    assert_eq!(read(json!({"seat": 6})), Some(6));
    // Go never wrote another negative, but it would mean nobody as well.
    assert_eq!(read(json!({"seat": -7})), None);

    // And where the wire carries it: an event's actor.
    let ev = GameEvent {
        kind: EventKind::MatchEnd,
        player: None,
        card: None::<Card>,
        chosen_color: Color::Red,
        at: 0,
    };
    let v = serde_json::to_value(&ev).unwrap();
    assert_eq!(v["player_index"], json!(-1));
    let back: GameEvent = serde_json::from_value(v).unwrap();
    assert_eq!(back, ev);

    // A swap aimed at nobody prints Go's -1 too.
    assert_eq!(
        GameError::InvalidSwapTarget(None).to_string(),
        "invalid chosen_player -1 for swap"
    );
    assert_eq!(
        GameError::InvalidSwapTarget(Some(4)).to_string(),
        "invalid chosen_player 4 for swap"
    );
}
