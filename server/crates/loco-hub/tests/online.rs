//! The count of connected players, told to the sockets not at a table.

#![allow(clippy::field_reassign_with_default)]

use futures_util::StreamExt;
use loco_hub::HubConfig;
use loco_hub::testkit::*;
use serde_json::{Value, json};
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

/// Waits for the next `players_online` and returns its count.
async fn read_players_online(ws: &mut Ws) -> i64 {
    for _ in 0..20 {
        let m = read_raw(ws).await;
        if m["type"] != "players_online" {
            continue;
        }
        return m["players_online"]
            .as_i64()
            .expect("players_online carried no count");
    }
    panic!("no players_online within 20 messages");
}

/// Makes the tick fast enough for a test.
fn short_online_period() -> HubConfig {
    let mut c = HubConfig::default();
    c.timings.players_online_period = Duration::from_millis(20);
    c
}

/// Every text message that arrives within `wait`, players_online included.
async fn everything_within(ws: &mut Ws, wait: Duration) -> Vec<Value> {
    let deadline = tokio::time::Instant::now() + wait;
    let mut out = Vec::new();
    while let Ok(Some(Ok(frame))) = tokio::time::timeout_at(deadline, ws.next()).await {
        if let Message::Text(t) = frame {
            out.push(serde_json::from_str(t.as_str()).expect("unmarshal"));
        }
    }
    out
}

// A socket is told the count as soon as it registers: the home screen has
// nothing else to draw it from, and waiting for the next tick would leave the
// first load — the visit this count exists for — without one.
#[tokio::test]
async fn players_online_sent_on_connect() {
    let th = new_test_hub().await;
    let mut conn = dial_ws(&th).await;
    // The very first message, and stamped like every other.
    let m = read_raw(&mut conn).await;
    assert_eq!(m["type"], "players_online");
    assert_eq!(m["players_online"], 1, "players_online on connect");
    assert!(
        m["server_now"].as_i64().unwrap_or(0) > 0,
        "no server_now on {m}"
    );
    th.stop().await;
}

// The count moving is what reaches the sockets already here. Nothing is sent
// while it holds still: the ticker checks, it does not announce.
#[tokio::test]
async fn players_online_updates_when_somebody_arrives() {
    let th = new_test_hub_with(short_online_period()).await;

    let mut first = dial_ws(&th).await;
    assert_eq!(read_players_online(&mut first).await, 1, "first socket");

    let _second = dial_ws(&th).await;

    assert_eq!(
        read_players_online(&mut first).await,
        2,
        "after an arrival the first socket"
    );
    th.stop().await;
}

// A tick that changes nothing sends nothing. Without this the count would be
// one small message per seatless socket every period, forever, on a server
// where nobody is doing anything.
#[tokio::test]
async fn players_online_silent_while_unchanged() {
    let th = new_test_hub_with(short_online_period()).await;

    let mut conn = dial_ws(&th).await;
    assert_eq!(read_players_online(&mut conn).await, 1, "connect count");

    // Several periods with nobody arriving or leaving.
    let got = everything_within(&mut conn, Duration::from_millis(200)).await;
    assert!(
        got.is_empty(),
        "a still count was broadcast anyway: {got:?}"
    );
    th.stop().await;
}

// A seated socket is not told: the count is drawn on the home screen and
// nowhere else, and a table in the middle of a match has no use for a message
// arriving on a timer.
#[tokio::test]
async fn players_online_not_sent_to_a_seated_socket() {
    let th = new_test_hub_with(short_online_period()).await;

    let mut host = dial_ws(&th).await;
    assert_eq!(read_players_online(&mut host).await, 1, "connect count");
    send_msg(
        &mut host,
        json!({"type": "create_room", "nickname": "Alice"}),
    )
    .await;
    read_msg_of_type(&mut host, "room_created").await;

    // Somebody else arrives: the count moves, and the seated socket must not
    // hear about it.
    let mut other = dial_ws(&th).await;
    assert_eq!(read_players_online(&mut other).await, 2, "arriving socket");

    let got = everything_within(&mut host, Duration::from_millis(200)).await;
    assert!(
        got.iter().all(|m| m["type"] != "players_online"),
        "a seated socket was sent players_online: {got:?}"
    );
    th.stop().await;
}

// A player who gives their seat up is on the home screen again, so the next
// tick owes them the count — even on a server where nothing else moves. This
// is what the per-socket watermark buys over a single hub-wide one.
#[tokio::test]
async fn players_online_resumes_after_leaving_a_table() {
    let th = new_test_hub_with(short_online_period()).await;

    let mut host = dial_ws(&th).await;
    assert_eq!(read_players_online(&mut host).await, 1, "connect count");
    send_msg(
        &mut host,
        json!({"type": "create_room", "nickname": "Alice"}),
    )
    .await;
    read_msg_of_type(&mut host, "room_created").await;

    // Two more sockets arrive while this one is seated and hears nothing.
    let mut others = Vec::new();
    for _ in 0..2 {
        others.push(dial_ws(&th).await);
    }

    send_msg(&mut host, json!({"type": "leave_room"})).await;
    read_msg_of_type(&mut host, "left_room").await;

    assert_eq!(
        read_players_online(&mut host).await,
        3,
        "back on the home screen the count"
    );
    th.stop().await;
}
