//! Infrastructure checks that reach across modules, beside the unit tests
//! inside `src/net/privacy.rs`, `src/net/serve.rs`, `src/ops/logsink.rs`,
//! `src/net/client.rs` and `src/ops/metrics.rs`.

use loco_hub::Hub;
use loco_hub::net::privacy::split_list;
use loco_hub::ops::config::HubConfig;
use std::io::{self, Write};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

// `LOCO_ALLOWED_ORIGINS` is read through the shared list splitter.
#[test]
fn split_origins() {
    assert_eq!(
        split_list(" https://a.example , ,https://b.example "),
        vec!["https://a.example", "https://b.example"]
    );
    // Empty, so the default same-host rule applies.
    assert!(split_list("").is_empty());
}

/// A sink that signals when its thread is inside a write, then waits on a
/// gate.
struct Gated {
    entered: mpsc::SyncSender<()>,
    gate: Arc<Mutex<mpsc::Receiver<()>>>,
}

impl Write for Gated {
    fn write(&mut self, p: &[u8]) -> io::Result<usize> {
        let _ = self.entered.try_send(());
        let _ = self.gate.lock().unwrap().recv();
        Ok(p.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

// messages_dropped_busy has an operator counterpart for every
// other thing this server throws away, and a log that silently shortens itself
// under load is exactly what somebody reading /metrics during an incident
// needs to know about. (foundation.rs had a looser version: at least 8 of 10.)
#[tokio::test]
async fn hub_reports_log_drops_on_metrics() {
    let hub = Hub::start(HubConfig::default());
    assert_eq!(
        hub.metrics_stats().log_lines_dropped,
        0,
        "a hub with no sink reports drops"
    );

    let (entered_tx, entered_rx) = mpsc::sync_channel(1);
    let (gate_tx, gate_rx) = mpsc::channel();
    let sink = loco_hub::AsyncLog::new(
        Gated {
            entered: entered_tx,
            gate: Arc::new(Mutex::new(gate_rx)),
        },
        1,
    );
    hub.set_log_sink(sink.clone());

    sink.write_line(b"held\n");
    entered_rx
        .recv_timeout(Duration::from_secs(2))
        .expect("the writer thread never reached the sink");
    // One slot free, so the next line queues and the three after it are lost.
    for _ in 0..4 {
        sink.write_line(b"flood\n");
    }
    drop(gate_tx);
    sink.close().unwrap();

    assert_eq!(
        hub.metrics_stats().log_lines_dropped,
        3,
        "/metrics dropped log lines"
    );
    hub.stop().await;
}
