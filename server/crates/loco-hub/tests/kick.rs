//! The host removing a seat from the waiting room.

use loco_hub::testkit::*;
use serde_json::{Value, json};

/// Opens a table with Alice as host and seats the named guests at it. Returns
/// the host connection, the guest connections in seat order, and the code.
/// Nothing is dealt.
async fn setup_lobby(th: &TestHub, guests: &[&str]) -> (Ws, Vec<Ws>, String) {
    let mut host = dial_ws(th).await;
    send_msg(
        &mut host,
        json!({"type": "create_room", "nickname": "Alice"}),
    )
    .await;
    let code = read_msg_of_type(&mut host, "room_created").await["room_code"]
        .as_str()
        .expect("room_code")
        .to_owned();
    let mut conns: Vec<Ws> = Vec::new();
    for name in guests {
        let mut c = dial_ws(th).await;
        send_msg(
            &mut c,
            json!({"type": "join_room", "nickname": name, "room_code": code}),
        )
        .await;
        read_msg_of_type(&mut c, "room_joined").await;
        read_msg_of_type(&mut host, "player_joined").await;
        for prev in conns.iter_mut() {
            read_msg_of_type(prev, "player_joined").await;
        }
        conns.push(c);
    }
    (host, conns, code)
}

fn error_of(m: &Value) -> &str {
    m["error"].as_str().unwrap_or_default()
}

fn players(m: &Value) -> Vec<Value> {
    m["players"].as_array().cloned().unwrap_or_default()
}

// A kick is a departure like any other from the table's point of view: the
// roster shrinks, the seats above it move down, and everybody still there is
// told. The removed player is told so on their own socket.
#[tokio::test]
async fn kick_player_frees_the_seat_and_rebases_the_ones_above() {
    let th = new_test_hub().await;
    let (mut host, mut guests, _) = setup_lobby(&th, &["Bob", "Carol"]).await;

    send_msg(&mut host, json!({"type": "kick_player", "target_index": 1})).await;

    read_msg_of_type(&mut guests[0], "kicked").await;
    let left = read_msg_of_type(&mut host, "player_left").await;
    assert_eq!(left["nickname"], "Bob", "player_left nickname");
    let roster = players(&left);
    assert_eq!(roster.len(), 2, "roster = {roster:?}, want 2 players");
    assert!(
        roster[1]["nickname"] == "Carol" && roster[1]["index"] == 1,
        "Carol is at {:?}, want seat 1",
        roster[1]
    );
    read_msg_of_type(&mut guests[1], "player_left").await;

    // The seat Carol was re-based to has to be the seat she is dealt into.
    send_msg(&mut host, json!({"type": "start_game"})).await;
    let started = read_msg_of_type(&mut guests[1], "game_started").await;
    assert!(
        started["state"].is_object(),
        "game_started carried no state"
    );
    assert_eq!(
        started["state"]["your_index"], 1,
        "Carol was dealt the wrong seat"
    );
    th.stop().await;
}

// It is the host's table, and only the host's.
#[tokio::test]
async fn kick_player_refused_for_a_guest() {
    let th = new_test_hub().await;
    let (_host, mut guests, _) = setup_lobby(&th, &["Bob", "Carol"]).await;

    send_msg(
        &mut guests[0],
        json!({"type": "kick_player", "target_index": 2}),
    )
    .await;
    let got = read_msg_of_type(&mut guests[0], "error").await;
    assert_eq!(
        error_of(&got),
        "only the room owner can remove players",
        "want the host-only refusal"
    );
    th.stop().await;
}

// Seat 0 is the host's own. Letting a kick take it would hand the table to
// whoever sat in seat 1; the way out of your own seat is leave_room.
#[tokio::test]
async fn kick_player_refused_on_the_hosts_own_seat() {
    let th = new_test_hub().await;
    let (mut host, _guests, _) = setup_lobby(&th, &["Bob"]).await;

    for seat in [0, 5, -1] {
        send_msg(
            &mut host,
            json!({"type": "kick_player", "target_index": seat}),
        )
        .await;
        let got = read_msg_of_type(&mut host, "error").await;
        assert_eq!(
            error_of(&got),
            "invalid player index",
            "seat {seat}: want the invalid-seat refusal"
        );
    }
    send_msg(&mut host, json!({"type": "kick_player"})).await;
    let got = read_msg_of_type(&mut host, "error").await;
    assert_eq!(
        error_of(&got),
        "invalid player index",
        "no target: want the invalid-seat refusal"
    );
    th.stop().await;
}

// Once the cards are out a seat belongs to a match rather than to the roster,
// and the only thing that ends one early is a forfeit.
#[tokio::test]
async fn kick_player_refused_once_the_cards_are_out() {
    let th = new_test_hub().await;
    let TwoPlayers { mut alice, .. } = setup_two_player_game(&th).await;

    send_msg(
        &mut alice,
        json!({"type": "kick_player", "target_index": 1}),
    )
    .await;
    let got = read_msg_of_type(&mut alice, "error").await;
    assert_eq!(
        error_of(&got),
        "can only remove players in the lobby",
        "want the lobby-only refusal"
    );
    th.stop().await;
}

// A bot is a seat like any other here, and this is the only way to take one
// back. The slot behind it has no socket, so it goes through its own removal
// path — which still has to re-base everything the human path re-bases.
#[tokio::test]
async fn kick_player_takes_a_bot_seat_back() {
    let th = new_test_hub().await;
    let (mut host, mut guests, _) = setup_lobby(&th, &["Bob"]).await;
    let bob = &mut guests[0];

    send_msg(&mut host, json!({"type": "add_bot"})).await;
    read_msg_of_type(&mut host, "player_joined").await;
    read_msg_of_type(bob, "player_joined").await;

    // Bot1 took seat 2; removing it must leave Alice and Bob where they were.
    send_msg(&mut host, json!({"type": "kick_player", "target_index": 2})).await;
    let left = read_msg_of_type(&mut host, "player_left").await;
    assert_eq!(left["nickname"], "Bot1", "player_left nickname");
    assert_eq!(players(&left).len(), 2, "roster, want 2 players");
    read_msg_of_type(bob, "player_left").await;

    let bots = th.hub.metrics_stats().bots_active;
    assert_eq!(bots, 0, "bots_active after the bot was removed");

    send_msg(&mut host, json!({"type": "start_game"})).await;
    let started = read_msg_of_type(bob, "game_started").await;
    assert_eq!(
        started["state"]["your_index"], 1,
        "Bob did not keep seat 1 across the bot's removal"
    );
    th.stop().await;
}

// A kick is not a ban: the table code is already in the kicked player's hands
// and there is no identity in this game to refuse them by. The socket is
// simply seatless again, which is the same state leave_room leaves it in.
#[tokio::test]
async fn kick_player_leaves_the_socket_free_to_sit_down_again() {
    let th = new_test_hub().await;
    let (mut host, mut guests, code) = setup_lobby(&th, &["Bob"]).await;
    let bob = &mut guests[0];

    send_msg(&mut host, json!({"type": "kick_player", "target_index": 1})).await;
    read_msg_of_type(bob, "kicked").await;
    read_msg_of_type(&mut host, "player_left").await;

    send_msg(
        bob,
        json!({"type": "join_room", "nickname": "Bob", "room_code": code}),
    )
    .await;
    let joined = read_msg_of_type(bob, "room_joined").await;
    assert_eq!(
        seat_of(&joined, "player_id"),
        1,
        "rejoined at the wrong seat"
    );
    th.stop().await;
}
