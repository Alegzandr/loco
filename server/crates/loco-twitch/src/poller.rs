//! Asks the gateway who is live, on a timer, and keeps the answer.
//!
//! It is the only thing in this process that talks to anybody outside it, and
//! it never touches the event loop: what it produces reaches the hub through
//! the `publish` callback [`Poller::run`] is handed, which posts to the router
//! like every other job crossing that boundary.

use crate::LiveStream;
use crate::config::{Config, LIVE_MAX_AGE, config_from_env};
use crate::thumbs::Thumb;
use std::collections::HashMap;
use std::future::Future;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, RwLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::mpsc;

/// The wordlist predicate (`loco_game::contains_blocked_term` in production),
/// injected rather than imported so this crate stays independent of the
/// domain and a test can screen nothing.
pub type Screen = Box<dyn Fn(&str) -> bool + Send + Sync>;

/// One poll's worth of answer, replaced whole: the poller writes it on its own
/// task, the two HTTP handlers read it on theirs, and neither is the event
/// loop. The lock is held for a pointer swap or a clone of an `Arc`, nothing
/// longer.
#[derive(Debug)]
pub struct Snapshot {
    pub streams: Vec<LiveStream>,
    pub thumbs: HashMap<String, Thumb>,
    pub at: Instant,
    /// `at` as unix seconds, which is what the page is told.
    pub updated: i64,
    /// What `/live.json` answers with, encoded once when the snapshot is built
    /// rather than per request.
    pub json_body: Vec<u8>,
}

/// What `/metrics` reads, from HTTP tasks while the poller writes.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Stats {
    pub polls: i64,
    pub errors: i64,
    pub rows_screened: i64,
    pub thumb_errors: i64,
    pub streams_live: i64,
}

pub struct Poller {
    pub(crate) cfg: Config,
    pub(crate) janus: loco_janus::Client,
    pub(crate) blocked: Option<Screen>,
    snap: RwLock<Option<Arc<Snapshot>>>,

    polls: AtomicI64,
    poll_errors: AtomicI64,
    rows_screened: AtomicI64,
    pub(crate) thumb_errors: AtomicI64,
    streams_live: AtomicI64,
}

impl std::fmt::Debug for Poller {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Poller")
            .field("cfg", &self.cfg)
            .finish_non_exhaustive()
    }
}

/// What the polling task alone reads and writes, kept out of [`Poller`] so the
/// shared half needs no lock for it.
#[derive(Debug, Default)]
pub struct PollState {
    pub(crate) game_id: String,
    /// What was last published, so a poll that changed nothing publishes
    /// nothing: the hub would otherwise send the same list to every seatless
    /// socket once a minute, for ever.
    pub(crate) last_sig: String,
    /// Honours a 429's Retry-After by skipping ticks: the only pacing this
    /// crate does; retries, backoff and the breaker are the gateway's.
    pub(crate) pause_until: Option<Instant>,
}

impl Poller {
    /// Builds the poller, or reports that this feature is switched off.
    pub fn new(getenv: &dyn Fn(&str) -> String, screen: Option<Screen>) -> Option<Arc<Poller>> {
        let cfg = config_from_env(getenv)?;
        Some(Arc::new(Poller::with_config(cfg, screen)))
    }

    pub fn with_config(cfg: Config, screen: Option<Screen>) -> Poller {
        Poller {
            janus: loco_janus::Client::new(cfg.janus.clone()),
            cfg,
            blocked: screen,
            snap: RwLock::new(None),
            polls: AtomicI64::new(0),
            poll_errors: AtomicI64::new(0),
            rows_screened: AtomicI64::new(0),
            thumb_errors: AtomicI64::new(0),
            streams_live: AtomicI64::new(0),
        }
    }

    pub fn config(&self) -> &Config {
        &self.cfg
    }

    /// Polls until `shutdown` resolves.
    ///
    /// The game id is resolved once, here, before the first poll: an
    /// unresolvable category switches the whole thing off rather than falling
    /// through to a query that would ask Helix about every live channel.
    pub async fn run<P>(self: Arc<Self>, publish: P, shutdown: impl Future<Output = ()>)
    where
        P: Fn(Vec<LiveStream>) + Send + Sync,
    {
        let (tx, rx) = mpsc::channel(1);
        let period = self.cfg.poll;
        let ticker = tokio::spawn(async move {
            let mut iv = tokio::time::interval_at(tokio::time::Instant::now() + period, period);
            iv.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            loop {
                iv.tick().await;
                if tx.send(()).await.is_err() {
                    return;
                }
            }
        });
        self.run_with_ticks(&publish, rx, shutdown).await;
        ticker.abort();
    }

    /// [`Poller::run`] driven by a channel instead of a clock, so a test can
    /// drive it.
    pub(crate) async fn run_with_ticks<P>(
        &self,
        publish: &P,
        mut ticks: mpsc::Receiver<()>,
        shutdown: impl Future<Output = ()>,
    ) where
        P: Fn(Vec<LiveStream>) + Send + Sync,
    {
        tokio::pin!(shutdown);
        let resolved = tokio::select! {
            r = self.resolve_game_id() => r,
            () = &mut shutdown => return,
        };
        let game_id = match resolved {
            Ok(id) => id,
            Err(e) => {
                tracing::warn!("twitch live is off: {e}");
                return;
            }
        };
        // The one line written when it switches on. Nothing is logged when it
        // is off: a line at every startup about a feature nobody configured is
        // noise.
        tracing::info!(
            "twitch live on game_id={game_id} poll={}s previews={}",
            self.cfg.poll.as_secs(),
            !self.cfg.cdn_slug.is_empty()
        );
        let mut st = PollState {
            game_id,
            ..Default::default()
        };

        let mut first = true;
        loop {
            if !first {
                tokio::select! {
                    t = ticks.recv() => if t.is_none() { return },
                    () = &mut shutdown => return,
                }
            }
            first = false;
            tokio::select! {
                () = self.tick(&mut st, publish) => {},
                () = &mut shutdown => return,
            }
        }
    }

    pub(crate) async fn tick<P>(&self, st: &mut PollState, publish: &P)
    where
        P: Fn(Vec<LiveStream>),
    {
        if st.pause_until.is_some_and(|until| Instant::now() < until) {
            return;
        }
        self.polls.fetch_add(1, Ordering::Relaxed);

        let (raw, cache) = match self.fetch_streams(&st.game_id).await {
            Ok(v) => v,
            Err(e) => {
                self.poll_errors.fetch_add(1, Ordering::Relaxed);
                let d = e.retry_after();
                if !d.is_zero() {
                    st.pause_until = Some(Instant::now() + d);
                    tracing::warn!("twitch live paused for {}s: {e}", d.as_secs());
                } else {
                    tracing::warn!("twitch live poll failed: {e}");
                }
                self.expire(st, publish);
                return;
            }
        };

        let (rows, dropped) = self.screen(&raw);
        if dropped > 0 {
            self.rows_screened
                .fetch_add(dropped as i64, Ordering::Relaxed);
        }

        let prev = self.current();
        let (rows, thumbs) = self.with_thumbs(rows, &raw, prev.as_deref()).await;

        let at = Instant::now();
        let updated = unix_now();
        let json_body = encode_live(&rows, updated);
        self.streams_live
            .store(rows.len() as i64, Ordering::Relaxed);
        let sig = signature(&rows);
        let n = rows.len();
        self.store(Snapshot {
            streams: rows.clone(),
            thumbs,
            at,
            updated,
            json_body,
        });

        if cache == "HIT" {
            // On a HIT the freshness of this list is the gateway's, not our
            // poll period.
            tracing::info!("twitch live cache=HIT streams={n}");
        }
        if sig != st.last_sig {
            st.last_sig = sig;
            publish(rows);
        }
    }

    /// What a failing poll does about the list already on screen: nothing,
    /// until the last good answer is older than `LIVE_MAX_AGE` — and then it
    /// publishes an empty one.
    fn expire<P>(&self, st: &mut PollState, publish: &P)
    where
        P: Fn(Vec<LiveStream>),
    {
        let Some(snap) = self.current() else { return };
        if snap.at.elapsed() < LIVE_MAX_AGE {
            return;
        }
        self.store(Snapshot {
            streams: Vec::new(),
            thumbs: HashMap::new(),
            at: snap.at,
            updated: snap.updated,
            json_body: encode_live(&[], snap.updated),
        });
        self.streams_live.store(0, Ordering::Relaxed);
        if !st.last_sig.is_empty() {
            st.last_sig.clear();
            publish(Vec::new());
        }
    }

    pub(crate) fn store(&self, s: Snapshot) {
        *self.snap.write().unwrap_or_else(|e| e.into_inner()) = Some(Arc::new(s));
    }

    pub(crate) fn current(&self) -> Option<Arc<Snapshot>> {
        self.snap.read().unwrap_or_else(|e| e.into_inner()).clone()
    }

    /// What the page and the socket are both drawn from, capped by the caller:
    /// the wire wants fewer than the page does. Zero means everything.
    pub fn streams(&self, max: usize) -> Vec<LiveStream> {
        let Some(snap) = self.current() else {
            return Vec::new();
        };
        let n = if max > 0 {
            max.min(snap.streams.len())
        } else {
            snap.streams.len()
        };
        snap.streams[..n].to_vec()
    }

    pub fn live_json(&self) -> Vec<u8> {
        match self.current() {
            Some(s) => s.json_body.clone(),
            None => encode_live(&[], 0),
        }
    }

    pub fn stats(&self) -> Stats {
        Stats {
            polls: self.polls.load(Ordering::Relaxed),
            errors: self.poll_errors.load(Ordering::Relaxed),
            rows_screened: self.rows_screened.load(Ordering::Relaxed),
            thumb_errors: self.thumb_errors.load(Ordering::Relaxed),
            streams_live: self.streams_live.load(Ordering::Relaxed),
        }
    }
}

fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// `{"streams":[…],"updated":<unix seconds>}`, and an empty list is a list:
/// the page reads one, never a `null`.
pub(crate) fn encode_live(rows: &[LiveStream], updated: i64) -> Vec<u8> {
    #[derive(serde::Serialize)]
    struct Body<'a> {
        streams: &'a [LiveStream],
        updated: i64,
    }
    serde_json::to_vec(&Body {
        streams: rows,
        updated,
    })
    .unwrap_or_else(|_| br#"{"streams":[],"updated":0}"#.to_vec())
}

/// What "nothing changed" means here: the same channels, in the same order,
/// with the same viewer counts and the same pictures.
fn signature(rows: &[LiveStream]) -> String {
    rows.iter()
        .map(|r| format!("{}|{}|{};", r.login, r.viewers, r.thumb))
        .collect()
}
