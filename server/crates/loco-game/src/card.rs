//! Cards, colours and kinds.
//!
//! Colours and kinds serialise as their integer discriminants, which is what
//! the drain snapshot stores, so the order of the variants below is part of
//! that file's shape. The wire protocol spells them as strings (`as_str`),
//! which is `loco-protocol`'s business, not this crate's.

use serde::{Deserialize, Serialize};
use serde_repr::{Deserialize_repr, Serialize_repr};
use std::fmt;

/// A card colour. `Wild` is the colour of the three wild kinds and never an
/// active colour (`GameState::set_active_color` refuses it).
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    PartialOrd,
    Ord,
    Default,
    Serialize_repr,
    Deserialize_repr,
)]
#[repr(u8)]
pub enum Color {
    #[default]
    Red = 0,
    Yellow = 1,
    Green = 2,
    Blue = 3,
    /// Used for wild cards that have no inherent colour.
    Wild = 4,
}

/// The four real colours, in the deck's order.
pub const COLORS: [Color; 4] = [Color::Red, Color::Yellow, Color::Green, Color::Blue];

impl Color {
    /// The wire spelling.
    pub const fn as_str(self) -> &'static str {
        match self {
            Color::Red => "red",
            Color::Yellow => "yellow",
            Color::Green => "green",
            Color::Blue => "blue",
            Color::Wild => "wild",
        }
    }

    /// Reads a wire spelling back.
    pub fn parse(s: &str) -> Option<Color> {
        match s {
            "red" => Some(Color::Red),
            "yellow" => Some(Color::Yellow),
            "green" => Some(Color::Green),
            "blue" => Some(Color::Blue),
            "wild" => Some(Color::Wild),
            _ => None,
        }
    }
}

impl fmt::Display for Color {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// The kind of a card.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    PartialOrd,
    Ord,
    Default,
    Serialize_repr,
    Deserialize_repr,
)]
#[repr(u8)]
pub enum Kind {
    #[default]
    Number = 0,
    Skip = 1,
    Reverse = 2,
    DrawTwo = 3,
    WildCard = 4,
    WildDrawFour = 5,
    /// Swap entire hands with a chosen opponent. Coloured, one per colour.
    Swap = 6,
    /// All players rotate hands in the current game direction. Wild.
    GlobalSwitch = 7,
}

/// Every kind, in discriminant order.
pub const KINDS: [Kind; 8] = [
    Kind::Number,
    Kind::Skip,
    Kind::Reverse,
    Kind::DrawTwo,
    Kind::WildCard,
    Kind::WildDrawFour,
    Kind::Swap,
    Kind::GlobalSwitch,
];

impl Kind {
    /// The wire spelling.
    pub const fn as_str(self) -> &'static str {
        match self {
            Kind::Number => "number",
            Kind::Skip => "skip",
            Kind::Reverse => "reverse",
            Kind::DrawTwo => "draw_two",
            Kind::WildCard => "wild",
            Kind::WildDrawFour => "wild_draw_four",
            Kind::Swap => "swap",
            Kind::GlobalSwitch => "global_switch",
        }
    }

    /// Reads a wire spelling back.
    pub fn parse(s: &str) -> Option<Kind> {
        KINDS.into_iter().find(|k| k.as_str() == s)
    }
}

impl fmt::Display for Kind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// A single playing card. Two cards are the same card when all three fields
/// match; that equality is what an interject, a batch and a counter test.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
pub struct Card {
    pub color: Color,
    pub kind: Kind,
    /// 1–9 for number cards, 0 for action cards.
    pub value: i32,
}

impl Card {
    /// A card of any shape.
    pub const fn new(color: Color, kind: Kind, value: i32) -> Card {
        Card { color, kind, value }
    }

    /// A number card.
    pub const fn number(color: Color, value: i32) -> Card {
        Card::new(color, Kind::Number, value)
    }

    /// An action card of a colour (Skip, Reverse, DrawTwo, Swap).
    pub const fn action(color: Color, kind: Kind) -> Card {
        Card::new(color, kind, 0)
    }

    /// One of the three wilds.
    pub const fn wild(kind: Kind) -> Card {
        Card::new(Color::Wild, kind, 0)
    }

    /// True if the card has no inherent colour. Swap is coloured and is not.
    pub const fn is_wild(&self) -> bool {
        matches!(
            self.kind,
            Kind::WildCard | Kind::WildDrawFour | Kind::GlobalSwitch
        )
    }

    /// True for every kind but Number.
    pub const fn is_action(&self) -> bool {
        !matches!(self.kind, Kind::Number)
    }
}

/// The scoring value of a card, per `docs/rules.md` §10: Number = face value,
/// Reverse = 10, Skip = 20, DrawTwo = 30, Swap = 30, GlobalSwitch = 40,
/// Wild = 40, WildDrawFour = 50.
pub const fn card_value(c: Card) -> i32 {
    match c.kind {
        Kind::Number => c.value,
        Kind::Reverse => 10,
        Kind::Skip => 20,
        Kind::DrawTwo | Kind::Swap => 30,
        Kind::GlobalSwitch | Kind::WildCard => 40,
        Kind::WildDrawFour => 50,
    }
}
