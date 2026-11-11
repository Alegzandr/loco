//! Port of `server/hub/match_history_test.go`.
//!
//! The evening's recap: one row per finished match, kept across the rematch
//! that wipes the scoreboard. Without it a group playing six matches on one
//! table ends up with nobody able to say who won.

mod common_b;

use common_b::*;
use loco_hub::testkit::*;
use serde_json::json;

#[tokio::test]
async fn match_history_first_match_is_one_row() {
    let th = new_test_hub_with(debug_cfg()).await;
    let (mut conns, _, _) = open_table(&th, &["Alice", "Bob"]).await;
    let (host, rest) = conns.split_first_mut().unwrap();
    let end = win_match_from_host_turn(host, &mut [&mut rest[0]]).await;

    let rec = &end["match_history"];
    assert_eq!(len_of(rec), 1, "{end}");
    assert_eq!(rec[0]["winner_index"], 0);
    assert_eq!(ints(&rec[0]["rounds_won"]), vec![1, 0]);
    assert_eq!(len_of(&rec[0]["scores"]), 2);
    th.stop().await;
}

// The record says how long the match was played. It is measured on the server
// from the moment the table opened (match_ready), so a reload at the game-over
// screen and a deploy in the middle of the match both keep the same number.
#[tokio::test]
async fn match_history_records_how_long_the_match_took() {
    let th = new_test_hub_with(debug_cfg()).await;
    let (mut conns, _, _) = open_table(&th, &["Alice", "Bob"]).await;
    let (host, rest) = conns.split_first_mut().unwrap();
    let end = win_match_from_host_turn(host, &mut [&mut rest[0]]).await;

    assert_eq!(len_of(&end["match_history"]), 1);
    // At least one: zero is "cannot say", and this match was played.
    let got = end["match_history"][0]["duration_ms"].as_i64().unwrap_or(0);
    assert!(got >= 1, "duration_ms = {got}, want at least 1");
    th.stop().await;
}

// The one that matters: a rematch empties the room's scores, and the recap has
// to outlive that.
#[tokio::test]
async fn match_history_survives_a_rematch() {
    let th = new_test_hub_with(debug_cfg()).await;
    let (conns, _, _) = won_table(&th, &["Alice", "Bob"]).await;
    let mut it = conns.into_iter();
    let (mut conn1, mut conn2) = (it.next().unwrap(), it.next().unwrap());

    send_msg(&mut conn1, json!({"type": "rematch"})).await;
    read_msg_of_type(&mut conn1, "rematch_offered").await;
    read_msg_of_type(&mut conn2, "rematch_offered").await;
    send_msg(&mut conn2, json!({"type": "rematch"})).await;
    read_msg_of_type(&mut conn1, "rematch_started").await;
    read_msg_of_type(&mut conn2, "rematch_started").await;

    send_msg(&mut conn1, json!({"type": "start_game"})).await;
    read_msg_of_type(&mut conn1, "game_started").await;
    read_msg_of_type(&mut conn2, "game_started").await;
    complete_map_load(&mut [&mut conn1, &mut conn2]).await;

    // Second match, won by the same seat. The scoreboard restarted; the recap
    // must not have.
    let end = win_match_from_host_turn(&mut conn1, &mut [&mut conn2]).await;
    assert_eq!(len_of(&end["match_history"]), 2, "{end}");
    for (i, row) in end["match_history"].as_array().unwrap().iter().enumerate() {
        assert_eq!(row["winner_index"], 0, "row {i}");
    }
    // And the live scoreboard is this match alone, exactly as before.
    for e in end["scoreboard"].as_array().into_iter().flatten() {
        assert!(
            e["rounds_won"].as_i64().unwrap_or(0) <= 1,
            "scoreboard leaked across the rematch: {e}"
        );
    }
    th.stop().await;
}

// A seat that leaves takes its column with it, and the seats above it re-base.
// Same rule as the tokens, the bots and the gone set: they never shift apart.
#[tokio::test]
async fn match_history_follows_a_seat_leaving() {
    let th = new_test_hub_with(debug_cfg()).await;
    let (conns, _, _) = won_table(&th, &["Alice", "Bob", "Carol"]).await;
    let mut it = conns.into_iter();
    let (mut conn1, mut conn2, mut conn3) =
        (it.next().unwrap(), it.next().unwrap(), it.next().unwrap());

    // Bob (seat 1) leaves the finished table; the recap must re-base onto two
    // seats with Carol's column intact.
    send_msg(&mut conn2, json!({"type": "leave_room"})).await;
    read_msg_of_type(&mut conn2, "left_room").await;
    read_msg_of_type(&mut conn1, "player_left").await;
    read_msg_of_type(&mut conn3, "player_left").await;

    send_msg(&mut conn1, json!({"type": "rematch"})).await;
    read_msg_of_type(&mut conn1, "rematch_offered").await;
    read_msg_of_type(&mut conn3, "rematch_offered").await;
    send_msg(&mut conn3, json!({"type": "rematch"})).await;
    read_msg_of_type(&mut conn1, "rematch_started").await;
    read_msg_of_type(&mut conn3, "rematch_started").await;

    send_msg(&mut conn1, json!({"type": "start_game"})).await;
    read_msg_of_type(&mut conn1, "game_started").await;
    read_msg_of_type(&mut conn3, "game_started").await;
    complete_map_load(&mut [&mut conn1, &mut conn3]).await;

    let end = win_match_from_host_turn(&mut conn1, &mut [&mut conn3]).await;
    let rows = end["match_history"].as_array().expect("match_history");
    assert_eq!(rows.len(), 2);
    for (i, row) in rows.iter().enumerate() {
        assert!(
            len_of(&row["rounds_won"]) == 2 && len_of(&row["scores"]) == 2,
            "row {i}: {row}, want 2 seats (the departed column should be gone)"
        );
    }
    assert_eq!(rows[0]["winner_index"], 0);
    th.stop().await;
}

// The recap is indexed by seat, and a departure re-bases the seats under it.
// The message that re-bases the roster carries the re-based recap with it —
// otherwise every row on the game-over screen slides one column.
#[tokio::test]
async fn match_history_rides_the_player_left_that_rebases_the_roster() {
    let th = new_test_hub_with(debug_cfg()).await;
    let (mut conns, _, _) = won_table(&th, &["Alice", "Bob", "Carol"]).await;

    send_msg(&mut conns[1], json!({"type": "leave_room"})).await;
    read_msg_of_type(&mut conns[1], "left_room").await;

    for i in [0, 2] {
        let left = read_msg_of_type(&mut conns[i], "player_left").await;
        assert_eq!(
            len_of(&left["match_history"]),
            1,
            "client {i}: player_left recap rows: {left}"
        );
        let row = &left["match_history"][0];
        assert!(
            len_of(&row["rounds_won"]) == 2 && len_of(&row["scores"]) == 2,
            "client {i}: recap row {row} — the departed column is still in it"
        );
        assert_eq!(row["winner_index"], 0, "client {i}");
    }
    th.stop().await;
}
