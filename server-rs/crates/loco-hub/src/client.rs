//! One WebSocket connection: its send queue, its two pumps, its token bucket,
//! its latency probe and the seat it holds. Port of `server/hub/client.go`.

use crate::hub::{Inbound, Shared};
use crate::wire::{Outgoing, decode_client, msg, now_ms};
use axum::extract::ws::{Message, Utf8Bytes, WebSocket};
use futures_util::{SinkExt, StreamExt};
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicI64, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::{mpsc, watch};
use tokio::time::Instant;
use tracing::Instrument;

/// The largest frame a client may send. Every client message is a few hundred
/// bytes; anything bigger is not one.
pub const MAX_MSG_SIZE: usize = 4096;
/// How many messages may wait to go out to one socket before it is closed.
pub const SEND_BUFFER: usize = 256;

/// Anything past this is "unplayable" either way; the cap keeps a stalled
/// connection from parking the display on a five-digit number.
pub const MAX_LATENCY_MS: i64 = 9999;

/// The token bucket: bursts of up to 20, refilling at 10 a second.
pub const RATE_PER_SEC: f64 = 10.0;
pub const RATE_BURST: f64 = 20.0;

/// How often a rate-limited connection is told so. One error per dropped
/// message meant the limiter amplified the flood it exists to absorb.
pub const RATE_LIMIT_NOTICE_PERIOD: Duration = Duration::from_secs(1);

/// A socket whose gameplay is refused this often inside the window is worth
/// one WARN. A real player's fat-fingered plays never trip it.
pub const SUSPECT_THRESHOLD: u32 = 5;
pub const SUSPECT_WINDOW: Duration = Duration::from_secs(30);

/// Per-client token bucket. Owned by the read pump, the only task that drops
/// messages, so it needs no lock.
#[derive(Debug, Clone)]
pub struct RateLimiter {
    tokens: f64,
    last_fill: Instant,
    last_notice: Option<Instant>,
}

impl RateLimiter {
    pub fn new(now: Instant) -> Self {
        RateLimiter {
            tokens: RATE_BURST,
            last_fill: now,
            last_notice: None,
        }
    }

    /// Whether the message arriving at `now` may be processed.
    pub fn allow(&mut self, now: Instant) -> bool {
        let elapsed = now.saturating_duration_since(self.last_fill).as_secs_f64();
        self.tokens = (self.tokens + elapsed * RATE_PER_SEC).min(RATE_BURST);
        self.last_fill = now;
        if self.tokens < 1.0 {
            return false;
        }
        self.tokens -= 1.0;
        true
    }

    /// Whether a refusal at `now` is owed a notice: one per burst, at most one
    /// a second. The count of dropped messages is kept regardless.
    pub fn should_notify(&mut self, now: Instant) -> bool {
        match self.last_notice {
            Some(at) if now.saturating_duration_since(at) < RATE_LIMIT_NOTICE_PERIOD => false,
            _ => {
                self.last_notice = Some(now);
                true
            }
        }
    }
}

/// Where a socket is sitting: a table code and an index into its members. The
/// two travel as one value because they are only ever true together; `None`
/// is "not at a table", the only honest way to say it, since seat 0 is the
/// host's.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SeatRef {
    pub code: String,
    pub id: usize,
}

/// One connection. Shared between its two pumps, the hub and whichever table
/// it sits at, so everything mutable in it is atomic or behind a lock held for
/// one read or one write.
pub struct Client {
    /// The hub's key for this socket. Unique for the process's lifetime.
    pub(crate) key: u64,
    shared: Arc<Shared>,
    /// A short random tag on every log line involving this connection.
    pub conn_id: String,
    /// The truncated network this socket was admitted under: what every
    /// `addr=` carries and what the per-network budgets are charged against.
    pub net_key: String,
    out: mpsc::Sender<Utf8Bytes>,
    closed: AtomicBool,
    kill: watch::Sender<bool>,
    seat: Mutex<Option<SeatRef>>,
    /// The players-online count this socket was last told (hub loop only).
    pub(crate) online_sent: AtomicI64,
    /// The live-streams version this socket was last told (hub loop only).
    pub(crate) live_sent: AtomicU64,
    latency_ms: AtomicI32,
    epoch: Instant,
    /// Nanoseconds after `epoch` the last ping went out, plus one; 0 is never.
    ping_sent_at: AtomicU64,
    /// Every refusal this socket was sent, read as a before/after pair by the
    /// dispatch boundary to tell an action taken from one turned down.
    refusals: AtomicI64,
    suspect: Mutex<(u32, Option<Instant>)>,
    /// When this socket was last handed a stale-state correction.
    last_resync_at: Mutex<Option<Instant>>,
    slot: Option<crate::serve::AdmissionSlot>,
}

impl std::fmt::Debug for Client {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Client")
            .field("conn", &self.conn_id)
            .field("seat", &self.seat())
            .finish_non_exhaustive()
    }
}

impl Client {
    pub(crate) fn new(
        shared: Arc<Shared>,
        net_key: String,
        slot: Option<crate::serve::AdmissionSlot>,
    ) -> (Arc<Client>, mpsc::Receiver<Utf8Bytes>) {
        let (out, rx) = mpsc::channel(SEND_BUFFER);
        let (kill, _) = watch::channel(false);
        let key = shared.next_client_key.fetch_add(1, Ordering::Relaxed);
        let c = Arc::new(Client {
            key,
            shared,
            conn_id: crate::tokens::generate_conn_id(),
            net_key,
            out,
            closed: AtomicBool::new(false),
            kill,
            seat: Mutex::new(None),
            online_sent: AtomicI64::new(0),
            live_sent: AtomicU64::new(0),
            latency_ms: AtomicI32::new(-1),
            epoch: Instant::now(),
            ping_sent_at: AtomicU64::new(0),
            refusals: AtomicI64::new(0),
            suspect: Mutex::new((0, None)),
            last_resync_at: Mutex::new(None),
            slot,
        });
        (c, rx)
    }

    /// A client with no socket behind it, for a test or a benchmark: what it
    /// is sent arrives on the receiver.
    pub fn detached(hub: &crate::Hub) -> (Arc<Client>, mpsc::Receiver<Utf8Bytes>) {
        Client::new(hub.shared().clone(), String::new(), None)
    }

    /// The network for an `addr=` field. Never the peer's address.
    pub fn net_prefix(&self) -> &str {
        if self.net_key.is_empty() {
            "unknown"
        } else {
            &self.net_key
        }
    }

    // ── the seat ────────────────────────────────────────────────────────────

    pub fn seat(&self) -> Option<SeatRef> {
        self.seat.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    /// The table this socket sits at, if any.
    pub fn room_code(&self) -> Option<String> {
        self.seat().map(|s| s.code)
    }

    /// This socket's seat index, or 0 when it has none. Callers that must tell
    /// seat 0 from no seat ask [`Client::seat`].
    pub fn player_id(&self) -> usize {
        self.seat().map_or(0, |s| s.id)
    }

    /// Binds this socket to a seat. Only `table.rs` calls it: a seat lives in
    /// two places, and routing every change through that file is what leaves
    /// no way to move one without the other.
    pub fn sit_at(&self, code: &str, id: usize) {
        *self.seat.lock().unwrap_or_else(|e| e.into_inner()) = Some(SeatRef {
            code: code.to_owned(),
            id,
        });
    }

    pub fn leave_seat(&self) {
        *self.seat.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }

    // ── sending ─────────────────────────────────────────────────────────────

    /// Marshals a message, stamps `server_now`, and queues it.
    pub fn send<M: Outgoing>(&self, mut msg: M) {
        msg.stamp_now(now_ms());
        match serde_json::to_string(&msg) {
            Ok(s) => self.send_bytes(Utf8Bytes::from(s)),
            Err(e) => tracing::warn!("marshal error: {e}"),
        }
    }

    /// Queues a payload already marshalled, which is how a broadcast marshals
    /// once and fans the same bytes out.
    ///
    /// **A full buffer force-closes the socket.** A silent drop would leave the
    /// client desynchronised with no way to recover; a close sends it through
    /// the reconnect path, which ends in a full snapshot.
    pub fn send_bytes(&self, data: Utf8Bytes) {
        if self.closed.load(Ordering::Acquire) {
            return;
        }
        match self.out.try_send(data) {
            Ok(()) | Err(mpsc::error::TrySendError::Closed(_)) => {}
            Err(mpsc::error::TrySendError::Full(_)) => {
                self.shared
                    .metrics
                    .slow_clients_closed
                    .fetch_add(1, Ordering::Relaxed);
                tracing::warn!(
                    conn = %self.conn_id,
                    addr = %self.net_prefix(),
                    "slow client, force-closing for clean reconnect"
                );
                self.force_close();
            }
        }
    }

    /// Refuses something. The single funnel every refusal goes through, which
    /// is what lets the dispatch boundary count them.
    pub fn refuse(&self, r: impl Into<crate::refusal::Refusal>) {
        self.refusals.fetch_add(1, Ordering::Relaxed);
        self.send(msg::error(&r.into().to_string()));
    }

    /// Counts a refusal the server deliberately does not answer (a Contre-LOCO!
    /// pressed where nothing is offered): without this it read as accepted and
    /// cleared the AFK counter.
    pub fn refuse_silently(&self) {
        self.refusals.fetch_add(1, Ordering::Relaxed);
    }

    pub fn refusals(&self) -> i64 {
        self.refusals.load(Ordering::Relaxed)
    }

    /// Ends both pumps: the reader unregisters, the writer stops.
    pub fn force_close(&self) {
        self.kill.send_replace(true);
    }

    /// Called by the hub on unregister: nothing more is queued, and the slot
    /// this socket held against the ceilings is given back.
    pub(crate) fn close(&self) {
        self.closed.store(true, Ordering::Release);
        self.force_close();
        if let Some(slot) = &self.slot {
            slot.release();
        }
    }

    // ── latency ─────────────────────────────────────────────────────────────

    pub(crate) fn stamp_ping(&self, now: Instant) {
        let n = now.saturating_duration_since(self.epoch).as_nanos() as u64;
        self.ping_sent_at
            .store(n.saturating_add(1), Ordering::Relaxed);
    }

    /// Records the round trip of the ping this pong answers, folded into the
    /// previous measurement at 0.6 old + 0.4 new. A pong with no ping behind
    /// it is ignored rather than published as a flattering 0 ms.
    pub fn note_pong(&self, now: Instant) {
        let sent = self.ping_sent_at.load(Ordering::Relaxed);
        if sent == 0 {
            return;
        }
        let sent_at = self.epoch + Duration::from_nanos(sent - 1);
        let Some(rtt) = now.checked_duration_since(sent_at) else {
            return;
        };
        let rtt = (rtt.as_millis() as i64).min(MAX_LATENCY_MS);
        let prev = self.latency_ms.load(Ordering::Relaxed);
        let next = if prev < 0 {
            rtt
        } else {
            (i64::from(prev) * 3 + rtt * 2) / 5
        };
        self.latency_ms.store(next as i32, Ordering::Relaxed);
    }

    /// The smoothed round trip in milliseconds, or -1 if unknown.
    pub fn latency(&self) -> i32 {
        self.latency_ms.load(Ordering::Relaxed)
    }

    // ── suspicion ───────────────────────────────────────────────────────────

    /// The gameplay path's entry point: records a refused action unless it is
    /// one a correct client produces in ordinary play (a lost race, a double
    /// tap). Counting those made `suspected_cheats` rise fastest at the
    /// busiest tables, which is exactly backwards.
    pub fn note_rejection(&self, err: &loco_game::GameError) {
        if err.is_lost_race() {
            return;
        }
        self.note_suspect(&err.to_string());
    }

    /// Whether a correction may be sent now, and if so records that it was:
    /// one per `period`.
    pub fn claim_resync(&self, period: Duration) -> bool {
        let now = Instant::now();
        let mut last = self
            .last_resync_at
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if last.is_some_and(|at| now.saturating_duration_since(at) < period) {
            return false;
        }
        *last = Some(now);
        true
    }

    /// Tags a refused gameplay action. One WARN per burst of
    /// [`SUSPECT_THRESHOLD`] inside [`SUSPECT_WINDOW`].
    pub fn note_suspect(&self, reason: &str) {
        let now = Instant::now();
        let count = {
            let mut s = self.suspect.lock().unwrap_or_else(|e| e.into_inner());
            if s.1
                .is_none_or(|start| now.saturating_duration_since(start) > SUSPECT_WINDOW)
            {
                *s = (0, Some(now));
            }
            s.0 += 1;
            s.0
        };
        if count == SUSPECT_THRESHOLD {
            self.shared
                .metrics
                .suspected_cheats
                .fetch_add(1, Ordering::Relaxed);
            let seat = self.seat();
            tracing::warn!(
                conn = %self.conn_id,
                code = %seat.as_ref().map_or("", |s| s.code.as_str()),
                player = seat.as_ref().map_or(0, |s| s.id),
                last_reason = ?reason,
                "suspected cheat: {count} validation rejections in 30s"
            );
        }
    }

    // ── the pumps ───────────────────────────────────────────────────────────

    /// Runs both pumps until the connection ends, then unregisters. Started by
    /// `serve.rs` only once the hub has registered this client, so the reader's
    /// unregister can never be processed before the register.
    pub(crate) async fn run(self: Arc<Self>, socket: WebSocket, out_rx: mpsc::Receiver<Utf8Bytes>) {
        let span = tracing::info_span!("ws", conn = %self.conn_id, addr = %self.net_prefix());
        async move {
            let (sink, stream) = socket.split();
            let writer = tokio::spawn(self.clone().write_pump(sink, out_rx).in_current_span());
            self.clone().read_pump(stream).await;
            // The reader is the one that decides the connection is over.
            let _ = self.shared.tx.unregister.send(self.clone()).await;
            self.force_close();
            let _ = writer.await;
        }
        .instrument(span)
        .await;
    }

    async fn read_pump(self: Arc<Self>, mut stream: futures_util::stream::SplitStream<WebSocket>) {
        let t = &self.shared.cfg.timings;
        let connected_at = Instant::now();
        let mut limiter = RateLimiter::new(connected_at);
        let mut kill = self.kill.subscribe();
        let mut deadline = Instant::now() + t.pong_wait;
        let reason: String = loop {
            let frame = tokio::select! {
                f = tokio::time::timeout_at(deadline, stream.next()) => f,
                () = killed(&mut kill) => break "closed by the server".into(),
            };
            let msg = match frame {
                Err(_) => break "read deadline".into(),
                Ok(None) => break "eof".into(),
                Ok(Some(Err(e))) => break e.to_string(),
                Ok(Some(Ok(m))) => m,
            };
            let data: &[u8] = match &msg {
                Message::Text(s) => s.as_str().as_bytes(),
                Message::Binary(b) => &b[..],
                Message::Pong(_) => {
                    let now = Instant::now();
                    deadline = now + t.pong_wait;
                    self.note_pong(now);
                    continue;
                }
                Message::Ping(_) => continue, // answered by the WebSocket layer
                Message::Close(_) => break "close frame".into(),
            };
            let now = Instant::now();
            if !limiter.allow(now) {
                // Still counted per dropped message: messages_rate_limited is
                // the metric that has to keep its shape. Only the reply is
                // throttled.
                self.shared
                    .metrics
                    .messages_rate_limited
                    .fetch_add(1, Ordering::Relaxed);
                if limiter.should_notify(now) {
                    self.refuse(crate::refusal::Refusal::RateLimited);
                }
                continue;
            }
            let parsed = match decode_client(data) {
                Ok(m) => m,
                Err(refusal) => {
                    if refusal == "unknown emote" {
                        self.note_suspect("unknown emote");
                    }
                    self.refuse(crate::refusal::Refusal::Other(refusal));
                    continue;
                }
            };
            // Never waits: a reader parked on a full hub queue would cascade
            // into a deadlock on the unregister queue behind it.
            match self.shared.tx.inbound.try_send(Inbound {
                client: self.clone(),
                msg: parsed,
            }) {
                Ok(()) => {}
                Err(mpsc::error::TrySendError::Full(_)) => {
                    self.shared
                        .metrics
                        .messages_dropped_busy
                        .fetch_add(1, Ordering::Relaxed);
                    tracing::info!("inbound channel full, dropping message");
                    self.refuse(crate::refusal::Refusal::ServerBusy);
                }
                Err(mpsc::error::TrySendError::Closed(_)) => break "hub stopped".into(),
            }
        };
        let uptime = connected_at.elapsed();
        if uptime < Duration::from_secs(5) {
            tracing::info!(uptime = ?uptime, reason = %reason, "ws immediate disconnect");
        } else {
            tracing::info!(uptime = ?uptime, reason = %reason, "ws connection closed");
        }
    }

    async fn write_pump(
        self: Arc<Self>,
        mut sink: futures_util::stream::SplitSink<WebSocket, Message>,
        mut out_rx: mpsc::Receiver<Utf8Bytes>,
    ) {
        let t = self.shared.cfg.timings.clone();
        let mut ping = tokio::time::interval_at(Instant::now() + t.ping_period, t.ping_period);
        ping.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let mut kill = self.kill.subscribe();
        loop {
            let frame = tokio::select! {
                biased;
                () = killed(&mut kill) => {
                    // Whatever is already queued goes out first: a refusal
                    // followed by a close is still a refusal the client reads.
                    while let Ok(data) = out_rx.try_recv() {
                        if !send_within(&mut sink, Message::Text(data), t.write_wait).await {
                            return;
                        }
                    }
                    let _ = send_within(&mut sink, Message::Close(None), t.write_wait).await;
                    return;
                }
                data = out_rx.recv() => match data {
                    Some(d) => Message::Text(d),
                    None => {
                        let _ = send_within(&mut sink, Message::Close(None), t.write_wait).await;
                        return;
                    }
                },
                _ = ping.tick() => {
                    self.stamp_ping(Instant::now());
                    Message::Ping(Default::default())
                }
            };
            if !send_within(&mut sink, frame, t.write_wait).await {
                // The reader notices the dead socket on its own; telling it
                // here as well makes the unregister immediate.
                self.force_close();
                return;
            }
        }
    }
}

/// Resolves once the client has been told to close. The watch guard is
/// dropped inside, so the future stays Send across the arm that follows.
async fn killed(kill: &mut watch::Receiver<bool>) {
    let _ = kill.wait_for(|k| *k).await;
}

async fn send_within(
    sink: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    m: Message,
    wait: Duration,
) -> bool {
    matches!(tokio::time::timeout(wait, sink.send(m)).await, Ok(Ok(())))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Port of client_internal_test.go, and of the limiter Go tested only
    // through sockets.

    #[tokio::test(start_paused = true)]
    async fn note_pong_smooths_samples() {
        let hub = crate::Hub::start(Default::default());
        let (c, _rx) = Client::detached(&hub);
        let now = Instant::now() + Duration::from_secs(1);

        // A pong with no ping behind it must not publish a flattering 0 ms.
        c.note_pong(now);
        assert_eq!(c.latency(), -1);

        // First real sample lands as-is.
        c.stamp_ping(now - Duration::from_millis(100));
        c.note_pong(now);
        assert_eq!(c.latency(), 100);

        // Second is folded in: 0.6*100 + 0.4*200 = 140.
        c.stamp_ping(now - Duration::from_millis(200));
        c.note_pong(now);
        assert_eq!(c.latency(), 140);
        hub.stop().await;
    }

    #[tokio::test(start_paused = true)]
    async fn note_pong_clamps_a_stalled_connection() {
        let hub = crate::Hub::start(Default::default());
        let (c, _rx) = Client::detached(&hub);
        let start = Instant::now();
        c.stamp_ping(start);
        c.note_pong(start + Duration::from_secs(3 * 3600));
        assert_eq!(i64::from(c.latency()), MAX_LATENCY_MS);
        hub.stop().await;
    }

    #[test]
    fn the_bucket_allows_a_burst_of_twenty_then_ten_a_second() {
        let t0 = Instant::now();
        let mut l = RateLimiter::new(t0);
        for i in 0..20 {
            assert!(l.allow(t0), "message {i} of the burst was refused");
        }
        assert!(
            !l.allow(t0),
            "the 21st message in the same instant was let through"
        );
        // A tenth of a second buys exactly one more.
        assert!(l.allow(t0 + Duration::from_millis(100)));
        assert!(!l.allow(t0 + Duration::from_millis(100)));
        // A long silence refills to the burst and no further.
        let later = t0 + Duration::from_secs(60);
        for _ in 0..20 {
            assert!(l.allow(later));
        }
        assert!(!l.allow(later));
    }

    // One notice per burst: a flood at 1000 msg/s gets one error a second back,
    // not one per dropped message.
    #[test]
    fn a_flood_is_told_once_a_second() {
        let t0 = Instant::now();
        let mut l = RateLimiter::new(t0);
        let mut notices = 0;
        for ms in 0..1000u64 {
            let now = t0 + Duration::from_millis(ms);
            if !l.allow(now) && l.should_notify(now) {
                notices += 1;
            }
        }
        assert_eq!(
            notices, 1,
            "a one-second flood was answered {notices} times"
        );
        let next = t0 + Duration::from_millis(1990);
        assert!(
            l.should_notify(next),
            "the next second's flood was not told"
        );
    }

    // The send buffer is a promise to the client, not a best effort: overflow
    // closes rather than drops.
    #[tokio::test]
    async fn a_full_send_buffer_closes_rather_than_drops() {
        let hub = crate::Hub::start(Default::default());
        let (c, _rx) = Client::detached(&hub);
        let mut kill = c.kill.subscribe();
        for _ in 0..SEND_BUFFER {
            c.send_bytes(Utf8Bytes::from_static("{}"));
        }
        assert!(!*kill.borrow(), "closed before the buffer was full");
        c.send_bytes(Utf8Bytes::from_static("{}"));
        kill.wait_for(|k| *k).await.unwrap();
        assert_eq!(hub.metrics().slow_clients_closed.load(Ordering::Relaxed), 1);
        hub.stop().await;
    }

    #[tokio::test]
    async fn every_refusal_is_counted_and_stamped() {
        let hub = crate::Hub::start(Default::default());
        let (c, mut rx) = Client::detached(&hub);
        c.refuse(crate::refusal::Refusal::Other("nope".into()));
        c.refuse_silently();
        assert_eq!(c.refusals(), 2);
        let got: serde_json::Value =
            serde_json::from_str(rx.recv().await.unwrap().as_str()).unwrap();
        assert_eq!(got["type"], "error");
        assert_eq!(got["error"], "nope");
        assert!(
            got["server_now"].as_i64().unwrap() > 0,
            "no server_now on {got}"
        );
        assert!(rx.try_recv().is_err(), "a silent refusal answered");
        hub.stop().await;
    }

    #[tokio::test]
    async fn a_burst_of_rejections_is_one_suspect() {
        let hub = crate::Hub::start(Default::default());
        let (c, _rx) = Client::detached(&hub);
        for _ in 0..SUSPECT_THRESHOLD * 2 {
            c.note_suspect("not your turn");
        }
        assert_eq!(hub.metrics().suspected_cheats.load(Ordering::Relaxed), 1);
        hub.stop().await;
    }
}
