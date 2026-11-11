//! Port of `server/hub/interrupt_window_test.go`.

#![allow(clippy::field_reassign_with_default)] // a test narrows one knob of the default config

use loco_hub::HubConfig;
use loco_hub::testkit::*;
use serde_json::json;

// Whether the pile may still be slammed is the server's word, and it rides
// every message that can open or shut the window. The client kept no copy of it
// and offered the twin for as long as the card was on top, so a slam after the
// seat at turn had drawn was rendered as "somebody was faster" on a table where
// nobody had been.
#[tokio::test]
async fn interrupt_open_rides_the_wire() {
    let mut c = HubConfig::default();
    c.debug_mode = true;
    let th = new_test_hub_with(c).await;
    let TwoPlayers {
        mut alice, mut bob, ..
    } = setup_two_player_game(&th).await;

    // Alice at turn holding two red numbers on a red top; nothing pending.
    let red7 = json!({"color": "red", "kind": "number", "value": 7});
    let red3 = json!({"color": "red", "kind": "number", "value": 3});
    send_msg(
        &mut alice,
        json!({"type": "debug_set_state", "debug": {
            "hand": [red7, red3],
            "discard": {"color": "red", "kind": "number", "value": 9},
            "pending_draw": 0,
            "current_turn": 0
        }}),
    )
    .await;
    let snap = read_msg_of_type(&mut alice, "game_state").await;
    read_msg_of_type(&mut bob, "game_state").await;
    assert_eq!(
        snap["state"]["interrupt_open"], true,
        "the snapshot of a fresh deal says the window is shut"
    );

    // A play opens it, and says so.
    send_msg(&mut alice, json!({"type": "play_card", "card": red7})).await;
    let played = read_msg_of_type(&mut bob, "card_played").await;
    assert_eq!(
        played["interrupt_open"], true,
        "card_played interrupt_open, want true"
    );

    // Bob, at turn now, draws: the window shuts and every seat is told.
    send_msg(&mut bob, json!({"type": "draw_card"})).await;
    let drawn = read_msg_of_type(&mut alice, "card_drawn").await;
    assert_eq!(
        drawn["interrupt_open"], false,
        "card_drawn interrupt_open, want false after the seat at turn drew"
    );

    // And the pass that follows carries the same answer.
    send_msg(&mut bob, json!({"type": "pass_turn"})).await;
    let changed = read_msg_of_type(&mut alice, "turn_changed").await;
    assert_eq!(
        changed["interrupt_open"], false,
        "turn_changed interrupt_open, want false"
    );
    th.stop().await;
}
