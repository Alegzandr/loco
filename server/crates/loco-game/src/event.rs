//! The game's own event log (`GameState::event_log`). The wire carries it as
//! `loco_protocol::GameEventDTO`, built by the hub; this shape is the snapshot's.

use crate::card::{Card, Color};
use crate::{Millis, Seat};
use serde::{Deserialize, Serialize};

/// What a logged event was.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventKind {
    GameStarted,
    CardPlayed,
    CardDrawn,
    TurnPassed,
    UnoDeclared,
    UnoCaught,
    CatchFailed,
    CounterDraw,
    GameFinished,
    RoundEnd,
    MatchEnd,
    /// A seat that walked out of a match in progress (`Room::retire_seat`).
    SeatRetired,
}

impl EventKind {
    /// The wire spelling.
    pub const fn as_str(self) -> &'static str {
        match self {
            EventKind::GameStarted => "game_started",
            EventKind::CardPlayed => "card_played",
            EventKind::CardDrawn => "card_drawn",
            EventKind::TurnPassed => "turn_passed",
            EventKind::UnoDeclared => "uno_declared",
            EventKind::UnoCaught => "uno_caught",
            EventKind::CatchFailed => "catch_failed",
            EventKind::CounterDraw => "counter_draw",
            EventKind::GameFinished => "game_finished",
            EventKind::RoundEnd => "round_end",
            EventKind::MatchEnd => "match_end",
            EventKind::SeatRetired => "seat_retired",
        }
    }
}

/// One action taken during the game.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GameEvent {
    pub kind: EventKind,
    /// The seat that acted; `None` for the deal and a match end.
    #[serde(default)]
    pub player: Option<Seat>,
    #[serde(default)]
    pub card: Option<Card>,
    #[serde(default)]
    pub chosen_color: Color,
    pub at: Millis,
}
