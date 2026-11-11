//! Maps: the room a match is played in, and the moment it is played at.
//!
//! A map is a scene, a table, an accent colour and a name. It changes no rule,
//! no card, no timing; the domain carries it purely so that the *choice* is the
//! server's: two seats describing two different tables to a viewer is a table
//! that does not exist. The client renders the scene from the three ids, so
//! every seat has to be handed the same three.
//!
//! `client/src/test/maps.test.ts` pins the client's registry to the lists
//! below and reads each id's spelling off `as_str`, so both stay plain.

use crate::rng;
use crate::room::Room;
use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;

/// A name that is not one of this server's maps, hours or skies.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("unknown {what}: {name}")]
pub struct UnknownName {
    pub what: &'static str,
    pub name: String,
}

/// The room a match is played in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MapId {
    /// A rooftop terrace above a neon city.
    Neon,
    /// The square of a village around an arcane tavern.
    Rune,
    /// A boulevard of art-deco hotels and marquees.
    Velvet,
    /// A base on an airless moon, under the home planet.
    Orbit,
    /// A hot-spring village under cherry trees.
    Sakura,
    /// A harbour front: pier, lighthouse, boats.
    Marina,
}

/// The hour a match is dealt at. Presentation only.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TimeOfDay {
    Dawn,
    Day,
    Dusk,
    Night,
}

/// The sky a match is dealt under. Presentation only.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Weather {
    Clear,
    Cloudy,
    Rain,
    Storm,
    Snow,
    Fog,
}

impl MapId {
    /// The wire spelling.
    pub const fn as_str(self) -> &'static str {
        match self {
            MapId::Neon => "neon",
            MapId::Rune => "rune",
            MapId::Velvet => "velvet",
            MapId::Orbit => "orbit",
            MapId::Sakura => "sakura",
            MapId::Marina => "marina",
        }
    }
}

impl TimeOfDay {
    /// The wire spelling.
    pub const fn as_str(self) -> &'static str {
        match self {
            TimeOfDay::Dawn => "dawn",
            TimeOfDay::Day => "day",
            TimeOfDay::Dusk => "dusk",
            TimeOfDay::Night => "night",
        }
    }
}

impl Weather {
    /// The wire spelling.
    pub const fn as_str(self) -> &'static str {
        match self {
            Weather::Clear => "clear",
            Weather::Cloudy => "cloudy",
            Weather::Rain => "rain",
            Weather::Storm => "storm",
            Weather::Snow => "snow",
            Weather::Fog => "fog",
        }
    }
}

/// `Display` and `FromStr` off `as_str` and the list of every value, so the
/// spelling is written once.
macro_rules! named {
    ($t:ident, $all:ident, $what:literal) => {
        impl fmt::Display for $t {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str(self.as_str())
            }
        }

        impl FromStr for $t {
            type Err = UnknownName;

            fn from_str(s: &str) -> Result<Self, Self::Err> {
                $all.into_iter()
                    .find(|v| v.as_str() == s)
                    .ok_or_else(|| UnknownName {
                        what: $what,
                        name: s.to_string(),
                    })
            }
        }
    };
}
named!(MapId, MAP_IDS, "map");
named!(TimeOfDay, TIMES_OF_DAY, "time of day");
named!(Weather, WEATHERS, "weather");
/// Every map a match can be dealt into, and the list the draw reads.
pub const MAP_IDS: [MapId; 6] = [
    MapId::Neon,
    MapId::Rune,
    MapId::Velvet,
    MapId::Orbit,
    MapId::Sakura,
    MapId::Marina,
];

/// Every hour a match can be dealt at.
pub const TIMES_OF_DAY: [TimeOfDay; 4] = [
    TimeOfDay::Dawn,
    TimeOfDay::Day,
    TimeOfDay::Dusk,
    TimeOfDay::Night,
];

/// Every weather any map can be dealt under.
pub const WEATHERS: [Weather; 6] = [
    Weather::Clear,
    Weather::Cloudy,
    Weather::Rain,
    Weather::Storm,
    Weather::Snow,
    Weather::Fog,
];

/// The weather each room can be dealt under, and the list its draw reads. A
/// room says what its sky can do: it does not snow on a moon with no air.
/// Every list is non-empty and carries `clear`.
pub const MAP_WEATHERS: [(MapId, &[Weather]); 6] = [
    (
        MapId::Neon,
        &[
            Weather::Clear,
            Weather::Cloudy,
            Weather::Rain,
            Weather::Storm,
            Weather::Snow,
            Weather::Fog,
        ],
    ),
    (
        MapId::Rune,
        &[
            Weather::Clear,
            Weather::Cloudy,
            Weather::Rain,
            Weather::Storm,
            Weather::Snow,
            Weather::Fog,
        ],
    ),
    (
        MapId::Velvet,
        &[
            Weather::Clear,
            Weather::Cloudy,
            Weather::Rain,
            Weather::Snow,
            Weather::Fog,
        ],
    ),
    (
        MapId::Orbit,
        &[Weather::Clear, Weather::Fog, Weather::Storm],
    ),
    (
        MapId::Sakura,
        &[
            Weather::Clear,
            Weather::Cloudy,
            Weather::Rain,
            Weather::Snow,
            Weather::Fog,
        ],
    ),
    (
        MapId::Marina,
        &[
            Weather::Clear,
            Weather::Cloudy,
            Weather::Rain,
            Weather::Storm,
            Weather::Fog,
        ],
    ),
];

impl MapId {
    /// The skies this room can be dealt under. Every map
    /// has a list, which `maps_test` pins.
    pub fn weathers(self) -> &'static [Weather] {
        MAP_WEATHERS
            .iter()
            .find(|(m, _)| *m == self)
            .map(|(_, w)| *w)
            .expect("every map has its weathers")
    }
}

impl Room {
    /// Draws the room for a match, from the room's own source so a seeded room
    /// deals a reproducible map beside its reproducible hands.
    pub(crate) fn pick_map(&mut self) -> MapId {
        MAP_IDS[rng::below(self.rng_mut(), MAP_IDS.len())]
    }

    /// Draws the hour, from the same source.
    pub(crate) fn pick_time(&mut self) -> TimeOfDay {
        TIMES_OF_DAY[rng::below(self.rng_mut(), TIMES_OF_DAY.len())]
    }

    /// Draws the sky among the ones the room allows.
    pub(crate) fn pick_weather(&mut self, m: MapId) -> Weather {
        let list = m.weathers();
        list[rng::below(self.rng_mut(), list.len())]
    }
}
