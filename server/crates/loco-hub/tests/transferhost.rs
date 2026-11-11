//! Port of `server/hub/transferhost_test.go`.

use loco_hub::testkit::*;
use serde_json::{Value, json};

/// Opens a table with Alice as host and seats the named guests at it. Go's
/// `setupLobby` (kick_test.go).
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

async fn assert_deals(ws: &mut Ws, why: &str) {
    let gs = read_msg_of_type(ws, "game_started").await;
    assert!(
        gs["state"].is_object(),
        "game_started missing state — {why}"
    );
}

// The host is seat 0 and nothing else, so handing the table over is a swap of
// two seats. Everything keyed by a seat moves with it, and the two players
// who moved are each told their own new index.
#[tokio::test]
async fn transfer_host_swaps_the_seats_and_the_controls() {
    let th = new_test_hub().await;
    let (mut host, mut guests, _) = setup_lobby(&th, &["Bob", "Carol"]).await;

    send_msg(
        &mut host,
        json!({"type": "transfer_host", "target_index": 1}),
    )
    .await;

    // The old host is seat 1 now, and hears so.
    let mine = read_msg_of_type(&mut host, "host_changed").await;
    assert_eq!(
        seat_of(&mine, "player_id"),
        1,
        "Alice seat after the transfer"
    );
    assert_eq!(
        mine["nickname"], "Bob",
        "host_changed names the wrong player"
    );
    let roster = mine["players"].as_array().cloned().unwrap_or_default();
    assert!(
        roster.len() == 3 && roster[0]["nickname"] == "Bob" && roster[1]["nickname"] == "Alice",
        "roster after the transfer = {roster:?}, want Bob then Alice"
    );

    // The new host is seat 0, and hears the same message with their own index.
    let theirs = read_msg_of_type(&mut guests[0], "host_changed").await;
    assert_eq!(
        seat_of(&theirs, "player_id"),
        0,
        "Bob seat after the transfer"
    );

    // A seat that did not move is told anyway: Carol is still seat 2.
    let carol = read_msg_of_type(&mut guests[1], "host_changed").await;
    assert_eq!(
        seat_of(&carol, "player_id"),
        2,
        "Carol seat after the transfer"
    );

    // The controls went with the seat, both ways.
    send_msg(&mut host, json!({"type": "add_bot"})).await;
    let got = read_msg_of_type(&mut host, "error").await;
    assert_eq!(
        error_of(&got),
        "only the room owner can add bots",
        "the old host's add_bot, want the host-only refusal"
    );
    send_msg(&mut guests[0], json!({"type": "start_game"})).await;
    assert_deals(&mut guests[0], "the new host cannot deal").await;
    th.stop().await;
}

// A bot cannot press start, so a table handed to one is a table that can
// never deal.
#[tokio::test]
async fn transfer_host_refused_to_a_bot() {
    let th = new_test_hub().await;
    let (mut host, _guests, _) = setup_lobby(&th, &["Bob"]).await;

    send_msg(&mut host, json!({"type": "add_bot"})).await;
    read_msg_of_type(&mut host, "player_joined").await;

    send_msg(
        &mut host,
        json!({"type": "transfer_host", "target_index": 2}),
    )
    .await;
    let got = read_msg_of_type(&mut host, "error").await;
    assert_eq!(
        error_of(&got),
        "a bot cannot host the table",
        "want the bot refusal"
    );

    // And the table is still Alice's.
    send_msg(&mut host, json!({"type": "start_game"})).await;
    assert_deals(&mut host, "the refused transfer took the table anyway").await;
    th.stop().await;
}

// It is the host's table, and only the host's.
#[tokio::test]
async fn transfer_host_refused_for_a_guest() {
    let th = new_test_hub().await;
    let (_host, mut guests, _) = setup_lobby(&th, &["Bob", "Carol"]).await;

    send_msg(
        &mut guests[0],
        json!({"type": "transfer_host", "target_index": 2}),
    )
    .await;
    let got = read_msg_of_type(&mut guests[0], "error").await;
    assert_eq!(
        error_of(&got),
        "only the room owner can hand over the table",
        "want the host-only refusal"
    );
    th.stop().await;
}

// Seat 0 is the sender's own by the host check, and a seat number off the end
// of the roster is a client inventing one. Both answer the same string.
#[tokio::test]
async fn transfer_host_refused_on_an_impossible_seat() {
    let th = new_test_hub().await;
    let (mut host, _guests, _) = setup_lobby(&th, &["Bob"]).await;

    for seat in [-1, 0, 2, 99] {
        send_msg(
            &mut host,
            json!({"type": "transfer_host", "target_index": seat}),
        )
        .await;
        let got = read_msg_of_type(&mut host, "error").await;
        assert_eq!(
            error_of(&got),
            "invalid player index",
            "seat {seat}: want invalid player index"
        );
    }
    send_msg(&mut host, json!({"type": "transfer_host"})).await;
    let got = read_msg_of_type(&mut host, "error").await;
    assert_eq!(
        error_of(&got),
        "invalid player index",
        "a transfer naming nobody, want invalid player index"
    );
    th.stop().await;
}

// Once the cards are out a seat belongs to a match, not to the roster:
// swapping two would swap two hands. Same rule as the kick.
#[tokio::test]
async fn transfer_host_refused_once_the_cards_are_out() {
    let th = new_test_hub().await;
    let (mut host, mut guests, _) = setup_lobby(&th, &["Bob"]).await;

    send_msg(&mut host, json!({"type": "start_game"})).await;
    read_msg_of_type(&mut host, "game_started").await;
    read_msg_of_type(&mut guests[0], "game_started").await;
    {
        let (a, b) = (&mut host, &mut guests[0]);
        complete_map_load(&mut [a, b]).await;
    }

    send_msg(
        &mut host,
        json!({"type": "transfer_host", "target_index": 1}),
    )
    .await;
    let got = read_msg_of_type(&mut host, "error").await;
    assert_eq!(
        error_of(&got),
        "can only hand over the table in the lobby",
        "want the lobby-only refusal"
    );
    th.stop().await;
}

// The session token is the proof a seat is yours, so it travels with the
// player and not with the index. Left behind, it would hand a reloading player
// the other one's seat — which on this table is the host's.
#[tokio::test]
async fn transfer_host_the_token_follows_the_player() {
    let th = new_test_hub().await;
    let (mut host, mut guests, code) = setup_lobby(&th, &["Bob"]).await;

    send_msg(
        &mut host,
        json!({"type": "transfer_host", "target_index": 1}),
    )
    .await;
    read_msg_of_type(&mut host, "host_changed").await;
    read_msg_of_type(&mut guests[0], "host_changed").await;

    // Bob owns the table now. Alice leaves and comes back: the seat she is
    // given is a fresh one at the end, and the table is still Bob's.
    send_msg(&mut host, json!({"type": "leave_room"})).await;
    read_msg_of_type(&mut host, "left_room").await;
    read_msg_of_type(&mut guests[0], "player_left").await;

    let mut back = dial_ws(&th).await;
    send_msg(
        &mut back,
        json!({"type": "join_room", "nickname": "Alice", "room_code": code}),
    )
    .await;
    let joined = read_msg_of_type(&mut back, "room_joined").await;
    assert_eq!(
        seat_of(&joined, "player_id"),
        1,
        "Alice rejoined at the wrong seat"
    );
    assert_eq!(
        joined["players"][0]["nickname"], "Bob",
        "roster = {}, want Bob still hosting",
        joined["players"]
    );
    read_msg_of_type(&mut guests[0], "player_joined").await;

    send_msg(&mut guests[0], json!({"type": "start_game"})).await;
    assert_deals(&mut guests[0], "the new host lost the table to a rejoin").await;
    th.stop().await;
}

// A matchmade table has no host: nobody opened it and nobody owns it.
#[tokio::test]
async fn transfer_host_refused_in_a_matchmade_room() {
    let th = new_test_hub().await;
    let mut a = dial_ws(&th).await;
    let mut b = dial_ws(&th).await;
    send_msg(&mut a, json!({"type": "find_match", "nickname": "Alice"})).await;
    read_msg_of_type(&mut a, "matchmaking_queued").await;
    send_msg(&mut b, json!({"type": "find_match", "nickname": "Bob"})).await;
    read_msg_of_type(&mut a, "match_found").await;
    read_msg_of_type(&mut b, "match_found").await;

    send_msg(&mut a, json!({"type": "transfer_host", "target_index": 1})).await;
    let got = read_msg_of_type(&mut a, "error").await;
    assert!(
        !error_of(&got).is_empty(),
        "a transfer in a matchmade room was accepted"
    );
    th.stop().await;
}
