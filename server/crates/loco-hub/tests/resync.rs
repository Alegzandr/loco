//! A refusal that proves a drift carries the correction.

#![allow(clippy::field_reassign_with_default)] // a test narrows one knob of the default config

use loco_hub::HubConfig;
use loco_hub::testkit::*;
use serde_json::{Value, json};
use std::time::Duration;

/// Debug on, and the bot kept off the board entirely: a bot play would repair
/// the client by accident and prove nothing about the refusal.
fn inert_bot() -> HubConfig {
    let mut c = HubConfig::default();
    c.debug_mode = true;
    c.timings.bots.think = Duration::from_secs(30);
    c.timings.latency_broadcast_period = Duration::from_secs(3600);
    c
}

async fn alice_and_a_bot(th: &TestHub) -> (Ws, i64) {
    let mut ws = dial_ws(th).await;
    send_msg(&mut ws, json!({"type": "create_room", "nickname": "Alice"})).await;
    read_msg_of_type(&mut ws, "room_created").await;
    send_msg(&mut ws, json!({"type": "add_bot"})).await;
    read_msg_of_type(&mut ws, "player_joined").await;
    send_msg(&mut ws, json!({"type": "start_game"})).await;
    let gs = read_msg_of_type(&mut ws, "game_started").await;
    complete_map_load(&mut [&mut ws]).await;
    assert!(
        gs["state"].is_object(),
        "missing game state in game_started"
    );
    let me = gs["state"]["your_index"].as_i64().unwrap();
    (ws, me)
}

// A client whose board has drifted from the server's has no way back on its
// own: every attempt comes back refused. The refusal itself has to carry the
// correction.
#[tokio::test]
async fn play_card_illegal_play_resyncs_the_client() {
    let th = new_test_hub_with(inert_bot()).await;
    let (mut ws, me) = alice_and_a_bot(&th).await;

    // A yellow 4 on the pile, a hand of reds: nothing here is playable.
    let red_swap = json!({"color": "red", "kind": "swap"});
    send_msg(
        &mut ws,
        json!({"type": "debug_set_state", "debug": {
            "hand": [red_swap, {"color": "red", "kind": "number", "value": 2}],
            "discard": {"color": "yellow", "kind": "number", "value": 4},
            "active_color": "yellow",
            "pending_draw": 0,
            "current_turn": me,
            "direction": 1
        }}),
    )
    .await;
    read_msg_of_type(&mut ws, "game_state").await;

    // The tap a drifted client sends: an off-colour Swap, target named.
    send_msg(
        &mut ws,
        json!({"type": "play_card", "card": red_swap, "chosen_player": 1 - me}),
    )
    .await;
    let refusal = read_msg_of_type(&mut ws, "error").await;
    assert_eq!(
        refusal["error"], "illegal card play",
        "want the unchanged wire string"
    );

    // ...and the state that proves it.
    let fresh = read_msg_of_type(&mut ws, "game_state").await;
    let st = &fresh["state"];
    assert!(st.is_object(), "resync carried no state");
    assert_eq!(st["active_color"], "yellow");
    assert!(
        st["discard"]["kind"] == "number" && st["discard"]["value"] == 4,
        "resync discard = {}, want the yellow 4",
        st["discard"]
    );
    assert_eq!(
        st["hand"].as_array().map(Vec::len),
        Some(2),
        "the refused card never left the hand"
    );
    th.stop().await;
}

// Losing an interrupt race is not a drift: the client's board was right, it was
// simply beaten. Answering one with a personalised snapshot would put the most
// expensive message on the wire at the busiest moment of the busiest table.
#[tokio::test]
async fn interrupt_lost_race_does_not_resync() {
    let mut c = inert_bot();
    c.timings.bots.interrupt_prob = 0.0;
    c.timings.bots.catch_prob = 0.0;
    let th = new_test_hub_with(c).await;
    let (mut ws, me) = alice_and_a_bot(&th).await;

    let red5 = json!({"color": "red", "kind": "number", "value": 5});
    send_msg(
        &mut ws,
        json!({"type": "debug_set_state", "debug": {
            "hand": [red5, {"color": "red", "kind": "number", "value": 2}],
            "discard": {"color": "red", "kind": "number", "value": 3},
            "active_color": "red",
            "pending_draw": 0,
            "current_turn": me,
            "direction": 1
        }}),
    )
    .await;
    read_msg_of_type(&mut ws, "game_state").await;

    // The red 5 is not the red 3 on the pile: this is what losing an interrupt
    // race is. The window itself is open, as it is from the deal onwards.
    send_msg(&mut ws, json!({"type": "interrupt_play", "card": red5})).await;
    let got = read_msg_of_type(&mut ws, "error").await;
    assert_eq!(
        got["error"],
        "interrupt card must exactly match the top discard card"
    );

    // Nothing else may follow. Read until the socket goes quiet.
    let deadline = tokio::time::Instant::now() + Duration::from_millis(400);
    while let Ok(m) = tokio::time::timeout_at(deadline, read_msg(&mut ws)).await {
        let m: Value = m;
        assert_ne!(
            m["type"], "game_state",
            "a lost interrupt race triggered a state resync"
        );
    }
    th.stop().await;
}
