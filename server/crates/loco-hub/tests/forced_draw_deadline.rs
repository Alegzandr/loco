//! Port of `server/hub/forced_draw_deadline_test.go`.

#![allow(clippy::field_reassign_with_default)] // a test narrows one knob of the default config

use loco_hub::HubConfig;
use loco_hub::testkit::*;
use serde_json::json;
use std::time::Duration;

fn deadline_of(m: &serde_json::Value) -> i64 {
    m["turn_deadline"].as_i64().unwrap_or(0)
}

// A forced draw does not cost the turn (rules.md §14.5), so the victim's clock
// has to be visible for the whole of it: while they decide whether to counter,
// and again once they have taken the stack. Every message on that path must
// carry a live turn_deadline, or the countdown bar leaves the screen.
#[tokio::test]
async fn forced_draw_keeps_turn_deadline_on_every_message() {
    let mut c = HubConfig::default();
    c.debug_mode = true;
    c.timings.turn_timeout = Duration::from_secs(30);
    let th = new_test_hub_with(c).await;
    let TwoPlayers {
        mut alice, mut bob, ..
    } = setup_two_player_game(&th).await;

    let blue9 = json!({"color": "blue", "kind": "number", "value": 9});
    let red_draw_two = json!({"color": "red", "kind": "draw_two"});
    send_msg(
        &mut alice,
        json!({"type": "debug_set_state", "debug": {
            "discard": {"color": "red", "kind": "number", "value": 5},
            "hands": [
                {"player_index": 0, "hand": [red_draw_two, blue9]},
                {"player_index": 1, "hand": [blue9, blue9]}
            ],
            "pending_draw": 0,
            "current_turn": 0
        }}),
    )
    .await;
    read_msg_of_type(&mut alice, "game_state").await;
    read_msg_of_type(&mut bob, "game_state").await;

    // Alice lands the +2 on Bob.
    send_msg(
        &mut alice,
        json!({"type": "play_card", "card": red_draw_two}),
    )
    .await;
    read_msg_of_type(&mut alice, "card_played").await;
    let played = read_msg_of_type(&mut bob, "card_played").await;
    assert_eq!(played["pending_draw"], 2, "card_played pending_draw");
    assert_eq!(played["turn"], 1, "card_played turn, want Bob (1)");
    assert_ne!(
        deadline_of(&played),
        0,
        "card_played that opens a forced draw carries no turn_deadline"
    );

    // Bob takes the stack. The turn is still his, so the clock must come back.
    send_msg(&mut bob, json!({"type": "draw_card"})).await;
    let drawn = read_msg_of_type(&mut bob, "card_drawn").await;
    assert_ne!(
        deadline_of(&drawn),
        0,
        "card_drawn after a forced draw carries no turn_deadline"
    );
    let observed = read_msg_of_type(&mut alice, "card_drawn").await;
    assert_ne!(
        deadline_of(&observed),
        0,
        "card_drawn broadcast after a forced draw carries no turn_deadline"
    );
    th.stop().await;
}

// Same property from the seat it is actually played from most of the time: a
// bot lands the +2 and the human it lands on has to see their clock the moment
// the card hits the pile.
#[tokio::test]
async fn forced_draw_bot_played_penalty_carries_the_victims_deadline() {
    let mut c = HubConfig::default();
    c.debug_mode = true;
    c.timings.turn_timeout = Duration::from_secs(30);
    c.timings.bots.think = Duration::from_millis(10);
    c.timings.bots.jitter_max = Duration::ZERO;
    c.timings.bots.interrupt_prob = 0.0;
    c.timings.bots.catch_prob = 0.0;
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
    let bot = 1 - me;

    let red3 = json!({"color": "red", "kind": "number", "value": 3});
    send_msg(
        &mut ws,
        json!({"type": "debug_set_state", "debug": {
            "hand": [red3, {"color": "blue", "kind": "number", "value": 9}],
            // Only the +2 is playable on a red 5, so the bot's move is pinned.
            "hands": [{"player_index": bot, "hand": [
                {"color": "red", "kind": "draw_two"},
                {"color": "blue", "kind": "number", "value": 7}
            ]}],
            "discard": {"color": "red", "kind": "number", "value": 5},
            "active_color": "red",
            "pending_draw": 0,
            "current_turn": me
        }}),
    )
    .await;
    read_msg_of_type(&mut ws, "game_state").await;

    // Hand the turn over for real: debug_set_state does not schedule the bot.
    send_msg(&mut ws, json!({"type": "play_card", "card": red3})).await;
    read_msg_of_type(&mut ws, "card_played").await;

    let penalty = read_msg_of_type(&mut ws, "card_played").await;
    assert_eq!(
        seat_of(&penalty, "player_index"),
        bot,
        "second card_played should come from the bot"
    );
    assert_eq!(penalty["pending_draw"], 2, "bot's card_played pending_draw");
    assert_eq!(
        penalty["turn"].as_i64(),
        Some(me),
        "turn after the bot's +2, want the victim"
    );
    assert_ne!(
        deadline_of(&penalty),
        0,
        "the +2 that starts a forced draw carries no turn_deadline"
    );
    th.stop().await;
}
