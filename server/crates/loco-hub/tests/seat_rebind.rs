//! A socket carries its seat, and the table carries a pointer to that same
//! socket in its members, indexed by seat. Nothing used to stop a seated client
//! from sending create_room or join_room again: the two identities came apart,
//! and every personalised broadcast for the old room was then built from the
//! new index — a player rebound to seat 0 elsewhere received seat 0's hand
//! here. Both tests fail without the guard in the create and join handlers.

#![allow(clippy::field_reassign_with_default)] // a test narrows one knob of the default config

use loco_hub::HubConfig;
use loco_hub::testkit::*;
use serde_json::json;

#[tokio::test]
async fn create_room_refused_while_seated_keeps_opponent_hand_private() {
    let mut c = HubConfig::default();
    c.debug_mode = true;
    let th = new_test_hub_with(c).await;
    let mut alice = dial_ws(&th).await;
    let mut bob = dial_ws(&th).await;

    send_msg(
        &mut alice,
        json!({"type": "create_room", "nickname": "Alice"}),
    )
    .await;
    let created = read_msg_of_type(&mut alice, "room_created").await;
    let code = created["room_code"].clone();

    send_msg(
        &mut bob,
        json!({"type": "join_room", "nickname": "Bob", "room_code": code}),
    )
    .await;
    let joined = read_msg_of_type(&mut bob, "room_joined").await;
    let bob_seat = seat_of(&joined, "player_id");
    assert_eq!(bob_seat, 1, "Bob joined second, expected seat 1");
    let alice_seat = 0;

    send_msg(&mut alice, json!({"type": "start_game"})).await;
    read_msg_of_type(&mut alice, "game_started").await;
    read_msg_of_type(&mut bob, "game_started").await;
    complete_map_load(&mut [&mut alice, &mut bob]).await;

    // The exploit: Bob, seated at 1 in this match, rebinds himself to seat 0 of
    // a throwaway room.
    send_msg(
        &mut bob,
        json!({"type": "create_room", "nickname": "Mallory"}),
    )
    .await;
    // Not fatal: the refusal and the disclosure are two separate claims.
    let resp = read_msg(&mut bob).await;
    let refused = resp["type"] == "error";

    // Arm a Swap for Alice: it forces a personalised game_state to the whole
    // room, which is the call that leaked.
    let swap = json!({"color": "red", "kind": "swap"});
    send_msg(
        &mut alice,
        json!({"type": "debug_set_state", "debug": {
            "hand": [swap, {"color": "red", "kind": "number", "value": 3}],
            "discard": {"color": "red", "kind": "number", "value": 9},
            "active_color": "red",
            "pending_draw": 0,
            "current_turn": alice_seat,
            "direction": 1
        }}),
    )
    .await;
    read_msg_of_type(&mut bob, "game_state").await; // the debug broadcast, not under test

    // Alice swaps hands with Bob: seat 0 then holds Bob's 8 cards and seat 1
    // Alice's remaining single card.
    send_msg(
        &mut alice,
        json!({"type": "play_card", "card": swap, "chosen_player": bob_seat}),
    )
    .await;
    let state = read_msg_of_type(&mut bob, "game_state").await["state"].clone();
    assert!(state.is_object(), "missing state in game_state");
    assert_eq!(
        state["your_index"].as_i64(),
        Some(bob_seat),
        "Bob's seat was rebound"
    );
    // Receiving 8 cards here is receiving seat 0's hand: the disclosure itself.
    let n = state["hand"].as_array().map_or(0, Vec::len);
    assert_eq!(
        n, 1,
        "Bob was handed a {n}-card hand; his own seat holds 1 after the swap: {}",
        state["hand"]
    );
    assert!(
        refused,
        "create_room while seated should be refused, got {resp}"
    );
    th.stop().await;
}

#[tokio::test]
async fn join_room_refused_while_seated_keeps_host_seat() {
    let th = new_test_hub().await;
    let mut alice = dial_ws(&th).await;
    let mut bob = dial_ws(&th).await;

    send_msg(
        &mut alice,
        json!({"type": "create_room", "nickname": "Alice"}),
    )
    .await;
    read_msg_of_type(&mut alice, "room_created").await;
    send_msg(&mut bob, json!({"type": "create_room", "nickname": "Bob"})).await;
    let other = read_msg_of_type(&mut bob, "room_created").await;

    // Alice, host of her own room, tries to take a seat in Bob's.
    send_msg(
        &mut alice,
        json!({"type": "join_room", "nickname": "Alice", "room_code": other["room_code"]}),
    )
    .await;
    let resp = read_msg(&mut alice).await;
    assert_eq!(
        resp["type"], "error",
        "join_room while seated should be refused, got {resp}"
    );

    // She is still seat 0 of her own room, so a host-only action still works.
    send_msg(&mut alice, json!({"type": "add_bot"})).await;
    let got = read_msg(&mut alice).await;
    assert_eq!(
        got["type"], "player_joined",
        "Alice lost her host seat: add_bot answered {got}"
    );
    th.stop().await;
}
