//! Ported from `server/game/maps_test.go`. `startedRoom` lives in
//! `support.rs` as `started_room`.
//!
//! Go's `MapID`, `TimeOfDay` and `Weather` were strings, so an unknown id was a
//! value of the type. Here they are enums and an unknown id never parses: the
//! Go cases on `MapID("atlantis")` become "it does not parse".

use super::support::*;
use crate::maps::{
    self, MAP_IDS, MAP_WEATHERS, MapId, TIMES_OF_DAY, Weather, time_of_day_valid, weather_valid,
};
use crate::room::{MatchFormat, Status};
use std::collections::HashSet;

fn map_valid(r: &crate::room::Room) -> bool {
    r.map_id.is_some_and(|m| maps::map_id_valid(m.as_str()))
}

#[test]
fn start_draws_a_valid_map() {
    let r = started_room(&["Alice", "Bob"]);
    assert!(
        map_valid(&r),
        "MapID = {:?}, want one of {MAP_IDS:?}",
        r.map_id
    );
}

// A lobby has no map. The client falls back to the built-in felt for an empty
// id, and the loading gate has nothing to wait for before a match exists.
#[test]
fn new_room_has_no_map_until_started() {
    let r = new_room("MAPTST");
    assert!(
        r.map_id.is_none(),
        "MapID = {:?} on a fresh lobby, want empty",
        r.map_id
    );
}

// The map is the room the whole match is played in. Redrawing it between rounds
// would move the table under the players mid-match and read as a bug.
#[test]
fn begin_next_round_keeps_the_map() {
    let mut r = new_room("MAPTST");
    for name in ["Alice", "Bob"] {
        must_join(&mut r, name);
    }
    // BO3: the default BO1 ends the match on the round we are about to finish,
    // and there would be no next round to check.
    r.set_format(MatchFormat::BO3)
        .unwrap_or_else(|e| panic!("SetFormat: {e}"));
    r.start(NOW).unwrap_or_else(|e| panic!("Start: {e}"));
    let first = r.map_id;
    // Force a round end so the room is allowed to deal the next one.
    r.end_round(0, NOW);
    assert!(!r.match_over, "BO3 should not be over after one round");
    r.begin_next_round(NOW)
        .unwrap_or_else(|e| panic!("BeginNextRound: {e}"));
    assert_eq!(
        r.map_id, first,
        "MapID = {:?} after round 2, want it to stay {first:?}",
        r.map_id
    );
}

// A rematch is a new match, so it gets a new room, and just as importantly a
// map the clients may not have downloaded yet, which is what re-arms the loading
// gate. Keeping the old id would silently skip that.
#[test]
fn reset_for_rematch_clears_the_map() {
    let mut r = started_room(&["Alice", "Bob"]);
    r.status = Status::Finished;
    r.reset_for_rematch()
        .unwrap_or_else(|e| panic!("ResetForRematch: {e}"));
    assert!(
        r.map_id.is_none(),
        "MapID = {:?} after a rematch reset, want empty",
        r.map_id
    );
    r.start(NOW)
        .unwrap_or_else(|e| panic!("Start after rematch: {e}"));
    assert!(
        map_valid(&r),
        "MapID = {:?} after restarting, want a fresh valid map",
        r.map_id
    );
}

#[test]
fn map_id_valid() {
    for id in MAP_IDS {
        assert!(
            maps::map_id_valid(id.as_str()),
            "{id:?} is in MapIDs but reports invalid"
        );
    }
    for id in ["", "atlantis", "Neon", "neon "] {
        assert!(!maps::map_id_valid(id), "{id:?} reports valid");
    }
}

// Every registered map must actually be drawable: an id listed but never
// returned would be a room nobody ever plays in, and the miss would be silent.
#[test]
fn pick_map_reaches_every_map() {
    let mut seen = HashSet::new();
    let mut r = new_room("MAPTST");
    for _ in 0..400 {
        seen.insert(r.pick_map());
    }
    for id in MAP_IDS {
        assert!(
            seen.contains(&id),
            "pickMap never returned {id:?} in 400 draws"
        );
    }
    assert_eq!(
        seen.len(),
        MAP_IDS.len(),
        "pickMap returned {} distinct maps, want {}",
        seen.len(),
        MAP_IDS.len()
    );
}

// The hour and the sky are drawn with the map, and a match dealt without either
// is a scene the client cannot render the same way for every seat.
#[test]
fn start_draws_an_hour_and_a_sky() {
    let r = started_room(&["Alice", "Bob"]);
    assert!(
        r.map_time.is_some_and(|t| time_of_day_valid(t.as_str())),
        "MapTime = {:?}, want one of {TIMES_OF_DAY:?}",
        r.map_time
    );
    assert!(
        r.map_weather.is_some_and(|w| weather_valid(w.as_str())),
        "MapWeather = {:?}, want one of {:?}",
        r.map_weather,
        maps::WEATHERS
    );
}

// A lobby has no hour and no sky, for the reason it has no map.
#[test]
fn new_room_has_no_scene_until_started() {
    let r = new_room("MAPTST");
    assert!(
        r.map_time.is_none() && r.map_weather.is_none(),
        "fresh lobby carries time={:?} weather={:?}, want both empty",
        r.map_time,
        r.map_weather
    );
}

// Rain does not stop between two rounds of the same match, and the sun does not
// set: the scene is the match's, exactly as the map is.
#[test]
fn begin_next_round_keeps_the_hour_and_the_sky() {
    let mut r = new_room("MAPTST");
    for name in ["Alice", "Bob"] {
        must_join(&mut r, name);
    }
    r.set_format(MatchFormat::BO3)
        .unwrap_or_else(|e| panic!("SetFormat: {e}"));
    r.start(NOW).unwrap_or_else(|e| panic!("Start: {e}"));
    let (first_time, first_weather) = (r.map_time, r.map_weather);
    r.end_round(0, NOW);
    r.begin_next_round(NOW)
        .unwrap_or_else(|e| panic!("BeginNextRound: {e}"));
    assert!(
        r.map_time == first_time && r.map_weather == first_weather,
        "round 2 dealt at {:?}/{:?}, want the match's {first_time:?}/{first_weather:?}",
        r.map_time,
        r.map_weather
    );
}

// A rematch clears the whole scene: a new match at the same hour under the same
// sky in the same room would read as nothing having happened.
#[test]
fn reset_for_rematch_clears_the_hour_and_the_sky() {
    let mut r = started_room(&["Alice", "Bob"]);
    r.status = Status::Finished;
    r.reset_for_rematch()
        .unwrap_or_else(|e| panic!("ResetForRematch: {e}"));
    assert!(
        r.map_time.is_none() && r.map_weather.is_none(),
        "after reset time={:?} weather={:?}, want both empty",
        r.map_time,
        r.map_weather
    );
}

// Every room lists what its sky can do, every list is dealt clear at least, and
// nothing a list names is a weather the server does not have. The client's
// registry mirrors these lists and `maps.test.ts` pins it to this file, so a
// weather a map lists here is a weather the client can draw for it.
#[test]
fn map_weathers_cover_every_map() {
    for id in MAP_IDS {
        let list = id.weathers();
        assert!(!list.is_empty(), "{id:?} lists no weather");
        let mut clear = false;
        for &w in list {
            assert!(
                weather_valid(w.as_str()),
                "{id:?} lists {w:?}, which is not a weather"
            );
            if w == Weather::Clear {
                clear = true;
            }
        }
        assert!(clear, "{id:?} cannot be dealt clear");
    }
    for (id, _) in MAP_WEATHERS {
        assert!(
            maps::map_id_valid(id.as_str()),
            "MapWeathers names {id:?}, which is not a map"
        );
    }
    // Go: `MapID("atlantis").Weathers() == nil`. An unknown id is not a
    // `MapId` here, so the nearest statement is that it never becomes one.
    assert!(
        MapId::parse("atlantis").is_none(),
        "an unknown map should list no weather"
    );
}

// The sky a match is dealt under has to be one the room allows: it does not
// snow on the moon.
#[test]
fn pick_weather_stays_inside_the_maps_list() {
    let mut r = new_room("MAPTST");
    for id in MAP_IDS {
        let allowed: HashSet<Weather> = id.weathers().iter().copied().collect();
        let mut seen = HashSet::new();
        for _ in 0..300 {
            let w = r.pick_weather(id);
            assert!(
                allowed.contains(&w),
                "{id:?} dealt {w:?}, which it does not list"
            );
            seen.insert(w);
        }
        for w in &allowed {
            assert!(seen.contains(w), "{id:?} never dealt {w:?} in 300 draws");
        }
    }
    // Go: `pickWeather(MapID("atlantis")) == WeatherClear`. An unknown id
    // cannot reach `pick_weather` (it is not a `MapId`), so the guard it
    // exercised is the empty-list branch, which no registered map takes.
    assert!(
        MapId::parse("atlantis").is_none(),
        "an unknown map parsed into a MapId"
    );
}

// Same discipline as the map: an hour listed but never drawn is a sky nobody
// ever plays under.
#[test]
fn pick_time_reaches_every_hour() {
    let mut seen = HashSet::new();
    let mut r = new_room("MAPTST");
    for _ in 0..300 {
        seen.insert(r.pick_time());
    }
    for h in TIMES_OF_DAY {
        assert!(
            seen.contains(&h),
            "pickTime never returned {h:?} in 300 draws"
        );
    }
}

#[test]
fn time_and_weather_valid() {
    for bad in ["", "noon", "Day", "day "] {
        assert!(!time_of_day_valid(bad), "time {bad:?} reports valid");
        assert!(!weather_valid(bad), "weather {bad:?} reports valid");
    }
}
