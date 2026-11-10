//! The wire enums.
//!
//! The domain owns these values (`loco-game`'s colours, kinds and the formats a
//! room accepts); this module is the spelling they travel under, and
//! `tests/enums.rs` pins one to the other in both directions once `loco-game`
//! is in the workspace.
//!
//! They exist because this crate is the single source the TypeScript client is
//! generated from. A field typed `String` here generates a field typed
//! `string`, which would throw away a narrowing the client always had: a colour
//! off the wire is one of five things, and the client's pickers, its suit shapes
//! and its active-colour chip are all written against that.
//!
//! Every value travels as the same lower-case (or `BO`n) string the Go server
//! wrote. Reading is as forgiving as the Go server's `parseColor` / `parseKind`
//! / `parseMatchFormat` were: case does not matter, and an empty colour reads as
//! [`CardColor::Wild`], which is what a card carries before its owner names one.
//! Writing is always the canonical spelling.

use schemars::JsonSchema;
use serde::{Deserialize, Deserializer, Serialize};
use ts_rs::TS;

/// Implements `Deserialize` for a wire enum by matching its canonical spelling
/// after `normalise`, so the forgiving read lives in one place per enum and the
/// canonical write stays the derive's.
macro_rules! forgiving_deserialize {
    ($ty:ident, $all:ident, $normalise:expr) => {
        impl<'de> Deserialize<'de> for $ty {
            fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
                let raw = <std::borrow::Cow<'de, str>>::deserialize(d)?;
                let normalise: fn(&str) -> String = $normalise;
                let wanted = normalise(&raw);
                $all.iter()
                    .copied()
                    .find(|v| v.as_str() == wanted)
                    .ok_or_else(|| {
                        serde::de::Error::custom(format!(
                            concat!("unknown ", stringify!($ty), ": {:?}"),
                            raw
                        ))
                    })
            }
        }
    };
}

/// A card colour, or the table's active colour, as it travels.
/// `wild` is what a wild card carries before its owner names a real one; it
/// must never reach a game state's active colour.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum CardColor {
    Red,
    Yellow,
    Green,
    Blue,
    Wild,
}

/// What `tests/enums.rs` checks the domain against. Declaration order.
pub const ALL_CARD_COLORS: [CardColor; 5] = [
    CardColor::Red,
    CardColor::Yellow,
    CardColor::Green,
    CardColor::Blue,
    CardColor::Wild,
];

impl CardColor {
    /// The wire spelling.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Red => "red",
            Self::Yellow => "yellow",
            Self::Green => "green",
            Self::Blue => "blue",
            Self::Wild => "wild",
        }
    }
}

// An empty colour reads as Wild, exactly as the Go server's parseColor did:
// every entry point still refuses a wild that reaches a play without a colour.
forgiving_deserialize!(CardColor, ALL_CARD_COLORS, |s| if s.is_empty() {
    "wild".to_owned()
} else {
    s.to_lowercase()
});

/// A card's kind as it travels. `wild` is the plain wild card; `global_switch`
/// is LOCO's own, a wild that rotates every hand.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum CardKind {
    Number,
    Skip,
    Reverse,
    DrawTwo,
    Wild,
    WildDrawFour,
    Swap,
    GlobalSwitch,
}

/// Mirrors [`ALL_CARD_COLORS`]' contract.
pub const ALL_CARD_KINDS: [CardKind; 8] = [
    CardKind::Number,
    CardKind::Skip,
    CardKind::Reverse,
    CardKind::DrawTwo,
    CardKind::Wild,
    CardKind::WildDrawFour,
    CardKind::Swap,
    CardKind::GlobalSwitch,
];

impl CardKind {
    /// The wire spelling.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Number => "number",
            Self::Skip => "skip",
            Self::Reverse => "reverse",
            Self::DrawTwo => "draw_two",
            Self::Wild => "wild",
            Self::WildDrawFour => "wild_draw_four",
            Self::Swap => "swap",
            Self::GlobalSwitch => "global_switch",
        }
    }
}

forgiving_deserialize!(CardKind, ALL_CARD_KINDS, |s| s.to_lowercase());

/// The best-of-N format a table is playing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, TS, JsonSchema)]
pub enum MatchFormat {
    BO1,
    BO3,
    BO5,
    BO7,
}

/// Mirrors [`ALL_CARD_COLORS`]' contract.
pub const ALL_MATCH_FORMATS: [MatchFormat; 4] = [
    MatchFormat::BO1,
    MatchFormat::BO3,
    MatchFormat::BO5,
    MatchFormat::BO7,
];

impl MatchFormat {
    /// The wire spelling.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::BO1 => "BO1",
            Self::BO3 => "BO3",
            Self::BO5 => "BO5",
            Self::BO7 => "BO7",
        }
    }

    /// The N in best-of-N.
    pub const fn rounds(self) -> u8 {
        match self {
            Self::BO1 => 1,
            Self::BO3 => 3,
            Self::BO5 => 5,
            Self::BO7 => 7,
        }
    }
}

forgiving_deserialize!(MatchFormat, ALL_MATCH_FORMATS, |s| s.to_uppercase());

/// One of the three things a player can say at the end of a match, and the
/// whole vocabulary the game has.
///
/// A closed set, decided here and travelling as an identifier, because the
/// alternative is free text, and free text is a moderation surface: "we
/// collect nothing" is the compliance strategy, not an accident. Three is
/// enough to react to a match and too few to be abusive.
///
/// The words themselves are the client's (`t.emotes`), in the player's own
/// language. Nothing here is stored, logged or snapshotted: an emote is
/// broadcast, shown for a few seconds, and forgotten.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Emote {
    /// The one this exists for: a close 1v1 against a stranger and no way to
    /// say anything at all about it.
    Gg,
    /// That was close.
    Close,
    /// You got lucky, addressed to the table rather than to a seat: the
    /// needling one, and a closed set is what keeps it needling rather than
    /// abusive.
    Lucky,
}

/// Mirrors [`ALL_CARD_COLORS`]' contract. Read strictly, unlike the three
/// above: an identifier this server does not know is refused at decoding, so a
/// fourth emote cannot be invented by a client.
pub const ALL_EMOTES: [Emote; 3] = [Emote::Gg, Emote::Close, Emote::Lucky];

impl Emote {
    /// The wire spelling.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Gg => "gg",
            Self::Close => "close",
            Self::Lucky => "lucky",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wire<T: Serialize>(v: T) -> String {
        serde_json::to_string(&v).unwrap()
    }

    #[test]
    fn as_str_is_the_serde_spelling() {
        for c in ALL_CARD_COLORS {
            assert_eq!(wire(c), format!("\"{}\"", c.as_str()));
        }
        for k in ALL_CARD_KINDS {
            assert_eq!(wire(k), format!("\"{}\"", k.as_str()));
        }
        for f in ALL_MATCH_FORMATS {
            assert_eq!(wire(f), format!("\"{}\"", f.as_str()));
        }
        for e in ALL_EMOTES {
            assert_eq!(wire(e), format!("\"{}\"", e.as_str()));
        }
    }

    #[test]
    fn reading_is_as_forgiving_as_the_go_server() {
        let c: CardColor = serde_json::from_str("\"RED\"").unwrap();
        assert_eq!(c, CardColor::Red);
        let c: CardColor = serde_json::from_str("\"\"").unwrap();
        assert_eq!(c, CardColor::Wild);
        let k: CardKind = serde_json::from_str("\"Draw_Two\"").unwrap();
        assert_eq!(k, CardKind::DrawTwo);
        let f: MatchFormat = serde_json::from_str("\"bo5\"").unwrap();
        assert_eq!(f, MatchFormat::BO5);
        assert!(serde_json::from_str::<CardColor>("\"purple\"").is_err());
        assert!(serde_json::from_str::<CardKind>("\"\"").is_err());
        assert!(serde_json::from_str::<MatchFormat>("\"BO2\"").is_err());
    }

    #[test]
    fn an_emote_is_read_strictly() {
        assert!(serde_json::from_str::<Emote>("\"GG\"").is_err());
        assert!(serde_json::from_str::<Emote>("\"wp\"").is_err());
        assert_eq!(serde_json::from_str::<Emote>("\"gg\"").unwrap(), Emote::Gg);
    }
}
