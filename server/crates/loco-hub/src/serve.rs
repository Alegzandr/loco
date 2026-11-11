//! The socket, from the HTTP request to a registered client: which origins may
//! open one, and the two ceilings refused **before** the upgrade, because the
//! window between the upgrade and the register is where a flood lives. Port of
//! `server/hub/serve.go`, plus the two operator endpoints `main.go` served.

use crate::Hub;
use crate::client::{Client, MAX_MSG_SIZE};
use crate::hub::{Register, Shared};
use crate::privacy::ClientNet;
use axum::Router;
use axum::extract::State;
use axum::extract::ws::WebSocketUpgrade;
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::oneshot;

/// The per-network and global connection counts, decided before a client
/// exists. Its own counter, not `metrics.clients`: that one is maintained by
/// the hub's loop and would let an unbounded number of sockets arrive in the
/// window between the upgrade and the register.
#[derive(Debug, Default)]
pub(crate) struct Admission {
    per_net: HashMap<String, usize>,
    total: usize,
}

/// One slot against the ceilings, given back exactly once: by the hub on
/// unregister, or by being dropped when the upgrade never happened.
#[derive(Debug)]
pub struct AdmissionSlot {
    shared: Arc<Shared>,
    net: String,
    released: AtomicBool,
}

impl AdmissionSlot {
    pub(crate) fn release(&self) {
        if self.released.swap(true, Ordering::AcqRel) {
            return;
        }
        let mut a = self
            .shared
            .admission
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        match a.per_net.get_mut(&self.net) {
            Some(n) if *n > 1 => *n -= 1,
            _ => {
                a.per_net.remove(&self.net);
            }
        }
        a.total = a.total.saturating_sub(1);
    }
}

impl Drop for AdmissionSlot {
    fn drop(&mut self) {
        self.release();
    }
}

/// Takes one slot against the global and per-network ceilings, if there is
/// one.
pub(crate) fn admit(shared: &Arc<Shared>, net: &str) -> Option<AdmissionSlot> {
    let limits = &shared.cfg.limits;
    let mut a = shared.admission.lock().unwrap_or_else(|e| e.into_inner());
    if a.total >= limits.max_clients
        || a.per_net.get(net).copied().unwrap_or(0) >= limits.max_conns_per_net
    {
        return None;
    }
    *a.per_net.entry(net.to_owned()).or_default() += 1;
    a.total += 1;
    Some(AdmissionSlot {
        shared: shared.clone(),
        net: net.to_owned(),
        released: AtomicBool::new(false),
    })
}

/// Whether a browser at `origin` may upgrade.
///
/// No `Origin` is not a browser, and nothing here is authenticated by anything
/// a non-browser client could be tricked into replaying. With an allowlist the
/// list is the whole rule; without one, hostnames must match and ports need
/// not, so the dev client on :5173 reaches the server on :8080 while
/// `evil.example` is refused either way.
pub fn origin_allowed(origin: Option<&str>, host: Option<&str>, allowed: &[String]) -> bool {
    let Some(origin) = origin else {
        return true;
    };
    let Some(origin_host) = origin_hostname(origin) else {
        return false;
    };
    if !allowed.is_empty() {
        return allowed.iter().any(|a| a.eq_ignore_ascii_case(origin));
    }
    origin_host.eq_ignore_ascii_case(&hostname(host.unwrap_or("")))
}

/// The hostname of an origin (`scheme://host[:port]`), or `None` when it has
/// no host — `null` and garbage included.
fn origin_hostname(origin: &str) -> Option<String> {
    let (scheme, rest) = origin.split_once("://")?;
    if scheme.is_empty()
        || !scheme
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "+-.".contains(c))
    {
        return None;
    }
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    let authority = authority.rsplit('@').next().unwrap_or("");
    let h = hostname(authority);
    (!h.is_empty()).then_some(h)
}

/// Strips any `:port` from a `Host` header, IPv6 literals included.
fn hostname(host: &str) -> String {
    if let Some(rest) = host.strip_prefix('[') {
        return match rest.find(']') {
            Some(end) => rest[..end].to_owned(),
            None => host.to_owned(),
        };
    }
    match host.rfind(':') {
        Some(i) => host[..i].to_owned(),
        None => host.to_owned(),
    }
}

/// `GET /ws`.
pub async fn serve_ws(
    State(hub): State<Hub>,
    ClientNet(net): ClientNet,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    let shared = hub.shared().clone();
    let origin = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok());
    let host = headers.get(header::HOST).and_then(|v| v.to_str().ok());
    tracing::info!(addr = %net, origin = ?origin.unwrap_or(""), "ws request");

    if !origin_allowed(origin, host, &shared.cfg.allowed_origins) {
        tracing::info!(addr = %net, origin = ?origin.unwrap_or(""), "ws upgrade refused: origin not allowed");
        return (StatusCode::FORBIDDEN, "origin not allowed").into_response();
    }

    // 429 rather than a close, so a client (and an operator reading nginx's
    // log) can tell a refusal from a network failure.
    let Some(slot) = admit(&shared, &net) else {
        shared.metrics.conns_refused.fetch_add(1, Ordering::Relaxed);
        tracing::warn!(addr = %net, "ws admission refused");
        return (StatusCode::TOO_MANY_REQUESTS, "too many connections").into_response();
    };

    // Compression stays off (axum's default): a deflate pass on both ends of
    // every card play buys no bandwidth worth having on payloads this small.
    ws.max_message_size(MAX_MSG_SIZE)
        .max_frame_size(MAX_MSG_SIZE)
        .on_failed_upgrade(|e| tracing::info!("ws upgrade failed err={e}"))
        .on_upgrade(move |socket| async move {
            tracing::info!(addr = %net, "ws upgrade OK");
            let (client, out_rx) = Client::new(shared.clone(), net, Some(slot));
            let (ack, started) = oneshot::channel();
            if shared
                .tx
                .register
                .send(Register {
                    client: client.clone(),
                    ack,
                })
                .await
                .is_err()
            {
                return; // the hub has stopped; the slot goes with the client
            }
            if started.await.is_err() {
                return;
            }
            client.run(socket, out_rx).await;
        })
}

/// `GET /health`: JSON, as Go served it, `200` even while draining.
pub async fn serve_health(State(hub): State<Hub>) -> Response {
    axum::Json(hub.health()).into_response()
}

/// `GET /metrics`: Prometheus text, under the Go names.
pub async fn serve_metrics(State(hub): State<Hub>) -> Response {
    (
        [(
            header::CONTENT_TYPE,
            "text/plain; version=0.0.4; charset=utf-8",
        )],
        hub.render_metrics(),
    )
        .into_response()
}

/// `/ws`, `/health` and `/metrics`. The binary adds the live-streams routes.
pub fn routes(hub: Hub) -> Router {
    Router::new()
        .route("/ws", get(serve_ws))
        .route("/health", get(serve_health))
        .route("/metrics", get(serve_metrics))
        .with_state(hub)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Port of origin_test.go.

    #[test]
    fn origin_allowed_default_is_same_host() {
        let cases = [
            (
                "same host and port",
                Some("https://loco.example.com"),
                "loco.example.com",
                true,
            ),
            // A different port on the same host is not another party.
            (
                "same host, different port",
                Some("http://localhost:5173"),
                "localhost:8080",
                true,
            ),
            (
                "e2e vite port",
                Some("http://localhost:4173"),
                "localhost:8080",
                true,
            ),
            (
                "another site entirely",
                Some("https://evil.example"),
                "loco.example.com",
                false,
            ),
            // The one that reads as same-origin and is not: a subdomain.
            (
                "subdomain",
                Some("https://evil.loco.example.com"),
                "loco.example.com",
                false,
            ),
            (
                "garbage origin",
                Some("not a url"),
                "loco.example.com",
                false,
            ),
            ("null origin", Some("null"), "loco.example.com", false),
            ("no origin header", None, "loco.example.com", true),
            ("ipv6 host", Some("http://[::1]:5173"), "[::1]:8080", true),
        ];
        for (name, origin, host, want) in cases {
            assert_eq!(origin_allowed(origin, Some(host), &[]), want, "{name}");
        }
    }

    #[test]
    fn origin_allowed_explicit_allowlist_wins() {
        let allowed = vec![
            "https://loco.example.com".to_owned(),
            "https://loco-d.example.com".to_owned(),
        ];
        assert!(origin_allowed(
            Some("https://loco-d.example.com"),
            Some("internal-lb"),
            &allowed
        ));
        // Once a list is configured it is the whole rule.
        assert!(!origin_allowed(
            Some("https://other.example.com"),
            Some("other.example.com"),
            &allowed
        ));
    }
}
