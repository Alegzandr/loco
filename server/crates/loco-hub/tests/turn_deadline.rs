//! Port of `server/hub/turn_deadline_test.go`.

#![allow(clippy::field_reassign_with_default)] // a test narrows one knob of the default config

use loco_hub::HubConfig;
use loco_hub::testkit::*;
use serde_json::json;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

fn deadline_of(m: &serde_json::Value) -> i64 {
    m["turn_deadline"].as_i64().unwrap_or(0)
}

// A bot's turn has no clock: the turn timer arms no timeout for one, and the
// deadline it broadcasts must say so. Every card_played that handed the turn to
// a bot used to carry the previous human's deadline, already part-spent.
//
// The Skip proves a deadline was recorded (so the second assertion cannot pass
// merely because nothing was ever set), and the number then hands the turn
// over.
#[tokio::test]
async fn turn_deadline_absent_during_bot_turn() {
    let mut c = HubConfig::default();
    c.debug_mode = true;
    // Keep the bot inert: this test is about what the server says.
    c.timings.bots.think = Duration::from_secs(30);
    c.timings.bots.catch_prob = 0.0;
    c.timings.bots.interrupt_prob = 0.0;
    let th = new_test_hub_with(c).await;

    let mut ws = dial_ws(&th).await;
    send_msg(&mut ws, json!({"type": "create_room", "nickname": "Alice"})).await;
    read_msg_of_type(&mut ws, "room_created").await;
    send_msg(&mut ws, json!({"type": "add_bot"})).await;
    read_msg_of_type(&mut ws, "player_joined").await;
    send_msg(&mut ws, json!({"type": "start_game"})).await;
    let gs = read_msg_of_type(&mut ws, "game_started").await;
    complete_map_load(&mut [&mut ws]).await;
    let me = gs["state"]["your_index"]
        .as_i64()
        .expect("missing game state in game_started");

    let red_skip = json!({"color": "red", "kind": "skip"});
    let red5 = json!({"color": "red", "kind": "number", "value": 5});
    send_msg(
        &mut ws,
        json!({"type": "debug_set_state", "debug": {
            // Four cards so neither play leaves the seat on one or on none.
            "hand": [red_skip, red5,
                {"color": "blue", "kind": "number", "value": 9},
                {"color": "green", "kind": "number", "value": 3}],
            "discard": {"color": "red", "kind": "number", "value": 3},
            "active_color": "red",
            "pending_draw": 0,
            "current_turn": me,
            "direction": 1
        }}),
    )
    .await;
    read_msg_of_type(&mut ws, "game_state").await;

    // A Skip at two seats skips the bot and hands the turn back to us.
    send_msg(&mut ws, json!({"type": "play_card", "card": red_skip})).await;
    let human = read_msg_of_type(&mut ws, "card_played").await;
    assert_eq!(
        human["turn"].as_i64(),
        Some(me),
        "after a Skip at two seats the turn should be back on us"
    );
    assert_ne!(
        deadline_of(&human),
        0,
        "card_played for a human turn carried no deadline: the rest of this test would pass vacuously"
    );

    // Now hand the turn to the bot.
    send_msg(&mut ws, json!({"type": "play_card", "card": red5})).await;
    let bot = read_msg_of_type(&mut ws, "card_played").await;
    assert_ne!(
        bot["turn"].as_i64(),
        Some(me),
        "expected the turn to move off our seat"
    );
    assert_eq!(
        deadline_of(&bot),
        0,
        "card_played handing the turn to a bot carried a deadline (a bot has no clock)"
    );
    th.stop().await;
}

// The turn that follows a timeout gets a clock like any other. The
// turn_changed a timeout broadcast used to carry the deadline of the turn that
// had just run out, already in the past.
#[tokio::test]
async fn turn_deadline_live_after_a_timeout() {
    let mut c = HubConfig::default();
    c.timings.turn_timeout = Duration::from_millis(300);
    let th = new_test_hub_with(c).await;
    let TwoPlayers { mut alice, .. } = setup_two_player_game(&th).await;

    // Nobody acts: the seat on the clock is auto-drawn and auto-passed.
    let changed = read_msg_of_type(&mut alice, "turn_changed").await;
    let d = deadline_of(&changed);
    assert_ne!(
        d, 0,
        "turn_changed after a timeout carries no deadline at all"
    );
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    assert!(
        d > now,
        "turn_changed after a timeout carries deadline {d}, already in the past"
    );
    th.stop().await;
}
