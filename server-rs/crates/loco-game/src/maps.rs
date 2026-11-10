//! Maps: the room a match is played in, and the moment it is played at
//! (`server/game/maps.go`).
//!
//! A map is a scene, a table, an accent colour and a name. It changes no rule,
//! no card, no timing; the domain carries it purely so that the *choice* is the
//! server's: two seats describing two different tables to a viewer is a table
//! that does not exist. The client renders the scene from the three ids, so
//! every seat has to be handed the same three.
//!
//! `client/src/test/maps.test.ts` pins the client's registry to the lists
//! below, so they stay plain constant arrays.

use crate::rng;
use crate::room::Room;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// Defines a string-valued enum with `as_str`, `parse` and string serde.
macro_rules! string_enum {
    ($(#[$m:meta])* $t:ident { $($(#[$vm:meta])* $v:ident = $s:literal),* $(,)? }) => {
        $(#[$m])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
        pub enum $t { $($(#[$vm])* $v),* }

        impl $t {
            /// The wire spelling.
            pub const fn as_str(self) -> &'static str {
                match self { $($t::$v => $s),* }
            }

            /// Reads a wire spelling back; `None` for anything this server
            /// does not know.
            pub fn parse(s: &str) -> Option<$t> {
                match s { $($s => Some($t::$v),)* _ => None }
            }
        }

        impl std::fmt::Display for $t {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str(self.as_str())
            }
        }

        impl Serialize for $t {
            fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
                s.serialize_str(self.as_str())
            }
        }

        impl<'de> Deserialize<'de> for $t {
            fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
                let s = String::deserialize(d)?;
                $t::parse(&s).ok_or_else(|| serde::de::Error::custom(format!(
                    concat!("unknown ", stringify!($t), ": {}"), s
                )))
            }
        }
    };
}

string_enum!(
    /// The room a match is played in (Go: `MapID`).
    MapId {
        /// A rooftop terrace above a neon city.
        Neon = "neon",
        /// The square of a village around an arcane tavern.
        Rune = "rune",
        /// A boulevard of art-deco hotels and marquees.
        Velvet = "velvet",
        /// A base on an airless moon, under the home planet.
        Orbit = "orbit",
        /// A hot-spring village under cherry trees.
        Sakura = "sakura",
        /// A harbour front: pier, lighthouse, boats.
        Marina = "marina",
    }
);

string_enum!(
    /// The hour a match is dealt at (Go: `TimeOfDay`). Presentation only.
    TimeOfDay {
        Dawn = "dawn",
        Day = "day",
        Dusk = "dusk",
        Night = "night",
    }
);

string_enum!(
    /// The sky a match is dealt under (Go: `Weather`). Presentation only.
    Weather {
        Clear = "clear",
        Cloudy = "cloudy",
        Rain = "rain",
        Storm = "storm",
        Snow = "snow",
        Fog = "fog",
    }
);

/// Every map a match can be dealt into, and the list the draw reads (Go:
/// `MapIDs`).
pub const MAP_IDS: [MapId; 6] = [
    MapId::Neon,
    MapId::Rune,
    MapId::Velvet,
    MapId::Orbit,
    MapId::Sakura,
    MapId::Marina,
];

/// Every hour a match can be dealt at (Go: `TimesOfDay`).
pub const TIMES_OF_DAY: [TimeOfDay; 4] = [
    TimeOfDay::Dawn,
    TimeOfDay::Day,
    TimeOfDay::Dusk,
    TimeOfDay::Night,
];

/// Every weather any map can be dealt under (Go: `Weathers`).
pub const WEATHERS: [Weather; 6] = [
    Weather::Clear,
    Weather::Cloudy,
    Weather::Rain,
    Weather::Storm,
    Weather::Snow,
    Weather::Fog,
];

/// The weather each room can be dealt under, and the list its draw reads (Go:
/// `MapWeathers`). A room says what its sky can do: it does not snow on a moon
/// with no air. Every list is non-empty and carries `clear`.
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
    /// The skies this room can be dealt under (Go: `MapID.Weathers`).
    pub fn weathers(self) -> &'static [Weather] {
        MAP_WEATHERS
            .iter()
            .find(|(m, _)| *m == self)
            .map_or(&[], |(_, w)| *w)
    }
}

/// Whether `s` names a map this server can deal into (Go: `MapID.Valid`).
pub fn map_id_valid(s: &str) -> bool {
    MapId::parse(s).is_some()
}

/// Whether `s` names an hour (Go: `TimeOfDay.Valid`).
pub fn time_of_day_valid(s: &str) -> bool {
    TimeOfDay::parse(s).is_some()
}

/// Whether `s` names a weather (Go: `Weather.Valid`).
pub fn weather_valid(s: &str) -> bool {
    Weather::parse(s).is_some()
}

/// `Option<T>` as Go's string type, where `""` is "not drawn yet".
pub(crate) mod empty_is_none {
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    pub fn serialize<S: Serializer, T: Serialize>(v: &Option<T>, s: S) -> Result<S::Ok, S::Error> {
        match v {
            Some(t) => t.serialize(s),
            None => s.serialize_str(""),
        }
    }

    pub fn deserialize<'de, D, T>(d: D) -> Result<Option<T>, D::Error>
    where
        D: Deserializer<'de>,
        T: Deserialize<'de>,
    {
        let s = Option::<String>::deserialize(d)?.unwrap_or_default();
        if s.is_empty() {
            return Ok(None);
        }
        T::deserialize(serde::de::value::StrDeserializer::<D::Error>::new(&s)).map(Some)
    }
}

impl Room {
    /// Draws the room for a match, from the room's own source so a seeded room
    /// deals a reproducible map beside its reproducible hands. (Go: `pickMap`.)
    pub(crate) fn pick_map(&mut self) -> MapId {
        MAP_IDS[rng::below(self.rng_mut(), MAP_IDS.len())]
    }

    /// Draws the hour, from the same source. (Go: `pickTime`.)
    pub(crate) fn pick_time(&mut self) -> TimeOfDay {
        TIMES_OF_DAY[rng::below(self.rng_mut(), TIMES_OF_DAY.len())]
    }

    /// Draws the sky among the ones the room allows; clear for a map with no
    /// list. (Go: `pickWeather`.)
    pub(crate) fn pick_weather(&mut self, m: MapId) -> Weather {
        let list = m.weathers();
        if list.is_empty() {
            return Weather::Clear;
        }
        list[rng::below(self.rng_mut(), list.len())]
    }
}
