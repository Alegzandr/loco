//! The HTTP listener, with Go's two slow-client timeouts.
//!
//! `axum::serve` exposes neither of `http.Server`'s `ReadHeaderTimeout` (10s)
//! nor `IdleTimeout` (60s), and a connection that sends half a request line and
//! waits is a socket and a task held for free — the Slowloris shape. So the
//! accept loop is ours, on hyper's HTTP/1 builder:
//!
//! - **The header clock is hyper's `header_read_timeout`** (10s). Hyper starts
//!   it whenever the connection waits for a request head — the first one and
//!   every one after a response — so a slow header is closed at 10s.
//! - **That also bounds idleness**: an idle keep-alive connection is waiting
//!   for a head, so it is closed at the same 10s, inside Go's 60s idle bound.
//!   Nothing behind nginx notices: nginx reopens an upstream connection on its
//!   own, and a WebSocket is past HTTP once upgraded, so neither clock touches
//!   a game.
//! - **Shutdown is graceful**: the listener stops, connections in flight get
//!   `SHUTDOWN_GRACE` to finish, upgraded sockets are not waited on.

use axum::Router;
use axum::extract::ConnectInfo;
use hyper::body::Incoming;
use hyper_util::rt::{TokioIo, TokioTimer};
use std::future::Future;
use std::time::Duration;
use tokio::net::TcpListener;
use tower::ServiceExt;

/// Go's `ReadHeaderTimeout`.
pub const HEADER_READ_TIMEOUT: Duration = Duration::from_secs(10);

/// What the listener enforces.
#[derive(Clone, Copy, Debug)]
pub struct ServeOpts {
    pub header_read_timeout: Duration,
    /// How long connections in flight are given once shutdown starts.
    pub shutdown_grace: Duration,
}

impl Default for ServeOpts {
    fn default() -> Self {
        ServeOpts {
            header_read_timeout: HEADER_READ_TIMEOUT,
            shutdown_grace: Duration::from_secs(5),
        }
    }
}

/// Serves `app` on `listener` until `shutdown` resolves, then drains the
/// connections in flight for at most `shutdown_grace`. Every request carries
/// `ConnectInfo<SocketAddr>` for `privacy.rs`'s extractor, exactly as
/// `into_make_service_with_connect_info` provided it.
pub async fn serve(
    listener: TcpListener,
    app: Router,
    opts: ServeOpts,
    shutdown: impl Future<Output = ()>,
) {
    // Every connection task holds a clone of `alive`; the drain at the end
    // waits for the last clone to go. `stop` tells them to finish gracefully.
    let (alive, mut all_gone) = tokio::sync::mpsc::channel::<()>(1);
    let (stop, stopping) = tokio::sync::watch::channel(false);
    tokio::pin!(shutdown);
    loop {
        let (stream, peer) = tokio::select! {
            accepted = listener.accept() => match accepted {
                Ok(a) => a,
                Err(e) => {
                    // Out of descriptors and the like: back off rather than spin.
                    tracing::warn!("accept failed err={e}");
                    tokio::time::sleep(Duration::from_millis(50)).await;
                    continue;
                }
            },
            () = &mut shutdown => break,
        };
        let svc = app
            .clone()
            .map_request(move |mut req: hyper::Request<Incoming>| {
                req.extensions_mut().insert(ConnectInfo(peer));
                req
            });
        let svc = hyper_util::service::TowerToHyperService::new(svc);
        let conn = hyper::server::conn::http1::Builder::new()
            .timer(TokioTimer::new())
            .header_read_timeout(opts.header_read_timeout)
            .serve_connection(TokioIo::new(stream), svc)
            .with_upgrades();
        let alive = alive.clone();
        let mut stopping = stopping.clone();
        tokio::spawn(async move {
            let _alive = alive;
            tokio::pin!(conn);
            // A closed or timed-out connection is ordinary traffic, not news.
            tokio::select! {
                _ = conn.as_mut() => {}
                () = stopped(&mut stopping) => {
                    conn.as_mut().graceful_shutdown();
                    let _ = conn.await;
                }
            }
        });
    }
    drop(listener);
    stop.send_replace(true);
    drop(alive);
    if tokio::time::timeout(opts.shutdown_grace, all_gone.recv())
        .await
        .is_err()
    {
        tracing::warn!(
            "http shutdown did not finish in {}s",
            opts.shutdown_grace.as_secs()
        );
    }
}

/// Resolves once shutdown starts; the watch guard is dropped inside, so the
/// connection task stays Send.
async fn stopped(rx: &mut tokio::sync::watch::Receiver<bool>) {
    let _ = rx.wait_for(|s| *s).await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::SocketAddr;
    use axum::routing::get;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    async fn start(
        opts: ServeOpts,
    ) -> (
        SocketAddr,
        tokio::sync::oneshot::Sender<()>,
        tokio::task::JoinHandle<()>,
    ) {
        let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = l.local_addr().unwrap();
        let app = Router::new().route(
            "/who",
            get(|ConnectInfo(peer): ConnectInfo<SocketAddr>| async move { peer.ip().to_string() }),
        );
        let (tx, rx) = tokio::sync::oneshot::channel::<()>();
        let task = tokio::spawn(serve(l, app, opts, async move {
            let _ = rx.await;
        }));
        (addr, tx, task)
    }

    fn quick() -> ServeOpts {
        ServeOpts {
            header_read_timeout: Duration::from_millis(300),
            shutdown_grace: Duration::from_millis(200),
        }
    }

    /// Reads until the server closes, reporting how long that took.
    async fn time_to_close(s: &mut tokio::net::TcpStream, limit: Duration) -> Option<Duration> {
        let start = tokio::time::Instant::now();
        let mut buf = [0u8; 1024];
        loop {
            match tokio::time::timeout(limit, s.read(&mut buf)).await {
                Ok(Ok(0)) | Ok(Err(_)) => return Some(start.elapsed()),
                Ok(Ok(_)) => continue,
                Err(_) => return None,
            }
        }
    }

    // Port of the property Go's ReadHeaderTimeout gave: half a request line
    // and silence is not a connection held for free.
    #[tokio::test]
    async fn a_slow_header_is_closed() {
        let (addr, _tx, _task) = start(quick()).await;
        let mut s = tokio::net::TcpStream::connect(addr).await.unwrap();
        s.write_all(b"GET /who HTTP/1.1\r\nHost: x\r\n")
            .await
            .unwrap();
        let closed = time_to_close(&mut s, Duration::from_secs(3)).await;
        assert!(
            closed.is_some_and(|d| d < Duration::from_secs(2)),
            "a slow header held the connection open: {closed:?}"
        );
    }

    // And an idle keep-alive connection is not kept for ever either: Go's
    // IdleTimeout, here bounded by the same clock.
    #[tokio::test]
    async fn an_idle_keep_alive_connection_is_closed() {
        let (addr, _tx, _task) = start(quick()).await;
        let mut s = tokio::net::TcpStream::connect(addr).await.unwrap();
        s.write_all(b"GET /who HTTP/1.1\r\nHost: x\r\n\r\n")
            .await
            .unwrap();
        let closed = time_to_close(&mut s, Duration::from_secs(3)).await;
        assert!(
            closed.is_some(),
            "an idle keep-alive connection was never closed"
        );
    }

    // A prompt request is answered, with the peer the privacy extractor reads.
    #[tokio::test]
    async fn a_request_is_served_with_its_peer() {
        let (addr, tx, task) = start(quick()).await;
        let mut s = tokio::net::TcpStream::connect(addr).await.unwrap();
        s.write_all(b"GET /who HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n")
            .await
            .unwrap();
        let mut out = String::new();
        s.read_to_string(&mut out).await.unwrap();
        assert!(out.starts_with("HTTP/1.1 200"), "{out}");
        assert!(out.ends_with("127.0.0.1"), "{out}");
        let _ = tx.send(());
        tokio::time::timeout(Duration::from_secs(2), task)
            .await
            .expect("serve did not return after shutdown")
            .unwrap();
    }
}
