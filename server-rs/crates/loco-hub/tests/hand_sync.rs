//! Port of `server/hub/hand_sync_test.go`.
//!
//! Every path that grows a hand must tell the affected player WHICH cards it
//! gained — a count is only enough for the other players. A client that never
//! receives the cards silently runs a shorter hand than the server, and the
//! round never ends.

#![allow(clippy::field_reassign_with_default)] // a test narrows one knob of the default config

use loco_hub::HubConfig;
use loco_hub::testkit::*;
use serde_json::{Value, json};
use std::time::Duration;

fn e2e() -> HubConfig {
    let mut c = HubConfig::default();
    c.debug_mode = true;
    c
}

/// The connection whose turn it is, the opponent's, and the active seat.
/// Go's `setupActiveGame`.
struct StartedGame {
    active: Ws,
    other: Ws,
    active_idx: i64,
}

async fn setup_active_game(th: &TestHub) -> StartedGame {
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
    assert!(
        gs1["state"].is_object() && gs2["state"].is_object(),
        "missing game state in game_started"
    );
    if gs1["state"]["turn"] == gs1["state"]["your_index"] {
        StartedGame {
            active: c1,
            other: c2,
            active_idx: gs1["state"]["your_index"].as_i64().unwrap(),
        }
    } else {
        StartedGame {
            active: c2,
            other: c1,
            active_idx: gs2["state"]["your_index"].as_i64().unwrap(),
        }
    }
}

/// The active seat down to one card, undeclared, and caught by the other.
async fn caught_on_one(g: &mut StartedGame) {
    send_msg(
        &mut g.active,
        json!({"type": "debug_set_state", "debug": {
            "hand": [{"color": "red", "kind": "number", "value": 6}, {"color": "red", "kind": "number", "value": 7}],
            "discard": {"color": "red", "kind": "number", "value": 5},
            "pending_draw": 0
        }}),
    )
    .await;
    read_msg_of_type(&mut g.active, "game_state").await;
    read_msg_of_type(&mut g.other, "game_state").await;

    // Down to 1 card without declaring.
    send_msg(
        &mut g.active,
        json!({"type": "play_card", "card": {"color": "red", "kind": "number", "value": 7}}),
    )
    .await;
    read_msg_of_type(&mut g.active, "card_played").await;
    read_msg_of_type(&mut g.other, "card_played").await;

    send_msg(&mut g.other, json!({"type": "catch_uno"})).await;
    read_msg_of_type(&mut g.active, "uno_caught").await;
    read_msg_of_type(&mut g.other, "uno_caught").await;
}

// The caught player draws 2 penalty cards server-side. Without the private
// card_drawn their local hand stays two cards short and the round can never
// end.
#[tokio::test]
async fn catch_uno_target_receives_penalty_cards() {
    let th = new_test_hub_with(e2e()).await;
    let mut g = setup_active_game(&th).await;
    caught_on_one(&mut g).await;

    // The caught player must be told exactly which 2 cards they gained.
    let drawn = read_msg_of_type(&mut g.active, "card_drawn").await;
    let n = drawn["cards"].as_array().map_or(0, Vec::len);
    assert_eq!(n, 2, "caught player received {n} cards (hand would desync)");
    assert_eq!(seat_of(&drawn, "player_index"), g.active_idx);

    // The catcher only needs the count.
    let observed = read_msg_of_type(&mut g.other, "card_drawn").await;
    assert_eq!(observed["drawn_count"], 2, "observer drawn_count");
    assert_eq!(seat_of(&observed, "player_index"), g.active_idx);
    th.stop().await;
}

// A hand can grow without anybody having drawn on their turn. Every card_drawn
// must therefore state has_drawn and pending_draw explicitly, to the drawer and
// to the observers alike: a missing false was read as "has drawn".
#[tokio::test]
async fn catch_uno_penalty_carries_turn_state() {
    let th = new_test_hub_with(e2e()).await;
    let mut g = setup_active_game(&th).await;
    caught_on_one(&mut g).await;

    let caught = read_msg_of_type(&mut g.active, "card_drawn").await;
    let observer = read_msg_of_type(&mut g.other, "card_drawn").await;
    for (name, msg) in [("caught player", caught), ("observer", observer)] {
        let msg: Value = msg;
        assert_eq!(
            msg.get("has_drawn"),
            Some(&json!(false)),
            "{name}: card_drawn has_drawn, want an explicit false"
        );
        assert_eq!(
            msg.get("pending_draw"),
            Some(&json!(0)),
            "{name}: card_drawn pending_draw, want an explicit 0"
        );
    }
    th.stop().await;
}

// The other side of the same contract: a real voluntary draw reports
// has_drawn=true to everyone, so the Pass button unlocks.
#[tokio::test]
async fn draw_card_carries_turn_state() {
    let th = new_test_hub_with(e2e()).await;
    let mut g = setup_active_game(&th).await;

    send_msg(
        &mut g.active,
        json!({"type": "debug_set_state", "debug": {
            "hand": [{"color": "blue", "kind": "number", "value": 3}],
            "discard": {"color": "red", "kind": "number", "value": 5},
            "pending_draw": 0
        }}),
    )
    .await;
    read_msg_of_type(&mut g.active, "game_state").await;
    read_msg_of_type(&mut g.other, "game_state").await;

    send_msg(&mut g.active, json!({"type": "draw_card"})).await;
    let drawer = read_msg_of_type(&mut g.active, "card_drawn").await;
    let observer = read_msg_of_type(&mut g.other, "card_drawn").await;
    for (name, msg) in [("drawer", drawer), ("observer", observer)] {
        assert_eq!(
            msg["has_drawn"], true,
            "{name}: card_drawn has_drawn, want true"
        );
    }
    th.stop().await;
}

// A timed-out player facing a pending draw takes the whole stack, and must be
// told which cards they took.
#[tokio::test]
async fn turn_timeout_penalty_draw_sends_cards_to_drawer() {
    let mut c = e2e();
    c.timings.turn_timeout = Duration::from_millis(1500);
    let th = new_test_hub_with(c).await;
    let mut g = setup_active_game(&th).await;

    // A +2 on the active player without touching whose turn it is — the turn
    // timer armed at game start is bound to that seat.
    send_msg(
        &mut g.active,
        json!({"type": "debug_set_state", "debug": {
            "hand": [{"color": "blue", "kind": "number", "value": 3}],
            "discard": {"color": "red", "kind": "draw_two"},
            "pending_draw": 2
        }}),
    )
    .await;
    read_msg_of_type(&mut g.active, "game_state").await;
    read_msg_of_type(&mut g.other, "game_state").await;

    let drawn = read_msg_of_type(&mut g.active, "card_drawn").await;
    let n = drawn["cards"].as_array().map_or(0, Vec::len);
    assert_eq!(
        n, 2,
        "timed-out player received {n} cards (hand would desync)"
    );
    let observed = read_msg_of_type(&mut g.other, "card_drawn").await;
    assert_eq!(observed["drawn_count"], 2, "observer drawn_count");
    th.stop().await;
}
