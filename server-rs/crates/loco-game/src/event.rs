//! The game's own event log (`GameState.EventLog`), as Go recorded it.

use crate::Millis;
use crate::card::{Card, Color};
use serde::{Deserialize, Serialize};

/// What a logged event was.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum EventKind {
    #[serde(rename = "game_started")]
    GameStarted,
    #[serde(rename = "card_played")]
    CardPlayed,
    #[serde(rename = "card_drawn")]
    CardDrawn,
    #[serde(rename = "turn_passed")]
    TurnPassed,
    #[serde(rename = "uno_declared")]
    UnoDeclared,
    #[serde(rename = "uno_caught")]
    UnoCaught,
    #[serde(rename = "catch_failed")]
    CatchFailed,
    #[serde(rename = "counter_draw")]
    CounterDraw,
    #[serde(rename = "game_finished")]
    GameFinished,
    #[serde(rename = "round_end")]
    RoundEnd,
    #[serde(rename = "match_end")]
    MatchEnd,
    /// A seat that walked out of a match in progress (`Room::retire_seat`).
    #[serde(rename = "seat_retired")]
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

fn is_red(c: &Color) -> bool {
    *c == Color::Red
}

/// One action taken during the game. JSON as Go's tags wrote it:
/// `chosen_color` is `omitempty` on an int, so Red (0) is left out.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GameEvent {
    pub kind: EventKind,
    pub player_index: i32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub card: Option<Card>,
    #[serde(default, skip_serializing_if = "is_red")]
    pub chosen_color: Color,
    #[serde(with = "crate::stamp::req")]
    pub at: Millis,
}
