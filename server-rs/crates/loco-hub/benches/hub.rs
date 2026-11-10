//! What the hub's hot paths cost, measured: `make bench-server-rs`. The Go
//! numbers to compare against are in docs/notes/server.md ("What the loop
//! actually costs"); the whole-card-play row (8.6 µs) arrives with the handler
//! port, which is when `dispatch(play_card)` exists to time.

use criterion::{Criterion, criterion_group, criterion_main};
use loco_hub::actor::DeadlineKey;
use loco_hub::room::new_room;
use loco_hub::wire::msg;
use loco_hub::{AsyncLog, Client, Hub, HubConfig, Table};
use std::hint::black_box;
use std::time::Duration;

fn benches(c: &mut Criterion) {
    let rt = tokio::runtime::Runtime::new().expect("runtime");
    let _guard = rt.enter();
    let hub = Hub::start(HubConfig::default());

    // Go: 0.15 µs through the sink, 0.9–7.3 µs straight to stderr.
    let log = AsyncLog::new(std::io::sink(), loco_hub::logsink::LOG_QUEUE_DEPTH);
    c.bench_function("log line through the async sink", |b| {
        b.iter(|| {
            log.write_line(black_box(
                b"2026/11/10 12:00:00 card played code=ABCDEF seat=1\n",
            ))
        })
    });

    let (client, mut rx) = Client::detached(&hub);
    c.bench_function("client.send (marshal + stamp + queue)", |b| {
        b.iter(|| {
            client.send(msg::players_online(black_box(42)));
            let _ = rx.try_recv();
        })
    });

    // Go: broadcastCardPlayed 1.04 µs at four seats (a bigger message).
    let mut table = Table::new("ABCDEF", new_room("ABCDEF"));
    let mut rxs = Vec::new();
    for seat in 0..4 {
        let (c, rx) = Client::detached(&hub);
        table.seat(&c, seat);
        rxs.push(rx);
    }
    c.bench_function("table.broadcast_all, four seats", |b| {
        b.iter(|| {
            table.broadcast_all(msg::server_updating());
            for rx in &mut rxs {
                let _ = rx.try_recv();
            }
        })
    });

    c.bench_function("deadline arm + take_due", |b| {
        let now = tokio::time::Instant::now();
        b.iter(|| {
            table.deadlines.arm(
                DeadlineKey::seat("turn", 1),
                now + Duration::from_secs(30),
                |_, _| {},
            );
            black_box(table.deadlines.take_due(now + Duration::from_secs(31)));
        })
    });

    let _ = log.close();
    rt.block_on(hub.stop());
}

criterion_group!(hub_benches, benches);
criterion_main!(hub_benches);
