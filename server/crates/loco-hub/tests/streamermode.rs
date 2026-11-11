//! Streamer mode is the one preference in this game that is not purely local.
//! The table code is a single string shared by everybody who can see it, so a
//! host who is streaming is exposed by their guests' screens as much as by
//! their own. These tests pin who may set it, who hears about it, and every
//! path a client can learn the current answer from.

use loco_hub::testkit::*;
use serde_json::{Value, json};

/// Opens a table with Alice as host and seats the named guests at it.
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

/// `streamer_mode` is omitempty on the wire: absent is false.
fn streamer(m: &Value) -> bool {
    m["streamer_mode"].as_bool().unwrap_or(false)
}

async fn set(ws: &mut Ws, on: bool) {
    send_msg(
        ws,
        json!({"type": "set_streamer_mode", "streamer_mode": on}),
    )
    .await;
}

/// Reads the next `error` and checks its text.
async fn expect_error(ws: &mut Ws, want: &str) {
    let msg = read_msg_of_type(ws, "error").await;
    let err = msg["error"].as_str().unwrap_or_default();
    assert!(
        err.contains(want),
        "error = {err:?}, want it to contain {want:?}"
    );
}

#[tokio::test]
async fn set_streamer_mode_reaches_every_seat() {
    let th = new_test_hub().await;
    let (mut host, mut guests, _) = setup_lobby(&th, &["Bob"]).await;

    set(&mut host, true).await;

    // The host included: the setting is the table's answer now, not the state
    // of one switch in one panel.
    for (name, conn) in [("the host", &mut host), ("Bob", &mut guests[0])] {
        let got = read_msg_of_type(conn, "streamer_mode_changed").await;
        assert!(
            streamer(&got),
            "{name} was told streamer_mode=false, want true"
        );
    }
    th.stop().await;
}

// Off travels exactly like on. The switch is a state, not a toggle.
#[tokio::test]
async fn set_streamer_mode_turns_back_off() {
    let th = new_test_hub().await;
    let (mut host, mut guests, _) = setup_lobby(&th, &["Bob"]).await;
    let bob = &mut guests[0];

    set(&mut host, true).await;
    read_msg_of_type(bob, "streamer_mode_changed").await;

    send_msg(&mut host, json!({"type": "set_streamer_mode"})).await;
    let got = read_msg_of_type(bob, "streamer_mode_changed").await;
    assert!(
        !streamer(&got),
        "streamer_mode stayed on after being switched off"
    );
    th.stop().await;
}

// A repeat of the state the table is already in is not an error, but it is
// broadcast to nobody.
#[tokio::test]
async fn set_streamer_mode_repeat_broadcasts_nothing() {
    let th = new_test_hub().await;
    let (mut host, mut guests, _) = setup_lobby(&th, &["Bob"]).await;
    let bob = &mut guests[0];

    set(&mut host, true).await;
    read_msg_of_type(bob, "streamer_mode_changed").await;

    // The second true says nothing new. The false behind it does, so it is what
    // Bob's next streamer_mode_changed must carry.
    set(&mut host, true).await;
    send_msg(&mut host, json!({"type": "set_streamer_mode"})).await;

    let got = read_msg_of_type(bob, "streamer_mode_changed").await;
    assert!(
        !streamer(&got),
        "the repeated set was broadcast; want it swallowed"
    );
    th.stop().await;
}

// It is a table setting, and a table's settings are seat 0's.
#[tokio::test]
async fn set_streamer_mode_refused_for_a_guest() {
    let th = new_test_hub().await;
    let (mut host, mut guests, _) = setup_lobby(&th, &["Bob"]).await;

    set(&mut guests[0], true).await;
    expect_error(&mut guests[0], "only the host").await;

    // And nothing moved: the host is the seat that would have been told.
    set(&mut host, true).await;
    let got = read_msg_of_type(&mut host, "streamer_mode_changed").await;
    assert!(streamer(&got), "the host's own set did not take");
    th.stop().await;
}

// A table with no host has no code on anybody's screen, so there is nothing
// to blur and nobody to ask.
#[tokio::test]
async fn set_streamer_mode_refused_at_a_hostless_table() {
    let th = new_test_hub().await;
    let mut conn = dial_ws(&th).await;

    send_msg(&mut conn, json!({"type": "play_bot", "nickname": "Alice"})).await;
    read_msg_of_type(&mut conn, "game_started").await;

    set(&mut conn, true).await;
    expect_error(&mut conn, "not available in this game").await;
    th.stop().await;
}

// Somebody who types the code after the host started streaming has to arrive
// already blurred.
#[tokio::test]
async fn set_streamer_mode_rides_the_join() {
    let th = new_test_hub().await;
    let (mut host, _, code) = setup_lobby(&th, &[]).await;

    set(&mut host, true).await;
    read_msg_of_type(&mut host, "streamer_mode_changed").await;

    let mut guest = dial_ws(&th).await;
    send_msg(
        &mut guest,
        json!({"type": "join_room", "nickname": "Bob", "room_code": code}),
    )
    .await;
    let got = read_msg_of_type(&mut guest, "room_joined").await;
    assert!(
        streamer(&got),
        "room_joined did not carry the table's streamer mode"
    );
    th.stop().await;
}

// And a tab that reloads mid-match rebuilds the table from the state snapshot
// and nothing else, so the setting rides that too.
#[tokio::test]
async fn set_streamer_mode_rides_the_state_snapshot() {
    let th = new_test_hub().await;
    let (mut host, mut guests, _) = setup_lobby(&th, &["Bob"]).await;

    set(&mut host, true).await;
    read_msg_of_type(&mut host, "streamer_mode_changed").await;
    read_msg_of_type(&mut guests[0], "streamer_mode_changed").await;

    send_msg(&mut host, json!({"type": "start_game"})).await;
    let started = read_msg_of_type(&mut guests[0], "game_started").await;
    assert!(
        started["state"].is_object(),
        "game_started carried no state"
    );
    assert!(
        streamer(&started["state"]),
        "the dealt state dropped the table's streamer mode"
    );
    th.stop().await;
}
