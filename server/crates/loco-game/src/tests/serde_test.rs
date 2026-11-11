//! The drain snapshot serialises the room as `SavedRoom`, in plain serde:
//! `snake_case` field names, colours and kinds as integers, instants as integer
//! `Millis`, "nobody" and "never" as `null`, one record per seat.
//! `SavedRoom` carries no source of randomness; `SavedRoom::restore` is handed
//! a fresh seed.

use super::support::NOW;
use crate::card::{Color, Kind};
use crate::event::EventKind;
use crate::maps::{MapId, TimeOfDay, Weather};
use crate::room::{MatchFormat, SavedRoom, Status};
use serde_json::{Value, json};

/// A match in flight, as this server writes it.
fn playing_room() -> Value {
    let c =
        |color: i64, kind: i64, value: i64| json!({"color": color, "kind": kind, "value": value});
    let seat = |declared: bool, last_card_at: Value, paid: &str, locked: Value, near: Value| {
        json!({
            "retired": false,
            "declared": declared,
            "last_card_at": last_card_at,
            "catch_paid_for": paid,
            "catch_locked_until": locked,
            "near_left_at": near,
        })
    };
    json!({
        "code": "ABC234",
        "status": 1,
        "seats": [
            {"nickname": "alice", "score": 0, "rounds_won": 0, "lost_hand_total": 14,
             "retired": false, "round_points": [0, 0]},
            {"nickname": "Étienne", "score": 31, "rounds_won": 2, "lost_hand_total": 0,
             "retired": false, "round_points": [14, 17]}
        ],
        "state": {
            "hands": [
                {"cards": [c(0, 0, 7), c(4, 4, 0)]},
                {"cards": [c(2, 3, 0)]}
            ],
            "deck": {"cards": [c(1, 1, 0), c(3, 6, 0), c(4, 7, 0)]},
            "discard": [c(0, 0, 3), c(0, 0, 5)],
            "current_turn": 1,
            "direction": -1,
            "active_color": 0,
            "pending_draw": 2,
            "has_drawn": false,
            "seats": [
                seat(false, json!(null), "", json!(1_700_000_002_000_i64), json!(null)),
                seat(false, json!(1_699_999_998_500_i64), "1@1699999998500;", json!(null), json!(1_699_999_990_001_i64)),
            ],
            "event_log": [
                {"kind": "game_started", "player": null, "card": null, "chosen_color": 0, "at": 1_699_999_920_000_i64},
                {"kind": "card_played", "player": 0, "card": c(0, 0, 5), "chosen_color": 0, "at": 1_699_999_980_250_i64},
                {"kind": "card_played", "player": 1, "card": c(4, 4, 0), "chosen_color": 2, "at": 1_699_999_985_000_i64}
            ],
            "interrupt_open": true,
            "last_play_by": 0,
            "last_play_at": 1_699_999_980_250_i64
        },
        "winner": "",
        "format": 3,
        "max_players": 7,
        "map_id": "orbit",
        "map_time": "night",
        "map_weather": "fog",
        "round_number": 3,
        "round_ended": false,
        "match_over": false,
        "match_winner": ""
    })
}

#[test]
fn a_snapshot_room_round_trips() {
    let raw = playing_room();
    let room: SavedRoom = serde_json::from_value(raw.clone()).expect("a saved room decodes");

    assert_eq!(room.code, "ABC234");
    assert_eq!(room.status, Status::Playing);
    assert_eq!(room.seats[1].nickname, "Étienne");
    assert_eq!(room.seats[1].round_points, vec![14, 17]);
    assert_eq!(room.format, MatchFormat::Bo3);
    assert_eq!(room.map_id, Some(MapId::Orbit));
    assert_eq!(room.map_time, Some(TimeOfDay::Night));
    assert_eq!(room.map_weather, Some(Weather::Fog));
    let st = room.state.as_ref().unwrap();
    assert_eq!(st.hands[0].cards[1].kind, Kind::WildCard);
    assert_eq!(st.hands[0].cards[1].color, Color::Wild);
    assert_eq!(st.direction, -1);
    let last_card_at: Vec<_> = st.seats.iter().map(|s| s.last_card_at).collect();
    assert_eq!(last_card_at, vec![None, Some(1_699_999_998_500)]);
    assert_eq!(st.seats[0].catch_locked_until, Some(1_700_000_002_000));
    assert_eq!(st.seats[1].catch_paid_for, "1@1699999998500;");
    assert_eq!(st.seats[1].near_left_at, Some(1_699_999_990_001));
    assert_eq!(st.last_play_by, Some(0));
    assert_eq!(st.last_play_at, Some(1_699_999_980_250));
    assert_eq!(st.event_log[0].player, None);
    assert_eq!(st.event_log[2].chosen_color, Color::Green);
    assert_eq!(st.event_log[0].card, None);
    assert_eq!(st.event_log[1].kind, EventKind::CardPlayed);

    let back = serde_json::to_value(&room).unwrap();
    assert_eq!(back, raw, "the room does not write back what it read");
}

#[test]
fn a_lobby_room_round_trips() {
    // A lobby: nothing dealt, nothing drawn, every match list still empty.
    let raw = json!({
        "code": "LOBBY2", "status": 0, "seats": [], "state": null, "winner": "",
        "format": 1, "max_players": 7, "map_id": null, "map_time": null, "map_weather": null,
        "round_number": 0, "round_ended": false, "match_over": false, "match_winner": ""
    });
    let room: SavedRoom = serde_json::from_value(raw.clone()).unwrap();
    assert_eq!(room.status, Status::Lobby);
    assert!(room.state.is_none() && room.map_id.is_none() && room.seats.is_empty());
    assert_eq!(serde_json::to_value(&room).unwrap(), raw);
}

#[test]
fn a_schema_5_room_does_not_decode() {
    // The shape before schema 6: PascalCase fields and RFC 3339 instants. The
    // hub's version gate drops such a file whole before it gets here; the room
    // refusing it too means nothing half-reads one.
    let old = json!({
        "Code": "ABC234", "Status": 1, "Players": null, "State": null, "Winner": "",
        "Format": 1, "MaxPlayers": 7, "MapID": "", "MapTime": "", "MapWeather": "",
        "RoundNumber": 0, "Scores": null, "RoundsWon": null, "LostHandTotal": null,
        "Retired": null, "RoundHistory": null, "RoundEnded": false, "MatchOver": false,
        "MatchWinner": ""
    });
    assert!(serde_json::from_value::<SavedRoom>(old).is_err());
}

#[test]
fn a_restored_room_plays_on_its_fresh_seed() {
    // The source of randomness never travels, and a room cannot exist without
    // one: the restore is handed the seed, and the room it returns acts at once.
    let saved: SavedRoom = serde_json::from_value(playing_room()).unwrap();
    let mut room = saved.clone().restore([7; 32]);
    assert_eq!(SavedRoom::from(&room), saved, "the restore moved a field");
    assert_eq!(
        room.round_history(),
        vec![vec![0, 14], vec![0, 17]],
        "the round history is not the seats' round points by round"
    );
    room.draw_card(1, NOW).expect("a restored room draws");
    let st = room.state.as_ref().unwrap();
    assert_eq!(st.hands[1].len(), 3, "the pending +2 was drawn");
    assert_eq!(st.pending_draw, 0);
    // The deck held three: two went to seat 1 without a replenish.
    assert_eq!(st.deck.cards.len(), 1);
}

#[test]
fn a_room_survives_its_own_round_trip() {
    let mut r = super::support::setup_three_player_game();
    r.retire_seat(2, NOW).unwrap();
    super::support::set_scores(&mut r, &[12, 0, 40]);
    let saved = SavedRoom::from(&r);
    let json = serde_json::to_string(&saved).unwrap();
    let back: SavedRoom = serde_json::from_str(&json).unwrap();
    assert_eq!(back, saved, "the snapshot does not read back what it wrote");

    // Restored with any seed, every public field is the live room's, and the
    // room saves back to the same snapshot.
    let restored = back.restore([9; 32]);
    assert_eq!(restored.code, r.code);
    assert_eq!(restored.status, r.status);
    assert_eq!(restored.seats(), r.seats());
    assert!(restored.is_retired(2), "the walk-out did not travel");
    assert_eq!(restored.state, r.state);
    assert_eq!(restored.winner, r.winner);
    assert_eq!(restored.format, r.format);
    assert_eq!(restored.max_players, r.max_players);
    assert_eq!(
        (restored.map_id, restored.map_time, restored.map_weather),
        (r.map_id, r.map_time, r.map_weather)
    );
    assert_eq!(restored.round_number, r.round_number);
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
