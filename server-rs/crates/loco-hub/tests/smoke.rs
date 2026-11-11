//! A first pass through the handlers over real sockets: create, join, deal,
//! load, play, draw, reconnect, debug_set_state, the turn clock.

#![allow(clippy::field_reassign_with_default)] // a test narrows one knob of the default config

use loco_hub::HubConfig;
use loco_hub::testkit::*;
use serde_json::json;
use std::time::Duration;

#[tokio::test]
async fn player_reconnect_during_game() {
    let th = new_test_hub().await;
    let TwoPlayers {
        mut alice,
        bob,
        code,
        tokens,
    } = setup_two_player_game(&th).await;
    drop(bob);
    let d = read_msg_of_type(&mut alice, "player_disconnected").await;
    assert_eq!(seat_of(&d, "player_index"), 1);

    let mut bob2 = dial_ws(&th).await;
    send_msg(
        &mut bob2,
        json!({"type": "join_room", "nickname": "Bob", "room_code": code, "session_token": tokens[1]}),
    )
    .await;
    let m = read_msg_of_type(&mut bob2, "player_reconnected").await;
    assert_eq!(seat_of(&m, "player_id"), 1);
    assert_eq!(m["room_code"], code.as_str());
    assert_eq!(m["state"]["your_index"], 1);
    assert_ne!(
        m["session_token"],
        tokens[1].as_str(),
        "a reclaim spends its token"
    );
    let seen = read_msg_of_type(&mut alice, "player_reconnected").await;
    assert_eq!(seat_of(&seen, "player_index"), 1);
    th.stop().await;
}

#[tokio::test]
async fn debug_set_state_overrides_hands_and_turn_then_a_play_lands() {
    let mut c = HubConfig::default();
    c.debug_mode = true;
    let th = new_test_hub_with(c).await;
    let TwoPlayers {
        mut alice, mut bob, ..
    } = setup_two_player_game(&th).await;

    send_msg(
        &mut alice,
        json!({"type": "debug_set_state", "debug": {
            "hands": [
                {"player_index": 0, "hand": [{"color": "red", "kind": "number", "value": 1}, {"color": "red", "kind": "number", "value": 7}]},
                {"player_index": 1, "hand": [{"color": "blue", "kind": "number", "value": 9}, {"color": "green", "kind": "number", "value": 2}]}
            ],
            "discard": {"color": "red", "kind": "number", "value": 5},
            "pending_draw": 0,
            "current_turn": 0,
            "direction": 1
        }}),
    )
    .await;
    let s1 = read_msg_of_type(&mut alice, "game_state").await;
    let s2 = read_msg_of_type(&mut bob, "game_state").await;
    assert_eq!(s1["state"]["turn"], 0);
    assert_eq!(s1["state"]["hand"].as_array().unwrap().len(), 2);
    assert_eq!(s2["state"]["hand"].as_array().unwrap().len(), 2);

    send_msg(
        &mut alice,
        json!({"type": "play_card", "card": {"color": "red", "kind": "number", "value": 7}}),
    )
    .await;
    let played = read_msg_of_type(&mut bob, "card_played").await;
    assert_eq!(played["card"]["value"], 7);
    assert_eq!(played["turn"], 1);
    assert!(played["turn_deadline"].as_i64().unwrap() > 0);
    // One card left and undeclared: Bob can see Alice on the hook.
    assert_eq!(played["catch_seats"][0]["player_index"], 0);

    // Out of turn now: refused, with the correction.
    send_msg(&mut alice, json!({"type": "draw_card"})).await;
    let e = read_msg_of_type(&mut alice, "error").await;
    assert_eq!(e["error"], "not your turn");
    read_msg_of_type(&mut alice, "game_state").await;

    send_msg(&mut bob, json!({"type": "draw_card"})).await;
    let drawn = read_msg_of_type(&mut bob, "card_drawn").await;
    assert_eq!(drawn["cards"].as_array().unwrap().len(), 1);
    let seen = read_msg_of_type(&mut alice, "card_drawn").await;
    assert_eq!(seen["drawn_count"], 1);
    assert!(seen.get("cards").is_none(), "a hidden card leaked: {seen}");
    th.stop().await;
}

#[tokio::test]
async fn turn_timer_auto_draw_and_pass() {
    let mut c = HubConfig::default();
    c.timings.turn_timeout = Duration::from_millis(80);
    let th = new_test_hub_with(c).await;
    let TwoPlayers {
        mut alice, mut bob, ..
    } = setup_two_player_game(&th).await;
    read_msg_of_type(&mut alice, "turn_changed").await;
    read_msg_of_type(&mut bob, "turn_changed").await;
    th.stop().await;
}

#[tokio::test]
async fn a_bot_game_plays_itself_to_a_round_end() {
    let mut c = HubConfig::default();
    c.debug_mode = true;
    c.timings.bots.think = Duration::from_millis(5);
    c.timings.bots.jitter_max = Duration::from_millis(5);
    c.timings.turn_timeout = Duration::from_millis(50);
    c.timings.turn_timeout_grace = Duration::ZERO;
    c.timings.afk_kick_threshold = 10_000;
    let th = new_test_hub_with(c).await;
    let mut alice = dial_ws(&th).await;
    send_msg(
        &mut alice,
        json!({"type": "create_room", "nickname": "Alice"}),
    )
    .await;
    read_msg_of_type(&mut alice, "room_created").await;
    send_msg(&mut alice, json!({"type": "add_bot"})).await;
    read_msg_of_type(&mut alice, "player_joined").await;
    send_msg(&mut alice, json!({"type": "start_game"})).await;
    read_msg_of_type(&mut alice, "game_started").await;
    complete_map_load(&mut [&mut alice]).await;
    // Alice never acts: the clock plays her, the bot plays itself.
    let deadline = tokio::time::Instant::now() + Duration::from_secs(60);
    loop {
        assert!(
            tokio::time::Instant::now() < deadline,
            "no round end in 60s"
        );
        let m = read_raw(&mut alice).await;
        if m["type"] == "round_end" {
            break;
        }
    }
    assert_eq!(th.hub.metrics_stats().handler_panics, 0);
    th.stop().await;
}
