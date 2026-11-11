//! The log, off the event loop. Port of `server/hub/logsink.go`, plus the
//! `tracing` formatter that writes the lines the Go server's `log.Printf` did.
//!
//! The number that matters here is not how slow a log line is, it is who
//! decides. A write to a pipe whose reader has stalled does not get slower, it
//! *waits*, and a wait inside a handler is a table that has stopped. So a line
//! is copied into a bounded queue and the caller returns; one thread takes
//! lines off and writes them for real. Overflow is dropped rather than waited
//! on, counted (`log_lines_dropped` on `/metrics`), and admitted in the log
//! itself. See `docs/notes/server.md`, "The log is off the event loop".

use std::fmt;
use std::io::{self, Write};
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, SyncSender, TrySendError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};
use tracing::{Event, Level, Subscriber};
use tracing_subscriber::fmt::format::Writer;
use tracing_subscriber::fmt::{FmtContext, FormatEvent, FormatFields, FormattedFields, MakeWriter};
use tracing_subscriber::registry::LookupSpan;

/// How many formatted lines may be in flight before the sink starts dropping.
/// Sized for the burst after a deploy, when every client reconnects at once.
pub const LOG_QUEUE_DEPTH: usize = 4096;

/// What [`AsyncLog::close`] waits for the flush, at most.
pub const LOG_CLOSE_GRACE: Duration = Duration::from_secs(2);

/// How often the writer thread looks up from an empty queue to see whether it
/// has been asked to stop. Only the shutdown pays it.
const QUIT_POLL: Duration = Duration::from_millis(20);

/// [`AsyncLog::close`] did not see the sink take everything queued inside the
/// grace. Lines were lost; nothing else went wrong.
#[derive(Debug, PartialEq, Eq, thiserror::Error)]
#[error("log sink did not flush before the deadline")]
pub struct LogNotFlushed;

struct Inner {
    lines: SyncSender<Vec<u8>>,
    quit: AtomicBool,
    dropped: AtomicI64,
    done: Mutex<Option<Receiver<()>>>,
    closed: AtomicBool,
}

/// A bounded, non-blocking line writer. Cloning it clones the handle.
#[derive(Clone)]
pub struct AsyncLog {
    inner: Arc<Inner>,
}

impl fmt::Debug for AsyncLog {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("AsyncLog")
            .field("dropped", &self.dropped())
            .finish()
    }
}

impl AsyncLog {
    /// Starts a sink writing to `out`. Close it to flush.
    pub fn new(out: impl Write + Send + 'static, capacity: usize) -> AsyncLog {
        let capacity = capacity.max(1);
        let (tx, rx) = mpsc::sync_channel::<Vec<u8>>(capacity);
        let (done_tx, done_rx) = mpsc::channel();
        let inner = Arc::new(Inner {
            lines: tx,
            quit: AtomicBool::new(false),
            dropped: AtomicI64::new(0),
            done: Mutex::new(Some(done_rx)),
            closed: AtomicBool::new(false),
        });
        let worker = inner.clone();
        std::thread::Builder::new()
            .name("loco-log".into())
            .spawn(move || {
                Writer_ {
                    out: Box::new(out),
                    rx,
                    inner: worker,
                    reported: 0,
                    capacity,
                }
                .run();
                let _ = done_tx.send(());
            })
            .expect("spawning the log thread");
        AsyncLog { inner }
    }

    /// Queues one formatted line. Never blocks and never fails: a logging call
    /// that can return an error is a logging call every site has to decide
    /// what to do about. The line is the caller's to keep; this takes a copy.
    pub fn write_line(&self, line: &[u8]) {
        match self.inner.lines.try_send(line.to_vec()) {
            Ok(()) => {}
            Err(TrySendError::Full(_)) => {
                self.inner.dropped.fetch_add(1, Ordering::Relaxed);
            }
            // The writer is gone: a late line after the shutdown, which a pump
            // that has not noticed it yet still writes. Harmless.
            Err(TrySendError::Disconnected(_)) => {}
        }
    }

    /// How many lines the sink has thrown away since it started.
    pub fn dropped(&self) -> i64 {
        self.inner.dropped.load(Ordering::Relaxed)
    }

    /// Stops the sink, flushes what is queued, and waits for the writer — at
    /// most [`LOG_CLOSE_GRACE`]. Safe to call more than once: a second signal
    /// is the escape hatch an operator is told to use.
    pub fn close(&self) -> Result<(), LogNotFlushed> {
        self.close_within(LOG_CLOSE_GRACE)
    }

    pub fn close_within(&self, grace: Duration) -> Result<(), LogNotFlushed> {
        self.inner.quit.store(true, Ordering::SeqCst);
        if self.inner.closed.load(Ordering::SeqCst) {
            return Ok(());
        }
        let mut done = self.inner.done.lock().unwrap_or_else(|e| e.into_inner());
        let Some(rx) = done.as_ref() else {
            return Ok(());
        };
        match rx.recv_timeout(grace) {
            Ok(()) | Err(RecvTimeoutError::Disconnected) => {
                *done = None;
                self.inner.closed.store(true, Ordering::SeqCst);
                Ok(())
            }
            Err(RecvTimeoutError::Timeout) => Err(LogNotFlushed),
        }
    }
}

// Named with a trailing underscore so it does not shadow tracing's `Writer`.
#[allow(non_camel_case_types)]
struct Writer_ {
    out: Box<dyn Write + Send>,
    rx: Receiver<Vec<u8>>,
    inner: Arc<Inner>,
    /// How many drops the log has already been told about.
    reported: i64,
    capacity: usize,
}

impl Writer_ {
    fn run(mut self) {
        loop {
            match self.rx.recv_timeout(QUIT_POLL) {
                Ok(line) => self.emit(&line),
                Err(RecvTimeoutError::Timeout) => {
                    if self.inner.quit.load(Ordering::SeqCst) {
                        self.flush();
                        return;
                    }
                }
                Err(RecvTimeoutError::Disconnected) => {
                    self.flush();
                    return;
                }
            }
            if self.inner.quit.load(Ordering::SeqCst) {
                self.flush();
                return;
            }
        }
    }

    /// Writes what is already queued and stops. Bounded by the queue's own
    /// capacity rather than by the queue going empty: a task that has not
    /// noticed the shutdown is still logging, and a flush that waited for
    /// silence would wait on the very thing the process is trying to stop.
    fn flush(&mut self) {
        for _ in 0..=self.capacity {
            match self.rx.try_recv() {
                Ok(line) => self.emit(&line),
                Err(_) => break,
            }
        }
        self.note();
        let _ = self.out.flush();
    }

    fn emit(&mut self, line: &[u8]) {
        self.note();
        let _ = self.out.write_all(line);
    }

    /// Admits the gap when lines have been lost since the last one. Straight to
    /// the output, never back through the queue, which is full by definition
    /// at the moment this is needed.
    fn note(&mut self) {
        let d = self.inner.dropped.load(Ordering::Relaxed);
        if d <= self.reported {
            return;
        }
        let n = d - self.reported;
        self.reported = d;
        let _ = writeln!(
            self.out,
            "{} WARN log sink overflowed, {n} line(s) dropped",
            crate::ops::gotime::log_stamp(SystemTime::now())
        );
    }
}

/// One event's worth of bytes, handed to the sink whole when `tracing` is done
/// with it: a line reaches the output in one piece or not at all.
pub struct LineWriter {
    buf: Vec<u8>,
    log: AsyncLog,
}

impl Write for LineWriter {
    fn write(&mut self, b: &[u8]) -> io::Result<usize> {
        self.buf.extend_from_slice(b);
        Ok(b.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl Drop for LineWriter {
    fn drop(&mut self) {
        if !self.buf.is_empty() {
            self.log.write_line(&self.buf);
        }
    }
}

impl<'a> MakeWriter<'a> for AsyncLog {
    type Writer = LineWriter;
    fn make_writer(&'a self) -> LineWriter {
        LineWriter {
            buf: Vec::with_capacity(160),
            log: self.clone(),
        }
    }
}

/// The Go server's line, kept so the operator's greps keep working:
/// `2006/01/02 15:04:05 [WARN ]message key=value …`, then the fields of every
/// span the event is inside — which is how `conn=` reaches every line a
/// connection's pumps write without each call site repeating it.
#[derive(Clone, Copy, Debug, Default)]
pub struct GoStyle;

impl<S, N> FormatEvent<S, N> for GoStyle
where
    S: Subscriber + for<'a> LookupSpan<'a>,
    N: for<'a> FormatFields<'a> + 'static,
{
    fn format_event(
        &self,
        ctx: &FmtContext<'_, S, N>,
        mut w: Writer<'_>,
        event: &Event<'_>,
    ) -> fmt::Result {
        write!(w, "{} ", crate::ops::gotime::log_stamp(SystemTime::now()))?;
        match *event.metadata().level() {
            Level::ERROR => write!(w, "ERROR ")?,
            Level::WARN => write!(w, "WARN ")?,
            _ => {}
        }
        ctx.format_fields(w.by_ref(), event)?;
        if let Some(scope) = ctx.event_scope() {
            for span in scope.from_root() {
                let ext = span.extensions();
                if let Some(fields) = ext.get::<FormattedFields<N>>()
                    && !fields.is_empty()
                {
                    write!(w, " {fields}")?;
                }
            }
        }
        writeln!(w)
    }
}

/// Installs `tracing` writing through `sink` in the Go format. `RUST_LOG` can
/// narrow it; the default is `info`. Fails if a subscriber is already set.
pub fn install(sink: &AsyncLog) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    use tracing_subscriber::EnvFilter;
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    tracing_subscriber::fmt()
        .with_ansi(false)
        .event_format(GoStyle)
        .with_writer(sink.clone())
        .with_env_filter(filter)
        .try_init()
}

/// Sends a panic's report through the log rather than straight to stderr, so it
/// lands in order with the lines around it. The job's `catch_unwind` still
/// decides what the panic costs.
pub fn install_panic_hook() {
    std::panic::set_hook(Box::new(|info| {
        let thread = std::thread::current();
        tracing::error!(
            "panic thread={} at={} payload={:?}",
            thread.name().unwrap_or("?"),
            info.location().map(|l| l.to_string()).unwrap_or_default(),
            panic_message(info.payload()),
        );
    }));
}

/// The text of a panic payload, for the WARN line that records it.
pub fn panic_message(p: &(dyn std::any::Any + Send)) -> String {
    if let Some(s) = p.downcast_ref::<&str>() {
        (*s).to_owned()
    } else if let Some(s) = p.downcast_ref::<String>() {
        s.clone()
    } else {
        "non-string panic".into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::{Receiver as StdRx, SyncSender as StdTx};
    use std::time::Instant;

    // Port of logsink_test.go.

    /// Collects whole writes. `entered` is signalled once per write, before
    /// blocking on `gate`, so a test can hold the writer thread inside the sink
    /// at a known point instead of guessing with a sleep.
    #[derive(Clone, Default)]
    struct Recording {
        written: Arc<Mutex<Vec<String>>>,
        entered: Option<StdTx<()>>,
        gate: Option<Arc<Mutex<StdRx<()>>>>,
    }

    impl Write for Recording {
        fn write(&mut self, p: &[u8]) -> io::Result<usize> {
            if let Some(e) = &self.entered {
                let _ = e.try_send(());
            }
            if let Some(g) = &self.gate {
                let _ = g.lock().unwrap().recv();
            }
            self.written
                .lock()
                .unwrap()
                .push(String::from_utf8_lossy(p).into_owned());
            Ok(p.len())
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    impl Recording {
        fn lines(&self) -> Vec<String> {
            self.written.lock().unwrap().clone()
        }
        fn joined(&self) -> String {
            self.lines().concat()
        }
    }

    /// A recording writer that blocks until the returned sender is dropped.
    fn gated() -> (Recording, StdRx<()>, std::sync::mpsc::Sender<()>) {
        let (entered_tx, entered_rx) = mpsc::sync_channel(1);
        let (gate_tx, gate_rx) = mpsc::channel();
        let r = Recording {
            entered: Some(entered_tx),
            gate: Some(Arc::new(Mutex::new(gate_rx))),
            ..Default::default()
        };
        (r, entered_rx, gate_tx)
    }

    // The whole point of this type: a write hands the line off and returns,
    // whatever the far side is doing.
    #[test]
    fn write_does_not_wait_on_the_sink() {
        let (sink, _entered, gate) = gated();
        let a = AsyncLog::new(sink, 64);
        let start = Instant::now();
        for _ in 0..32 {
            a.write_line(b"line\n");
        }
        let took = start.elapsed();
        drop(gate);
        let _ = a.close();
        assert!(
            took < Duration::from_millis(50),
            "32 writes took {took:?} against a stalled sink"
        );
    }

    #[test]
    fn delivers_every_line_in_order() {
        let sink = Recording::default();
        let a = AsyncLog::new(sink.clone(), 64);
        for s in ["one\n", "two\n", "three\n"] {
            a.write_line(s.as_bytes());
        }
        a.close().unwrap();
        assert_eq!(sink.joined(), "one\ntwo\nthree\n");
    }

    // log.Logger reused its buffer; tracing's writer is ours. Either way the
    // queue must hold a copy, and the writer thread parked inside the sink is
    // what proves both lines were still queued when the buffer changed.
    #[test]
    fn copies_the_callers_buffer() {
        let (sink, entered, gate) = gated();
        let a = AsyncLog::new(sink.clone(), 8);
        a.write_line(b"hold\n");
        entered.recv().unwrap();

        let mut buf = b"first\n".to_vec();
        a.write_line(&buf);
        buf[..5].copy_from_slice(b"secnd");
        a.write_line(&buf);

        drop(gate);
        a.close().unwrap();
        assert_eq!(sink.joined(), "hold\nfirst\nsecnd\n");
    }

    #[test]
    fn drops_rather_than_blocks() {
        let (sink, entered, gate) = gated();
        let a = AsyncLog::new(sink, 1);
        a.write_line(b"held\n");
        entered
            .recv_timeout(Duration::from_secs(2))
            .expect("the writer thread never reached the sink");
        // One slot free, so the next line queues and the three after it are lost.
        for _ in 0..4 {
            a.write_line(b"flood\n");
        }
        assert_eq!(a.dropped(), 3);
        drop(gate);
        a.close().unwrap();
    }

    // A gap nobody is told about is worse than a slow log.
    #[test]
    fn says_what_it_dropped() {
        let (sink, entered, gate) = gated();
        let a = AsyncLog::new(sink.clone(), 1);
        a.write_line(b"held\n");
        entered.recv().unwrap();
        for _ in 0..4 {
            a.write_line(b"flood\n");
        }
        drop(gate);
        a.close().unwrap();
        let out = sink.joined();
        assert!(
            out.contains("3 line(s) dropped"),
            "the log never admits the gap:\n{out}"
        );
    }

    #[test]
    fn close_flushes_what_is_queued() {
        let sink = Recording::default();
        let a = AsyncLog::new(sink.clone(), 64);
        for _ in 0..20 {
            a.write_line(b"x\n");
        }
        a.close().unwrap();
        assert_eq!(sink.lines().len(), 20, "close lost what was queued");
    }

    #[test]
    fn close_is_idempotent() {
        let a = AsyncLog::new(Recording::default(), 8);
        a.close().unwrap();
        a.close().unwrap();
    }

    #[test]
    fn write_after_close_is_harmless() {
        let a = AsyncLog::new(Recording::default(), 8);
        a.close().unwrap();
        a.write_line(b"late\n");
    }

    // The far side can stop moving, so the flush cannot be what keeps a
    // container alive past its stop_grace_period.
    #[test]
    fn close_gives_up_on_a_wedged_sink() {
        let (sink, _entered, gate) = gated();
        let a = AsyncLog::new(sink, 8);
        a.write_line(b"stuck\n");
        let start = Instant::now();
        let err = a.close_within(Duration::from_millis(50));
        let took = start.elapsed();
        assert_eq!(err, Err(LogNotFlushed));
        assert!(
            took < Duration::from_secs(1),
            "close waited {took:?} on a sink that never moves"
        );
        drop(gate);
    }

    // The event loop and every connection pump log at the same time.
    #[test]
    fn survives_concurrent_writers() {
        let sink = Recording::default();
        let a = AsyncLog::new(sink.clone(), 1024);
        let threads: Vec<_> = (0..8)
            .map(|_| {
                let a = a.clone();
                std::thread::spawn(move || {
                    for _ in 0..50 {
                        a.write_line(b"concurrent\n");
                    }
                })
            })
            .collect();
        for t in threads {
            t.join().unwrap();
        }
        a.close().unwrap();
        let got = sink.lines().len() as i64 + a.dropped();
        assert!(got >= 400, "{got} lines accounted for, want at least 400");
        assert!(
            !sink.joined().contains("concurrentconcurrent"),
            "two lines were spliced together"
        );
    }

    // The formatter writes what the Go server's log.Printf did, and a span's
    // fields ride every line inside it.
    #[test]
    fn lines_read_like_the_go_log() {
        let sink = Recording::default();
        let a = AsyncLog::new(sink.clone(), 64);
        let sub = tracing_subscriber::fmt()
            .with_ansi(false)
            .event_format(GoStyle)
            .with_writer(a.clone())
            .finish();
        tracing::subscriber::with_default(sub, || {
            // `%` is how a call site gets Go's unquoted `key=value`.
            let span = tracing::info_span!("ws", conn = %"a1b2c3d4");
            let _g = span.enter();
            tracing::warn!(addr = %"203.0.113.0/24", "slow client, force-closing");
            tracing::info!("plain line");
        });
        a.close().unwrap();
        let lines = sink.lines();
        assert_eq!(lines.len(), 2, "{lines:?}");
        let warn = &lines[0];
        assert!(
            warn.contains(" WARN slow client, force-closing addr=203.0.113.0/24 conn=a1b2c3d4"),
            "{warn}"
        );
        assert!(warn.as_bytes()[4] == b'/' && warn.ends_with('\n'), "{warn}");
        assert!(
            !lines[1].contains("INFO"),
            "an info line carries no level, like log.Printf: {}",
            lines[1]
        );
    }
}
