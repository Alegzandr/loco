//! The drain snapshot serialises `game.Room` directly (schema version 5), so
//! the Rust `SavedRoom` has to read what Go's `json.Marshal` wrote and write it
//! back in the same shape: Go's field names, colours and kinds as integers,
//! instants as RFC 3339 with Go's zero time for "never", nil slices as `null`.
//! `SavedRoom` carries no source of randomness, exactly as Go's unexported
//! `rng` was never written; `SavedRoom::restore` is handed a fresh seed.

use super::support::NOW;
use crate::card::{Color, Kind};
use crate::event::EventKind;
use crate::maps::{MapId, TimeOfDay, Weather};
use crate::room::{MatchFormat, SavedRoom, Status};
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
    let room: SavedRoom = serde_json::from_value(go.clone()).expect("Go-shaped Room decodes");

    assert_eq!(room.code, "ABC234");
    assert_eq!(room.status, Status::Playing);
    assert_eq!(room.players[1].nickname, "Étienne");
    assert_eq!(room.format, MatchFormat::Bo3);
    assert_eq!(room.map_id, Some(MapId::Orbit));
    assert_eq!(room.map_time, Some(TimeOfDay::Night));
    assert_eq!(room.map_weather, Some(Weather::Fog));
    assert!(room.round_history.is_empty());
    let st = room.state.as_ref().unwrap();
    assert_eq!(st.hands[0].cards[1].kind, Kind::WildCard);
    assert_eq!(st.hands[0].cards[1].color, Color::Wild);
    assert_eq!(st.direction, -1);
    let last_card_at: Vec<_> = st.seats.iter().map(|s| s.last_card_at).collect();
    assert_eq!(last_card_at, vec![None, Some(1_699_999_998_500)]);
    assert_eq!(st.seats[0].catch_locked_until, Some(1_700_000_002_000));
    assert_eq!(st.seats[1].catch_paid_for, "1@1699999998500000000;");
    assert_eq!(st.seats[1].near_left_at, Some(1_699_999_990_001));
    assert_eq!(st.last_play_by, Some(0));
    assert_eq!(st.event_log[0].player, None);
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
    let room: SavedRoom = serde_json::from_value(go.clone()).unwrap();
    assert_eq!(room.status, Status::Lobby);
    assert!(room.state.is_none() && room.map_id.is_none() && room.players.is_empty());
    assert_eq!(serde_json::to_value(&room).unwrap(), go);
}

#[test]
fn go_instants_with_nanoseconds_and_offsets_truncate_to_the_millisecond() {
    let mut go = go_playing_room();
    go["State"]["LastPlayAt"] = json!("2023-11-14T23:13:00.250999999+01:00");
    let room: SavedRoom = serde_json::from_value(go).unwrap();
    // 22:13:00.250 UTC; NOW (1_700_000_000_000) is 22:13:20 UTC.
    assert_eq!(room.state.unwrap().last_play_at, Some(1_699_999_980_250));
}

#[test]
fn a_restored_room_plays_on_its_fresh_seed() {
    // Go's rng was unexported, so no snapshot ever carried it, and a Rust room
    // cannot exist without one: the restore is handed the seed, and the room
    // it returns acts at once.
    let saved: SavedRoom = serde_json::from_value(go_playing_room()).unwrap();
    let mut room = saved.clone().restore([7; 32]);
    assert_eq!(SavedRoom::from(&room), saved, "the restore moved a field");
    room.draw_card(1, NOW).expect("a restored room draws");
    let st = room.state.as_ref().unwrap();
    assert_eq!(st.hands[1].len(), 3, "the pending +2 was drawn");
    assert_eq!(st.pending_draw, 0);
    // The deck held three: two went to seat 1 without a replenish.
    assert_eq!(st.deck.cards.len(), 1);
}

#[test]
fn a_rust_room_survives_its_own_round_trip() {
    let mut r = super::support::setup_three_player_game();
    r.retire_seat(2, NOW).unwrap();
    let saved = SavedRoom::from(&r);
    let json = serde_json::to_string(&saved).unwrap();
    let back: SavedRoom = serde_json::from_str(&json).unwrap();
    assert_eq!(back, saved, "the snapshot does not read back what it wrote");

    // Restored with any seed, every public field is the live room's, and the
    // room saves back to the same snapshot.
    let restored = back.restore([9; 32]);
    assert_eq!(restored.code, r.code);
    assert_eq!(restored.status, r.status);
    assert_eq!(restored.players, r.players);
    assert_eq!(restored.state, r.state);
    assert_eq!(restored.winner, r.winner);
    assert_eq!(restored.format, r.format);
    assert_eq!(restored.max_players, r.max_players);
    assert_eq!(
        (restored.map_id, restored.map_time, restored.map_weather),
        (r.map_id, r.map_time, r.map_weather)
    );
    assert_eq!(restored.round_number, r.round_number);
    assert_eq!(restored.scores, r.scores);
    assert_eq!(restored.rounds_won, r.rounds_won);
    assert_eq!(restored.lost_hand_total, r.lost_hand_total);
    assert_eq!(restored.retired, r.retired);
    assert_eq!(restored.round_history, r.round_history);
    assert_eq!(
        (
            restored.round_ended,
            restored.match_over,
            &restored.match_winner
        ),
        (r.round_ended, r.match_over, &r.match_winner)
    );
    assert_eq!(SavedRoom::from(&restored), saved);
}
