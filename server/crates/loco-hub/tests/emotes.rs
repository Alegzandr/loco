//! Three fixed things, on the game-over screen and nowhere else. Most of what
//! the feature is, is a refusal: a closed set, one screen, and a refusal that
//! costs its sender a message and everybody else nothing. What is deliberately
//! *not* refused is a seat changing its mind — as often as it likes.

#![allow(clippy::field_reassign_with_default)] // a test narrows one knob of the default config

use loco_hub::HubConfig;
use loco_hub::testkit::*;
use serde_json::json;
use std::time::Duration;

/// Alice hosts, Bob joins, and the host wins a BO1.
async fn win_bo1(th: &TestHub) -> (Ws, Ws) {
    let TwoPlayers {
        mut alice, mut bob, ..
    } = setup_two_player_game(th).await;
    let win = json!({"color": "red", "kind": "number", "value": 7});
    send_msg(
        &mut alice,
        json!({"type": "debug_set_state", "debug": {
            "hand": [win],
            "discard": {"color": "red", "kind": "number", "value": 7},
            "pending_draw": 0,
            "current_turn": 0
        }}),
    )
    .await;
    read_msg_of_type(&mut alice, "game_state").await;
    read_msg_of_type(&mut bob, "game_state").await;
    declare_before_winning(&mut alice).await;
    send_msg(&mut alice, json!({"type": "play_card", "card": win})).await;
    read_msg_of_type(&mut alice, "match_end").await;
    read_msg_of_type(&mut bob, "match_end").await;
    (alice, bob)
}

async fn hub() -> TestHub {
    let mut c = HubConfig::default();
    c.debug_mode = true; // debug_set_state
    new_test_hub_with(c).await
}

async fn emote(ws: &mut Ws, e: &str) {
    send_msg(ws, json!({"type": "send_emote", "emote": e})).await;
}

/// The negative read every "refused to its sender alone" test ends on.
async fn assert_no_message(ws: &mut Ws) {
    assert!(
        stays_silent(ws, Duration::from_millis(300)).await,
        "a refusal reached the rest of the table"
    );
}

#[tokio::test]
async fn emote_reaches_the_whole_table_once_the_match_is_over() {
    let th = hub().await;
    let (mut conn1, mut conn2) = win_bo1(&th).await;

    emote(&mut conn1, "gg").await;
    for (i, conn) in [&mut conn1, &mut conn2].into_iter().enumerate() {
        let got = read_msg_of_type(conn, "emote").await;
        assert_eq!(seat_of(&got, "player_index"), 0, "client {i}: emote seat");
        assert_eq!(got["emote"], "gg", "client {i}: emote");
    }
    th.stop().await;
}

// The set is the server's. A client cannot invent a fourth, and the one it
// made up is refused rather than relayed.
#[tokio::test]
async fn emote_refuses_an_identifier_it_does_not_know() {
    let th = hub().await;
    let (mut conn1, mut conn2) = win_bo1(&th).await;

    emote(&mut conn1, "ez").await;
    let got = read_msg_of_type(&mut conn1, "error").await;
    assert_eq!(
        got["error"], "unknown emote",
        "want the unknown-emote refusal"
    );
    // And the table hears nothing at all.
    assert_no_message(&mut conn2).await;
    th.stop().await;
}

// Mid-round it would be something to do to somebody, which is the thing a
// reaction game least needs.
#[tokio::test]
async fn emote_refused_before_the_match_is_over() {
    let th = hub().await;
    // Alice hosts Bob and Carol.
    let mut host = dial_ws(&th).await;
    send_msg(
        &mut host,
        json!({"type": "create_room", "nickname": "Alice"}),
    )
    .await;
    let code = read_msg_of_type(&mut host, "room_created").await["room_code"]
        .as_str()
        .expect("room_code")
        .to_owned();
    let mut conns = vec![host];
    for name in ["Bob", "Carol"] {
        let mut c = dial_ws(&th).await;
        send_msg(
            &mut c,
            json!({"type": "join_room", "nickname": name, "room_code": code}),
        )
        .await;
        read_msg_of_type(&mut c, "room_joined").await;
        for seated in conns.iter_mut() {
            read_msg_of_type(seated, "player_joined").await;
        }
        conns.push(c);
    }
    send_msg(&mut conns[0], json!({"type": "start_game"})).await;
    for c in conns.iter_mut() {
        read_msg_of_type(c, "game_started").await;
    }
    {
        let mut refs: Vec<&mut Ws> = conns.iter_mut().collect();
        complete_map_load(&mut refs).await;
    }

    emote(&mut conns[0], "gg").await;
    let got = read_msg_of_type(&mut conns[0], "error").await;
    assert_eq!(
        got["error"], "emotes are only for the end of a match",
        "want the wrong-screen refusal"
    );
    assert_no_message(&mut conns[1]).await;
    th.stop().await;
}

// A seat changes its mind as often as it likes, and the table sees every
// change. The traffic is bounded by the per-client token bucket, like every
// other message on the socket.
#[tokio::test]
async fn emote_changes_as_often_as_the_seat_likes() {
    let th = hub().await;
    let (mut conn1, mut conn2) = win_bo1(&th).await;

    for want in ["gg", "lucky", "close", "gg"] {
        emote(&mut conn1, want).await;
        for (i, conn) in [&mut conn1, &mut conn2].into_iter().enumerate() {
            let got = read_msg_of_type(conn, "emote").await;
            assert!(
                seat_of(&got, "player_index") == 0 && got["emote"] == want,
                "client {i}: emote = {got}, want seat 0 {want:?}"
            );
        }
    }
    th.stop().await;
}

// Two seats, back to back: neither is ever waiting on the other.
#[tokio::test]
async fn emote_the_other_seat_is_not_throttled_by_it() {
    let th = hub().await;
    let (mut conn1, mut conn2) = win_bo1(&th).await;

    emote(&mut conn1, "gg").await;
    read_msg_of_type(&mut conn1, "emote").await;
    read_msg_of_type(&mut conn2, "emote").await;

    emote(&mut conn2, "close").await;
    let got = read_msg_of_type(&mut conn2, "emote").await;
    assert!(
        seat_of(&got, "player_index") == 1 && got["emote"] == "close",
        "emote = {got}, want seat 1 close"
    );
    read_msg_of_type(&mut conn1, "emote").await;
    th.stop().await;
}
