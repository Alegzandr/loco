//! Port of `server/hub/turn_timer_test.go`.

#![allow(clippy::field_reassign_with_default)] // a test narrows one knob of the default config

use loco_hub::HubConfig;
use loco_hub::testkit::*;
use serde_json::{Value, json};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const TURN_TIMEOUT: Duration = Duration::from_millis(700);

/// The connection whose turn it is, the opponent's, and the active seat.
/// Go's `setupActiveGame`.
async fn setup_active_game(th: &TestHub) -> (Ws, Ws, i64) {
    let mut c1 = dial_ws(th).await;
    let mut c2 = dial_ws(th).await;
    send_msg(&mut c1, json!({"type": "create_room", "nickname": "Alice"})).await;
    let created = read_msg_of_type(&mut c1, "room_created").await;
    send_msg(
        &mut c2,
        json!({"type": "join_room", "nickname": "Bob", "room_code": created["room_code"]}),
    )
    .await;
    read_msg_of_type(&mut c2, "room_joined").await;
    read_msg_of_type(&mut c1, "player_joined").await;
    send_msg(&mut c1, json!({"type": "start_game"})).await;
    let gs1 = read_msg_of_type(&mut c1, "game_started").await;
    let gs2 = read_msg_of_type(&mut c2, "game_started").await;
    complete_map_load(&mut [&mut c1, &mut c2]).await;
    if gs1["state"]["turn"] == gs1["state"]["your_index"] {
        (c1, c2, gs1["state"]["your_index"].as_i64().unwrap())
    } else {
        (c2, c1, gs2["state"]["your_index"].as_i64().unwrap())
    }
}

// Deviation §14.5 — a forced draw does not cost the turn: the victim takes the
// whole stack and then plays normally. The turn clock was armed when the
// penalty card landed, so every second spent deciding whether to counter was
// gone from the turn that follows the draw. Drawing re-arms the clock. Both
// penalty cards share one code path, so the pair is what the test watches.
async fn penalty_draw_rearms_turn_timer(discard: Value, pending: usize) {
    let mut c = HubConfig::default();
    c.debug_mode = true;
    c.timings.turn_timeout = TURN_TIMEOUT;
    let th = new_test_hub_with(c).await;
    let (mut active, mut other, active_idx) = setup_active_game(&th).await;

    // The penalty lands on the active seat; debug_set_state does not touch
    // whose turn it is, so the timer armed at game start is still running.
    send_msg(
        &mut active,
        json!({"type": "debug_set_state", "debug": {
            "hand": [{"color": "blue", "kind": "number", "value": 3}],
            "discard": discard,
            "active_color": "blue",
            "pending_draw": pending
        }}),
    )
    .await;
    read_msg_of_type(&mut active, "game_state").await;
    read_msg_of_type(&mut other, "game_state").await;

    // Deciding not to counter burns most of the original turn.
    tokio::time::sleep(Duration::from_millis(400)).await;

    send_msg(&mut active, json!({"type": "draw_card"})).await;
    let drawn = read_msg_of_type(&mut active, "card_drawn").await;
    assert_eq!(
        drawn["cards"].as_array().map_or(0, Vec::len),
        pending,
        "penalty draw gave the wrong number of cards"
    );
    assert_eq!(
        drawn["turn"].as_i64(),
        Some(active_idx),
        "turn moved after a forced draw (deviation §14.5)"
    );

    // The announced deadline must be a fresh turn, not the leftover of the old one.
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    let remaining = drawn["turn_deadline"].as_i64().unwrap_or(0) - now;
    assert!(
        remaining >= 500,
        "turn deadline after penalty draw leaves {remaining}ms, want ~{TURN_TIMEOUT:?} (timer not re-armed)"
    );

    // And the seat must still be ours past the original deadline.
    tokio::time::sleep(Duration::from_millis(400)).await;
    send_msg(
        &mut active,
        json!({"type": "play_card", "card": {"color": "blue", "kind": "number", "value": 3}}),
    )
    .await;
    let played = read_msg_of_type(&mut active, "card_played").await;
    assert_eq!(seat_of(&played, "player_index"), active_idx);
    th.stop().await;
}

#[tokio::test]
async fn penalty_draw_rearms_turn_timer_draw_two() {
    penalty_draw_rearms_turn_timer(json!({"color": "blue", "kind": "draw_two"}), 2).await;
}

#[tokio::test]
async fn penalty_draw_rearms_turn_timer_wild_draw_four() {
    penalty_draw_rearms_turn_timer(json!({"color": "wild", "kind": "wild_draw_four"}), 4).await;
}
