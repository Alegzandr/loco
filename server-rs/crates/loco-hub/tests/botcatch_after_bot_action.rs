//! Port of `server/hub/botcatch_after_bot_action_test.go`.

#![allow(clippy::field_reassign_with_default)] // a test narrows one knob of the default config

use loco_hub::HubConfig;
use loco_hub::testkit::*;
use serde_json::json;
use std::time::Duration;

// A bot's own Global Switch hands a human their last card, and §8 makes
// receiving it exactly as declarable as playing down to it. Nobody answered
// that.
//
// A Global Switch rather than a Swap because a Swap only ever leaves the table
// when it pays the bot, and an exchange that leaves the other seat on one card
// never does.
//
// Regression: the catch was armed after a *human* action only, while the bots'
// own declarations were armed everywhere. Both halves are armed together now
// (`maybe_schedule_bot_reactions`), from every point a board can change.
#[tokio::test]
async fn bot_catches_after_its_own_rotation_leaves_a_human_on_one_card() {
    // The bot has to take its turn here — the rotation is the whole fixture —
    // so the think delay is short rather than absent. Everything else is pinned.
    let mut c = HubConfig::default();
    c.debug_mode = true;
    c.timings.bots.think = Duration::from_millis(20);
    c.timings.bots.jitter_max = Duration::ZERO;
    c.timings.bots.catch_delay = Duration::from_millis(20);
    c.timings.bots.catch_jitter_max = Duration::ZERO;
    c.timings.bots.catch_prob = 1.0;
    c.timings.bots.interrupt_prob = 0.0;
    let th = new_test_hub_with(c).await;

    let mut conn = dial_ws(&th).await;
    send_msg(
        &mut conn,
        json!({"type": "create_room", "nickname": "Alice"}),
    )
    .await;
    read_msg_of_type(&mut conn, "room_created").await;
    send_msg(&mut conn, json!({"type": "add_bot"})).await;
    read_msg_of_type(&mut conn, "player_joined").await;
    send_msg(&mut conn, json!({"type": "start_game"})).await;
    let gs = read_msg_of_type(&mut conn, "game_started").await;
    complete_map_load(&mut [&mut conn]).await;
    let me = gs["state"]["your_index"]
        .as_i64()
        .expect("missing game state in game_started");
    let bot = 1 - me;

    // Three cards, so the card played below leaves two: the window this
    // asserts must be opened by the bot's Global Switch and by nothing we did.
    // The bot's one playable card is the Global Switch; it keeps a second
    // card, which stops the rotation from being a finish.
    send_msg(
        &mut conn,
        json!({"type": "debug_set_state", "debug": {
            "hand": [
                {"color": "red", "kind": "number", "value": 5},
                {"color": "red", "kind": "number", "value": 6},
                {"color": "red", "kind": "number", "value": 7}
            ],
            "hands": [{"player_index": bot, "hand": [
                {"color": "wild", "kind": "global_switch"},
                {"color": "blue", "kind": "number", "value": 3}
            ]}],
            "discard": {"color": "red", "kind": "number", "value": 9},
            "active_color": "red",
            "pending_draw": 0,
            "current_turn": me,
            "direction": 1
        }}),
    )
    .await;
    read_msg_of_type(&mut conn, "game_state").await;

    send_msg(
        &mut conn,
        json!({"type": "play_card", "card": {"color": "red", "kind": "number", "value": 5}}),
    )
    .await;
    read_msg_of_type(&mut conn, "card_played").await;

    // The bot rotates its one remaining card onto us and then answers the
    // window it just opened.
    let caught = read_msg_of_type(&mut conn, "uno_caught").await;
    assert_eq!(
        seat_of(&caught, "player_index"),
        me,
        "uno_caught named the wrong seat"
    );
    th.stop().await;
}
