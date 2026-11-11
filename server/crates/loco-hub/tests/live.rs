//! Port of `server/hub/live_test.go`.

use futures_util::StreamExt;
use loco_hub::net::wire::LiveStream;
use loco_hub::router::live::LIVE_WIRE_MAX;
use loco_hub::testkit::*;
use serde_json::Value;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

fn live_rows(logins: &[&str]) -> Vec<LiveStream> {
    logins
        .iter()
        .enumerate()
        .map(|(i, l)| LiveStream {
            login: (*l).to_owned(),
            name: (*l).to_owned(),
            viewers: 100 - i as i32,
            lang: String::new(),
            thumb: String::new(),
        })
        .collect()
}

/// Waits up to 2 s for the next `live_streams` and returns its rows, or
/// `None` when none arrived. Go's `readLive`.
async fn read_live(ws: &mut Ws) -> Option<Vec<Value>> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(2);
    for _ in 0..20 {
        loop {
            match tokio::time::timeout_at(deadline, ws.next()).await {
                Ok(Some(Ok(Message::Text(t)))) => {
                    let m: Value = serde_json::from_str(t.as_str()).ok()?;
                    if m["type"] == "live_streams" {
                        return Some(m["live_streams"].as_array().cloned().unwrap_or_default());
                    }
                    break;
                }
                Ok(Some(Ok(_))) => continue,
                _ => return None,
            }
        }
    }
    None
}

async fn read_players_online(ws: &mut Ws) -> i64 {
    for _ in 0..20 {
        let m = read_raw(ws).await;
        if m["type"] == "players_online" {
            return m["players_online"].as_i64().expect("a count");
        }
    }
    panic!("no players_online within 20 messages");
}

// The strip is drawn on the home screen and nowhere else, so it goes to the
// sockets that are not sitting at a table — the same rule players_online
// follows, and the same reason.
#[tokio::test]
async fn live_streams_reaches_a_seatless_socket() {
    let th = new_test_hub().await;
    let mut conn = dial_ws(&th).await;
    assert_eq!(read_players_online(&mut conn).await, 1);

    th.hub.publish_live(live_rows(&["kisuke_", "someone"]));

    let rows = read_live(&mut conn).await.expect("no live_streams arrived");
    assert!(
        rows.len() == 2 && rows[0]["login"] == "kisuke_",
        "rows = {rows:?}"
    );
    th.stop().await;
}

// A publication that changes nothing sends nothing. Without the per-socket
// watermark, every poll would push the same list to every seatless socket for
// as long as the server is up.
#[tokio::test]
async fn live_streams_same_version_is_not_sent_twice() {
    let th = new_test_hub().await;
    let mut conn = dial_ws(&th).await;
    read_players_online(&mut conn).await;

    th.hub.publish_live(live_rows(&["kisuke_"]));
    assert!(
        read_live(&mut conn).await.is_some(),
        "the first publication never arrived"
    );

    // Nothing publishes again, so nothing should arrive. The deadline in
    // read_live is what makes "nothing" observable.
    if let Some(rows) = read_live(&mut conn).await {
        panic!("a second copy arrived unasked: {rows:?}");
    }
    th.stop().await;
}

// A socket that arrives after a publication is told on arrival, rather than
// waiting for somebody to go live or off air. On a quiet evening that wait is
// for ever, which is the same bug the per-socket watermark exists for.
#[tokio::test]
async fn live_streams_sent_on_connect() {
    let th = new_test_hub().await;
    th.hub.publish_live(live_rows(&["kisuke_"]));
    // The publication crosses to the loop through the router box; one round
    // trip through the loop orders the connect after it, where Go slept.
    th.hub.on_loop(|_| ()).await;

    let mut conn = dial_ws(&th).await;
    let rows = read_live(&mut conn)
        .await
        .expect("a socket arriving after a publication was told nothing");
    assert!(
        rows.len() == 1 && rows[0]["login"] == "kisuke_",
        "rows = {rows:?}"
    );
    th.stop().await;
}

// Six on the wire. The strip draws three; the rest is slack for the rows the
// screen drops, and it is capped because this message reaches every seatless
// socket at once.
#[tokio::test]
async fn live_streams_capped_for_the_wire() {
    let th = new_test_hub().await;
    let mut conn = dial_ws(&th).await;
    read_players_online(&mut conn).await;

    let many: Vec<String> = (0..LIVE_WIRE_MAX + 4)
        .map(|i| format!("chan{}", (b'a' + i as u8) as char))
        .collect();
    let refs: Vec<&str> = many.iter().map(String::as_str).collect();
    th.hub.publish_live(live_rows(&refs));

    let rows = read_live(&mut conn).await.expect("no live_streams arrived");
    assert_eq!(rows.len(), LIVE_WIRE_MAX, "wire rows");
    th.stop().await;
}

// An empty list is a real answer: it says nobody is live any more. It has to
// survive the wire.
#[tokio::test]
async fn live_streams_empty_list_is_told() {
    let th = new_test_hub().await;
    let mut conn = dial_ws(&th).await;
    read_players_online(&mut conn).await;

    th.hub.publish_live(live_rows(&["kisuke_"]));
    assert!(
        read_live(&mut conn).await.is_some(),
        "the first publication never arrived"
    );

    th.hub.publish_live(Vec::new());
    let rows = read_live(&mut conn)
        .await
        .expect("emptying the list told nobody");
    assert!(rows.is_empty(), "rows = {rows:?}, want none");
    th.stop().await;
}

// PublishLive is called from a task that must never wait on this loop.
// post_to_router is non-blocking by construction; this is the assertion that
// says so, because the failure is a poller wedged behind a busy server.
#[tokio::test]
async fn publish_live_never_blocks() {
    let th = new_test_hub().await;
    let hub = th.hub.clone();
    // On a task of its own, the way the poller calls it. Synchronous all the
    // way: a call that waited on the loop could not return here at all.
    let done = tokio::spawn(async move {
        for _ in 0..2000 {
            hub.publish_live(live_rows(&["kisuke_"]));
        }
    });
    tokio::time::timeout(Duration::from_secs(5), done)
        .await
        .expect("publish_live blocked")
        .unwrap();
    th.stop().await;
}

// A server with no gateway key installs no stats reader, and /metrics still
// answers rather than panicking on a missing function.
#[tokio::test]
async fn live_stats_default_to_zero() {
    let th = new_test_hub().await;
    assert_eq!(
        th.hub.metrics_stats().live,
        loco_hub::LiveStats::default(),
        "live stats, want zeroes"
    );
    let (status, _, _) = http_get(&th, "/metrics").await;
    assert_eq!(status, 200);
    th.stop().await;
}
