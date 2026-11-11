//! Port of `server/hub/expiry_settle_test.go`.
//!
//! What a hold running out does to the table it ran out at. In a running
//! ordinary match the seat used to stay in the round with its cards, and at a
//! finished table dropping the first expired seat re-based the members without
//! re-basing the holds.

mod common_b;

use common_b::*;
use loco_hub::HubConfig;
use loco_hub::testkit::*;
use serde_json::json;
use std::time::Duration;

fn hold(d: Duration) -> HubConfig {
    let mut c = debug_cfg();
    short_reconnect_hold(&mut c, d);
    c
}

// Above the floor the seat is retired, exactly as leave_room retires it: the
// table sees the departure by seat, then the board again with that seat holding
// nothing, and the match goes on.
#[tokio::test]
async fn reconnect_expiry_a_table_of_three_retires_the_seat() {
    let th = new_test_hub_with(hold(Duration::from_millis(150))).await;
    let (mut conns, _, _) = open_table(&th, &["Alice", "Bob", "Carol"]).await;
    drop(conns.pop());

    for (i, c) in conns.iter_mut().enumerate() {
        read_msg_of_type(c, "player_disconnected").await;
        let left = read_msg_of_type(c, "player_left").await;
        assert_eq!(seat_of(&left, "player_index"), 2, "client {i}");
        assert_eq!(left["nickname"], "Carol", "client {i}");
        let (connected, _) = seat_connected(&left["players"], 2);
        assert!(!connected, "client {i}: seat 2 still reads as connected");
        let gs = read_msg_of_type(c, "game_state").await;
        assert!(
            gs["state"].is_object(),
            "client {i}: game_state without state"
        );
        for p in gs["state"]["players"].as_array().into_iter().flatten() {
            if p["index"] == 2 {
                assert_eq!(
                    p["hand_size"], 0,
                    "client {i}: the expired seat still holds cards"
                );
            }
        }
    }
    assert!(
        !drain_until(&mut conns[0], "match_end", Duration::from_millis(400)).await,
        "the match ended at a table of two that could carry on"
    );
    th.stop().await;
}

// At the floor there is no match left without the seat, so it ends and goes to
// the player who stayed, announced as the forfeit it is.
#[tokio::test]
async fn reconnect_expiry_a_table_of_two_forfeits_to_the_seat_that_stayed() {
    let th = new_test_hub_with(hold(Duration::from_millis(150))).await;
    let TwoPlayers { mut alice, bob, .. } = setup_two_player_game(&th).await;
    drop(bob);

    read_msg_of_type(&mut alice, "player_disconnected").await;
    let left = read_msg_of_type(&mut alice, "player_left").await;
    assert_eq!(seat_of(&left, "player_index"), 1);
    let end = read_msg_of_type(&mut alice, "match_end").await;
    assert_eq!(end["forfeit"], true, "{end}");
    assert_eq!(end["match_winner"], "Alice", "{end}");
    assert_eq!(seat_of(&end, "player_index"), 1, "{end}");
    th.stop().await;
}

// Two holds at a finished table, and the lower one runs out first. The seat
// above it moves down a key, and its hold has to move with it: the roster still
// says that player is away, their token still opens the seat they now sit at,
// and it is their own hold that ends when it ends — not somebody else's seat.
#[tokio::test]
async fn game_over_disconnect_two_holds_rebase_together() {
    let th = new_test_hub_with(hold(Duration::from_secs(1))).await;
    let (conns, code, tokens) = won_table(&th, &["Alice", "Bob", "Carol"]).await;
    let mut it = conns.into_iter();
    let (mut alice, bob, carol) = (it.next().unwrap(), it.next().unwrap(), it.next().unwrap());

    drop(bob); // seat 1
    read_msg_of_type(&mut alice, "player_disconnected").await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    drop(carol); // seat 2
    read_msg_of_type(&mut alice, "player_disconnected").await;

    // Bob's hold runs out first and his seat goes; Carol slides into 1.
    let left = read_msg_of_type(&mut alice, "player_left").await;
    assert_eq!(left["nickname"], "Bob", "{left}");
    assert_eq!(len_of(&left["players"]), 2, "{left}");
    let (connected, present) = seat_connected(&left["players"], 1);
    assert!(
        present && !connected,
        "Carol at seat 1: present={present} connected={connected}, want present and away"
    );

    // Her token opens the seat she now sits at.
    let mut back = dial_ws(&th).await;
    send_msg(
        &mut back,
        json!({"type": "join_room", "nickname": "Carol", "room_code": code, "session_token": tokens[2]}),
    )
    .await;
    let rejoined = read_msg_of_type(&mut back, "player_reconnected").await;
    assert_eq!(
        seat_of(&rejoined, "player_id"),
        1,
        "Carol reclaimed the wrong seat"
    );
    read_msg_of_type(&mut alice, "player_reconnected").await;

    // And the timer armed for her old seat finds her hold gone and does nothing.
    assert!(
        !drain_until(&mut alice, "player_left", Duration::from_millis(1200)).await,
        "a stale expiry removed a seat somebody was sitting at"
    );
    th.stop().await;
}

// Same start, nobody comes back: the second hold has to end too, on its own
// timer, and take its own seat with it rather than leaving a phantom the next
// match would deal a hand to.
#[tokio::test]
async fn game_over_disconnect_the_second_hold_still_expires_after_a_rebase() {
    let th = new_test_hub_with(hold(Duration::from_millis(400))).await;
    let (conns, _, _) = won_table(&th, &["Alice", "Bob", "Carol"]).await;
    let mut it = conns.into_iter();
    let (mut alice, bob, carol) = (it.next().unwrap(), it.next().unwrap(), it.next().unwrap());

    drop(bob);
    read_msg_of_type(&mut alice, "player_disconnected").await;
    tokio::time::sleep(Duration::from_millis(150)).await;
    drop(carol);
    read_msg_of_type(&mut alice, "player_disconnected").await;

    let first = read_msg_of_type(&mut alice, "player_left").await;
    let second = read_msg_of_type(&mut alice, "player_left").await;
    assert_eq!(first["nickname"], "Bob");
    assert_eq!(second["nickname"], "Carol");
    assert_eq!(
        len_of(&second["players"]),
        1,
        "want Alice alone after both holds ran out"
    );
    th.stop().await;
}

// A finished table both players have dropped from, with both holds gone, is a
// table nobody can come back to. It closes on the spot rather than on the
// empty-room timer.
#[tokio::test]
async fn game_over_disconnect_both_holds_expiring_closes_the_table() {
    let th = new_test_hub_with(hold(Duration::from_millis(120))).await;
    let (conns, code, _) = won_table(&th, &["Alice", "Bob"]).await;
    drop(conns);
    assert!(
        wait_room_gone(&th, &code, Duration::from_secs(3)).await,
        "the finished table outlived both holds with nobody at it"
    );
    th.stop().await;
}

// Every message carries the server's clock, which is what the client reads
// every deadline against.
#[tokio::test]
async fn server_msg_carries_server_now() {
    let th = new_test_hub().await;
    let mut conn = dial_ws(&th).await;
    let now_ms = || {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64
    };
    let before = now_ms();
    send_msg(
        &mut conn,
        json!({"type": "create_room", "nickname": "Alice"}),
    )
    .await;
    let created = read_msg_of_type(&mut conn, "room_created").await;
    let sn = created["server_now"].as_i64().unwrap_or(0);
    assert!(
        sn >= before && sn <= now_ms(),
        "server_now = {sn}, want the server's clock at send time"
    );
    th.stop().await;
}
