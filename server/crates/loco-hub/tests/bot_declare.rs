//! A bot's LOCO! declaration, and that it can still be caught.

#![allow(clippy::field_reassign_with_default)] // a test narrows one knob of the default config

use loco_hub::HubConfig;
use loco_hub::testkit::*;
use serde_json::{Value, json};
use std::time::Duration;

/// A 1v1 against a bot, past the map gate: the socket, our seat and the bot's.
async fn bot_table(th: &TestHub) -> (Ws, i64, i64) {
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
    let gs = read_msg_of_type(&mut conn, "game_started").await;
    complete_map_load(&mut [&mut conn]).await;
    let me = gs["state"]["your_index"]
        .as_i64()
        .expect("missing game state in game_started");
    (conn, me, 1 - me)
}

/// The bot must not take its ordinary turn; only the declaration is under
/// test, and it is made deterministic.
fn cfg(uno_delay: Duration) -> HubConfig {
    let mut c = HubConfig::default();
    c.debug_mode = true;
    c.timings.bots.think = Duration::from_secs(30);
    c.timings.bots.uno_delay = uno_delay;
    c.timings.bots.uno_jitter_max = Duration::ZERO;
    c.timings.bots.catch_prob = 0.0;
    c.timings.bots.interrupt_prob = 0.0;
    c
}

fn swap_fixture(me: i64, bot: i64, bot_hand: Value) -> Value {
    json!({"type": "debug_set_state", "debug": {
        "hand": [{"color": "red", "kind": "swap"}, {"color": "blue", "kind": "number", "value": 9}],
        "hands": [{"player_index": bot, "hand": bot_hand}],
        "discard": {"color": "red", "kind": "number", "value": 3},
        "active_color": "red",
        "pending_draw": 0,
        "current_turn": me,
        "direction": 1
    }})
}

// Receiving your last card owes the table a declaration exactly like playing
// down to it (rules.md §8). A bot has to pay that rule too.
//
// Regression: the scheduler was keyed on the seat that had just *acted*, so a
// human whose Swap left a bot on one card scheduled nothing at all.
#[tokio::test]
async fn bot_declares_after_a_human_swap_leaves_it_on_one_card() {
    let th = new_test_hub_with(cfg(Duration::from_millis(20))).await;
    let (mut conn, me, bot) = bot_table(&th).await;

    // Playing the Swap leaves us holding one card, which the swap then hands
    // to the bot: the bot ends on exactly one card it has never announced.
    send_msg(
        &mut conn,
        swap_fixture(
            me,
            bot,
            json!([
                {"color": "green", "kind": "number", "value": 3},
                {"color": "green", "kind": "number", "value": 4},
                {"color": "green", "kind": "number", "value": 5}
            ]),
        ),
    )
    .await;
    read_msg_of_type(&mut conn, "game_state").await;

    send_msg(
        &mut conn,
        json!({"type": "play_card", "card": {"color": "red", "kind": "swap"}, "chosen_player": bot}),
    )
    .await;
    read_msg_of_type(&mut conn, "card_played").await;

    let declared = read_msg_of_type(&mut conn, "uno_declared").await;
    assert_eq!(
        seat_of(&declared, "player_index"),
        bot,
        "uno_declared named the wrong seat"
    );
    th.stop().await;
}

// The other half of the rule: the declaration is still deferred, so a human
// who reacts fast enough can take the +2 first.
#[tokio::test]
async fn bot_declaration_after_a_swap_is_still_catchable() {
    // Long enough that the catch below is unambiguously first.
    let th = new_test_hub_with(cfg(Duration::from_secs(5))).await;
    let (mut conn, me, bot) = bot_table(&th).await;

    send_msg(
        &mut conn,
        swap_fixture(
            me,
            bot,
            json!([
                {"color": "green", "kind": "number", "value": 3},
                {"color": "green", "kind": "number", "value": 4}
            ]),
        ),
    )
    .await;
    read_msg_of_type(&mut conn, "game_state").await;

    send_msg(
        &mut conn,
        json!({"type": "play_card", "card": {"color": "red", "kind": "swap"}, "chosen_player": bot}),
    )
    .await;
    read_msg_of_type(&mut conn, "card_played").await;

    send_msg(&mut conn, json!({"type": "catch_uno", "target_index": bot})).await;
    let caught = read_msg_of_type(&mut conn, "uno_caught").await;
    assert_eq!(
        seat_of(&caught, "player_index"),
        bot,
        "uno_caught named the wrong seat"
    );
    th.stop().await;
}
