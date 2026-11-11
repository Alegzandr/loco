//! One table, one task, and the two ways work crosses between them. Port of
//! `server/hub/actor.go`.
//!
//! A table owns its own task and is the sole owner of its state, so nothing in
//! it is locked. The two directions are deliberately the same shape:
//!
//!   - [`TableSender::post`]       run this on that table
//!   - [`crate::Hub::post_to_router`] run this on the hub
//!
//! **Both are non-blocking, and that is not an optimisation.** A blocking send
//! in either direction deadlocks the moment the other end is trying to send
//! back, which is a state two busy tables reach on their own. What cannot be
//! delivered is dropped and counted, and the posts whose loss would leak
//! something retry once.
//!
//! Go armed `time.AfterFunc` callbacks that posted back and then re-checked a
//! stamp to see whether they had gone stale. Here a deadline lives in the
//! table's own state ([`Deadlines`]), keyed by what it is for: arming a key
//! replaces whatever was armed there, so a stale callback does not exist to be
//! filtered. The task sleeps until the next one inside the same `select!` that
//! reads its mailbox.

use crate::Hub;
use crate::net::client::Client;
use crate::ops::logsink::panic_message;
use crate::table::Table;
use std::borrow::Cow;
use std::collections::HashMap;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::Arc;
use std::sync::atomic::{AtomicI32, AtomicU8, Ordering};
use std::time::Duration;
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;
use tokio::time::Instant;
use tracing::Instrument;

/// How many jobs may wait for one table: how far one table may fall behind
/// before its own players are told to retry. It says nothing about anybody
/// else's table.
pub const TABLE_BOX_DEPTH: usize = 64;

/// What a job does to the table it runs on.
pub type TableFn = Box<dyn FnOnce(&mut Table, &TableCtx) + Send>;

/// One unit of work for a table's task.
pub struct TableJob {
    /// Names the job in the line a recovered panic writes: a message type for
    /// anything a player sent, the timer's own name otherwise.
    pub what: Cow<'static, str>,
    /// The socket the job came from, and `None` for a timer. It is who the
    /// refusal goes to when the job panics.
    pub client: Option<Arc<Client>>,
    pub run: TableFn,
}

impl std::fmt::Debug for TableJob {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TableJob")
            .field("what", &self.what)
            .finish_non_exhaustive()
    }
}

impl TableJob {
    pub fn new(
        what: impl Into<Cow<'static, str>>,
        run: impl FnOnce(&mut Table, &TableCtx) + Send + 'static,
    ) -> Self {
        TableJob {
            what: what.into(),
            client: None,
            run: Box::new(run),
        }
    }

    pub fn from_client(mut self, c: Arc<Client>) -> Self {
        self.client = Some(c);
        self
    }
}

/// What a job is handed besides the table: the hub, and a way back into its
/// own mailbox.
#[derive(Clone, Debug)]
pub struct TableCtx {
    pub hub: Hub,
    pub me: TableSender,
}

impl TableCtx {
    /// A context for driving a `Table` by hand, with no task behind it: what
    /// it posts to itself goes nowhere. The white-box tests and the benches
    /// drive tables this way.
    pub fn detached(hub: &Hub, code: &str) -> TableCtx {
        let (tx, _rx) = mpsc::channel(TABLE_BOX_DEPTH);
        TableCtx {
            hub: hub.clone(),
            me: TableSender {
                code: Arc::from(code),
                tx,
            },
        }
    }
}

/// Whether a shutdown would interrupt something here: a match being played, or
/// a matchmade pair whose reveal is running and whose deal is already
/// scheduled. An ordinary lobby is not, because a drain refuses `start_game`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum Phase {
    Idle = 0,
    InFlight = 1,
}

/// What the hub may read about a table without asking it: published by the
/// table's task after every job it runs.
#[derive(Debug, Default)]
pub(crate) struct Published {
    phase: AtomicU8,
    bots: AtomicI32,
}

impl Published {
    fn publish(&self, t: &Table) {
        self.phase.store(t.phase() as u8, Ordering::Release);
        self.bots.store(t.bot_count() as i32, Ordering::Release);
    }
}

/// A way to reach one table's mailbox. Cheap to clone; held by timers, by the
/// hub, and by the table's own jobs.
#[derive(Clone)]
pub struct TableSender {
    code: Arc<str>,
    tx: mpsc::Sender<TableJob>,
}

impl std::fmt::Debug for TableSender {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "TableSender({})", self.code)
    }
}

impl TableSender {
    pub fn code(&self) -> &str {
        &self.code
    }

    /// Hands a job to the table, and gives it back if the box is full or the
    /// table has stopped. Never waits: see the module comment.
    pub fn post(&self, job: TableJob) -> Result<(), TableJob> {
        self.tx.try_send(job).map_err(|e| match e {
            mpsc::error::TrySendError::Full(j) | mpsc::error::TrySendError::Closed(j) => j,
        })
    }

    /// `post` for a deferred job with nobody waiting for an answer: a dropped
    /// one fails quietly, which is a legal outcome rather than a fault.
    pub fn post_from_timer(
        &self,
        what: &'static str,
        run: impl FnOnce(&mut Table, &TableCtx) + Send + 'static,
    ) {
        if self.post(TableJob::new(what, run)).is_err() {
            tracing::info!(code = %self.code, "table box full, dropping {what}");
        }
    }

    /// `post` for the jobs whose loss leaks: a seat nobody frees, a room nobody
    /// deletes, a reveal that never deals. Retried once after `retry`.
    pub fn post_critical(
        &self,
        hub: &Hub,
        what: &'static str,
        retry: Duration,
        run: impl FnOnce(&mut Table, &TableCtx) + Send + 'static,
    ) {
        let Err(job) = self.post(TableJob::new(what, run)) else {
            return;
        };
        hub.metrics()
            .channel_retries
            .fetch_add(1, Ordering::Relaxed);
        tracing::info!(code = %self.code, "table box full, retrying {what} in {retry:?}");
        let me = self.clone();
        tokio::spawn(async move {
            tokio::time::sleep(retry).await;
            if me.post(job).is_err() {
                tracing::warn!(code = %me.code, "{what} retry dropped");
            }
        });
    }
}

/// The hub's handle on one running table.
pub struct TableHandle {
    sender: TableSender,
    published: Arc<Published>,
    quit: Option<oneshot::Sender<()>>,
    join: Option<JoinHandle<Table>>,
}

impl std::fmt::Debug for TableHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "TableHandle({})", self.sender.code)
    }
}

impl std::ops::Deref for TableHandle {
    type Target = TableSender;
    fn deref(&self) -> &TableSender {
        &self.sender
    }
}

impl TableHandle {
    /// Gives a fully built table its task. Its phase is published before the
    /// task exists, so a table restored mid-match counts against the drain
    /// from its first instant rather than from its first message. `first`, if
    /// any, is the task's first job: handed to it rather than posted, so no box
    /// can refuse it the way it can refuse a post.
    pub(crate) fn start(table: Table, hub: Hub, first: Option<TableJob>) -> TableHandle {
        let (tx, rx) = mpsc::channel(TABLE_BOX_DEPTH);
        let (quit_tx, quit_rx) = oneshot::channel();
        let sender = TableSender {
            code: Arc::from(table.code.as_str()),
            tx,
        };
        let published = Arc::new(Published::default());
        published.publish(&table);
        let ctx = TableCtx {
            hub,
            me: sender.clone(),
        };
        // Every line the table writes carries `code=`, from this span rather
        // than from each call site.
        let span = tracing::info_span!("table", code = %table.code);
        let join =
            tokio::spawn(run(table, first, rx, quit_rx, ctx, published.clone()).instrument(span));
        TableHandle {
            sender,
            published,
            quit: Some(quit_tx),
            join: Some(join),
        }
    }

    pub fn sender(&self) -> &TableSender {
        &self.sender
    }

    /// The phase this table last published. How the drain counts without
    /// reading a table it does not own.
    pub fn phase(&self) -> Phase {
        match self.published.phase.load(Ordering::Acquire) {
            1 => Phase::InFlight,
            _ => Phase::Idle,
        }
    }

    pub(crate) fn bots_hint(&self) -> i32 {
        self.published.bots.load(Ordering::Acquire)
    }

    pub(crate) fn signal_stop(&mut self) {
        if let Some(q) = self.quit.take() {
            let _ = q.send(());
        }
    }

    /// Ends this table's task and waits for it, handing back the state it
    /// owned. `None` the second time, or if the task died.
    pub async fn stop(&mut self) -> Option<Table> {
        self.signal_stop();
        let join = self.join.take()?;
        join.await.ok()
    }
}

async fn run(
    mut table: Table,
    first: Option<TableJob>,
    mut rx: mpsc::Receiver<TableJob>,
    mut quit: oneshot::Receiver<()>,
    ctx: TableCtx,
    published: Arc<Published>,
) -> Table {
    if let Some(job) = first {
        let start = Instant::now();
        run_job(&mut table, &ctx, job);
        ctx.hub.metrics().note_event(0, start.elapsed());
        published.publish(&table);
    }
    loop {
        let next = table.deadlines.next();
        tokio::select! {
            biased;
            _ = &mut quit => break,
            job = rx.recv() => {
                let Some(job) = job else { break };
                // Timed here, because here is where the work is.
                let queued = rx.len();
                let start = Instant::now();
                run_job(&mut table, &ctx, job);
                ctx.hub.metrics().note_event(queued, start.elapsed());
            }
            _ = tokio::time::sleep_until(next.unwrap_or_else(Instant::now)), if next.is_some() => {
                // Several deadlines can fall due together. A deletion that
                // lands between two of them stops the rest: a deleted table
                // runs nothing after the job it was in.
                let mut deleted = false;
                for job in table.deadlines.take_due(Instant::now()) {
                    if quit.try_recv().is_ok() {
                        deleted = true;
                        break;
                    }
                    let start = Instant::now();
                    run_job(&mut table, &ctx, job);
                    ctx.hub.metrics().note_event(0, start.elapsed());
                }
                if deleted {
                    break;
                }
            }
        }
        // After every job, not hooked onto the handful that can end a match:
        // the one that gets forgotten leaves a deploy hanging.
        published.publish(&table);
    }
    table
}

/// The floor under every handler a table runs: a panic costs one message and
/// one WARN. It matters more here than on the hub — a table whose task died
/// would not fail, it would go quiet, for ever.
pub(crate) fn run_job(table: &mut Table, ctx: &TableCtx, job: TableJob) {
    let TableJob { what, client, run } = job;
    #[cfg(any(test, feature = "testkit"))]
    let probe = ctx
        .hub
        .shared()
        .table_probe
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    // A player's message is logged under its connection, like the pumps' lines.
    let span = client
        .as_ref()
        .map(|c| tracing::info_span!("job", conn = %c.conn_id))
        .unwrap_or_else(tracing::Span::none);
    let _entered = span.enter();
    let result = catch_unwind(AssertUnwindSafe(|| {
        // Go fired its probe at the top of a message's handler, never a
        // timer's: a client job is that.
        #[cfg(any(test, feature = "testkit"))]
        if let Some(p) = probe
            && client.is_some()
        {
            p(&table.code);
        }
        run(table, ctx);
    }));
    if let Err(p) = result {
        ctx.hub
            .metrics()
            .handler_panics
            .fetch_add(1, Ordering::Relaxed);
        let player = client
            .as_ref()
            .and_then(|c| c.seat())
            .map_or(-1, |s| s.id as i64);
        tracing::warn!(
            job = %what,
            player,
            panic = %panic_message(p.as_ref()),
            "handler panic recovered"
        );
        if let Some(c) = client {
            c.refuse(crate::table::refusal::Refusal::ServerError);
        }
    }
}

/// What a deadline is for. Arming a key replaces what was armed under it, which
/// is how a turn timer re-armed for a new turn cannot fire for the old one.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct DeadlineKey {
    pub kind: &'static str,
    /// A seat, or -1 for a deadline about the table as a whole.
    pub seat: i32,
}

impl DeadlineKey {
    pub const fn table(kind: &'static str) -> Self {
        DeadlineKey { kind, seat: -1 }
    }
    pub const fn seat(kind: &'static str, seat: usize) -> Self {
        DeadlineKey {
            kind,
            seat: seat as i32,
        }
    }
}

struct Armed {
    at: Instant,
    seq: u64,
    run: TableFn,
}

/// Every deadline a table has armed, in its own state.
#[derive(Default)]
pub struct Deadlines {
    slots: HashMap<DeadlineKey, Armed>,
    seq: u64,
}

impl std::fmt::Debug for Deadlines {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_map()
            .entries(self.slots.iter().map(|(k, a)| (k, a.at)))
            .finish()
    }
}

impl Deadlines {
    /// Arms `key` to run at `at`, replacing whatever was armed under it.
    pub fn arm(
        &mut self,
        key: DeadlineKey,
        at: Instant,
        run: impl FnOnce(&mut Table, &TableCtx) + Send + 'static,
    ) {
        self.seq += 1;
        self.slots.insert(
            key,
            Armed {
                at,
                seq: self.seq,
                run: Box::new(run),
            },
        );
    }

    /// Disarms `key`, and reports whether anything was armed there.
    pub fn disarm(&mut self, key: DeadlineKey) -> bool {
        self.slots.remove(&key).is_some()
    }

    /// When `key` will fire, if it is armed.
    pub fn when(&self, key: DeadlineKey) -> Option<Instant> {
        self.slots.get(&key).map(|a| a.at)
    }

    /// Disarms everything: a table starting over has no deadline left from
    /// the match before.
    pub fn clear(&mut self) {
        self.slots.clear();
    }

    /// Disarms every deadline whose key `keep` refuses.
    pub fn retain(&mut self, mut keep: impl FnMut(&DeadlineKey) -> bool) {
        self.slots.retain(|k, _| keep(k));
    }

    pub fn len(&self) -> usize {
        self.slots.len()
    }

    pub fn is_empty(&self) -> bool {
        self.slots.is_empty()
    }

    /// The soonest armed instant.
    pub fn next(&self) -> Option<Instant> {
        self.slots.values().map(|a| a.at).min()
    }

    /// Takes every deadline due at `now`, soonest first (armed order breaking
    /// ties), as jobs.
    pub fn take_due(&mut self, now: Instant) -> Vec<TableJob> {
        let mut due: Vec<(DeadlineKey, Instant, u64)> = self
            .slots
            .iter()
            .filter(|(_, a)| a.at <= now)
            .map(|(k, a)| (*k, a.at, a.seq))
            .collect();
        due.sort_by_key(|&(_, at, seq)| (at, seq));
        due.into_iter()
            .filter_map(|(k, _, _)| {
                self.slots.remove(&k).map(|a| TableJob {
                    what: Cow::Borrowed(k.kind),
                    client: None,
                    run: a.run,
                })
            })
            .collect()
    }
}
