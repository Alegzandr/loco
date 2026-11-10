//! The drain snapshot serialises `game.Room` directly (schema version 5), so
//! the Rust `Room` has to read what Go's `json.Marshal` wrote and write it back
//! in the same shape: Go's field names, colours and kinds as integers, instants
//! as RFC 3339 with Go's zero time for "never", nil slices as `null`.

use super::support::NOW;
use crate::card::{Color, Kind};
use crate::error::GameError;
use crate::event::EventKind;
use crate::maps::{MapId, TimeOfDay, Weather};
use crate::room::{Action, MatchFormat, Room, Status};
use serde_json::{Value, json};

/// A match in flight, written the way Go's encoder writes it: struct field
/// order, `GameEvent`'s json tags (`chosen_color` omitted for Red, `card`
/// omitted when nil), zero times, a nil `RoundHistory`.
fn go_playing_room() -> Value {
    let c =
        |color: i64, kind: i64, value: i64| json!({"Color": color, "Kind": kind, "Value": value});
    json!({
        "Code": "ABC234",
        "Status": 1,
        "Players": [{"Nickname": "alice", "Index": 0}, {"Nickname": "Étienne", "Index": 1}],
        "State": {
            "Hands": [
                {"Cards": [c(0, 0, 7), c(4, 4, 0)]},
                {"Cards": [c(2, 3, 0)]}
            ],
            "Deck": {"Cards": [c(1, 1, 0), c(3, 6, 0), c(4, 7, 0)]},
            "Discard": [c(0, 0, 3), c(0, 0, 5)],
            "CurrentTurn": 1,
            "Direction": -1,
            "ActiveColor": 0,
            "PendingDraw": 2,
            "HasDrawn": false,
            "LastCardDeclared": [false, false],
            "LastCardAt": ["0001-01-01T00:00:00Z", "2023-11-14T22:13:18.5Z"],
            "CatchPaidFor": ["", "1@1699999998500000000;"],
            "CatchLockedUntil": ["2023-11-14T22:13:22Z", "0001-01-01T00:00:00Z"],
            "NearLeftAt": ["0001-01-01T00:00:00Z", "2023-11-14T22:13:10.001Z"],
            "Retired": [false, false],
            "EventLog": [
                {"kind": "game_started", "player_index": -1, "at": "2023-11-14T22:12:00Z"},
                {"kind": "card_played", "player_index": 0, "card": c(0, 0, 5), "at": "2023-11-14T22:13:00.25Z"},
                {"kind": "card_played", "player_index": 1, "card": c(4, 4, 0), "chosen_color": 2, "at": "2023-11-14T22:13:05Z"}
            ],
            "InterruptOpen": true,
            "LastPlayBy": 0,
            "LastPlayAt": "2023-11-14T22:13:00.25Z"
        },
        "Winner": "",
        "Format": 3,
        "MaxPlayers": 7,
        "MapID": "orbit",
        "MapTime": "night",
        "MapWeather": "fog",
        "RoundNumber": 1,
        "Scores": [0, 0],
        "RoundsWon": [0, 0],
        "LostHandTotal": [0, 0],
        "Retired": [false, false],
        "RoundHistory": null,
        "RoundEnded": false,
        "MatchOver": false,
        "MatchWinner": ""
    })
}

#[test]
fn a_go_snapshot_room_round_trips() {
    let go = go_playing_room();
    let room: Room = serde_json::from_value(go.clone()).expect("Go-shaped Room decodes");

    assert_eq!(room.code, "ABC234");
    assert_eq!(room.status, Status::Playing);
    assert_eq!(room.players[1].nickname, "Étienne");
    assert_eq!(room.format, MatchFormat::BO3);
    assert_eq!(room.map_id, Some(MapId::Orbit));
    assert_eq!(room.map_time, Some(TimeOfDay::Night));
    assert_eq!(room.map_weather, Some(Weather::Fog));
    assert!(room.round_history.is_empty());
    let st = room.state.as_ref().unwrap();
    assert_eq!(st.hands[0].cards[1].kind, Kind::WildCard);
    assert_eq!(st.hands[0].cards[1].color, Color::Wild);
    assert_eq!(st.direction, -1);
    assert_eq!(st.last_card_at, vec![None, Some(1_699_999_998_500)]);
    assert_eq!(st.catch_locked_until[0], Some(1_700_000_002_000));
    assert_eq!(st.event_log[2].chosen_color, Color::Green);
    assert_eq!(st.event_log[0].card, None);
    assert_eq!(st.event_log[1].kind, EventKind::CardPlayed);

    let back = serde_json::to_value(&room).unwrap();
    assert_eq!(back, go, "the Rust room does not write Go's shape back");
}

#[test]
fn a_go_lobby_room_round_trips() {
    // A lobby: nothing dealt, nothing drawn, every match slice still nil.
    let go = json!({
        "Code": "LOBBY2", "Status": 0, "Players": null, "State": null, "Winner": "",
        "Format": 1, "MaxPlayers": 7, "MapID": "", "MapTime": "", "MapWeather": "",
        "RoundNumber": 0, "Scores": null, "RoundsWon": null, "LostHandTotal": null,
        "Retired": null, "RoundHistory": null, "RoundEnded": false, "MatchOver": false,
        "MatchWinner": ""
    });
    let room: Room = serde_json::from_value(go.clone()).unwrap();
    assert_eq!(room.status, Status::Lobby);
    assert!(room.state.is_none() && room.map_id.is_none() && room.players.is_empty());
    assert_eq!(serde_json::to_value(&room).unwrap(), go);
}

#[test]
fn go_instants_with_nanoseconds_and_offsets_truncate_to_the_millisecond() {
    let mut go = go_playing_room();
    go["State"]["LastPlayAt"] = json!("2023-11-14T23:13:00.250999999+01:00");
    let room: Room = serde_json::from_value(go).unwrap();
    // 22:13:00.250 UTC; NOW (1_700_000_000_000) is 22:13:20 UTC.
    assert_eq!(room.state.unwrap().last_play_at, Some(1_699_999_980_250));
}

#[test]
fn a_restored_room_is_unseeded_until_the_hub_reseeds_it() {
    // Go's rng was unexported, so no snapshot ever carried it; Rust's is never
    // serialised either. A restored room refuses to act until reseeded, rather
    // than dealing off a source nobody chose.
    let room: Room = serde_json::from_value(go_playing_room()).unwrap();
    assert!(!room.is_seeded());
    assert_eq!(
        room.apply(Action::DrawCard { seat: 1 }, NOW).unwrap_err(),
        GameError::Unseeded
    );
    let mut room = room;
    room.reseed([7; 32]);
    let (next, _) = room.apply(Action::DrawCard { seat: 1 }, NOW).unwrap();
    assert_eq!(
        next.state.unwrap().hands[1].size(),
        3,
        "the pending +2 was drawn"
    );
}

#[test]
fn a_rust_room_survives_its_own_round_trip() {
    let mut r = super::support::setup_three_player_game();
    r.retire_seat(2, NOW).unwrap();
    let json = serde_json::to_string(&r).unwrap();
    let mut back: Room = serde_json::from_str(&json).unwrap();
    back.rng = r.rng.clone();
    assert_eq!(back, r);
}
