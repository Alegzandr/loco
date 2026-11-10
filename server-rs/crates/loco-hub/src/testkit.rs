//! The WebSocket harness: `hub_test.go`'s helpers, for the handler tests to
//! stand on. Behind the `testkit` feature, which the crate's own tests turn on.
//!
//! Everything here goes through a real socket on loopback, because what a
//! handler test claims is about the server a player is connected to. That is
//! also why these helpers run on real time: a paused clock auto-advances
//! whenever the runtime is idle, and a test waiting on a socket is idle. Use
//! `tokio::time::pause` in tests that drive a [`crate::Table`] or the actor
//! directly, where nothing waits on the kernel.

use crate::{Hub, HubConfig};
use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use std::net::SocketAddr;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::{self, Message, client::IntoClientRequest};
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

/// A client socket, as a test holds it.
pub type Ws = WebSocketStream<MaybeTlsStream<TcpStream>>;

/// How long a read waits before the test fails, like Go's 3s read deadline.
pub const READ_TIMEOUT: Duration = Duration::from_secs(3);

/// A running hub behind a real listener on loopback. Go's `newTestHub`.
pub struct TestHub {
    pub hub: Hub,
    pub addr: SocketAddr,
    server: JoinHandle<()>,
}

impl TestHub {
    pub fn ws_url(&self) -> String {
        format!("ws://{}/ws", self.addr)
    }

    /// Stops the listener and the hub, and waits for the hub to be gone.
    pub async fn stop(self) {
        self.server.abort();
        self.hub.stop().await;
    }
}

/// A hub on its default configuration.
pub async fn new_test_hub() -> TestHub {
    new_test_hub_with(HubConfig::default()).await
}

/// A hub on `cfg` — how a test narrows a ceiling or shortens a clock, where Go
/// assigned a package variable and restored it.
pub async fn new_test_hub_with(cfg: HubConfig) -> TestHub {
    let hub = Hub::start(cfg);
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind loopback");
    let addr = listener.local_addr().expect("local addr");
    let app = crate::routes(hub.clone()).into_make_service_with_connect_info::<SocketAddr>();
    let server = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    TestHub { hub, addr, server }
}

/// Opens a socket. Go's `dialWS`.
pub async fn dial_ws(th: &TestHub) -> Ws {
    try_dial_ws(th, &[]).await.expect("dial")
}

/// Opens a socket with extra request headers, and hands back the refusal
/// rather than failing: the admission tests read its status.
pub async fn try_dial_ws(th: &TestHub, headers: &[(&str, &str)]) -> Result<Ws, tungstenite::Error> {
    let mut req = th.ws_url().into_client_request()?;
    for (k, v) in headers {
        req.headers_mut().append(
            tungstenite::http::HeaderName::from_bytes(k.as_bytes()).expect("header name"),
            tungstenite::http::HeaderValue::from_str(v).expect("header value"),
        );
    }
    let (ws, _) = tokio_tungstenite::connect_async(req).await?;
    Ok(ws)
}

/// The HTTP status a refused upgrade answered with.
pub fn refusal_status(err: &tungstenite::Error) -> Option<u16> {
    match err {
        tungstenite::Error::Http(resp) => Some(resp.status().as_u16()),
        _ => None,
    }
}

/// Sends one client message. Go's `sendMsg`.
pub async fn send_msg(ws: &mut Ws, msg: Value) {
    ws.send(Message::text(msg.to_string()))
        .await
        .expect("write");
}

/// Sends raw text, for the tests about what a client should never send.
pub async fn send_text(ws: &mut Ws, text: &str) {
    ws.send(Message::text(text.to_owned()))
        .await
        .expect("write");
}

/// The next server message, whatever it is. Go's `readRaw`.
pub async fn read_raw(ws: &mut Ws) -> Value {
    loop {
        let frame = tokio::time::timeout(READ_TIMEOUT, ws.next())
            .await
            .expect("read: timed out")
            .expect("read: socket closed")
            .expect("read");
        match frame {
            Message::Text(t) => return serde_json::from_str(t.as_str()).expect("unmarshal"),
            Message::Close(_) => panic!("read: the server closed the socket"),
            _ => continue, // pings and pongs are the transport's
        }
    }
}

/// The next server message that is not `players_online`, which answers nothing
/// and can land in front of any reply. Go's `readMsg`.
pub async fn read_msg(ws: &mut Ws) -> Value {
    for _ in 0..10 {
        let m = read_raw(ws).await;
        if m["type"] != "players_online" {
            return m;
        }
    }
    panic!("nothing but players_online in 10 messages");
}

/// Reads until a message of `typ` arrives, skipping up to ten others. Go's
/// `readMsgOfType`.
pub async fn read_msg_of_type(ws: &mut Ws, typ: &str) -> Value {
    for _ in 0..10 {
        let m = read_msg(ws).await;
        if m["type"] == typ {
            return m;
        }
    }
    panic!("did not receive a message of type {typ:?} within 10 attempts");
}

/// Whether the server says nothing more within `wait`.
pub async fn stays_silent(ws: &mut Ws, wait: Duration) -> bool {
    // One deadline for the whole wait: a ping every few milliseconds must not
    // keep extending it.
    let deadline = tokio::time::Instant::now() + wait;
    loop {
        match tokio::time::timeout_at(deadline, ws.next()).await {
            Err(_) => return true,
            Ok(Some(Ok(Message::Text(t)))) => {
                let v: Value = serde_json::from_str(t.as_str()).unwrap_or_default();
                if v["type"] != "players_online" {
                    return false;
                }
            }
            Ok(Some(Ok(_))) => continue,
            Ok(_) => return false,
        }
    }
}

/// A plain `GET`, for `/health` and `/metrics`: status and body.
pub async fn http_get(th: &TestHub, path: &str) -> (u16, String, String) {
    let mut s = TcpStream::connect(th.addr).await.expect("connect");
    let req = format!(
        "GET {path} HTTP/1.1\r\nHost: {}\r\nConnection: close\r\n\r\n",
        th.addr
    );
    s.write_all(req.as_bytes()).await.expect("write");
    let mut raw = Vec::new();
    s.read_to_end(&mut raw).await.expect("read");
    let text = String::from_utf8_lossy(&raw).into_owned();
    let (head, body) = text.split_once("\r\n\r\n").unwrap_or((&text, ""));
    let status = head
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let content_type = head
        .lines()
        .find_map(|l| {
            let (k, v) = l.split_once(':')?;
            k.eq_ignore_ascii_case("content-type")
                .then(|| v.trim().to_owned())
        })
        .unwrap_or_default();
    (status, content_type, body.to_owned())
}

/// Polls `cond` until it holds or `within` passes. For a counter the loop
/// updates on its own schedule, where Go slept 10 ms and hoped.
pub async fn eventually(within: Duration, mut cond: impl FnMut() -> bool) -> bool {
    let deadline = tokio::time::Instant::now() + within;
    loop {
        if cond() {
            return true;
        }
        if tokio::time::Instant::now() >= deadline {
            return false;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
}
