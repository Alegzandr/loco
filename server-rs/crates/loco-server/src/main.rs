//! The LOCO! server. Port of `server/main.go`.
//!
//! Two ways to run it: `loco-server` serves, and `loco-server healthcheck`
//! asks a running one for `/health` and exits 0 or 1 — the distroless image
//! has no `wget`, so this is what the container's healthcheck calls.

use axum::Router;
use axum::extract::State;
use axum::http::{HeaderMap, Uri, header};
use axum::response::Response;
use axum::routing::get;
use loco_hub::{AsyncLog, Hub, HubConfig, LiveStats};
use loco_twitch::Poller;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

/// How long a shutdown waits for the matches in flight before it writes a
/// snapshot instead. A deploy policy, not a game rule, and deliberately short:
/// a deploy must never wait on the tables that happen to be up. Overridden by
/// `LOCO_DRAIN_TIMEOUT`; `stop_grace_period` must stay above it.
const DEFAULT_DRAIN_TIMEOUT: Duration = Duration::from_secs(90);

/// How long the HTTP server is given to close its connections once there is
/// nothing left to protect.
const SHUTDOWN_GRACE: Duration = Duration::from_secs(5);

/// Reads `LOCO_DRAIN_TIMEOUT`: a Go duration (`90s`, `15m`) or bare seconds.
/// Zero is the one answer this may never give — a typo must not turn a
/// graceful deploy back into the abrupt one it replaced.
fn parse_drain_timeout(raw: &str) -> Duration {
    let raw = raw.trim();
    if raw.is_empty() {
        return DEFAULT_DRAIN_TIMEOUT;
    }
    if let Some(d) = loco_twitch::parse_go_duration(raw).filter(|d| !d.is_zero()) {
        return d;
    }
    if let Ok(secs) = raw.parse::<u64>()
        && secs > 0
    {
        return Duration::from_secs(secs);
    }
    tracing::warn!(
        "LOCO_DRAIN_TIMEOUT={raw:?} is not a duration, using {}s",
        DEFAULT_DRAIN_TIMEOUT.as_secs()
    );
    DEFAULT_DRAIN_TIMEOUT
}

fn env(k: &str) -> String {
    std::env::var(k).unwrap_or_default()
}

fn port() -> u16 {
    env("PORT").trim().parse().unwrap_or(8080)
}

/// Every route this process answers. nginx proxies `/ws`, `/live.json` and
/// `/live-thumb/` and nothing else; `/health` and `/metrics` are operator
/// surfaces reached from inside the container.
fn app(hub: Hub, poller: Option<Arc<Poller>>) -> Router {
    async fn live_json(State(p): State<Option<Arc<Poller>>>) -> Response {
        loco_twitch::serve_json(p.as_deref())
    }
    async fn live_thumb(
        State(p): State<Option<Arc<Poller>>>,
        uri: Uri,
        headers: HeaderMap,
    ) -> Response {
        let inm = headers
            .get(header::IF_NONE_MATCH)
            .and_then(|v| v.to_str().ok());
        loco_twitch::serve_thumb(p.as_deref(), uri.path(), inm)
    }
    // `/live.json` is registered whether or not the feature is on, so a server
    // with no gateway key answers "nobody is live" rather than "no such
    // resource", and the nginx block is the same everywhere.
    let live = Router::new()
        .route("/live.json", get(live_json))
        .route("/live-thumb/", get(live_thumb))
        .route("/live-thumb/{*key}", get(live_thumb))
        .with_state(poller);
    loco_hub::routes(hub).merge(live)
}

/// `loco-server healthcheck`: a `GET /health` on loopback, exit 0 on a 200.
async fn healthcheck() -> std::process::ExitCode {
    if check_health(SocketAddr::from(([127, 0, 0, 1], port()))).await {
        std::process::ExitCode::SUCCESS
    } else {
        std::process::ExitCode::FAILURE
    }
}

async fn check_health(addr: SocketAddr) -> bool {
    let attempt = async {
        let mut s = tokio::net::TcpStream::connect(addr).await.ok()?;
        s.write_all(
            b"GET /health HTTP/1.1
Host: localhost
Connection: close

",
        )
        .await
        .ok()?;
        let mut buf = Vec::new();
        s.read_to_end(&mut buf).await.ok()?;
        let head = String::from_utf8_lossy(&buf);
        Some(head.starts_with("HTTP/1.1 200") || head.starts_with("HTTP/1.0 200"))
    };
    matches!(
        tokio::time::timeout(Duration::from_secs(5), attempt).await,
        Ok(Some(true))
    )
}

/// SIGTERM is what `docker compose up -d` sends the container it replaces;
/// Ctrl-C is the same thing at a terminal.
async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let term = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut s) => {
                s.recv().await;
            }
            Err(_) => std::future::pending::<()>().await,
        }
    };
    // Ctrl-Break is the console's other interrupt, and the one a parent can
    // deliver to a process group: a Windows dev box stops the server with it.
    #[cfg(windows)]
    let term = async {
        match tokio::signal::windows::ctrl_break() {
            Ok(mut s) => {
                s.recv().await;
            }
            Err(_) => std::future::pending::<()>().await,
        }
    };
    #[cfg(not(any(unix, windows)))]
    let term = std::future::pending::<()>();
    tokio::select! {
        () = ctrl_c => {},
        () = term => {},
    }
}

/// Drains, then snapshots whatever the drain did not finish. The two halves
/// are complementary rather than alternative, so both run every time.
async fn drain_and_snapshot(hub: &Hub, timeout: Duration, snapshot: &std::path::Path) {
    tracing::info!(
        "shutdown signal received, draining timeout={}s",
        timeout.as_secs()
    );
    hub.begin_drain();
    if tokio::time::timeout(timeout, hub.drain_done())
        .await
        .is_ok()
    {
        tracing::info!("drain finished, no match was interrupted");
    } else {
        tracing::warn!(
            "drain timed out after {}s with {} match(es) still in flight",
            timeout.as_secs(),
            hub.metrics_stats().matches_in_flight
        );
    }
    if let Err(e) = hub.save_snapshot(snapshot).await {
        tracing::warn!("snapshot write failed, matches in flight will be lost err={e}");
    }
}

#[tokio::main]
async fn main() -> std::process::ExitCode {
    if std::env::args().nth(1).as_deref() == Some("healthcheck") {
        return healthcheck().await;
    }

    // First, before anything has a line to write: from here on a log line is
    // a queue push, and a slow reader of stderr cannot stall a table.
    let sink = AsyncLog::new(std::io::stderr(), loco_hub::logsink::LOG_QUEUE_DEPTH);
    if let Err(e) = loco_hub::logsink::install(&sink) {
        eprintln!("installing the log failed: {e}");
    }
    loco_hub::logsink::install_panic_hook();

    let code = serve(&sink).await;
    let _ = sink.close();
    code
}

async fn serve(sink: &AsyncLog) -> std::process::ExitCode {
    let cfg = HubConfig::from_env(&env);
    if cfg.debug_mode {
        tracing::warn!(
            "debug mode enabled (LOCO_E2E=1) — debug_set_state is unauthenticated; do NOT use in production"
        );
    }
    // TODO(handler port): hub::apply_bot_timing_env(), before the hub starts.
    let hub = Hub::start(cfg);
    hub.set_log_sink(sink.clone());

    // Before the listener is up, so no socket arrives into a half-restored
    // room. An empty path disables the whole mechanism (local dev, E2E).
    let snapshot = PathBuf::from(env("LOCO_SNAPSHOT_PATH"));
    if let Err(e) = hub.load_snapshot(&snapshot).await {
        tracing::warn!("snapshot restore failed, starting empty err={e}");
    }

    // The one thing in this process that talks to anybody outside it. Off,
    // silently, wherever no gateway key is set.
    let (stop_live, live_stopped) = tokio::sync::oneshot::channel::<()>();
    let poller = Poller::new(
        &env,
        Some(Box::new(loco_game::screen::contains_blocked_term)),
    );
    if let Some(p) = &poller {
        let stats = p.clone();
        hub.set_live_stats(move || {
            let s = stats.stats();
            LiveStats {
                twitch_polls: s.polls,
                twitch_poll_errors: s.errors,
                live_rows_screened: s.rows_screened,
                twitch_thumb_errors: s.thumb_errors,
                twitch_streams_live: s.streams_live,
            }
        });
        let h = hub.clone();
        tokio::spawn(p.clone().run(move |rows| h.publish_live(rows), async move {
            let _ = live_stopped.await;
        }));
    }

    let addr = SocketAddr::from(([0, 0, 0, 0], port()));
    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(e) => {
            // Not a panic: the line saying why the server never came up is the
            // one an operator cannot do without, and it is still in the queue.
            tracing::error!("FATAL listen failed err={e}");
            return std::process::ExitCode::FAILURE;
        }
    };
    tracing::info!("loco server listening on :{}", addr.port());

    let (close_http, http_closing) = tokio::sync::oneshot::channel::<()>();
    let app = app(hub.clone(), poller).into_make_service_with_connect_info::<SocketAddr>();
    let server = tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(async move {
                let _ = http_closing.await;
            })
            .await
    });

    shutdown_signal().await;
    // A second signal from here on ends the process the old way: the escape
    // hatch for an operator who will not wait for the drain.
    tokio::spawn(async {
        shutdown_signal().await;
        tracing::warn!("second signal, exiting without waiting for the drain");
        std::process::exit(1);
    });
    // Before the drain: a gateway request still in flight has no reason to
    // exist, and the poller has nothing to hand over.
    let _ = stop_live.send(());
    drain_and_snapshot(
        &hub,
        parse_drain_timeout(&env("LOCO_DRAIN_TIMEOUT")),
        &snapshot,
    )
    .await;

    let _ = close_http.send(());
    if tokio::time::timeout(SHUTDOWN_GRACE, server).await.is_err() {
        tracing::warn!(
            "http shutdown did not finish in {}s",
            SHUTDOWN_GRACE.as_secs()
        );
    }
    hub.stop().await;
    tracing::info!("loco server stopped");
    std::process::ExitCode::SUCCESS
}

#[cfg(test)]
mod tests {
    use super::*;
    use loco_hub::testkit;

    // Port of main_test.go: zero is the one answer this may never give.
    #[test]
    fn parse_drain_timeout_cases() {
        let cases = [
            ("unset", "", DEFAULT_DRAIN_TIMEOUT),
            ("go duration", "90s", Duration::from_secs(90)),
            ("minutes", "15m", Duration::from_secs(15 * 60)),
            ("bare seconds", "120", Duration::from_secs(120)),
            ("nonsense falls back", "soon", DEFAULT_DRAIN_TIMEOUT),
            ("zero falls back", "0", DEFAULT_DRAIN_TIMEOUT),
            ("negative falls back", "-5m", DEFAULT_DRAIN_TIMEOUT),
        ];
        for (name, raw, want) in cases {
            assert_eq!(parse_drain_timeout(raw), want, "{name}");
        }
    }

    async fn serve_app(app: Router) -> SocketAddr {
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = l.local_addr().unwrap();
        tokio::spawn(async move {
            let _ = axum::serve(l, app.into_make_service_with_connect_info::<SocketAddr>()).await;
        });
        addr
    }

    async fn get(addr: SocketAddr, path: &str) -> (u16, String) {
        let mut s = tokio::net::TcpStream::connect(addr).await.unwrap();
        s.write_all(
            format!("GET {path} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n").as_bytes(),
        )
        .await
        .unwrap();
        let mut raw = Vec::new();
        s.read_to_end(&mut raw).await.unwrap();
        let text = String::from_utf8_lossy(&raw).into_owned();
        let status = text
            .split_whitespace()
            .nth(1)
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        (
            status,
            text.split_once("\r\n\r\n")
                .map(|(_, b)| b.to_owned())
                .unwrap_or_default(),
        )
    }

    // Every route the binary serves answers, with no gateway key at all: the
    // live list is an empty list, a preview is a 404, the socket upgrades.
    #[tokio::test]
    async fn the_routes_answer_without_a_gateway() {
        let hub = Hub::start(HubConfig::default());
        let addr = serve_app(app(hub.clone(), None)).await;

        let (s, body) = get(addr, "/health").await;
        assert_eq!(s, 200);
        assert!(body.contains(r#""status":"ok""#), "{body}");
        let (s, body) = get(addr, "/metrics").await;
        assert_eq!(s, 200);
        assert!(body.lines().any(|l| l == "matchmaking_queue 0"), "{body}");
        let (s, body) = get(addr, "/live.json").await;
        assert_eq!(s, 200);
        assert!(body.contains(r#""streams":[]"#), "{body}");
        assert_eq!(get(addr, "/live-thumb/abc").await.0, 404);
        assert_eq!(get(addr, "/live-thumb/").await.0, 404);
        assert_eq!(get(addr, "/elsewhere").await.0, 404);

        let mut ws = testkit::dial_url(&format!("ws://{addr}/ws"))
            .await
            .expect("upgrade");
        let first = testkit::read_raw(&mut ws).await;
        assert_eq!(first["type"], "players_online");
        hub.stop().await;
    }

    // The shutdown path: a drain with nothing in flight finishes at once, and a
    // match in flight is written to the snapshot when the timeout runs out.
    #[tokio::test]
    async fn drain_then_snapshot_writes_what_is_still_playing() {
        let hub = Hub::start(HubConfig::default());
        let dir = std::env::temp_dir().join(format!(
            "loco-server-{}",
            loco_hub::tokens::generate_conn_id()
        ));
        let path = dir.join("snap.json");
        let mut room = loco_game::Room::from_u64_seed("PLAYIN", 1);
        room.join("Alice").unwrap();
        room.join("Bob").unwrap();
        room.start(loco_hub::wire::now_ms()).unwrap();
        let table = loco_hub::Table::new("PLAYIN", room);
        hub.on_loop(move |core| {
            core.open_table(table);
        })
        .await;

        drain_and_snapshot(&hub, Duration::from_millis(100), &path).await;
        let snap: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(snap["schema_version"], 5);
        assert_eq!(snap["rooms"][0]["room"]["Code"], "PLAYIN");
        hub.stop().await;
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn the_healthcheck_reads_the_endpoint() {
        let hub = Hub::start(HubConfig::default());
        let addr = serve_app(app(hub.clone(), None)).await;
        assert!(
            check_health(addr).await,
            "a healthy server failed its healthcheck"
        );
        let dead = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let dead_addr = dead.local_addr().unwrap();
        drop(dead);
        assert!(
            !check_health(dead_addr).await,
            "nothing listening read as healthy"
        );
        hub.stop().await;
    }
}
