//! The hub: its shared half, the state its loop owns, and the loop. Port of
//! `server/hub/hub.go`.
//!
//! A table owns its own task (`actor.rs`), and the hub owns what is genuinely
//! between tables: the map of them, the matchmaking queue, the connected
//! sockets, the wrong-code budgets and the drain. Nothing else is shared.
//! [`Hub`] is the handle anybody may hold; [`HubCore`] is the state only the
//! loop touches, which is why none of it is locked.

use crate::net::client::Client;
use crate::net::privacy::{HasNetPolicy, NetPolicy};
use crate::net::serve::Admission;
use crate::net::wire::ClientMsg;
use crate::ops::config::HubConfig;
use crate::ops::logsink::AsyncLog;
use crate::ops::metrics::{Exporter, HealthStats, HubMetrics, LiveStats, MetricsStats};
use crate::table::actor::TableHandle;
use axum::extract::ws::Utf8Bytes;
use std::collections::HashMap;
use std::future::Future;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::{mpsc, oneshot, watch};
use tokio::time::Instant;

/// How many sockets may be waiting to register or unregister at once.
pub const REGISTER_DEPTH: usize = 16;
/// The hub's own inbound queue. A full one answers "server busy".
pub const INBOUND_DEPTH: usize = 256;
/// The hub's queue for work handed back by a table. Generous, because
/// overflowing it is the one thing here that can lose a room; the retry is
/// what makes that survivable, not this number.
pub const ROUTER_DEPTH: usize = 1024;

/// How long a router post that found the queue full waits before its one
/// retry.
pub const ROUTER_RETRY: Duration = Duration::from_secs(1);

/// One message from one socket, on its way to the loop.
#[derive(Debug)]
pub struct Inbound {
    pub client: Arc<Client>,
    pub msg: ClientMsg,
}

/// A socket asking to be registered. `ack` is fired once it is, and only then
/// are its pumps started, so the reader's unregister is never processed before
/// the register.
pub(crate) struct Register {
    pub client: Arc<Client>,
    pub ack: oneshot::Sender<()>,
}

/// Work a table hands back because it is not a table's to do.
pub type RouterJob = Box<dyn FnOnce(&mut HubCore) + Send>;

pub(crate) enum Control {
    Drain,
    Save(
        PathBuf,
        oneshot::Sender<Result<(), crate::ops::snapshot::SnapshotError>>,
    ),
    Load(
        PathBuf,
        oneshot::Sender<Result<(), crate::ops::snapshot::SnapshotError>>,
    ),
    #[cfg(any(test, feature = "testkit"))]
    Run(Box<dyn FnOnce(&mut HubCore) + Send>),
    Stop,
}

pub(crate) struct Senders {
    pub register: mpsc::Sender<Register>,
    pub unregister: mpsc::Sender<Arc<Client>>,
    pub inbound: mpsc::Sender<Inbound>,
    pub router: mpsc::Sender<RouterJob>,
    pub control: mpsc::UnboundedSender<Control>,
}

type LiveStatsFn = Arc<dyn Fn() -> LiveStats + Send + Sync>;
#[cfg(any(test, feature = "testkit"))]
pub(crate) type Probe = Arc<dyn Fn(&str) + Send + Sync>;

/// What every task may read. Everything in it is atomic, immutable, or behind
/// a lock held for one read or one write — and none of it is a table's.
pub struct Shared {
    pub(crate) cfg: HubConfig,
    pub(crate) metrics: HubMetrics,
    exporter: Exporter,
    pub(crate) admission: Mutex<Admission>,
    pub(crate) draining: AtomicBool,
    pub(crate) drained: watch::Sender<bool>,
    stopped: watch::Sender<bool>,
    started: Instant,
    log_sink: Mutex<Option<AsyncLog>>,
    live_stats: Mutex<Option<LiveStatsFn>>,
    pub(crate) next_client_key: AtomicU64,
    pub(crate) tx: Senders,
    #[cfg(any(test, feature = "testkit"))]
    pub(crate) table_probe: Mutex<Option<Probe>>,
    #[cfg(any(test, feature = "testkit"))]
    pub(crate) dispatch_probe: Mutex<Option<Probe>>,
}

impl std::fmt::Debug for Shared {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Shared").finish_non_exhaustive()
    }
}

/// The handle to a running hub. Cheap to clone; every method is safe from any
/// task.
#[derive(Clone, Debug)]
pub struct Hub(Arc<Shared>);

impl HasNetPolicy for Hub {
    fn net_policy(&self) -> &NetPolicy {
        &self.0.cfg.net
    }
}

impl Hub {
    /// Builds a hub and spawns its loop on the current runtime.
    pub fn start(cfg: HubConfig) -> Hub {
        let (register, register_rx) = mpsc::channel(REGISTER_DEPTH);
        let (unregister, unregister_rx) = mpsc::channel(REGISTER_DEPTH);
        let (inbound, inbound_rx) = mpsc::channel(INBOUND_DEPTH);
        let (router, router_rx) = mpsc::channel(ROUTER_DEPTH);
        let (control, control_rx) = mpsc::unbounded_channel();
        let shared = Arc::new(Shared {
            cfg,
            metrics: HubMetrics::default(),
            exporter: Exporter::default(),
            admission: Mutex::new(Admission::default()),
            draining: AtomicBool::new(false),
            drained: watch::channel(false).0,
            stopped: watch::channel(false).0,
            started: Instant::now(),
            log_sink: Mutex::new(None),
            live_stats: Mutex::new(None),
            next_client_key: AtomicU64::new(1),
            tx: Senders {
                register,
                unregister,
                inbound,
                router,
                control,
            },
            #[cfg(any(test, feature = "testkit"))]
            table_probe: Mutex::new(None),
            #[cfg(any(test, feature = "testkit"))]
            dispatch_probe: Mutex::new(None),
        });
        let hub = Hub(shared);
        let core = HubCore {
            hub: hub.clone(),
            tables: HashMap::new(),
            clients: HashMap::new(),
            queue: Vec::new(),
            join_budgets: HashMap::new(),
            live_bytes: None,
            live_version: 0,
            drained_closed: false,
        };
        tokio::spawn(core.run(Receivers {
            register: register_rx,
            unregister: unregister_rx,
            inbound: inbound_rx,
            router: router_rx,
            control: control_rx,
        }));
        hub
    }

    pub(crate) fn shared(&self) -> &Arc<Shared> {
        &self.0
    }

    pub fn config(&self) -> &HubConfig {
        &self.0.cfg
    }

    pub fn metrics(&self) -> &HubMetrics {
        &self.0.metrics
    }

    /// Ends the loop and every table's task, and waits for all of it to be
    /// gone. When this returns nothing in this hub is still running, which is
    /// what makes the read of a stopped table safe.
    pub async fn stop(&self) {
        let _ = self.0.tx.control.send(Control::Stop);
        let mut stopped = self.0.stopped.subscribe();
        let _ = stopped.wait_for(|s| *s).await;
    }

    /// Asks the loop to run `fn` on itself: how a table, the poller or a timer
    /// reaches the map of tables, the queue and the sockets.
    ///
    /// Never waits. A full queue is retried once, a second later — the two
    /// callers that matter are deleting a room and putting a player back in the
    /// queue, and losing either is a leak somebody notices much later.
    pub fn post_to_router(
        &self,
        what: &'static str,
        job: impl FnOnce(&mut HubCore) + Send + 'static,
    ) {
        let job: RouterJob = Box::new(job);
        match self.0.tx.router.try_send(job) {
            Ok(()) => {}
            Err(mpsc::error::TrySendError::Closed(_)) => {}
            Err(mpsc::error::TrySendError::Full(job)) => {
                self.0
                    .metrics
                    .channel_retries
                    .fetch_add(1, Ordering::Relaxed);
                tracing::info!("router box full, retrying {what} in 1s");
                let tx = self.0.tx.router.clone();
                tokio::spawn(async move {
                    tokio::time::sleep(ROUTER_RETRY).await;
                    if tx.try_send(job).is_err() {
                        tracing::warn!(what, "router job dropped");
                    }
                });
            }
        }
    }

    // ── what operators read ─────────────────────────────────────────────────

    /// Tells the hub which asynchronous log writer to report drops from.
    pub fn set_log_sink(&self, sink: AsyncLog) {
        *self.0.log_sink.lock().unwrap_or_else(|e| e.into_inner()) = Some(sink);
    }

    /// Installs the reader `/metrics` calls for the poller's counters, so the
    /// hub reports them without knowing what a poller is.
    pub fn set_live_stats(&self, f: impl Fn() -> LiveStats + Send + Sync + 'static) {
        *self.0.live_stats.lock().unwrap_or_else(|e| e.into_inner()) = Some(Arc::new(f));
    }

    fn log_lines_dropped(&self) -> i64 {
        self.0
            .log_sink
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .map_or(0, AsyncLog::dropped)
    }

    fn live_stats(&self) -> LiveStats {
        let f = self
            .0
            .live_stats
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        f.map(|f| f()).unwrap_or_default()
    }

    pub fn health(&self) -> HealthStats {
        let m = &self.0.metrics;
        HealthStats {
            status: "ok".into(),
            rooms: m.rooms.load(Ordering::Relaxed),
            clients: m.clients.load(Ordering::Relaxed),
            uptime_sec: self.0.started.elapsed().as_secs() as i64,
            draining: self.draining(),
        }
    }

    pub fn metrics_stats(&self) -> MetricsStats {
        let m = &self.0.metrics;
        let r = |a: &std::sync::atomic::AtomicI32| a.load(Ordering::Relaxed);
        let r64 = |a: &std::sync::atomic::AtomicI64| a.load(Ordering::Relaxed);
        let inbound = &self.0.tx.inbound;
        MetricsStats {
            rooms_active: r(&m.rooms),
            players_connected: r(&m.clients),
            matches_started: r(&m.matches_started),
            matches_finished: r(&m.matches_finished),
            bots_active: r(&m.bots_active),
            uptime_sec: self.0.started.elapsed().as_secs() as i64,
            goroutine_count: tokio::runtime::Handle::try_current()
                .map(|h| h.metrics().num_alive_tasks() as i64)
                .unwrap_or(0),
            messages_rate_limited: r64(&m.messages_rate_limited),
            messages_dropped_busy: r64(&m.messages_dropped_busy),
            slow_clients_closed: r64(&m.slow_clients_closed),
            channel_retries: r64(&m.channel_retries),
            suspected_cheats: r64(&m.suspected_cheats),
            reconnect_expirations: r64(&m.reconnect_expirations),
            matchmaking_queue: r(&m.matchmaking_queue),
            matches_matchmade: r(&m.matches_matchmade),
            matches_solo: r(&m.matches_solo),
            debug_mode_active: self.0.cfg.debug_mode,
            draining: self.draining(),
            matches_in_flight: r(&m.matches_in_flight),
            handler_panics: r64(&m.handler_panics),
            conns_refused: r64(&m.conns_refused),
            joins_throttled: r64(&m.joins_throttled),
            loop_queue_depth: (inbound.max_capacity() - inbound.capacity()) as i32,
            loop_queue_capacity: inbound.max_capacity() as i32,
            loop_queue_peak: r(&m.loop_queue_peak),
            loop_slowest_us: r64(&m.loop_slowest_us),
            loop_events: r64(&m.loop_event_count),
            log_lines_dropped: self.log_lines_dropped(),
            live: self.live_stats(),
        }
    }

    pub fn render_metrics(&self) -> String {
        self.0.exporter.render(&self.metrics_stats())
    }

    // ── test seams ──────────────────────────────────────────────────────────

    /// Runs `f` on the hub's loop and hands back what it returns: how a test
    /// reaches the state only the loop may touch.
    #[cfg(any(test, feature = "testkit"))]
    pub async fn on_loop<R: Send + 'static>(
        &self,
        f: impl FnOnce(&mut HubCore) -> R + Send + 'static,
    ) -> R {
        let (tx, rx) = oneshot::channel();
        let _ = self.0.tx.control.send(Control::Run(Box::new(move |core| {
            let _ = tx.send(f(core));
        })));
        rx.await.expect("the hub stopped before running the job")
    }

    /// Fired at the top of every job a table runs, with that table's code: how
    /// a test makes one table's handler panic, or holds one table still while
    /// another plays. Go's `SetTableProbe`.
    #[cfg(any(test, feature = "testkit"))]
    pub fn set_table_probe(&self, f: impl Fn(&str) + Send + Sync + 'static) {
        *self.0.table_probe.lock().unwrap_or_else(|e| e.into_inner()) = Some(Arc::new(f));
    }

    /// Fired at the top of `dispatch`, with the message type. Go's
    /// `SetDispatchProbe`.
    #[cfg(any(test, feature = "testkit"))]
    pub fn set_dispatch_probe(&self, f: impl Fn(&str) + Send + Sync + 'static) {
        *self
            .0
            .dispatch_probe
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(Arc::new(f));
    }
}

struct Receivers {
    register: mpsc::Receiver<Register>,
    unregister: mpsc::Receiver<Arc<Client>>,
    inbound: mpsc::Receiver<Inbound>,
    router: mpsc::Receiver<RouterJob>,
    control: mpsc::UnboundedReceiver<Control>,
}

enum Event {
    Control(Control),
    Latency,
    Online,
    Register(Register),
    Unregister(Arc<Client>),
    Inbound(Inbound),
    Router(RouterJob),
}

/// The state only the hub's loop touches. Handlers and router jobs get it as
/// `&mut`, which is the whole of its access control.
pub struct HubCore {
    pub hub: Hub,
    /// Every live table, keyed by its code.
    pub tables: HashMap<crate::ids::RoomCode, TableHandle>,
    /// Every registered socket, keyed by `Client::key`.
    pub clients: HashMap<u64, Arc<Client>>,
    /// The 1v1 queue, oldest wait first. Its length is a metric and nothing
    /// else.
    ///
    pub queue: Vec<crate::router::matchmaking::QueuedPlayer>,
    /// How many table codes each network has got wrong recently.
    pub(crate) join_budgets: HashMap<String, crate::router::rooms::JoinBudget>,
    pub(crate) live_bytes: Option<Utf8Bytes>,
    pub(crate) live_version: u64,
    pub(crate) drained_closed: bool,
}

impl std::fmt::Debug for HubCore {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("HubCore")
            .field("tables", &self.tables.len())
            .field("clients", &self.clients.len())
            .finish_non_exhaustive()
    }
}

impl HubCore {
    async fn run(mut self, mut rx: Receivers) {
        let t = self.hub.config().timings.clone();
        let start = Instant::now();
        let mut latency = tokio::time::interval_at(
            start + t.latency_broadcast_period,
            t.latency_broadcast_period,
        );
        let mut online =
            tokio::time::interval_at(start + t.players_online_period, t.players_online_period);
        latency.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        online.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

        loop {
            let ev = tokio::select! {
                Some(c) = rx.control.recv() => Event::Control(c),
                _ = latency.tick() => Event::Latency,
                _ = online.tick() => Event::Online,
                Some(r) = rx.register.recv() => Event::Register(r),
                Some(c) = rx.unregister.recv() => Event::Unregister(c),
                Some(im) = rx.inbound.recv() => Event::Inbound(im),
                Some(job) = rx.router.recv() => Event::Router(job),
                else => break,
            };
            match ev {
                Event::Control(Control::Stop) => break,
                Event::Control(Control::Drain) => self.begin_drain(),
                Event::Control(Control::Save(path, reply)) => {
                    let _ = reply.send(self.save_snapshot(&path).await);
                }
                Event::Control(Control::Load(path, reply)) => {
                    let _ = reply.send(self.load_snapshot(&path));
                }
                #[cfg(any(test, feature = "testkit"))]
                Event::Control(Control::Run(f)) => f(&mut self),
                Event::Latency => self.broadcast_latencies(),
                Event::Online => self.broadcast_players_online(),
                Event::Register(Register { client, ack }) => {
                    self.clients.insert(client.key, client.clone());
                    self.hub.metrics().clients.fetch_add(1, Ordering::Relaxed);
                    tracing::info!(conn = %client.conn_id, addr = %client.net_prefix(), "player connected");
                    // The pumps start now, so the first thing this server says
                    // to a socket has a writer to reach. The two answers queue
                    // ahead of anything else it will be told.
                    let _ = ack.send(());
                    self.send_players_online(&client);
                    self.send_live_streams(&client);
                }
                Event::Unregister(client) => {
                    if self.clients.remove(&client.key).is_some() {
                        self.hub.metrics().clients.fetch_sub(1, Ordering::Relaxed);
                        client.close();
                        self.handle_disconnect(&client);
                    }
                }
                Event::Inbound(Inbound { client, msg }) => {
                    crate::router::dispatch::dispatch(&mut self, &client, msg)
                }
                Event::Router(job) => job(&mut self),
            }
            // After every event, not hooked onto the handful that can end a
            // match: the path that gets forgotten is the one that leaves a
            // deploy hanging until its timeout.
            if self.hub.draining() {
                self.check_drained();
            }
        }

        // Every table's task goes with this one, and before `stopped` is
        // published, so `Hub::stop` still means what it says.
        self.stop_tables().await;
        self.hub.0.stopped.send_replace(true);
    }

    /// Stops every table's task and waits for each, handing back the state the
    /// ones still running owned.
    pub(crate) async fn stop_tables(&mut self) -> Vec<crate::table::Table> {
        let mut out = Vec::new();
        for t in self.tables.values_mut() {
            if let Some(state) = t.stop().await {
                out.push(state);
            }
        }
        out
    }

    /// Puts a fully built table in the map and starts its task. Every
    /// construction path does all of its own writing before this — a task
    /// reading fields somebody is still writing is the race the split between
    /// building and starting exists to make impossible.
    pub fn open_table(&mut self, table: crate::table::Table) -> &TableHandle {
        self.open_table_with(table, None)
    }

    /// `open_table`, with the job the table's task runs before anything else:
    /// work that has to happen on the table (it arms deadlines) and that no
    /// full box may refuse.
    pub fn open_table_with(
        &mut self,
        mut table: crate::table::Table,
        first: Option<crate::table::actor::TableJob>,
    ) -> &TableHandle {
        table.timings = Arc::new(self.hub.config().timings.clone());
        let code = table.code.clone();
        let handle = TableHandle::start(table, self.hub.clone(), first);
        self.hub.metrics().rooms.fetch_add(1, Ordering::Relaxed);
        self.tables.insert(code.clone(), handle);
        &self.tables[&code]
    }

    /// A table built on this hub's clocks, not yet started.
    pub fn new_table(&self, code: &str, room: crate::table::room::Room) -> crate::table::Table {
        let mut t = crate::table::Table::new(code, room);
        t.timings = Arc::new(self.hub.config().timings.clone());
        t
    }

    /// Forgets a table and stops its task, in one step on the loop and without
    /// waiting for it. The map entry goes first, so nothing new can be routed to
    /// it. A job is synchronous and is never cut in half, so the one the task
    /// may be inside finishes; after it, the task runs nothing — no job still
    /// in its box, no deadline, not even one that fell due in the same batch
    /// (`actor::run` checks the stop before each). Waiting here instead would
    /// block every other table behind one.
    pub fn delete_room(&mut self, code: &str) {
        let Some(mut t) = self.tables.remove(code) else {
            return;
        };
        self.hub.metrics().rooms.fetch_sub(1, Ordering::Relaxed);
        let bots = t.bots_hint();
        self.hub
            .metrics()
            .bots_active
            .fetch_sub(bots, Ordering::Relaxed);
        t.signal_stop();
        tokio::spawn(async move {
            let _ = t.stop().await;
        });
        tracing::info!(code, "room deleted");
    }

    /// The table a client is sitting at, if any.
    pub fn table_of(&self, c: &Client) -> Option<&TableHandle> {
        self.tables.get(&*c.room_code()?)
    }

    /// Every table's latency fan-out, asked of each table: who sits where is
    /// the table's to say.
    fn broadcast_latencies(&self) {
        for t in self.tables.values() {
            t.post_from_timer("latency", |table, _| table.send_latencies());
        }
    }
}

impl Hub {
    /// Runs `req` on the loop and waits for the answer.
    pub(crate) fn control(&self, c: Control) -> bool {
        self.0.tx.control.send(c).is_ok()
    }

    /// Resolves once `stop` has finished.
    pub fn stopped(&self) -> impl Future<Output = ()> + use<> {
        let mut rx = self.0.stopped.subscribe();
        async move {
            let _ = rx.wait_for(|s| *s).await;
        }
    }
}
