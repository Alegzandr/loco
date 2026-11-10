//! The foundation through real sockets: admission, the endpoints, the pumps,
//! the actor, the drain and the snapshot. Ports the parts of hub_test.go,
//! hardening_test.go, actor_test.go, drain_test.go, snapshot_test.go,
//! online_test.go and live_test.go that stand without a game; the rest come
//! with the handler port, on the same harness. The Go-named ports of those
//! files are `drain.rs`, `snapshot.rs`, `online.rs`, `live.rs`, `actor.rs`;
//! what stays here are the structural checks they do not repeat.

use loco_hub::actor::{DeadlineKey, Phase, TableJob};
use loco_hub::room::{Room, Status, new_room};
use loco_hub::snapshot::{RoomSnapshot, SNAPSHOT_SCHEMA_VERSION, SnapshotFile};
use loco_hub::table::MatchRecord;
use loco_hub::testkit::*;
use loco_hub::{Client, DRAIN_REFUSAL, Hub, HubConfig, Table};
use serde_json::{Value, json};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, SystemTime};

fn cfg() -> HubConfig {
    HubConfig::default()
}

/// A room with a match dealt, through the domain's own door.
fn playing_room(code: &str, players: usize) -> Room {
    let mut r = Room::from_u64_seed(code, 7);
    for i in 0..players {
        r.join(&format!("Joueur{i}")).expect("join");
    }
    r.start(loco_hub::wire::now_ms()).expect("start");
    assert_eq!(r.status, Status::Playing);
    r
}

async fn open(hub: &Hub, t: Table) {
    hub.on_loop(move |core| {
        core.open_table(t);
    })
    .await;
}

// ── the endpoints ───────────────────────────────────────────────────────────

#[tokio::test]
async fn health_endpoint() {
    let th = new_test_hub().await;
    let (status, ct, body) = http_get(&th, "/health").await;
    assert_eq!(status, 200);
    assert!(ct.starts_with("application/json"), "content type {ct:?}");
    let v: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(v["status"], "ok");
    assert_eq!(v["rooms"], 0);
    assert_eq!(v["draining"], false);
    assert!(v["uptime_sec"].is_i64());
    th.stop().await;
}

#[tokio::test]
async fn health_endpoint_counts_rooms_and_clients() {
    let th = new_test_hub().await;
    let mut ws = dial_ws(&th).await;
    read_raw(&mut ws).await; // registered: players_online arrives first
    open(&th.hub, Table::new("AAAAAA", new_room("AAAAAA"))).await;
    let (_, _, body) = http_get(&th, "/health").await;
    let v: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(v["rooms"], 1);
    assert!(v["clients"].as_i64().unwrap() >= 1);
    th.stop().await;
}

// The E2E helpers read matchmaking_queue off this page as text now.
#[tokio::test]
async fn metrics_endpoint_is_prometheus_text_under_the_go_names() {
    let mut c = cfg();
    c.debug_mode = true;
    let th = new_test_hub_with(c).await;
    let (status, ct, body) = http_get(&th, "/metrics").await;
    assert_eq!(status, 200);
    assert!(ct.starts_with("text/plain"), "content type {ct:?}");
    for line in [
        "matchmaking_queue 0",
        "handler_panics 0",
        "debug_mode_active 1",
        "draining 0",
    ] {
        assert!(body.lines().any(|l| l == line), "missing {line:?}:\n{body}");
    }
    th.stop().await;
}

#[tokio::test]
async fn live_stats_default_to_zero_and_read_the_installed_reader() {
    let th = new_test_hub().await;
    assert_eq!(th.hub.metrics_stats().live, Default::default());
    th.hub.set_live_stats(|| loco_hub::LiveStats {
        twitch_polls: 3,
        ..Default::default()
    });
    assert_eq!(th.hub.metrics_stats().live.twitch_polls, 3);
    th.stop().await;
}

// ── admission ───────────────────────────────────────────────────────────────

#[tokio::test]
async fn connections_per_network_are_capped() {
    let mut c = cfg();
    c.limits.max_conns_per_net = 2;
    let th = new_test_hub_with(c).await;
    let mut held = Vec::new();
    for _ in 0..2 {
        held.push(dial_ws(&th).await);
    }
    // Refused at the upgrade, before a client exists.
    let err = try_dial_ws(&th, &[])
        .await
        .expect_err("the cap accepted one connection too many");
    assert_eq!(refusal_status(&err), Some(429));
    assert_eq!(th.hub.metrics_stats().conns_refused, 1);
    th.stop().await;
}

// Behind the proxy two players on different networks must not share a bucket,
// and one player must still not be able to take the whole cap.
#[tokio::test]
async fn connections_are_capped_per_player_network_behind_a_proxy() {
    let mut c = cfg();
    c.limits.max_conns_per_net = 2;
    let th = new_test_hub_with(c).await;
    let mut held = Vec::new();
    for i in 0..2 {
        held.push(
            try_dial_ws(&th, &[("Cf-Connecting-Ip", "203.0.113.7")])
                .await
                .unwrap_or_else(|e| panic!("first network, connection {i}: {e}")),
        );
    }
    let err = try_dial_ws(&th, &[("Cf-Connecting-Ip", "203.0.113.9")])
        .await
        .expect_err("a network already at the cap got another slot");
    assert_eq!(refusal_status(&err), Some(429));
    held.push(
        try_dial_ws(&th, &[("Cf-Connecting-Ip", "198.51.100.4")])
            .await
            .expect("a second network was refused a slot of its own"),
    );
    held.push(
        try_dial_ws(&th, &[("Cf-Connecting-Ip", "2001:861:3240:54b0::1")])
            .await
            .expect("an IPv6 player was refused a slot of their own"),
    );
    th.stop().await;
}

#[tokio::test]
async fn the_global_ceiling_is_refused_too() {
    let mut c = cfg();
    c.limits.max_clients = 1;
    let th = new_test_hub_with(c).await;
    let _first = try_dial_ws(&th, &[("Cf-Connecting-Ip", "203.0.113.7")])
        .await
        .unwrap();
    let err = try_dial_ws(&th, &[("Cf-Connecting-Ip", "198.51.100.4")])
        .await
        .unwrap_err();
    assert_eq!(refusal_status(&err), Some(429));
    th.stop().await;
}

// A slot is given back when its socket goes: the cap is on concurrent sockets.
#[tokio::test]
async fn a_closed_socket_gives_its_slot_back() {
    let mut c = cfg();
    c.limits.max_conns_per_net = 1;
    let th = new_test_hub_with(c).await;
    let mut ws = dial_ws(&th).await;
    read_raw(&mut ws).await;
    ws.close(None).await.unwrap();
    drop(ws);
    let hub = th.hub.clone();
    assert!(
        eventually(Duration::from_secs(3), || hub.health().clients == 0).await,
        "the socket never unregistered"
    );
    let _again = try_dial_ws(&th, &[])
        .await
        .expect("the slot was not given back");
    th.stop().await;
}

#[tokio::test]
async fn a_foreign_origin_is_refused_before_the_upgrade() {
    let mut c = cfg();
    c.allowed_origins = vec!["https://loco.example.com".into()];
    let th = new_test_hub_with(c).await;
    let err = try_dial_ws(&th, &[("Origin", "https://evil.example")])
        .await
        .unwrap_err();
    assert_eq!(refusal_status(&err), Some(403));
    let _ok = try_dial_ws(&th, &[("Origin", "https://loco.example.com")])
        .await
        .unwrap();
    th.stop().await;
}

// ── the pumps ───────────────────────────────────────────────────────────────

#[tokio::test]
async fn an_unknown_message_is_refused_and_a_malformed_one_is_named() {
    let th = new_test_hub().await;
    let mut ws = dial_ws(&th).await;
    send_text(&mut ws, "{not json").await;
    let m = read_msg(&mut ws).await;
    assert_eq!(
        m,
        json!({"type": "error", "error": "invalid message format", "server_now": m["server_now"], "turn": 0, "drawn_count": 0}),
    );
    send_msg(&mut ws, json!({"type": "nope"})).await;
    assert_eq!(read_msg(&mut ws).await["error"], "unknown message type");
    th.stop().await;
}

// A flood is told once a second, and every dropped message is still counted.
#[tokio::test]
async fn a_flood_is_rate_limited_and_told_once() {
    let th = new_test_hub().await;
    let mut ws = dial_ws(&th).await;
    read_raw(&mut ws).await;
    for _ in 0..40 {
        send_msg(&mut ws, json!({"type": "nope"})).await;
    }
    let mut unknown = 0;
    let mut limited = 0;
    while let Ok(m) = tokio::time::timeout(Duration::from_millis(300), read_msg(&mut ws)).await {
        match m["error"].as_str() {
            Some("unknown message type") => unknown += 1,
            Some("rate limit exceeded") => limited += 1,
            other => panic!("unexpected {other:?}"),
        }
    }
    assert!(unknown >= 20, "the burst was not let through: {unknown}");
    assert_eq!(limited, 1, "the flood was told {limited} times");
    assert!(th.hub.metrics_stats().messages_rate_limited >= 15);
    th.stop().await;
}

// A frame over 4096 bytes is not a client message; the socket is dropped.
#[tokio::test]
async fn an_oversized_frame_ends_the_connection() {
    let th = new_test_hub().await;
    let mut ws = dial_ws(&th).await;
    read_raw(&mut ws).await;
    send_text(
        &mut ws,
        &format!(r#"{{"type":"x","pad":"{}"}}"#, "a".repeat(5000)),
    )
    .await;
    let hub = th.hub.clone();
    assert!(
        eventually(Duration::from_secs(3), || hub.health().clients == 0).await,
        "an oversized frame was read"
    );
    th.stop().await;
}

// The ping is the latency probe: a browser (here, tungstenite) answers it in
// the transport, and the round trip lands on the client.
#[tokio::test]
async fn pings_measure_the_round_trip() {
    let mut c = cfg();
    c.timings.ping_period = Duration::from_millis(50);
    let th = new_test_hub_with(c).await;
    let mut ws = dial_ws(&th).await;
    read_raw(&mut ws).await;
    // Reading is what makes tungstenite answer the pings.
    let reader = tokio::spawn(async move {
        let _ = stays_silent(&mut ws, Duration::from_millis(400)).await;
        ws
    });
    let _ws = reader.await.unwrap();
    let latencies = th
        .hub
        .on_loop(|core| {
            core.clients
                .values()
                .map(|c| c.latency())
                .collect::<Vec<_>>()
        })
        .await;
    assert!(
        latencies.iter().all(|&l| l >= 0),
        "no round trip measured: {latencies:?}"
    );
    th.stop().await;
}

// ── the actor ───────────────────────────────────────────────────────────────

// A deadline lives in the table's state and fires on its own task; arming the
// same key again replaces it, so the stale one never runs.
#[tokio::test(start_paused = true)]
async fn a_rearmed_deadline_replaces_the_old_one() {
    let hub = Hub::start(cfg());
    let fired: Arc<std::sync::Mutex<Vec<&'static str>>> = Arc::default();
    let mut t = Table::new("AAAAAA", new_room("AAAAAA"));
    let now = tokio::time::Instant::now();
    let key = DeadlineKey::seat("turn", 0);
    let f = fired.clone();
    t.deadlines
        .arm(key, now + Duration::from_secs(30), move |_, _| {
            f.lock().unwrap().push("old")
        });
    let f = fired.clone();
    t.deadlines
        .arm(key, now + Duration::from_secs(10), move |_, _| {
            f.lock().unwrap().push("new")
        });
    let f = fired.clone();
    t.deadlines.arm(
        DeadlineKey::table("cleanup"),
        now + Duration::from_secs(20),
        move |_, _| f.lock().unwrap().push("cleanup"),
    );
    open(&hub, t).await;

    tokio::time::sleep(Duration::from_secs(15)).await;
    assert_eq!(*fired.lock().unwrap(), vec!["new"]);
    tokio::time::sleep(Duration::from_secs(60)).await;
    assert_eq!(
        *fired.lock().unwrap(),
        vec!["new", "cleanup"],
        "the replaced deadline fired"
    );
    hub.stop().await;
}

// A deadline can re-arm itself from inside its own job.
#[tokio::test(start_paused = true)]
async fn a_deadline_can_rearm_from_its_own_job() {
    let hub = Hub::start(cfg());
    let count = Arc::new(AtomicUsize::new(0));
    fn tick(
        count: Arc<AtomicUsize>,
    ) -> impl FnOnce(&mut Table, &loco_hub::TableCtx) + Send + 'static {
        move |t, _| {
            if count.fetch_add(1, Ordering::SeqCst) < 2 {
                let at = tokio::time::Instant::now() + Duration::from_secs(1);
                t.deadlines.arm(DeadlineKey::table("tick"), at, tick(count));
            }
        }
    }
    let mut t = Table::new("AAAAAA", new_room("AAAAAA"));
    t.deadlines.arm(
        DeadlineKey::table("tick"),
        tokio::time::Instant::now() + Duration::from_secs(1),
        tick(count.clone()),
    );
    open(&hub, t).await;
    tokio::time::sleep(Duration::from_secs(10)).await;
    assert_eq!(count.load(Ordering::SeqCst), 3);
    hub.stop().await;
}

#[tokio::test]
async fn a_deleted_room_stops_and_forgets_its_bots() {
    let hub = Hub::start(cfg());
    let mut t = Table::new("AAAAAA", new_room("AAAAAA"));
    t.bots.insert(1);
    hub.metrics().bots_active.fetch_add(1, Ordering::Relaxed);
    open(&hub, t).await;
    let sender = hub
        .on_loop(|core| core.tables["AAAAAA"].sender().clone())
        .await;
    hub.on_loop(|core| core.delete_room("AAAAAA")).await;
    assert_eq!(hub.health().rooms, 0);
    assert_eq!(hub.metrics().bots_active.load(Ordering::Relaxed), 0);
    let s = sender.clone();
    assert!(
        eventually(Duration::from_secs(2), move || s
            .post(TableJob::new("late", |_, _| {}))
            .is_err())
        .await,
        "a deleted table still takes jobs"
    );
    hub.stop().await;
}

// ── the drain ───────────────────────────────────────────────────────────────

#[tokio::test]
async fn drain_done_immediately_when_nobody_is_playing() {
    let th = new_test_hub().await;
    open(&th.hub, Table::new("LOBBYY", new_room("LOBBYY"))).await;
    th.hub.begin_drain();
    tokio::time::timeout(Duration::from_secs(2), th.hub.drain_done())
        .await
        .expect("a lobby held the drain open");
    th.stop().await;
}

#[tokio::test]
async fn drain_done_only_once_the_last_match_ends() {
    let mut c = cfg();
    c.timings.latency_broadcast_period = Duration::from_millis(20);
    let th = new_test_hub_with(c).await;
    open(&th.hub, Table::new("PLAYIN", playing_room("PLAYIN", 2))).await;
    th.hub.begin_drain();
    assert!(
        tokio::time::timeout(Duration::from_millis(200), th.hub.drain_done())
            .await
            .is_err(),
        "the drain finished with a match still in flight"
    );
    assert_eq!(th.hub.metrics_stats().matches_in_flight, 1);
    th.hub
        .on_loop(|core| {
            let _ = core.tables["PLAYIN"].post(TableJob::new("finish", |t, _| {
                t.room.status = Status::Finished;
            }));
        })
        .await;
    tokio::time::timeout(Duration::from_secs(2), th.hub.drain_done())
        .await
        .expect("the drain never noticed the match end");
    th.stop().await;
}

// A matchmade pair on its versus reveal is formally a lobby and still counts.
#[tokio::test]
async fn a_matchmade_reveal_counts_as_in_flight() {
    let hub = Hub::start(cfg());
    let mut t = Table::new("REVEAL", new_room("REVEAL"));
    t.matchmade_at = Some(tokio::time::Instant::now());
    open(&hub, t).await;
    let phase = hub.on_loop(|core| core.tables["REVEAL"].phase()).await;
    assert_eq!(phase, Phase::InFlight);
    hub.stop().await;
}

#[tokio::test]
async fn drain_notifies_every_table_and_empties_the_queue() {
    let th = new_test_hub().await;
    let (seated, mut seated_rx) = Client::detached(&th.hub);
    let (queued, mut queued_rx) = Client::detached(&th.hub);
    let mut lobby = Table::new("LOBBYY", new_room("LOBBYY"));
    lobby.seat(&seated, 0);
    open(&th.hub, lobby).await;
    let q = queued.clone();
    th.hub
        .on_loop(move |core| {
            core.queue.push(loco_hub::matchmaking::QueuedPlayer {
                client: q,
                nickname: "Q".into(),
                since: tokio::time::Instant::now(),
            })
        })
        .await;

    th.hub.begin_drain();

    let notice: Value = serde_json::from_str(seated_rx.recv().await.unwrap().as_str()).unwrap();
    assert_eq!(
        notice["type"], "server_updating",
        "a lobby was not told about the drain"
    );
    let refusal: Value = serde_json::from_str(queued_rx.recv().await.unwrap().as_str()).unwrap();
    assert_eq!(refusal["error"], DRAIN_REFUSAL);
    let cancelled: Value = serde_json::from_str(queued_rx.recv().await.unwrap().as_str()).unwrap();
    assert_eq!(cancelled["type"], "matchmaking_cancelled");
    assert_eq!(th.hub.metrics_stats().matchmaking_queue, 0);

    // And the refusal the handlers will call answers with the same string.
    let (late, mut late_rx) = Client::detached(&th.hub);
    let l = late.clone();
    assert!(
        th.hub
            .on_loop(move |core| core.refuse_while_draining(&l))
            .await
    );
    let r: Value = serde_json::from_str(late_rx.recv().await.unwrap().as_str()).unwrap();
    assert_eq!(r["error"], "server updating, try again in a moment");
    th.stop().await;
}

#[tokio::test]
async fn drain_reported_on_health_and_metrics() {
    let th = new_test_hub().await;
    th.hub.begin_drain();
    th.hub.drain_done().await;
    let (status, _, body) = http_get(&th, "/health").await;
    assert_eq!(status, 200, "a draining server must stay healthy");
    assert_eq!(
        serde_json::from_str::<Value>(&body).unwrap()["draining"],
        true
    );
    let (_, _, page) = http_get(&th, "/metrics").await;
    assert!(page.lines().any(|l| l == "draining 1"), "{page}");
    th.hub.begin_drain(); // twice is fine
    th.stop().await;
}

// ── the snapshot ────────────────────────────────────────────────────────────

fn snap_path(dir: &std::path::Path) -> std::path::PathBuf {
    dir.join("snapshots").join("loco.json")
}

fn tempdir(name: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!(
        "loco-hub-{name}-{}",
        loco_hub::tokens::generate_conn_id()
    ));
    std::fs::create_dir_all(&d).unwrap();
    d
}

// The whole point: a match on one process is a match on the next.
#[tokio::test]
async fn snapshot_match_survives_a_restart() {
    let dir = tempdir("survive");
    let path = snap_path(&dir);
    let started = SystemTime::now() - Duration::from_secs(90);

    let first = Hub::start(cfg());
    let mut t = Table::new("PLAYIN", playing_room("PLAYIN", 3));
    t.tokens.insert(0, "tok-0".into());
    t.tokens.insert(2, "tok-2".into());
    t.bots.insert(1);
    t.afk.insert(2, 1);
    t.solo = true;
    t.streamer_mode = true;
    t.match_started_at = Some(started);
    t.match_history.push(MatchRecord {
        rounds_won: vec![2, 0, 1],
        scores: vec![0, 30, 12],
        winner: 0,
        duration_ms: 1234,
    });
    open(&first, t).await;
    open(&first, Table::new("LOBBYY", new_room("LOBBYY"))).await;
    first.save_snapshot(&path).await.expect("save");
    first.stop().await;

    let raw: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    assert_eq!(raw["schema_version"], SNAPSHOT_SCHEMA_VERSION);
    assert_eq!(
        raw["rooms"].as_array().unwrap().len(),
        1,
        "a lobby was saved: {raw}"
    );
    assert_eq!(
        raw["rooms"][0]["session_tokens"],
        json!({"0": "tok-0", "2": "tok-2"})
    );

    let second = Hub::start(cfg());
    second.load_snapshot(&path).await.expect("load");
    assert!(!path.exists(), "the snapshot was left to be replayed");
    let back = second
        .on_loop(|core| {
            let t = &core.tables["PLAYIN"];
            (t.phase(), core.tables.len())
        })
        .await;
    assert_eq!(back, (Phase::InFlight, 1));
    // What travelled is what the table holds, read on the table's own task.
    let (tx, rx) = tokio::sync::oneshot::channel();
    second
        .on_loop(move |core| {
            let _ = core.tables["PLAYIN"].post(TableJob::new("inspect", move |t, _| {
                let _ = tx.send((
                    t.validate_token(2, "tok-2"),
                    t.is_bot(1),
                    t.afk.get(&2).copied(),
                    t.solo && t.streamer_mode,
                    t.match_history.clone(),
                    t.match_started_at,
                    t.away_at.keys().copied().collect::<Vec<_>>(),
                    t.members.len(),
                    t.room.is_seeded(),
                ));
            }));
        })
        .await;
    let (tok, bot, afk, flags, history, at, away, seats, seeded) = rx.await.unwrap();
    assert!(seeded, "a restored room was left without an RNG");
    assert!(tok && bot && flags);
    assert_eq!(afk, Some(1));
    assert_eq!(history[0].duration_ms, 1234);
    let drift = at.unwrap().duration_since(started).unwrap_or_default();
    assert!(
        drift < Duration::from_millis(1),
        "the match start moved: {drift:?}"
    );
    assert_eq!(
        away,
        vec![0, 2],
        "every human seat comes back held, the bot does not"
    );
    assert_eq!(seats, 3);
    assert_eq!(second.metrics().bots_active.load(Ordering::Relaxed), 1);
    second.stop().await;
    let _ = std::fs::remove_dir_all(dir);
}

fn write_snapshot(path: &std::path::Path, schema: i64, saved_at: SystemTime) {
    let file = SnapshotFile {
        schema_version: schema,
        saved_at: Some(saved_at),
        rooms: vec![RoomSnapshot {
            room: playing_room("PLAYIN", 2),
            ..Default::default()
        }],
    };
    loco_hub::snapshot::write_atomic(path, &file).unwrap();
}

#[tokio::test]
async fn snapshot_refused_when_too_old() {
    let dir = tempdir("old");
    let path = snap_path(&dir);
    write_snapshot(
        &path,
        SNAPSHOT_SCHEMA_VERSION,
        SystemTime::now() - Duration::from_secs(3 * 60),
    );
    let hub = Hub::start(cfg());
    hub.load_snapshot(&path).await.unwrap();
    assert_eq!(hub.health().rooms, 0, "a stale snapshot was restored");
    assert!(!path.exists(), "a refused snapshot was left on disk");
    hub.stop().await;
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn snapshot_refused_on_schema_mismatch() {
    let dir = tempdir("schema");
    let path = snap_path(&dir);
    write_snapshot(&path, SNAPSHOT_SCHEMA_VERSION + 1, SystemTime::now());
    let hub = Hub::start(cfg());
    hub.load_snapshot(&path).await.unwrap();
    assert_eq!(hub.health().rooms, 0, "a foreign snapshot was restored");
    hub.stop().await;
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn snapshot_malformed_is_nothing_to_restore() {
    let dir = tempdir("malformed");
    let path = snap_path(&dir);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, b"{truncated").unwrap();
    let hub = Hub::start(cfg());
    hub.load_snapshot(&path)
        .await
        .expect("a malformed file refused the boot");
    assert!(!path.exists());
    hub.stop().await;
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn snapshot_disabled_when_no_path_is_configured() {
    let hub = Hub::start(cfg());
    open(&hub, Table::new("PLAYIN", playing_room("PLAYIN", 2))).await;
    hub.save_snapshot(std::path::Path::new("")).await.unwrap();
    hub.load_snapshot(std::path::Path::new("")).await.unwrap();
    // Nothing was stopped either: the table still answers.
    let ok = hub
        .on_loop(|core| {
            core.tables["PLAYIN"]
                .post(TableJob::new("ping", |_, _| {}))
                .is_ok()
        })
        .await;
    assert!(ok);
    hub.stop().await;
}

// A file the Go server wrote on its way out: local offset, nanoseconds, the
// zero time, and nulls where this keeps maps. It must load.
#[tokio::test]
async fn snapshot_written_by_go_loads() {
    let dir = tempdir("gofile");
    let path = snap_path(&dir);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let saved = loco_hub::gotime::format_rfc3339(SystemTime::now()).replace('Z', "+00:00");
    let body = json!({
        "schema_version": 5,
        "saved_at": saved,
        "rooms": [{
            "room": serde_json::to_value(playing_room("GOGOGO", 2)).unwrap(),
            "session_tokens": {"0": "abc", "1": "def"},
            "bot_slots": null,
            "afk_timeouts": null,
            "match_history": null,
            "match_started_at": "0001-01-01T00:00:00Z"
        }]
    });
    std::fs::write(&path, body.to_string()).unwrap();
    let hub = Hub::start(cfg());
    hub.load_snapshot(&path).await.unwrap();
    assert_eq!(hub.health().rooms, 1, "a Go snapshot was not restored");
    hub.stop().await;
    let _ = std::fs::remove_dir_all(dir);
}

#[cfg(unix)]
#[tokio::test]
async fn snapshot_is_private_on_disk() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempdir("perms");
    let path = snap_path(&dir);
    write_snapshot(&path, SNAPSHOT_SCHEMA_VERSION, SystemTime::now());
    let file = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
    let parent = std::fs::metadata(path.parent().unwrap())
        .unwrap()
        .permissions()
        .mode()
        & 0o777;
    assert_eq!(file, 0o600);
    assert_eq!(parent, 0o700);
    let _ = std::fs::remove_dir_all(dir);
}
