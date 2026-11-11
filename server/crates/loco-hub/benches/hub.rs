//! What the hub's hot paths cost, measured: `make bench-server`. The cases:
//! a whole card play through the table's dispatch, the personalised fan-out
//! after a Swap, the card_played broadcast alone, one recipient's state.

use criterion::{BenchmarkId, Criterion, criterion_group, criterion_main};
use loco_game::{Card, Color, Kind};
use loco_hub::net::wire::ClientMsg;
use loco_hub::net::wire::msg;
use loco_hub::table::actor::DeadlineKey;
use loco_hub::table::room::new_room;
use loco_hub::{AsyncLog, Client, Hub, HubConfig, Table};
use std::hint::black_box;
use std::sync::Arc;
use std::time::Duration;

fn benches(c: &mut Criterion) {
    let rt = tokio::runtime::Runtime::new().expect("runtime");
    let _guard = rt.enter();
    let hub = Hub::start(HubConfig::default());

    // A log line handed to the sink, never to stderr on the caller's time.
    let log = AsyncLog::new(std::io::sink(), loco_hub::ops::logsink::LOG_QUEUE_DEPTH);
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

    // The fan-out of one small message to four seats.
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
                DeadlineKey::BotMove(1),
                now + Duration::from_secs(30),
                |_, _| {},
            );
            black_box(table.deadlines.take_due(now + Duration::from_secs(31)));
        })
    });

    let _ = log.close();
    rt.block_on(hub.stop());
}

/// A dealt table of `n` seats, every seat a detached client whose queue the
/// bench drains between iterations.
fn bench_table(
    hub: &Hub,
    n: usize,
) -> (
    Table,
    loco_hub::TableCtx,
    Vec<Arc<Client>>,
    Vec<tokio::sync::mpsc::Receiver<axum::extract::ws::Utf8Bytes>>,
) {
    let code = "BENCH1";
    let mut room = loco_game::Room::from_u64_seed(code, 1);
    room.max_players = n;
    for i in 0..n {
        room.join(&format!("player{i}")).expect("join");
    }
    let mut t = Table::new(code, room);
    let mut clients = Vec::new();
    let mut rxs = Vec::new();
    for i in 0..n {
        let (c, rx) = Client::detached(hub);
        t.seat(&c, i);
        clients.push(c);
        rxs.push(rx);
    }
    t.room.start(loco_hub::ops::clock::now_ms()).expect("start");
    (t, loco_hub::TableCtx::detached(hub, code), clients, rxs)
}

fn drain(rxs: &mut [tokio::sync::mpsc::Receiver<axum::extract::ws::Utf8Bytes>]) {
    for rx in rxs {
        while rx.try_recv().is_ok() {}
    }
}

/// A wild played by whoever's turn it is, through the whole table-side
/// dispatch, at 2, 4 and 10 seats.
fn dispatch_play_card(c: &mut Criterion) {
    let rt = tokio::runtime::Runtime::new().expect("runtime");
    let _guard = rt.enter();
    let hub = Hub::start(HubConfig::default());
    let msg: ClientMsg = serde_json::from_value(serde_json::json!({
        "type": "play_card",
        "card": {"color": "wild", "kind": "wild", "value": 0},
        "chosen_color": "red"
    }))
    .expect("a play_card");
    let mut g = c.benchmark_group("dispatch(play_card)");
    for n in [2usize, 4, 10] {
        let (mut t, cx, clients, mut rxs) = bench_table(&hub, n);
        g.bench_with_input(
            BenchmarkId::from_parameter(format!("players={n}")),
            &n,
            |b, _| {
                b.iter_custom(|iters| {
                    let mut total = Duration::ZERO;
                    for _ in 0..iters {
                        let state = t.room.state.as_mut().expect("dealt");
                        let seat = state.current_turn;
                        state.hands[seat].add(&[Card {
                            color: Color::Wild,
                            kind: Kind::WildCard,
                            value: 0,
                        }]);
                        state.pending_draw = 0;
                        let c = clients[seat].clone();
                        let m = msg.clone();
                        let start = std::time::Instant::now();
                        t.dispatch_at_table(&cx, &c, m);
                        total += start.elapsed();
                        drain(&mut rxs);
                        t.deadlines.clear();
                    }
                    total
                })
            },
        );
    }
    g.finish();
}

/// The personalised fan-out after a Swap, the `card_played` broadcast, and
/// one recipient's state.
fn broadcasts(c: &mut Criterion) {
    let rt = tokio::runtime::Runtime::new().expect("runtime");
    let _guard = rt.enter();
    let hub = Hub::start(HubConfig::default());
    for n in [2usize, 4, 10] {
        let (mut t, cx, _clients, mut rxs) = bench_table(&hub, n);
        c.bench_function(
            &format!("broadcast_personalized_game_state/players={n}"),
            |b| {
                b.iter(|| {
                    t.broadcast_personalized_game_state();
                    drain(&mut rxs);
                })
            },
        );
        t.room.round_ended = true;
        c.bench_function(&format!("broadcast_card_played/players={n}"), |b| {
            b.iter(|| {
                t.broadcast_card_played(&cx, 0, None);
                drain(&mut rxs);
            })
        });
        if n == 10 {
            let pl = t.player_list();
            c.bench_function("player_game_state_using/players=10", |b| {
                b.iter(|| black_box(t.player_game_state_using(0, pl.clone())))
            });
        }
    }
}

criterion_group!(hub_benches, benches, dispatch_play_card, broadcasts);
criterion_main!(hub_benches);
