//! The map-loading gate between `game_started` and the first move.

#![allow(clippy::field_reassign_with_default)] // a test narrows one knob of the default config

use loco_game::{TimeOfDay, Weather};
use loco_hub::HubConfig;
use loco_hub::testkit::*;
use serde_json::json;
use std::time::Duration;

/// Creates a room, joins a second human and starts the match, returning both
/// connections with the table still shut.
async fn two_humans_at_start(th: &TestHub) -> (Ws, Ws) {
    let mut conn1 = dial_ws(th).await;
    send_msg(
        &mut conn1,
        json!({"type": "create_room", "nickname": "Alice"}),
    )
    .await;
    let created = read_msg_of_type(&mut conn1, "room_created").await;

    let mut conn2 = dial_ws(th).await;
    send_msg(
        &mut conn2,
        json!({"type": "join_room", "nickname": "Bob", "room_code": created["room_code"]}),
    )
    .await;
    read_msg_of_type(&mut conn2, "room_joined").await;
    read_msg_of_type(&mut conn1, "player_joined").await;

    send_msg(&mut conn1, json!({"type": "start_game"})).await;
    read_msg_of_type(&mut conn1, "game_started").await;
    read_msg_of_type(&mut conn2, "game_started").await;
    (conn1, conn2)
}

/// Alice alone with a bot, the match dealt and the gate still shut.
async fn alone_with_a_bot(th: &TestHub) -> (Ws, serde_json::Value) {
    let mut conn = dial_ws(th).await;
    send_msg(
        &mut conn,
        json!({"type": "create_room", "nickname": "Alice"}),
    )
    .await;
    read_msg_of_type(&mut conn, "room_created").await;
    send_msg(&mut conn, json!({"type": "add_bot"})).await;
    read_msg_of_type(&mut conn, "player_joined").await;
    send_msg(&mut conn, json!({"type": "start_game"})).await;
    let started = read_msg_of_type(&mut conn, "game_started").await;
    (conn, started)
}

async fn assert_gated(conn: &mut Ws, why: &str) {
    let e = read_msg_of_type(conn, "error").await;
    let msg = e["error"].as_str().unwrap_or_default();
    assert!(msg.contains("load the table"), "error = {msg:?}, {why}");
}

/// Ends a BO1 from the host's turn, for a host alone with a bot.
async fn win_match_from_host_turn(host: &mut Ws) {
    let win = json!({"color": "red", "kind": "number", "value": 7});
    send_msg(
        host,
        json!({"type": "debug_set_state", "debug": {
            "hand": [win],
            "discard": {"color": "red", "kind": "number", "value": 7},
            "pending_draw": 0,
            "current_turn": 0
        }}),
    )
    .await;
    read_msg_of_type(host, "game_state").await;
    declare_before_winning(host).await;
    send_msg(host, json!({"type": "play_card", "card": win})).await;
    read_msg_of_type(host, "match_end").await;
}

// The map has to reach the client, and it has to reach it in the snapshot
// rather than only in game_started: a player who reconnects mid-match must
// rebuild the same room as everybody else.
#[tokio::test]
async fn map_id_rides_the_game_state() {
    let th = new_test_hub().await;
    let (mut conn, started) = alone_with_a_bot(&th).await;
    let state = &started["state"];
    assert!(state.is_object(), "game_started missing state");
    assert!(
        state["map_id"].as_str().is_some_and(|s| !s.is_empty()),
        "game_started carries no map_id"
    );
    // The hour and the sky travel with it: the client renders the scene from
    // the three ids.
    let hour = state["time_of_day"].as_str().unwrap_or_default();
    assert!(
        hour.parse::<TimeOfDay>().is_ok(),
        "game_started carries time_of_day={hour:?}, want a valid hour"
    );
    let sky = state["weather"].as_str().unwrap_or_default();
    assert!(
        sky.parse::<Weather>().is_ok(),
        "game_started carries weather={sky:?}, want a valid sky"
    );
    complete_map_load(&mut [&mut conn]).await;
    th.stop().await;
}

// Every seat must be told the same room. Two players describing two different
// tables to a viewer is a table that does not exist.
#[tokio::test]
async fn map_id_is_the_same_for_every_seat() {
    let th = new_test_hub().await;
    let mut conn1 = dial_ws(&th).await;
    send_msg(
        &mut conn1,
        json!({"type": "create_room", "nickname": "Alice"}),
    )
    .await;
    let created = read_msg_of_type(&mut conn1, "room_created").await;
    let mut conn2 = dial_ws(&th).await;
    send_msg(
        &mut conn2,
        json!({"type": "join_room", "nickname": "Bob", "room_code": created["room_code"]}),
    )
    .await;
    read_msg_of_type(&mut conn2, "room_joined").await;
    read_msg_of_type(&mut conn1, "player_joined").await;

    send_msg(&mut conn1, json!({"type": "start_game"})).await;
    let gs1 = read_msg_of_type(&mut conn1, "game_started").await;
    let gs2 = read_msg_of_type(&mut conn2, "game_started").await;
    let (s1, s2) = (&gs1["state"], &gs2["state"]);
    assert!(
        s1.is_object() && s2.is_object(),
        "game_started missing state"
    );
    assert!(
        s1["time_of_day"] == s2["time_of_day"] && s1["weather"] == s2["weather"],
        "two seats dealt under two skies: {}/{} vs {}/{}",
        s1["time_of_day"],
        s1["weather"],
        s2["time_of_day"],
        s2["weather"]
    );
    assert_eq!(s1["map_id"], s2["map_id"], "every seat plays in one room");
    complete_map_load(&mut [&mut conn1, &mut conn2]).await;
    th.stop().await;
}

// The gate's whole point: a client that skips its own loading screen must not
// be the only one able to act while everybody else is still downloading.
#[tokio::test]
async fn map_loading_refuses_gameplay_until_the_table_opens() {
    let th = new_test_hub().await;
    let (mut conn1, mut conn2) = two_humans_at_start(&th).await;

    send_msg(&mut conn1, json!({"type": "draw_card"})).await;
    assert_gated(&mut conn1, "want a refusal naming the loading table").await;

    complete_map_load(&mut [&mut conn1, &mut conn2]).await;
    th.stop().await;
}

// One arrival is not enough: the table waits for the last one.
#[tokio::test]
async fn map_loading_waits_for_every_seat() {
    let th = new_test_hub().await;
    let (mut conn1, mut conn2) = two_humans_at_start(&th).await;

    send_msg(&mut conn1, json!({"type": "map_ready"})).await;
    let mut progress = read_msg_of_type(&mut conn1, "match_loading").await;
    // The first broadcast (nobody ready) may still be in the pipe; walk to the
    // one that names seat 0.
    let ready = |p: &serde_json::Value| p["players_ready"].as_array().cloned().unwrap_or_default();
    for _ in 0..5 {
        if !ready(&progress).is_empty() {
            break;
        }
        progress = read_msg_of_type(&mut conn1, "match_loading").await;
    }
    assert_eq!(
        ready(&progress),
        vec![json!(0)],
        "players_ready, want just seat 0"
    );

    // Still shut: Bob has not answered.
    send_msg(&mut conn1, json!({"type": "draw_card"})).await;
    assert_gated(&mut conn1, "want the table to still be shut").await;

    send_msg(&mut conn2, json!({"type": "map_ready"})).await;
    read_msg_of_type(&mut conn1, "match_ready").await;
    read_msg_of_type(&mut conn2, "match_ready").await;
    th.stop().await;
}

// A bot has nothing to download, so a human alone with bots never waits.
#[tokio::test]
async fn map_loading_bots_are_ready_immediately() {
    let th = new_test_hub().await;
    let (mut conn, _) = alone_with_a_bot(&th).await;
    send_msg(&mut conn, json!({"type": "map_ready"})).await;

    let ready = read_msg_of_type(&mut conn, "match_ready").await;
    // The clock is only armed for a human seat: bots keep their own timing, so
    // a round the bot opens has no deadline to report.
    let turn = ready["turn"].as_i64().unwrap_or(-1);
    let deadline = ready["turn_deadline"].as_i64().unwrap_or(0);
    if turn == 0 {
        assert_ne!(
            deadline, 0,
            "match_ready opens on the human's turn but carries no turn deadline"
        );
    } else {
        assert_eq!(
            deadline, 0,
            "match_ready opens on the bot's turn with a deadline; bots run their own clock"
        );
    }
    th.stop().await;
}

// One tab thrown into the background must not hold nine other people on a
// loading screen. The table starts without it.
#[tokio::test]
async fn map_loading_timeout_opens_the_table_anyway() {
    let mut c = HubConfig::default();
    c.timings.map_load_timeout = Duration::from_millis(120);
    let th = new_test_hub_with(c).await;
    let (mut conn1, mut conn2) = two_humans_at_start(&th).await;

    // Only Alice answers. Bob never does.
    send_msg(&mut conn1, json!({"type": "map_ready"})).await;

    read_msg_of_type(&mut conn1, "match_ready").await;
    read_msg_of_type(&mut conn2, "match_ready").await;
    th.stop().await;
}

// A seat that leaves during the gate stops being a seat the table waits on;
// otherwise the room sits out the full timeout for a player who is gone.
#[tokio::test]
async fn map_loading_disconnect_stops_blocking_the_table() {
    // Long enough that a pass would have to come from the disconnect path, not
    // from the deadline quietly rescuing the test.
    let mut c = HubConfig::default();
    c.timings.map_load_timeout = Duration::from_secs(30);
    let th = new_test_hub_with(c).await;
    let (mut conn1, conn2) = two_humans_at_start(&th).await;

    send_msg(&mut conn1, json!({"type": "map_ready"})).await;
    drop(conn2);

    read_msg_of_type(&mut conn1, "match_ready").await;
    th.stop().await;
}

// A rematch draws a new map, so the gate has to re-arm. If the previous
// match's gate leaked, the second match would either never open or open
// without waiting.
#[tokio::test]
async fn map_loading_rearms_on_rematch() {
    let mut c = HubConfig::default();
    c.debug_mode = true; // debug_set_state
    let th = new_test_hub_with(c).await;
    let (mut conn, _) = alone_with_a_bot(&th).await;
    complete_map_load(&mut [&mut conn]).await;
    win_match_from_host_turn(&mut conn).await;

    send_msg(&mut conn, json!({"type": "rematch"})).await;
    read_msg_of_type(&mut conn, "rematch_started").await;

    send_msg(&mut conn, json!({"type": "start_game"})).await;
    let gs = read_msg_of_type(&mut conn, "game_started").await;
    assert!(
        gs["state"]["map_id"]
            .as_str()
            .is_some_and(|s| !s.is_empty()),
        "rematch dealt no map"
    );
    // Still gated: the new map is one nobody has downloaded.
    send_msg(&mut conn, json!({"type": "draw_card"})).await;
    assert_gated(&mut conn, "want the rematch to gate on its new map too").await;
    complete_map_load(&mut [&mut conn]).await;
    th.stop().await;
}

// A duplicate answer is a double click or a message already in flight, not an
// attack, and it must not earn an error toast in the middle of a match.
#[tokio::test]
async fn map_loading_repeated_map_ready_is_harmless() {
    let th = new_test_hub().await;
    let (mut conn1, mut conn2) = two_humans_at_start(&th).await;
    complete_map_load(&mut [&mut conn1, &mut conn2]).await;

    send_msg(&mut conn1, json!({"type": "map_ready"})).await;
    send_msg(&mut conn1, json!({"type": "draw_card"})).await;
    // The draw is answered on its merits ("not your turn" if Bob leads). What
    // matters is that nothing complains about the map.
    for _ in 0..6 {
        let msg = read_msg(&mut conn1).await;
        let err = msg["error"].as_str().unwrap_or_default();
        assert!(
            !(msg["type"] == "error" && err.contains("load the table")),
            "a repeated map_ready re-shut the table: {err:?}"
        );
        if msg["type"] == "card_drawn" || msg["type"] == "error" {
            break;
        }
    }
    th.stop().await;
}
