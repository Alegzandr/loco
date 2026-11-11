//! A 1v1 against the server: the queue's experience with the queue taken out.
//! The property that matters beyond the mode working is the last test here: it
//! touches nothing the matchmaking queue owns.

mod common_b;

use common_b::*;
use loco_hub::testkit::*;
use serde_json::{Value, json};

/// Sends `play_bot` and reads the deal back.
async fn play_bot(ws: &mut Ws, nickname: &str) -> Value {
    send_msg(ws, json!({"type": "play_bot", "nickname": nickname})).await;
    read_msg_of_type(ws, "game_started").await
}

async fn open_solo(ws: &mut Ws) -> Value {
    let started = play_bot(ws, "Alice").await;
    read_msg_of_type(ws, "match_loading").await;
    send_msg(ws, json!({"type": "map_ready"})).await;
    read_msg_of_type(ws, "match_ready").await;
    started
}

#[tokio::test]
async fn play_bot_deals_a_hand_with_nothing_to_press() {
    let th = new_test_hub().await;
    let mut conn = dial_ws(&th).await;
    let started = play_bot(&mut conn, "Alice").await;

    // The whole identity, on the one message this mode has: there is no
    // room_created and no match_found in front of it, so without these a reload
    // could not reclaim the seat.
    assert!(
        !started["room_code"].as_str().unwrap_or("").is_empty(),
        "game_started carried no room code"
    );
    assert!(
        !started["session_token"].as_str().unwrap_or("").is_empty(),
        "game_started carried no session token"
    );
    assert_eq!(seat_of(&started, "player_id"), 0);
    let state = &started["state"];
    assert!(state.is_object(), "game_started carried no state");
    assert_eq!(len_of(&state["hand"]), 8);
    assert_eq!(len_of(&state["players"]), 2);
    assert_eq!(state["players"][0]["nickname"], "Alice");
    assert_eq!(
        state["players"][1]["is_bot"], true,
        "seat 1 is not marked as a bot"
    );
    // One round, like the queue's: the entry promises a hand now.
    assert_eq!(state["match_format"], "BO1");
    assert_eq!(state["max_players"], 2);

    // And the table is shut behind the map gate like every other match: the
    // clock starts at match_ready, not here.
    read_msg_of_type(&mut conn, "match_loading").await;
    th.stop().await;
}

// The table has no host, exactly like a matchmade one: nothing to configure,
// nobody to configure it for, and nobody with standing to remove the other seat.
#[tokio::test]
async fn play_bot_host_controls_are_refused() {
    let th = new_test_hub().await;
    let mut conn = dial_ws(&th).await;
    play_bot(&mut conn, "Alice").await;
    read_msg_of_type(&mut conn, "match_loading").await;

    for msg in [
        json!({"type": "add_bot"}),
        json!({"type": "start_game"}),
        json!({"type": "set_match_format", "match_format": "BO7"}),
        json!({"type": "set_max_players", "max_players": 4}),
        json!({"type": "kick_player", "target_index": 1}),
        json!({"type": "transfer_host", "target_index": 1}),
    ] {
        send_msg(&mut conn, msg.clone()).await;
        let got = read_msg_of_type(&mut conn, "error").await;
        assert_eq!(
            got["error"], "not available in this game",
            "{}: want the hostless refusal",
            msg["type"]
        );
    }
    th.stop().await;
}

// Leaving a solo game costs nobody anything: there is no one to walk out on and
// nothing to award the match to, so the seat goes and the table goes with it.
#[tokio::test]
async fn play_bot_leaving_takes_the_table_with_it() {
    let th = new_test_hub().await;
    let mut conn = dial_ws(&th).await;
    let started = open_solo(&mut conn).await;

    send_msg(&mut conn, json!({"type": "leave_room"})).await;
    read_msg_of_type(&mut conn, "left_room").await;

    let code = started["room_code"].as_str().unwrap();
    assert!(
        room_gone(&th, code).await,
        "the solo table outlived the only player at it"
    );
    th.stop().await;
}

// A rematch is an ask in every room but this one. Here the ask has no
// addressee: the other seat is the server. Another game is another play_bot,
// which is what the game-over screen sends.
#[tokio::test]
async fn play_bot_rematch_is_refused_and_another_press_deals_again() {
    let th = new_test_hub_with(debug_cfg()).await;
    let mut conn = dial_ws(&th).await;
    let first = open_solo(&mut conn).await;

    win_match_from_host_turn(&mut conn, &mut []).await;

    send_msg(&mut conn, json!({"type": "rematch"})).await;
    let got = read_msg_of_type(&mut conn, "error").await;
    assert_eq!(
        got["error"], "not available in this game",
        "rematch: want the hostless refusal"
    );

    // The button that *is* offered: another press, another table, another hand.
    let second = play_bot(&mut conn, "Alice").await;
    assert_ne!(
        second["room_code"], first["room_code"],
        "the second game reused the first table"
    );
    assert_eq!(
        len_of(&second["state"]["hand"]),
        8,
        "the second game was not dealt a fresh hand"
    );
    th.stop().await;
}

// The property the E2E suite depends on: this mode is not the queue,
// read off the hub's own counters.
#[tokio::test]
async fn play_bot_never_touches_the_matchmaking_queue() {
    let th = new_test_hub().await;
    let mut conn = dial_ws(&th).await;

    let before = th.hub.metrics_stats();
    play_bot(&mut conn, "Alice").await;
    read_msg_of_type(&mut conn, "match_loading").await;
    let after = th.hub.metrics_stats();

    assert_eq!(before.matchmaking_queue, 0);
    assert_eq!(after.matchmaking_queue, 0, "matchmaking_queue moved");
    assert_eq!(
        after.matches_matchmade, before.matches_matchmade,
        "matches_matchmade moved"
    );
    assert_eq!(after.matches_solo, before.matches_solo + 1);
    th.stop().await;
}
