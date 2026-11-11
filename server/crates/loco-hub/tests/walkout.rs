//! Leaving a match in progress, which every table allows. The exit is never
//! refused; what the table size decides is what happens next: above the floor
//! the round carries on without the seat, at or below it the match ends and
//! goes to whoever stayed.

mod common_b;

use common_b::*;
use loco_hub::testkit::*;
use serde_json::json;

// Four seats: one can go and three are left, which is the floor.
#[tokio::test]
async fn walk_out_allowed_when_three_seats_are_left() {
    let th = new_test_hub().await;
    let (mut conns, _, _) = open_table(&th, &["Alice", "Bob", "Carol", "Dave"]).await;

    send_msg(&mut conns[3], json!({"type": "leave_room"})).await;
    read_msg_of_type(&mut conns[3], "left_room").await;

    // The table sees an ordinary departure, and the seat rides it: a running
    // match indexes hands by seat, so nothing moved.
    for (i, c) in conns[..3].iter_mut().enumerate() {
        let left = read_msg_of_type(c, "player_left").await;
        assert_eq!(seat_of(&left, "player_index"), 3, "client {i}");
        assert_eq!(left["nickname"], "Dave", "client {i}");
        // And the roster stops reporting them as present.
        let (connected, _) = seat_connected(&left["players"], 3);
        assert!(!connected, "client {i}: seat 3 still reads as connected");
    }

    // Everybody is handed the board again: the hand went back to the deck and
    // the turn may have moved.
    for (i, c) in conns[..3].iter_mut().enumerate() {
        let gs = read_msg_of_type(c, "game_state").await;
        assert!(
            gs["state"].is_object(),
            "client {i}: game_state without state"
        );
        for p in gs["state"]["players"].as_array().into_iter().flatten() {
            if p["index"] == 3 {
                assert_eq!(
                    p["hand_size"], 0,
                    "client {i}: the seat that left still holds cards"
                );
            }
        }
    }
    th.stop().await;
}

// Three seats: one leaving leaves two, which is still a match, so the round goes
// on without the seat rather than ending for the two who stayed.
#[tokio::test]
async fn walk_out_a_table_of_three_keeps_playing_with_two() {
    let th = new_test_hub().await;
    let (mut conns, _, _) = open_table(&th, &["Alice", "Bob", "Carol"]).await;
    send_msg(&mut conns[2], json!({"type": "leave_room"})).await;
    read_msg_of_type(&mut conns[2], "left_room").await;

    for (i, c) in conns[..2].iter_mut().enumerate() {
        let left = read_msg_of_type(c, "player_left").await;
        assert_eq!(seat_of(&left, "player_index"), 2, "client {i}");
        // The board again, and no match_end behind it: the match is not over.
        let gs = read_msg_of_type(c, "game_state").await;
        assert!(
            gs["state"].is_object(),
            "client {i}: game_state without state"
        );
    }
    th.stop().await;
}

// Two seats: there is no match left to carry on, so it ends where it stands and
// goes to the seat that stayed.
#[tokio::test]
async fn walk_out_a_table_of_two_ends_the_match() {
    let th = new_test_hub().await;
    let (mut conns, _, _) = open_table(&th, &["Alice", "Bob"]).await;
    send_msg(&mut conns[1], json!({"type": "leave_room"})).await;
    read_msg_of_type(&mut conns[1], "left_room").await;

    let end = read_msg_of_type(&mut conns[0], "match_end").await;
    assert_eq!(end["forfeit"], true, "{end}");
    assert_eq!(end["match_winner"], "Alice", "{end}");
    assert_eq!(seat_of(&end, "player_index"), 1, "the seat that left");
    th.stop().await;
}

// The host leaving is the same match end, and it is the one that moves the seat
// underneath the screen it just opened: the player who stayed is re-based from
// 1 onto 0. The recap rides the departure so the game-over screen is rebuilt on
// the seats it is now being read with.
#[tokio::test]
async fn walk_out_the_host_leaving_rebases_the_recap_for_the_seat_that_stayed() {
    let th = new_test_hub().await;
    let (mut conns, _, _) = open_table(&th, &["Alice", "Bob"]).await;
    send_msg(&mut conns[0], json!({"type": "leave_room"})).await;
    read_msg_of_type(&mut conns[0], "left_room").await;

    let end = read_msg_of_type(&mut conns[1], "match_end").await;
    assert_eq!(end["forfeit"], true, "{end}");
    assert_eq!(end["match_winner"], "Bob", "{end}");
    assert_eq!(len_of(&end["match_history"]), 1, "{end}");
    assert_eq!(len_of(&end["match_history"][0]["rounds_won"]), 2, "{end}");

    let left = read_msg_of_type(&mut conns[1], "player_left").await;
    assert_eq!(len_of(&left["players"]), 1, "{left}");
    assert_eq!(left["players"][0]["index"], 0, "want Bob alone at seat 0");
    assert_eq!(len_of(&left["match_history"]), 1, "{left}");
    let row = &left["match_history"][0];
    assert!(
        len_of(&row["rounds_won"]) == 1 && len_of(&row["scores"]) == 1,
        "recap row {row}: the roster re-based and the recap did not"
    );
    th.stop().await;
}

// The floor counts seats that can play, and a bot can play.
#[tokio::test]
async fn walk_out_counts_bots_as_seats_that_can_play() {
    let th = new_test_hub().await;
    let mut host = dial_ws(&th).await;
    send_msg(
        &mut host,
        json!({"type": "create_room", "nickname": "Alice"}),
    )
    .await;
    let created = read_msg_of_type(&mut host, "room_created").await;
    let code = created["room_code"].as_str().unwrap().to_owned();

    let mut guest = dial_ws(&th).await;
    send_msg(
        &mut guest,
        json!({"type": "join_room", "nickname": "Bob", "room_code": code}),
    )
    .await;
    read_msg_of_type(&mut guest, "room_joined").await;
    read_msg_of_type(&mut host, "player_joined").await;

    // Two humans and two bots: Bob can go, and three seats keep playing.
    for _ in 0..2 {
        send_msg(&mut host, json!({"type": "add_bot"})).await;
        read_msg_of_type(&mut host, "player_joined").await;
        read_msg_of_type(&mut guest, "player_joined").await;
    }

    send_msg(&mut host, json!({"type": "start_game"})).await;
    read_msg_of_type(&mut host, "game_started").await;
    read_msg_of_type(&mut guest, "game_started").await;
    complete_map_load(&mut [&mut host, &mut guest]).await;

    send_msg(&mut guest, json!({"type": "leave_room"})).await;
    read_msg_of_type(&mut guest, "left_room").await;
    let left = read_msg_of_type(&mut host, "player_left").await;
    assert_eq!(seat_of(&left, "player_index"), 1);
    th.stop().await;
}

// The seat is not reclaimable: the token is spent and the hand is in the deck.
#[tokio::test]
async fn walk_out_seat_cannot_be_taken_back() {
    let th = new_test_hub().await;
    let (mut conns, code, _) = open_table(&th, &["Alice", "Bob", "Carol", "Dave"]).await;
    send_msg(&mut conns[3], json!({"type": "leave_room"})).await;
    read_msg_of_type(&mut conns[3], "left_room").await;
    for c in conns[..3].iter_mut() {
        read_msg_of_type(c, "player_left").await;
        read_msg_of_type(c, "game_state").await;
    }

    // The same socket asking for its seat back gets the stranger's answer.
    send_msg(
        &mut conns[3],
        json!({"type": "join_room", "nickname": "Dave", "room_code": code, "session_token": "anything"}),
    )
    .await;
    let got = read_msg_of_type(&mut conns[3], "error").await;
    assert_eq!(
        got["error"], "game already in progress",
        "rejoin: want the one string a stranger gets"
    );
    th.stop().await;
}
