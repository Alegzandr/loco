//! Port of `server/hub/bot_interrupt_test.go`.

#![allow(clippy::field_reassign_with_default)] // a test narrows one knob of the default config

use futures_util::StreamExt;
use loco_hub::HubConfig;
use loco_hub::testkit::*;
use serde_json::{Value, json};
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

/// Keeps the bot off its ordinary turn so the only thing it can do is react,
/// and makes the reaction deterministic.
fn cfg(interrupt_prob: f32) -> HubConfig {
    let mut c = HubConfig::default();
    c.debug_mode = true;
    c.timings.bots.think = Duration::from_secs(30);
    c.timings.bots.interrupt_delay = Duration::from_millis(10);
    c.timings.bots.interrupt_jitter_max = Duration::ZERO;
    c.timings.bots.interrupt_prob = interrupt_prob;
    c.timings.bots.catch_prob = 0.0;
    c
}

fn red5() -> Value {
    json!({"color": "red", "kind": "number", "value": 5})
}

/// A 1v1 against a bot that holds the red 5 we are about to play; our red 5
/// is already on its way to the pile when this returns.
async fn play_a_card_the_bot_holds(th: &TestHub) -> (Ws, i64) {
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
    let bot = 1 - me;

    send_msg(
        &mut conn,
        json!({"type": "debug_set_state", "debug": {
            "hand": [red5(), {"color": "blue", "kind": "number", "value": 9}],
            "hands": [{"player_index": bot, "hand": [red5(), {"color": "green", "kind": "number", "value": 3}]}],
            "discard": {"color": "red", "kind": "number", "value": 3},
            "active_color": "red",
            "pending_draw": 0,
            "current_turn": me
        }}),
    )
    .await;
    read_msg_of_type(&mut conn, "game_state").await;

    // Only a real play arms the window; debug_set_state leaves it closed.
    send_msg(&mut conn, json!({"type": "play_card", "card": red5()})).await;
    read_msg_of_type(&mut conn, "card_played").await;
    (conn, bot)
}

// The interject is the game's signature mechanic, and until now it ran one
// way: bots could be interrupted and never interrupted back. This walks the
// whole path — human plays, bot slams an identical card, the table is told.
#[tokio::test]
async fn bot_interrupt_slams_back_on_a_human_play() {
    let th = new_test_hub_with(cfg(1.0)).await;
    let (mut conn, bot) = play_a_card_the_bot_holds(&th).await;

    let got = read_msg_of_type(&mut conn, "interrupt_success").await;
    assert_eq!(
        seat_of(&got, "player_index"),
        bot,
        "interrupt_success named the wrong seat"
    );
    let cards = got["cards"].as_array().expect("cards");
    assert_eq!(cards.len(), 1, "interrupt_success carried {cards:?}");
    assert!(
        cards[0]["color"] == "red" && cards[0]["value"] == 5,
        "bot slammed {:?}, want the red 5 that was on the pile",
        cards[0]
    );
    th.stop().await;
}

// Bots must stay fallible. The probability gate is the only thing between
// "bots take part in the mechanic" and "bots answer every card a human plays",
// so it has to be wired to something.
#[tokio::test]
async fn bot_interrupt_probability_gate_is_wired() {
    let th = new_test_hub_with(cfg(0.0)).await; // never
    let (mut conn, _) = play_a_card_the_bot_holds(&th).await;

    // Nothing should arrive. Read until the socket goes quiet.
    let end = tokio::time::Instant::now() + Duration::from_millis(400);
    while let Ok(Some(Ok(frame))) = tokio::time::timeout_at(end, conn.next()).await {
        if let Message::Text(t) = frame
            && let Ok(v) = serde_json::from_str::<Value>(t.as_str())
        {
            assert_ne!(
                v["type"], "interrupt_success",
                "bot interjected with interrupt_prob = 0"
            );
        }
    }
    th.stop().await;
}
