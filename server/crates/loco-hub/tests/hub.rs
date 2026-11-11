//! The hub's handlers end to end, through real sockets on loopback.

#![allow(clippy::field_reassign_with_default)] // a test narrows one knob of the default config

use futures_util::StreamExt;
use loco_hub::testkit::*;
use loco_hub::{Hub, HubConfig};
use serde_json::{Value, json};
use std::collections::HashSet;
use std::time::Duration;
use tokio::time::Instant;
use tokio_tungstenite::tungstenite::Message;

// ── helpers ─────────────────────────────────────────────────────────────────

fn num(color: &str, value: i64) -> Value {
    json!({"color": color, "kind": "number", "value": value})
}

fn debug_cfg() -> HubConfig {
    let mut c = HubConfig::default();
    c.debug_mode = true;
    c
}

/// A hub whose empty tables go after `timeout`.
async fn new_test_hub_fast_cleanup(timeout: Duration) -> TestHub {
    let mut c = HubConfig::default();
    c.timings.empty_room_timeout = timeout;
    new_test_hub_with(c).await
}

async fn create(th: &TestHub, nick: &str) -> (Ws, Value) {
    let mut ws = dial_ws(th).await;
    send_msg(&mut ws, json!({"type": "create_room", "nickname": nick})).await;
    let created = read_msg_of_type(&mut ws, "room_created").await;
    (ws, created)
}

async fn join(th: &TestHub, code: &str, nick: &str) -> (Ws, Value) {
    let mut ws = dial_ws(th).await;
    send_msg(
        &mut ws,
        json!({"type": "join_room", "nickname": nick, "room_code": code}),
    )
    .await;
    let joined = read_msg_of_type(&mut ws, "room_joined").await;
    (ws, joined)
}

fn code_of(created: &Value) -> String {
    created["room_code"].as_str().expect("room_code").to_owned()
}

enum Frame {
    Msg(Value),
    Timeout,
    Closed,
}

/// The next JSON message within `wait`, or why there was none. Unlike
/// `read_raw` this never panics on a closed socket: several tests end on one.
async fn next_frame(ws: &mut Ws, wait: Duration) -> Frame {
    let deadline = Instant::now() + wait;
    loop {
        match tokio::time::timeout_at(deadline, ws.next()).await {
            Err(_) => return Frame::Timeout,
            Ok(Some(Ok(Message::Text(t)))) => {
                return Frame::Msg(serde_json::from_str(t.as_str()).unwrap_or_default());
            }
            Ok(Some(Ok(Message::Close(_)))) | Ok(None) | Ok(Some(Err(_))) => {
                return Frame::Closed;
            }
            Ok(Some(Ok(_))) => continue,
        }
    }
}

/// Reads until a message of `typ` or `deadline` passes.
async fn drain_until(ws: &mut Ws, typ: &str, deadline: Duration) -> bool {
    let end = Instant::now() + deadline;
    while Instant::now() < end {
        match next_frame(ws, Duration::from_millis(500)).await {
            Frame::Msg(m) if m["type"] == typ => return true,
            Frame::Msg(_) => {}
            Frame::Timeout | Frame::Closed => return false,
        }
    }
    false
}

/// Whether no message of `typ` arrives within `wait` (anything else is read
/// and dropped).
async fn none_of_type_within(ws: &mut Ws, typ: &str, wait: Duration) -> Result<(), Value> {
    let end = Instant::now() + wait;
    loop {
        let left = end.saturating_duration_since(Instant::now());
        if left.is_zero() {
            return Ok(());
        }
        match next_frame(ws, left).await {
            Frame::Msg(m) if m["type"] == typ => return Err(m),
            Frame::Msg(_) => {}
            Frame::Timeout | Frame::Closed => return Ok(()),
        }
    }
}

/// A closed socket is torn down asynchronously.
async fn wait_for_clients(hub: &Hub, want: i32) {
    let h = hub.clone();
    assert!(
        eventually(Duration::from_secs(2), move || h.health().clients == want).await,
        "clients = {}, want {want}",
        hub.health().clients
    );
}

/// One value off the Prometheus page.
fn metric(page: &str, name: &str) -> Option<f64> {
    page.lines().find_map(|l| {
        let (k, v) = l.split_once(' ')?;
        (k == name).then(|| v.trim().parse().ok())?
    })
}

async fn get_metric(th: &TestHub, name: &str) -> f64 {
    let (_, _, page) = http_get(th, "/metrics").await;
    metric(&page, name).unwrap_or_else(|| panic!("no {name} on /metrics:\n{page}"))
}

async fn get_health(th: &TestHub) -> Value {
    let (_, _, body) = http_get(th, "/health").await;
    serde_json::from_str(&body).expect("health json")
}

fn hand_len(m: &Value) -> usize {
    m["state"]["hand"].as_array().map_or(0, Vec::len)
}

fn i(v: &Value) -> i64 {
    v.as_i64().unwrap_or(-1)
}

/// Three humans at a dealt, loaded table: Alice (host, 0), Bob (1), Carol (2).
async fn three_player_game(th: &TestHub) -> (Ws, Ws, Ws) {
    let (mut c1, created) = create(th, "Alice").await;
    let code = code_of(&created);
    let (mut c2, _) = join(th, &code, "Bob").await;
    read_msg_of_type(&mut c1, "player_joined").await;
    let (mut c3, _) = join(th, &code, "Carol").await;
    read_msg_of_type(&mut c1, "player_joined").await;
    read_msg_of_type(&mut c2, "player_joined").await;
    send_msg(&mut c1, json!({"type": "start_game"})).await;
    for c in [&mut c1, &mut c2, &mut c3] {
        read_msg_of_type(c, "game_started").await;
    }
    complete_map_load(&mut [&mut c1, &mut c2, &mut c3]).await;
    (c1, c2, c3)
}

/// Two humans dealt and loaded, handing back both `game_started`s.
async fn two_player_game_with_starts(th: &TestHub) -> (Ws, Ws, Value, Value) {
    let (mut c1, created) = create(th, "Alice").await;
    let (mut c2, _) = join(th, &code_of(&created), "Bob").await;
    read_msg_of_type(&mut c1, "player_joined").await;
    send_msg(&mut c1, json!({"type": "start_game"})).await;
    let gs1 = read_msg_of_type(&mut c1, "game_started").await;
    let gs2 = read_msg_of_type(&mut c2, "game_started").await;
    complete_map_load(&mut [&mut c1, &mut c2]).await;
    (c1, c2, gs1, gs2)
}

/// A human and one bot, dealt and loaded; the human's `game_started`.
async fn bot_game(th: &TestHub, nick: &str) -> (Ws, Value) {
    let (mut ws, _) = create(th, nick).await;
    send_msg(&mut ws, json!({"type": "add_bot"})).await;
    read_msg_of_type(&mut ws, "player_joined").await;
    send_msg(&mut ws, json!({"type": "start_game"})).await;
    let gs = read_msg_of_type(&mut ws, "game_started").await;
    complete_map_load(&mut [&mut ws]).await;
    (ws, gs)
}

// ── tests ───────────────────────────────────────────────────────────────────

#[tokio::test]
async fn health_endpoint() {
    let th = new_test_hub().await;
    let (status, ct, body) = http_get(&th, "/health").await;
    assert_eq!(status, 200);
    assert!(ct.starts_with("application/json"), "content type {ct:?}");
    let v: Value = serde_json::from_str(&body).expect("decode health");
    assert_eq!(v["status"], "ok");
    th.stop().await;
}

#[tokio::test]
async fn health_endpoint_room_count() {
    let th = new_test_hub().await;
    assert_eq!(get_health(&th).await["rooms"], 0);

    let (_conn, _) = create(&th, "Alice").await;
    let h = th.hub.clone();
    assert!(eventually(Duration::from_secs(2), move || h.health().rooms == 1).await);
    let v = get_health(&th).await;
    assert_eq!(v["rooms"], 1);
    assert!(i(&v["clients"]) >= 1, "expected >= 1 client, got {v}");
    th.stop().await;
}

#[tokio::test]
async fn player_disconnect_during_game_broadcasts_disconnected() {
    let th = new_test_hub().await;
    let TwoPlayers { mut alice, bob, .. } = setup_two_player_game(&th).await;
    drop(bob);
    let m = read_msg_of_type(&mut alice, "player_disconnected").await;
    assert_eq!(seat_of(&m, "player_index"), 1);
    assert_eq!(m["nickname"], "Bob");
    for p in m["players"].as_array().into_iter().flatten() {
        if p["index"] == 1 {
            assert_eq!(
                p["connected"], false,
                "Bob should be disconnected in the player list"
            );
        }
    }
    th.stop().await;
}

#[tokio::test]
async fn player_reconnect_during_game() {
    let th = new_test_hub().await;
    let TwoPlayers {
        mut alice,
        bob,
        code,
        tokens,
    } = setup_two_player_game(&th).await;
    drop(bob);
    read_msg_of_type(&mut alice, "player_disconnected").await;

    let mut bob2 = dial_ws(&th).await;
    send_msg(
        &mut bob2,
        json!({"type": "join_room", "nickname": "Bob", "room_code": code, "session_token": tokens[1]}),
    )
    .await;
    let m = read_msg_of_type(&mut bob2, "player_reconnected").await;
    assert_eq!(seat_of(&m, "player_id"), 1);
    assert_eq!(m["room_code"], code.as_str());
    assert!(
        m["state"].is_object(),
        "expected game state in reconnect message"
    );
    assert_eq!(m["state"]["your_index"], 1);

    let seen = read_msg_of_type(&mut alice, "player_reconnected").await;
    assert_eq!(seat_of(&seen, "player_index"), 1);
    for p in seen["players"].as_array().into_iter().flatten() {
        if p["index"] == 1 {
            assert_eq!(
                p["connected"], true,
                "Bob should be connected after reconnect"
            );
        }
    }
    th.stop().await;
}

#[tokio::test]
async fn player_reconnect_wrong_token_rejected() {
    let th = new_test_hub().await;
    let TwoPlayers {
        alice: _alice,
        bob,
        code,
        ..
    } = setup_two_player_game(&th).await;
    drop(bob);

    let mut c3 = dial_ws(&th).await;
    send_msg(
        &mut c3,
        json!({"type": "join_room", "nickname": "Bob", "room_code": code, "session_token": "wrong-token"}),
    )
    .await;
    // The refusal is deliberately the generic one: naming the token would tell
    // anyone holding a table code which nicknames sit at it.
    let m = read_msg_of_type(&mut c3, "error").await;
    let e = m["error"].as_str().unwrap_or("");
    assert!(
        !e.contains("invalid session token"),
        "the refusal names the seat again: {e:?}"
    );
    assert!(!e.is_empty(), "expected a refusal");
    th.stop().await;
}

#[tokio::test]
async fn player_reconnect_wrong_nickname_rejected() {
    let th = new_test_hub().await;
    let TwoPlayers {
        alice: _alice,
        bob,
        code,
        ..
    } = setup_two_player_game(&th).await;
    drop(bob);

    let mut c3 = dial_ws(&th).await;
    send_msg(
        &mut c3,
        json!({"type": "join_room", "nickname": "Charlie", "room_code": code}),
    )
    .await;
    let m = read_msg_of_type(&mut c3, "error").await;
    assert!(
        m["error"]
            .as_str()
            .unwrap_or("")
            .contains("game already in progress"),
        "got {m}"
    );
    th.stop().await;
}

#[tokio::test]
async fn player_disconnect_in_lobby_removes_player() {
    let th = new_test_hub().await;
    let (mut c1, created) = create(&th, "Alice").await;
    let (c2, _) = join(&th, &code_of(&created), "Bob").await;
    read_msg_of_type(&mut c1, "player_joined").await;

    drop(c2);
    // A lobby seat leaves (player_left), it is not held (player_disconnected).
    let m = read_msg_of_type(&mut c1, "player_left").await;
    assert_eq!(m["nickname"], "Bob");
    th.stop().await;
}

#[tokio::test]
async fn player_reconnect_after_reconnect_can_continue_playing() {
    let th = new_test_hub().await;
    let TwoPlayers {
        mut alice,
        bob,
        code,
        tokens,
    } = setup_two_player_game(&th).await;
    drop(bob);
    read_msg_of_type(&mut alice, "player_disconnected").await;

    let mut bob2 = dial_ws(&th).await;
    send_msg(
        &mut bob2,
        json!({"type": "join_room", "nickname": "Bob", "room_code": code, "session_token": tokens[1]}),
    )
    .await;
    let rm = read_msg_of_type(&mut bob2, "player_reconnected").await;
    assert!(
        rm["state"].is_object(),
        "expected game state after reconnect"
    );
    read_msg_of_type(&mut alice, "player_reconnected").await;

    let turn = i(&rm["state"]["turn"]);
    assert!((0..=1).contains(&turn), "unexpected turn index {turn}");
    assert!(hand_len(&rm) > 0, "expected Bob to have cards in hand");

    // Whoever is on turn can still draw: the server still works.
    let drawer = if turn == 0 { &mut alice } else { &mut bob2 };
    send_msg(drawer, json!({"type": "draw_card"})).await;
    read_msg_of_type(drawer, "card_drawn").await;
    th.stop().await;
}

#[tokio::test]
async fn player_connected_flag_in_player_list() {
    let th = new_test_hub().await;
    let TwoPlayers { mut alice, bob, .. } = setup_two_player_game(&th).await;
    drop(bob);
    let m = read_msg_of_type(&mut alice, "player_disconnected").await;
    for p in m["players"].as_array().into_iter().flatten() {
        if p["index"] == 0 {
            assert_eq!(p["connected"], true, "Alice should be connected");
        }
        if p["index"] == 1 {
            assert_eq!(p["connected"], false, "Bob should be disconnected");
        }
    }
    th.stop().await;
}

#[tokio::test]
async fn room_code_is_human_friendly6_chars() {
    let th = new_test_hub().await;
    let (_c, created) = create(&th, "Alice").await;
    let code = code_of(&created);
    assert_eq!(code.chars().count(), 6, "room code {code:?}");
    for ch in code.chars() {
        assert!(
            !matches!(ch, '0' | 'O' | '1' | 'I' | 'l'),
            "room code {code:?} contains confusing char {ch:?}"
        );
    }
    th.stop().await;
}

#[tokio::test]
async fn room_code_unique_across_multiple_rooms() {
    let th = new_test_hub().await;
    let mut codes = HashSet::new();
    let mut held = Vec::new();
    for n in 0..5 {
        let (c, created) = create(&th, &format!("Player{n}")).await;
        let code = code_of(&created);
        assert!(codes.insert(code.clone()), "room code collision: {code:?}");
        held.push(c);
    }
    th.stop().await;
}

/// A lobby of Alice (host) and Bob.
async fn lobby_of_two(th: &TestHub) -> (Ws, Ws) {
    let (mut c1, created) = create(th, "Alice").await;
    let (c2, _) = join(th, &code_of(&created), "Bob").await;
    read_msg_of_type(&mut c1, "player_joined").await;
    (c1, c2)
}

#[tokio::test]
async fn set_match_format_host_only() {
    let th = new_test_hub().await;
    let (_c1, mut c2) = lobby_of_two(&th).await;
    send_msg(
        &mut c2,
        json!({"type": "set_match_format", "match_format": "BO3"}),
    )
    .await;
    let e = read_msg_of_type(&mut c2, "error").await;
    assert!(
        e["error"].as_str().unwrap_or("").contains("only the host"),
        "expected host-only error, got {e}"
    );
    th.stop().await;
}

#[tokio::test]
async fn set_match_format_broadcasts_to_all() {
    let th = new_test_hub().await;
    let (mut c1, mut c2) = lobby_of_two(&th).await;
    send_msg(
        &mut c1,
        json!({"type": "set_match_format", "match_format": "BO3"}),
    )
    .await;
    let a = read_msg_of_type(&mut c1, "lobby_config_changed").await;
    let b = read_msg_of_type(&mut c2, "lobby_config_changed").await;
    assert_eq!(a["match_format"], "BO3");
    assert_eq!(b["match_format"], "BO3");
    th.stop().await;
}

#[tokio::test]
async fn set_max_players_broadcasts_to_all() {
    let th = new_test_hub().await;
    let (mut c1, mut c2) = lobby_of_two(&th).await;
    send_msg(
        &mut c1,
        json!({"type": "set_max_players", "max_players": 4}),
    )
    .await;
    let a = read_msg_of_type(&mut c1, "lobby_config_changed").await;
    let b = read_msg_of_type(&mut c2, "lobby_config_changed").await;
    assert_eq!(a["max_players"], 4);
    assert_eq!(b["max_players"], 4);
    th.stop().await;
}

#[tokio::test]
async fn set_max_players_cannot_drop_below_current() {
    let th = new_test_hub().await;
    let (mut c1, _c2) = lobby_of_two(&th).await;
    send_msg(
        &mut c1,
        json!({"type": "set_max_players", "max_players": 1}),
    )
    .await;
    let e = read_msg_of_type(&mut c1, "error").await;
    assert!(
        !e["error"].as_str().unwrap_or("").is_empty(),
        "expected error when setting max players below current count"
    );
    th.stop().await;
}

#[tokio::test]
async fn room_created_includes_match_format_and_max_players() {
    let th = new_test_hub().await;
    let (_c, created) = create(&th, "Alice").await;
    assert_eq!(created["match_format"], "BO1");
    assert_eq!(created["max_players"], 7);
    th.stop().await;
}

// Only that a game starts.
#[tokio::test]
async fn game_state_includes_round_and_scoreboard() {
    let th = new_test_hub().await;
    let _game = setup_two_player_game(&th).await;
    th.stop().await;
}

// --- Metrics tests ---

// /metrics is Prometheus text: the page answers 200 and parses, under the
// names the operators read.
#[tokio::test]
async fn metrics_endpoint_returns_json() {
    let th = new_test_hub().await;
    let (status, ct, page) = http_get(&th, "/metrics").await;
    assert_eq!(status, 200);
    assert!(ct.starts_with("text/plain"), "content type {ct:?}");
    for name in ["rooms_active", "players_connected", "matches_started"] {
        assert!(metric(&page, name).is_some(), "missing {name}:\n{page}");
    }
    th.stop().await;
}

#[tokio::test]
async fn metrics_endpoint_rooms_and_players_count() {
    let th = new_test_hub().await;
    assert_eq!(get_metric(&th, "rooms_active").await, 0.0);
    assert_eq!(get_metric(&th, "players_connected").await, 0.0);

    let (_c, _) = create(&th, "Alice").await;
    let h = th.hub.clone();
    assert!(eventually(Duration::from_secs(2), move || h.health().rooms == 1).await);
    assert_eq!(get_metric(&th, "rooms_active").await, 1.0);
    assert!(get_metric(&th, "players_connected").await >= 1.0);
    th.stop().await;
}

#[tokio::test]
async fn metrics_endpoint_matches_started_and_finished() {
    let th = new_test_hub().await;
    assert_eq!(get_metric(&th, "matches_started").await, 0.0);
    let _game = setup_two_player_game(&th).await;
    let h = th.hub.clone();
    assert!(
        eventually(Duration::from_secs(2), move || h
            .metrics_stats()
            .matches_started
            == 1)
        .await
    );
    assert_eq!(get_metric(&th, "matches_started").await, 1.0);
    th.stop().await;
}

#[tokio::test]
async fn metrics_endpoint_bots_active() {
    let th = new_test_hub().await;
    let (mut c, _) = create(&th, "Alice").await;
    send_msg(&mut c, json!({"type": "add_bot"})).await;
    read_msg_of_type(&mut c, "player_joined").await;
    let h = th.hub.clone();
    assert!(
        eventually(Duration::from_secs(2), move || h
            .metrics_stats()
            .bots_active
            == 1)
        .await
    );
    assert_eq!(get_metric(&th, "bots_active").await, 1.0);
    th.stop().await;
}

// --- Room cleanup tests ---

#[tokio::test]
async fn room_cleanup_empty_lobby_deleted_after_timeout() {
    let th = new_test_hub_fast_cleanup(Duration::from_millis(80)).await;
    let (conn, _) = create(&th, "Alice").await;
    let h = th.hub.clone();
    assert!(eventually(Duration::from_secs(2), move || h.health().rooms == 1).await);
    assert_eq!(get_metric(&th, "rooms_active").await, 1.0);

    // Alice leaves: the cleanup clock starts.
    drop(conn);
    wait_for_clients(&th.hub, 0).await;
    assert_eq!(
        th.hub.health().rooms,
        1,
        "the room went before its cleanup timeout"
    );

    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(get_metric(&th, "rooms_active").await, 0.0);
    th.stop().await;
}

#[tokio::test]
async fn room_cleanup_cancelled_on_rejoin() {
    let th = new_test_hub_fast_cleanup(Duration::from_millis(150)).await;
    let (c1, created) = create(&th, "Alice").await;
    let code = code_of(&created);

    drop(c1);
    tokio::time::sleep(Duration::from_millis(30)).await;

    let mut c2 = dial_ws(&th).await;
    send_msg(
        &mut c2,
        json!({"type": "join_room", "nickname": "Bob", "room_code": code}),
    )
    .await;
    let m = read_msg(&mut c2).await;
    assert_ne!(m["type"], "error", "expected to join room, got {m}");

    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(
        get_metric(&th, "rooms_active").await,
        1.0,
        "the room went with Bob in it"
    );
    th.stop().await;
}

// --- Input validation tests ---

#[tokio::test]
async fn create_room_empty_nickname_rejected() {
    let th = new_test_hub().await;
    let mut c = dial_ws(&th).await;
    send_msg(&mut c, json!({"type": "create_room", "nickname": ""})).await;
    let m = read_msg_of_type(&mut c, "error").await;
    assert!(
        m["error"].as_str().unwrap_or("").contains("nickname"),
        "{m}"
    );
    th.stop().await;
}

#[tokio::test]
async fn create_room_nickname_too_long_rejected() {
    let th = new_test_hub().await;
    let mut c = dial_ws(&th).await;
    send_msg(
        &mut c,
        json!({"type": "create_room", "nickname": "a".repeat(21)}),
    )
    .await;
    let m = read_msg_of_type(&mut c, "error").await;
    assert!(
        m["error"].as_str().unwrap_or("").contains("nickname"),
        "{m}"
    );
    th.stop().await;
}

#[tokio::test]
async fn join_room_invalid_room_code_rejected() {
    let th = new_test_hub().await;
    let mut c = dial_ws(&th).await;
    send_msg(
        &mut c,
        json!({"type": "join_room", "nickname": "Alice", "room_code": "BAD!!"}),
    )
    .await;
    let m = read_msg_of_type(&mut c, "error").await;
    assert!(
        m["error"]
            .as_str()
            .unwrap_or("")
            .contains("invalid room code"),
        "{m}"
    );
    th.stop().await;
}

#[tokio::test]
async fn join_room_empty_nickname_rejected() {
    let th = new_test_hub().await;
    let mut c = dial_ws(&th).await;
    send_msg(
        &mut c,
        json!({"type": "join_room", "nickname": "", "room_code": "ABCDEF"}),
    )
    .await;
    let m = read_msg_of_type(&mut c, "error").await;
    assert!(
        m["error"].as_str().unwrap_or("").contains("nickname"),
        "{m}"
    );
    th.stop().await;
}

// --- Task stability ---
//
// The runtime's live task count, which is what `runtime_tasks` reports.
// Each #[tokio::test] has a runtime of its own, so the count is this test's
// alone.

fn live_tasks(th: &TestHub) -> i64 {
    th.hub.metrics_stats().runtime_tasks
}

/// Waits for the live task count to come back within `slack` of `baseline`.
async fn settles_near(th: &TestHub, baseline: i64, slack: i64) -> i64 {
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        let now = live_tasks(th);
        if now <= baseline + slack || Instant::now() >= deadline {
            return now;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

fn fast_bots(c: &mut HubConfig) {
    c.timings.bots.think = Duration::from_millis(5);
    c.timings.bots.jitter_max = Duration::from_millis(5);
    c.timings.turn_timeout = Duration::from_millis(50);
    c.timings.turn_timeout_grace = Duration::ZERO;
    c.timings.afk_kick_threshold = 10_000;
}

// The comprehensive leak regression: rapid create and leave (cleanup timer
// path), full bot games then close, and mid-game disconnects (reconnect expiry
// path). The task count must not grow with the number of rooms.
#[tokio::test]
async fn task_stability_full_lifecycle() {
    let mut c = HubConfig::default();
    c.timings.empty_room_timeout = Duration::from_millis(80);
    c.timings.reconnect_timeout = Duration::from_millis(120);
    fast_bots(&mut c);
    let th = new_test_hub_with(c).await;
    tokio::time::sleep(Duration::from_millis(20)).await;
    let baseline = live_tasks(&th);

    // Path 1: rapid create + immediate leave.
    const QUICK_ROOMS: usize = 10;
    for n in 0..QUICK_ROOMS {
        let (c, _) = create(&th, &format!("Quick{n}")).await;
        drop(c);
    }

    // Path 2: a bot game, run for a while (to its end if it gets there), then
    // closed.
    for nick in ["BotPlayer1", "BotPlayer2"] {
        let (mut c, _) = bot_game(&th, nick).await;
        drain_until(&mut c, "match_end", Duration::from_secs(2)).await;
        drop(c);
    }

    // Path 3: mid-game disconnect → reconnect expiry.
    const MID_DISCONNECT_ROOMS: usize = 3;
    for n in 0..MID_DISCONNECT_ROOMS {
        let (c, _) = bot_game(&th, &format!("Disconn{n}")).await;
        drop(c);
    }

    tokio::time::sleep(Duration::from_millis(500)).await;
    let slack = 12;
    let after = settles_near(&th, baseline, slack).await;
    assert!(
        after <= baseline + slack,
        "task leak: baseline={baseline} after={after} delta={} exceeds slack={slack} \
         (rooms={QUICK_ROOMS}, bot_games=2, mid_disconnects={MID_DISCONNECT_ROOMS})",
        after - baseline
    );
    th.stop().await;
}

// runtime_tasks is on the Prometheus page, and counts runtime tasks.
#[tokio::test]
async fn metrics_runtime_tasks_present() {
    let th = new_test_hub().await;
    let (status, _, page) = http_get(&th, "/metrics").await;
    assert_eq!(status, 200);
    let n = metric(&page, "runtime_tasks").expect("runtime_tasks on /metrics");
    assert!(n > 0.0, "runtime_tasks should be > 0, got {n}");
    th.stop().await;
}

// Creating and destroying many rooms does not leak tasks: the 504 bug was
// timers and schedulers piling up per room.
#[tokio::test]
async fn task_stability_room_lifecycle() {
    let th = new_test_hub_fast_cleanup(Duration::from_millis(80)).await;
    tokio::time::sleep(Duration::from_millis(20)).await;
    let baseline = live_tasks(&th);

    const NUM_ROOMS: usize = 20;
    for n in 0..NUM_ROOMS {
        let (c, _) = create(&th, &format!("Player{n}")).await;
        drop(c);
    }

    tokio::time::sleep(Duration::from_millis(200)).await;
    let slack = 10;
    let after = settles_near(&th, baseline, slack).await;
    assert!(
        after <= baseline + slack,
        "task leak: baseline={baseline} after={after} (created {NUM_ROOMS} rooms); delta={} exceeds slack={slack}",
        after - baseline
    );
    th.stop().await;
}

// A 1v1 bot game run and closed leaves no tasks behind.
#[tokio::test]
async fn task_stability_bot_game() {
    let mut c = HubConfig::default();
    c.timings.empty_room_timeout = Duration::from_millis(80);
    c.timings.reconnect_timeout = Duration::from_millis(120);
    fast_bots(&mut c);
    let th = new_test_hub_with(c).await;
    tokio::time::sleep(Duration::from_millis(20)).await;
    let baseline = live_tasks(&th);

    let (mut conn, _) = bot_game(&th, "Human").await;
    drain_until(&mut conn, "match_end", Duration::from_secs(3)).await;
    drop(conn);

    tokio::time::sleep(Duration::from_millis(300)).await;
    let slack = 10;
    let after = settles_near(&th, baseline, slack).await;
    assert!(
        after <= baseline + slack,
        "task leak after bot game: baseline={baseline} after={after} delta={} exceeds slack={slack}",
        after - baseline
    );
    th.stop().await;
}

// --- Turn timer tests ---

// The clock starts at match_ready, once every client has loaded the map, not
// at game_started: anything else is a head start in a game decided by arrival
// order.
#[tokio::test]
async fn turn_timer_starts_at_match_ready_not_game_started() {
    let th = new_test_hub().await;
    let (mut c1, created) = create(&th, "Alice").await;
    let (mut c2, _) = join(&th, &code_of(&created), "Bob").await;
    read_msg_of_type(&mut c1, "player_joined").await;

    send_msg(&mut c1, json!({"type": "start_game"})).await;
    let s1 = read_msg_of_type(&mut c1, "game_started").await;
    let s2 = read_msg_of_type(&mut c2, "game_started").await;
    for s in [&s1, &s2] {
        assert!(s["state"].is_object(), "game_started missing state");
        assert!(
            s["state"]["turn_deadline"].as_i64().unwrap_or(0) == 0,
            "game_started carries a turn deadline before match_ready: {}",
            s["state"]["turn_deadline"]
        );
    }

    for c in [&mut c1, &mut c2] {
        send_msg(c, json!({"type": "map_ready"})).await;
    }
    for (n, c) in [&mut c1, &mut c2].into_iter().enumerate() {
        let ready = read_msg_of_type(c, "match_ready").await;
        let dl = ready["turn_deadline"].as_i64().unwrap_or(0);
        assert!(
            dl != 0,
            "conn{}: match_ready carries no turn_deadline",
            n + 1
        );
        assert!(
            dl > loco_hub::net::wire::now_ms(),
            "conn{}: turn_deadline {dl} should be in the future",
            n + 1
        );
    }
    th.stop().await;
}

// A human who does not act within the turn timeout is drawn for and passed,
// and turn_changed reaches everybody.
#[tokio::test]
async fn turn_timer_auto_draw_and_pass() {
    let mut c = HubConfig::default();
    c.timings.turn_timeout = Duration::from_millis(80);
    let th = new_test_hub_with(c).await;
    let TwoPlayers {
        mut alice, mut bob, ..
    } = setup_two_player_game(&th).await;
    assert!(
        drain_until(&mut alice, "turn_changed", Duration::from_secs(2)).await,
        "conn1: expected turn_changed after turn timeout"
    );
    assert!(
        drain_until(&mut bob, "turn_changed", Duration::from_secs(2)).await,
        "conn2: expected turn_changed after turn timeout"
    );
    th.stop().await;
}

// card_drawn carries a turn deadline so clients can reset their countdown.
#[tokio::test]
async fn turn_timer_card_played_includes_deadline() {
    let mut c = HubConfig::default();
    c.timings.turn_timeout = Duration::from_secs(30);
    let th = new_test_hub_with(c).await;
    let (c1, c2, gs1, _) = two_player_game_with_starts(&th).await;
    let (mut draw, mut other) = if gs1["state"]["turn"] == 0 {
        (c1, c2)
    } else {
        (c2, c1)
    };
    send_msg(&mut draw, json!({"type": "draw_card"})).await;
    let mine = read_msg_of_type(&mut draw, "card_drawn").await;
    assert!(
        mine["turn_deadline"].as_i64().unwrap_or(0) != 0,
        "card_drawn (private) missing turn_deadline: {mine}"
    );
    let theirs = read_msg_of_type(&mut other, "card_drawn").await;
    assert!(
        theirs["turn_deadline"].as_i64().unwrap_or(0) != 0,
        "card_drawn (broadcast) missing turn_deadline: {theirs}"
    );
    th.stop().await;
}

// The turn timer and the bot scheduler must keep interleaving under sustained
// pressure without deadlocking, then let the match finish. The round is ended
// on purpose by handing the bot one winning card: how long a bot takes to
// empty its own hand is not a property of this code.
#[tokio::test]
async fn turn_timer_bot_game_survives_interleaved_timeouts() {
    let mut c = debug_cfg();
    c.timings.afk_kick_threshold = 1 << 30;
    c.timings.bots.think = Duration::from_millis(10);
    c.timings.bots.jitter_max = Duration::ZERO;
    c.timings.bots.uno_delay = Duration::ZERO;
    c.timings.bots.uno_jitter_max = Duration::ZERO;
    c.timings.bots.catch_delay = Duration::ZERO;
    c.timings.bots.catch_jitter_max = Duration::ZERO;
    c.timings.bots.catch_prob = 0.0;
    c.timings.turn_timeout = Duration::from_millis(50);
    c.timings.empty_room_timeout = Duration::from_millis(80);
    let th = new_test_hub_with(c).await;
    let (mut conn, _) = bot_game(&th, "Human").await;

    // Phase 1: the interleaving itself. A gap with no traffic is a deadlock.
    const WANT_PASSES: usize = 5;
    const WANT_BOT_PLAYS: usize = 3;
    let (mut passes, mut bot_plays) = (0, 0);
    while passes < WANT_PASSES || bot_plays < WANT_BOT_PLAYS {
        let Frame::Msg(m) = next_frame(&mut conn, Duration::from_secs(5)).await else {
            panic!(
                "game went quiet after {passes} auto-passes and {bot_plays} bot plays; \
                 the timer and the bot scheduler have deadlocked"
            );
        };
        match m["type"].as_str() {
            Some("turn_changed") => passes += 1,
            Some("card_played") => bot_plays += 1,
            // The bot emptied its hand on its own: nothing left to force.
            Some("match_end") => return th.stop().await,
            _ => {}
        }
    }

    // Phase 2: one playable card, nothing pending: the bot wins on its next
    // turn whatever the deck holds.
    send_msg(
        &mut conn,
        json!({"type": "debug_set_state", "debug": {
            "hands": [{"player_index": 1, "hand": [num("red", 7)]}],
            "discard": num("red", 5),
            "active_color": "red",
            "pending_draw": 0
        }}),
    )
    .await;
    loop {
        let Frame::Msg(m) = next_frame(&mut conn, Duration::from_secs(8)).await else {
            panic!("no match_end after the bot was handed a winning card");
        };
        assert_ne!(m["type"], "error", "debug_set_state refused: {m}");
        if m["type"] == "match_end" {
            break;
        }
    }
    th.stop().await;
}

// N connections closed right after the upgrade leave no zombie clients.
#[tokio::test]
async fn immediate_close_no_zombie_client() {
    let th = new_test_hub().await;
    for _ in 0..50 {
        let c = dial_ws(&th).await;
        drop(c);
    }
    let h = th.hub.clone();
    assert!(
        eventually(Duration::from_secs(2), move || h.health().clients == 0).await,
        "zombie clients remain after immediate-close storm: {}",
        th.hub.health().clients
    );
    th.stop().await;
}

// A socket closed the instant the hub registers it: the test waits for the
// registration (the clients count reaching one) and closes on that, the race
// window seen from outside: registered, then gone at once.
#[tokio::test]
async fn register_hook_cleanup_after_immediate_close() {
    let th = new_test_hub().await;
    let conn = dial_ws(&th).await;
    let h = th.hub.clone();
    assert!(
        eventually(Duration::from_secs(2), move || h.health().clients == 1).await,
        "the client was never registered"
    );
    drop(conn);
    let h = th.hub.clone();
    assert!(
        eventually(Duration::from_secs(2), move || h.health().clients == 0).await,
        "hub retained zombie after a close right on registration: {}",
        th.hub.health().clients
    );
    th.stop().await;
}

// A wild interject never matches exactly: refused, and nobody sees a play.
#[tokio::test]
async fn interrupt_play_non_matching_card_rejected() {
    let th = new_test_hub().await;
    let TwoPlayers {
        mut alice, mut bob, ..
    } = setup_two_player_game(&th).await;
    send_msg(
        &mut bob,
        json!({"type": "interrupt_play", "card": {"color": "wild", "kind": "wild"}}),
    )
    .await;
    let e = read_msg_of_type(&mut bob, "error").await;
    assert!(
        !e["error"].as_str().unwrap_or("").is_empty(),
        "expected non-empty error for invalid interrupt"
    );
    if let Err(m) = none_of_type_within(&mut alice, "card_played", Duration::from_millis(100)).await
    {
        panic!("alice received card_played after an invalid interrupt: {m}");
    }
    th.stop().await;
}

// interrupt_play on one's own turn is refused (play_card is the door).
#[tokio::test]
async fn interrupt_play_own_turn_rejected() {
    let th = new_test_hub().await;
    let (c1, c2, gs1, gs2) = two_player_game_with_starts(&th).await;
    let (mut cur, hand) = if gs1["state"]["turn"] == gs1["state"]["your_index"] {
        (c1, gs1["state"]["hand"].clone())
    } else {
        (c2, gs2["state"]["hand"].clone())
    };
    let first = hand[0].clone();
    assert!(first.is_object(), "empty hand at the deal");
    send_msg(&mut cur, json!({"type": "interrupt_play", "card": first})).await;
    let e = read_msg_of_type(&mut cur, "error").await;
    assert!(
        !e["error"].as_str().unwrap_or("").is_empty(),
        "expected error for interrupt on own turn"
    );
    th.stop().await;
}

// The happy path: Alice plays Red-5, Carol (neither on turn nor the last to
// play) slams her own Red-5, and everybody sees interrupt_success then the play.
#[tokio::test]
async fn interrupt_play_valid_match_accepted_and_broadcast() {
    let th = new_test_hub_with(debug_cfg()).await;
    let (mut c1, mut c2, mut c3) = three_player_game(&th).await;
    let red5 = num("red", 5);
    let blue9 = num("blue", 9);
    send_msg(
        &mut c1,
        json!({"type": "debug_set_state", "debug": {
            "discard": red5,
            "hands": [
                {"player_index": 0, "hand": [red5, blue9]},
                {"player_index": 1, "hand": [blue9, blue9]},
                {"player_index": 2, "hand": [red5, blue9]}
            ],
            "pending_draw": 0,
            "current_turn": 0
        }}),
    )
    .await;
    for c in [&mut c1, &mut c2, &mut c3] {
        read_msg_of_type(c, "game_state").await;
    }

    send_msg(&mut c1, json!({"type": "play_card", "card": red5})).await;
    for c in [&mut c1, &mut c2, &mut c3] {
        read_msg_of_type(c, "card_played").await;
    }

    send_msg(&mut c3, json!({"type": "interrupt_play", "card": red5})).await;
    for c in [&mut c1, &mut c2, &mut c3] {
        read_msg_of_type(c, "interrupt_success").await;
    }
    let cp1 = read_msg_of_type(&mut c1, "card_played").await;
    read_msg_of_type(&mut c2, "card_played").await;
    read_msg_of_type(&mut c3, "card_played").await;
    assert_eq!(cp1["card"], red5, "card_played mismatch: {cp1}");
    th.stop().await;
}

// interrupt_play_card with two cards is refused (an interject is one card),
// and the same alias with one card still lands.
#[tokio::test]
async fn interrupt_play_card_batch_alias_refused() {
    let th = new_test_hub_with(debug_cfg()).await;
    let (mut c1, mut c2, mut c3) = three_player_game(&th).await;
    let red3 = num("red", 3);
    let blue9 = num("blue", 9);
    send_msg(
        &mut c1,
        json!({"type": "debug_set_state", "debug": {
            "discard": red3,
            "hands": [
                {"player_index": 0, "hand": [red3, blue9]},
                {"player_index": 1, "hand": [blue9, blue9]},
                {"player_index": 2, "hand": [red3, red3, blue9]}
            ],
            "pending_draw": 0,
            "current_turn": 0
        }}),
    )
    .await;
    for c in [&mut c1, &mut c2, &mut c3] {
        read_msg_of_type(c, "game_state").await;
    }

    send_msg(&mut c1, json!({"type": "play_card", "card": red3})).await;
    for c in [&mut c1, &mut c2, &mut c3] {
        read_msg_of_type(c, "card_played").await;
    }

    send_msg(
        &mut c3,
        json!({"type": "interrupt_play_card", "play_cards": [red3, red3]}),
    )
    .await;
    let e = read_msg_of_type(&mut c3, "error").await;
    assert_eq!(
        e["error"],
        loco_game::GameError::InterruptBatch.to_string(),
        "batch interject refusal"
    );

    send_msg(
        &mut c3,
        json!({"type": "interrupt_play_card", "play_cards": [red3]}),
    )
    .await;
    let is1 = read_msg_of_type(&mut c1, "interrupt_success").await;
    read_msg_of_type(&mut c2, "interrupt_success").await;
    read_msg_of_type(&mut c3, "interrupt_success").await;
    assert_eq!(
        is1["cards"].as_array().map_or(0, Vec::len),
        1,
        "interrupt_success cards: {is1}"
    );
    for c in [&mut c1, &mut c2, &mut c3] {
        read_msg_of_type(c, "card_played").await;
    }
    th.stop().await;
}

// A GlobalSwitch slammed as an interject rearranges every hand, and every
// client is sent its new one; the interjecter names the colour.
#[tokio::test]
async fn interrupt_play_global_switch_resends_hands() {
    let th = new_test_hub_with(debug_cfg()).await;
    let (mut c1, mut c2, mut c3) = three_player_game(&th).await;
    let gs = json!({"color": "wild", "kind": "global_switch"});
    let red3 = num("red", 3);
    let blue9 = num("blue", 9);
    let green7 = num("green", 7);
    send_msg(
        &mut c1,
        json!({"type": "debug_set_state", "debug": {
            "discard": red3,
            "hands": [
                {"player_index": 0, "hand": [gs, blue9]},
                {"player_index": 1, "hand": [green7]},
                {"player_index": 2, "hand": [gs, red3]}
            ],
            "pending_draw": 0,
            "current_turn": 0
        }}),
    )
    .await;
    for c in [&mut c1, &mut c2, &mut c3] {
        read_msg_of_type(c, "game_state").await;
    }

    // Hands rotate one seat: 0←[gs,red3], 1←[blue9], 2←[green7].
    send_msg(
        &mut c1,
        json!({"type": "play_card", "card": gs, "chosen_color": "red"}),
    )
    .await;
    for c in [&mut c1, &mut c2, &mut c3] {
        read_msg_of_type(c, "card_played").await;
    }
    for c in [&mut c1, &mut c2, &mut c3] {
        read_msg_of_type(c, "game_state").await;
    }

    // Alice slams the GlobalSwitch she just received: 0←[green7], 1←[red3],
    // 2←[blue9].
    send_msg(
        &mut c1,
        json!({"type": "interrupt_play", "card": gs, "chosen_color": "blue"}),
    )
    .await;
    for c in [&mut c1, &mut c2, &mut c3] {
        read_msg_of_type(c, "interrupt_success").await;
    }
    for c in [&mut c1, &mut c2, &mut c3] {
        read_msg_of_type(c, "card_played").await;
    }
    let st1 = read_msg_of_type(&mut c1, "game_state").await;
    let st2 = read_msg_of_type(&mut c2, "game_state").await;
    let st3 = read_msg_of_type(&mut c3, "game_state").await;
    for (st, seat, color, value) in [
        (&st1, "Alice", "green", 7),
        (&st2, "Bob", "red", 3),
        (&st3, "Carol", "blue", 9),
    ] {
        let hand = st["state"]["hand"].as_array().expect("hand");
        assert_eq!(hand.len(), 1, "{seat}: game_state hand = {hand:?}");
        assert_eq!(hand[0]["color"], color, "{seat} holds {}", hand[0]);
        assert_eq!(hand[0]["value"], value, "{seat} holds {}", hand[0]);
    }
    assert_eq!(
        st1["state"]["active_color"], "blue",
        "the interjecter names the colour"
    );
    th.stop().await;
}

// The whole catch flow: a seat plays down to one card without the call, the
// other presses Contre-LOCO!, both see uno_caught for the right seat.
#[tokio::test]
async fn catch_uno_human_catches_human() {
    let th = new_test_hub_with(debug_cfg()).await;
    let (c1, c2, gs1, gs2) = two_player_game_with_starts(&th).await;
    let (mut active, mut catcher, active_idx) =
        if gs1["state"]["turn"] == gs1["state"]["your_index"] {
            (c1, c2, i(&gs1["state"]["your_index"]))
        } else {
            (c2, c1, i(&gs2["state"]["your_index"]))
        };

    send_msg(
        &mut active,
        json!({"type": "debug_set_state", "debug": {
            "hand": [num("red", 6), num("red", 7)],
            "discard": num("red", 5),
            "pending_draw": 0
        }}),
    )
    .await;
    read_msg_of_type(&mut active, "game_state").await;
    read_msg_of_type(&mut catcher, "game_state").await;

    send_msg(
        &mut active,
        json!({"type": "play_card", "card": num("red", 7)}),
    )
    .await;
    read_msg_of_type(&mut active, "card_played").await;
    read_msg_of_type(&mut catcher, "card_played").await;

    send_msg(&mut catcher, json!({"type": "catch_uno"})).await;
    let caught1 = read_msg_of_type(&mut active, "uno_caught").await;
    read_msg_of_type(&mut catcher, "uno_caught").await;
    assert_eq!(seat_of(&caught1, "player_index"), active_idx);
    th.stop().await;
}

#[tokio::test]
async fn debug_set_state_overrides_hands_and_turn() {
    let th = new_test_hub_with(debug_cfg()).await;
    let (mut c1, mut c2, gs1, gs2) = two_player_game_with_starts(&th).await;
    let idx1 = i(&gs1["state"]["your_index"]);
    let idx2 = i(&gs2["state"]["your_index"]);
    assert_ne!(idx1, idx2, "expected distinct player indices");

    send_msg(
        &mut c1,
        json!({"type": "debug_set_state", "debug": {
            "hands": [
                {"player_index": idx1, "hand": [num("red", 1)]},
                {"player_index": idx2, "hand": [num("blue", 9), num("green", 2)]}
            ],
            "discard": num("red", 5),
            "pending_draw": 2,
            "current_turn": idx2
        }}),
    )
    .await;
    let p1 = read_msg_of_type(&mut c1, "game_state").await;
    let p2 = read_msg_of_type(&mut c2, "game_state").await;
    assert_eq!(i(&p1["state"]["turn"]), idx2);
    assert_eq!(i(&p2["state"]["turn"]), idx2);
    assert_eq!(p1["state"]["pending_draw"], 2);
    assert_eq!(p2["state"]["pending_draw"], 2);
    assert_eq!(hand_len(&p1), 1);
    assert_eq!(hand_len(&p2), 2);
    th.stop().await;
}

// The play direction can be pinned, so an E2E test reasoning about "the next
// seat" does not depend on a Reverse the bots played. Anything but ±1 is
// refused.
#[tokio::test]
async fn debug_set_state_overrides_direction() {
    let th = new_test_hub_with(debug_cfg()).await;
    let TwoPlayers {
        mut alice, mut bob, ..
    } = setup_two_player_game(&th).await;

    send_msg(
        &mut alice,
        json!({"type": "debug_set_state", "debug": {"direction": -1}}),
    )
    .await;
    let p1 = read_msg_of_type(&mut alice, "game_state").await;
    let p2 = read_msg_of_type(&mut bob, "game_state").await;
    assert_eq!(p1["state"]["direction"], -1);
    assert_eq!(p2["state"]["direction"], -1);

    send_msg(
        &mut alice,
        json!({"type": "debug_set_state", "debug": {"direction": 1}}),
    )
    .await;
    let b1 = read_msg_of_type(&mut alice, "game_state").await;
    read_msg_of_type(&mut bob, "game_state").await;
    assert_eq!(b1["state"]["direction"], 1);

    send_msg(
        &mut alice,
        json!({"type": "debug_set_state", "debug": {"direction": 2}}),
    )
    .await;
    let e = read_msg_of_type(&mut alice, "error").await;
    assert!(
        !e["error"].as_str().unwrap_or("").is_empty(),
        "expected an error for a bogus direction"
    );
    th.stop().await;
}

/// A human against one bot whose own turn will not come in this test, its
/// catch armed fast and certain.
fn catching_bot_cfg(catch_delay: Duration) -> HubConfig {
    let mut c = debug_cfg();
    c.timings.bots.think = Duration::from_secs(30);
    c.timings.bots.catch_delay = catch_delay;
    c.timings.bots.catch_jitter_max = Duration::ZERO;
    c.timings.bots.catch_prob = 1.0;
    c
}

// A bot catches a human who plays down to one card without the call.
//
// The turn is pinned to the human through debug_set_state, so the deal giving
// the bot the first turn never skips the test.
#[tokio::test]
async fn bot_catch_within_window() {
    let th = new_test_hub_with(catching_bot_cfg(Duration::from_millis(10))).await;
    let (mut conn, gs) = bot_game(&th, "Alice").await;
    let me = i(&gs["state"]["your_index"]);

    send_msg(
        &mut conn,
        json!({"type": "debug_set_state", "debug": {
            "hand": [num("red", 6), num("red", 7)],
            "discard": num("red", 5),
            "pending_draw": 0,
            "current_turn": me
        }}),
    )
    .await;
    read_msg_of_type(&mut conn, "game_state").await;

    send_msg(
        &mut conn,
        json!({"type": "play_card", "card": num("red", 7)}),
    )
    .await;
    read_msg_of_type(&mut conn, "card_played").await;

    let caught = read_msg_of_type(&mut conn, "uno_caught").await;
    assert_eq!(seat_of(&caught, "player_index"), me, "{caught}");
    th.stop().await;
}

// A bot catch scheduled before the human's declaration is discarded once the
// declaration lands: no uno_caught after uno_declared.
//
// Same deterministic turn pin as above.
#[tokio::test]
async fn bot_catch_stale_callback_ignored_after_declared() {
    let th = new_test_hub_with(catching_bot_cfg(Duration::from_millis(300))).await;
    let (mut conn, gs) = bot_game(&th, "Alice").await;
    let me = i(&gs["state"]["your_index"]);

    send_msg(
        &mut conn,
        json!({"type": "debug_set_state", "debug": {
            "hand": [num("red", 6), num("red", 7)],
            "discard": num("red", 5),
            "pending_draw": 0,
            "current_turn": me
        }}),
    )
    .await;
    read_msg_of_type(&mut conn, "game_state").await;

    send_msg(
        &mut conn,
        json!({"type": "play_card", "card": num("red", 7)}),
    )
    .await;
    read_msg_of_type(&mut conn, "card_played").await;
    send_msg(&mut conn, json!({"type": "declare_uno"})).await;
    read_msg_of_type(&mut conn, "uno_declared").await;

    // Well past the 300 ms catch, which must have found nothing.
    if let Err(m) = none_of_type_within(&mut conn, "uno_caught", Duration::from_millis(1500)).await
    {
        panic!("spurious uno_caught after the player already declared: {m}");
    }
    th.stop().await;
}

// A bot's LOCO! is declared when it is announced, not when its card lands, so
// the announce delay is a real window a human can catch it in; and a caught
// bot never announces afterwards.
#[tokio::test]
async fn bot_uno_catchable_during_announce_delay() {
    let mut c = debug_cfg();
    c.timings.bots.think = Duration::from_millis(20);
    c.timings.bots.jitter_max = Duration::ZERO;
    c.timings.bots.uno_delay = Duration::from_secs(2);
    c.timings.bots.uno_jitter_max = Duration::ZERO;
    c.timings.bots.catch_prob = 0.0;
    let uno_delay = c.timings.bots.uno_delay;
    let th = new_test_hub_with(c).await;
    let (mut conn, gs) = bot_game(&th, "Alice").await;
    let alice = i(&gs["state"]["your_index"]);
    let bot = 1 - alice;

    send_msg(
        &mut conn,
        json!({"type": "debug_set_state", "debug": {
            "hands": [
                {"player_index": bot, "hand": [num("red", 6), num("red", 7)]},
                {"player_index": alice, "hand": [num("red", 4), num("blue", 2), num("green", 3)]}
            ],
            "discard": num("red", 5),
            "active_color": "red",
            "pending_draw": 0,
            "current_turn": alice
        }}),
    )
    .await;
    read_msg_of_type(&mut conn, "game_state").await;

    send_msg(
        &mut conn,
        json!({"type": "play_card", "card": num("red", 4)}),
    )
    .await;

    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        assert!(Instant::now() < deadline, "bot never played");
        let m = read_msg_of_type(&mut conn, "card_played").await;
        if seat_of(&m, "player_index") == bot {
            break;
        }
    }

    send_msg(&mut conn, json!({"type": "catch_uno", "target_index": bot})).await;
    let caught = read_msg_of_type(&mut conn, "uno_caught").await;
    assert_eq!(
        seat_of(&caught, "player_index"),
        bot,
        "uno_caught must name the caught bot: {caught}"
    );

    // The swallowed announcement must not resurface.
    let wait = uno_delay + Duration::from_millis(500);
    let end = Instant::now() + wait;
    loop {
        let left = end.saturating_duration_since(Instant::now());
        if left.is_zero() {
            break;
        }
        match next_frame(&mut conn, left).await {
            Frame::Msg(m) => assert!(
                !(m["type"] == "uno_declared" && seat_of(&m, "player_index") == bot),
                "bot announced LOCO! after being caught: {m}"
            ),
            Frame::Timeout | Frame::Closed => break,
        }
    }
    th.stop().await;
}

// The host leaving a lobby re-bases the seats so the first remaining player is
// the new host (seat 0) and can deal.
#[tokio::test]
async fn lobby_host_disconnect_new_host_can_start_game() {
    let th = new_test_hub().await;
    let (mut c1, created) = create(&th, "Alice").await;
    let code = code_of(&created);
    let (mut c2, bob_joined) = join(&th, &code, "Bob").await;
    assert_eq!(seat_of(&bob_joined, "player_id"), 1);
    read_msg_of_type(&mut c1, "player_joined").await;
    let (mut c3, _) = join(&th, &code, "Carol").await;
    read_msg_of_type(&mut c1, "player_joined").await;
    read_msg_of_type(&mut c2, "player_joined").await;

    drop(c1);
    let left = read_msg_of_type(&mut c2, "player_left").await;
    assert_eq!(left["nickname"], "Alice");
    read_msg_of_type(&mut c3, "player_left").await;

    send_msg(&mut c2, json!({"type": "start_game"})).await;
    let gs = read_msg_of_type(&mut c2, "game_started").await;
    assert!(
        gs["state"].is_object(),
        "game_started missing state — host promotion failed"
    );
    assert_eq!(gs["state"]["your_index"], 0, "Bob is the new host");
    assert_eq!(
        gs["state"]["players"].as_array().map_or(0, Vec::len),
        2,
        "Alice should have been removed"
    );
    let carol = read_msg_of_type(&mut c3, "game_started").await;
    complete_map_load(&mut [&mut c2, &mut c3]).await;
    assert_eq!(carol["state"]["your_index"], 1);
    th.stop().await;
}

// A lobby left with only bots in it is cleaned up, not left as a zombie.
#[tokio::test]
async fn lobby_host_disconnect_bots_only_triggers_cleanup() {
    let th = new_test_hub_fast_cleanup(Duration::from_millis(80)).await;
    let (mut c, _) = create(&th, "Alice").await;
    send_msg(&mut c, json!({"type": "add_bot"})).await;
    read_msg_of_type(&mut c, "player_joined").await;
    assert_eq!(th.hub.health().rooms, 1);

    drop(c);
    tokio::time::sleep(Duration::from_millis(200)).await;
    let h = th.hub.clone();
    assert!(
        eventually(Duration::from_millis(500), move || h.health().rooms == 0).await,
        "rooms after a host-with-bots disconnect = {}, want 0",
        th.hub.health().rooms
    );
    th.stop().await;
}

// The reload bug: the host adds a bot and reloads. The bot must not slide into
// seat 0, which is the whole definition of the host.
#[tokio::test]
async fn lobby_reload_bot_does_not_keep_the_host_seat() {
    let th = new_test_hub().await;
    let (mut c, created) = create(&th, "Alice").await;
    let code = code_of(&created);
    send_msg(&mut c, json!({"type": "add_bot"})).await;
    read_msg_of_type(&mut c, "player_joined").await;

    drop(c);
    wait_for_clients(&th.hub, 0).await;

    let (mut back, joined) = join(&th, &code, "Alice").await;
    assert_eq!(
        seat_of(&joined, "player_id"),
        0,
        "the bot must not hold the host seat"
    );
    let players = joined["players"].as_array().expect("players");
    assert_eq!(players.len(), 2, "roster {players:?}");
    assert_eq!(players[0]["nickname"], "Alice", "roster {players:?}");

    send_msg(&mut back, json!({"type": "start_game"})).await;
    let gs = read_msg_of_type(&mut back, "game_started").await;
    assert!(gs["state"].is_object(), "the host seat did not come back");
    th.stop().await;
}

// A bot between the leaving host and the next human never becomes the host by
// re-indexing.
#[tokio::test]
async fn lobby_host_disconnect_bot_never_inherits_the_seat() {
    let th = new_test_hub().await;
    let (mut c1, created) = create(&th, "Alice").await;
    let code = code_of(&created);
    send_msg(&mut c1, json!({"type": "add_bot"})).await;
    read_msg_of_type(&mut c1, "player_joined").await;

    let (mut c2, joined) = join(&th, &code, "Bob").await;
    assert_eq!(seat_of(&joined, "player_id"), 2, "Bob's seat");
    read_msg_of_type(&mut c1, "player_joined").await;

    drop(c1);
    let left = read_msg_of_type(&mut c2, "player_left").await;
    let players = left["players"].as_array().expect("players");
    assert_eq!(players.len(), 2, "roster {players:?}");
    assert_eq!(players[0]["nickname"], "Bob", "roster {players:?}");

    send_msg(&mut c2, json!({"type": "start_game"})).await;
    let gs = read_msg_of_type(&mut c2, "game_started").await;
    assert!(gs["state"].is_object(), "the bot inherited the host seat");
    th.stop().await;
}

// The round-winning card_played must carry the card actually played, not the
// next round's opening card; round_end follows, then the next deal.
#[tokio::test]
async fn round_transition_card_played_reflects_winning_play() {
    let th = new_test_hub_with(debug_cfg()).await;
    let (mut c1, mut c2) = lobby_of_two(&th).await;
    send_msg(
        &mut c1,
        json!({"type": "set_match_format", "match_format": "BO3"}),
    )
    .await;
    read_msg_of_type(&mut c1, "lobby_config_changed").await;
    read_msg_of_type(&mut c2, "lobby_config_changed").await;

    send_msg(&mut c1, json!({"type": "start_game"})).await;
    let gs1 = read_msg_of_type(&mut c1, "game_started").await;
    read_msg_of_type(&mut c2, "game_started").await;
    complete_map_load(&mut [&mut c1, &mut c2]).await;
    assert!(gs1["state"].is_object());

    let win = num("red", 7);
    send_msg(
        &mut c1,
        json!({"type": "debug_set_state", "debug": {
            "hand": [win],
            "discard": num("red", 7),
            "pending_draw": 0,
            "current_turn": 0
        }}),
    )
    .await;
    read_msg_of_type(&mut c1, "game_state").await;
    read_msg_of_type(&mut c2, "game_state").await;

    declare_before_winning(&mut c1).await;
    send_msg(&mut c1, json!({"type": "play_card", "card": win})).await;

    let played = read_msg_of_type(&mut c1, "card_played").await;
    assert_eq!(
        played["card"], win,
        "card_played reported the wrong card after the winning play"
    );
    assert_eq!(seat_of(&played, "player_index"), 0);

    let re = read_msg_of_type(&mut c1, "round_end").await;
    assert_eq!(re["round_number"], 1);
    assert_eq!(re["round_winner"], "Alice");

    let next = read_msg_of_type(&mut c1, "game_started").await;
    assert_eq!(next["state"]["round_number"], 2);
    assert_eq!(hand_len(&next), 8);
    th.stop().await;
}

// 30 messages over a 20-token bucket: exactly one rate-limit notice, and the
// metric counts every dropped message.
#[tokio::test]
async fn rate_limit_burst_then_error() {
    let th = new_test_hub().await;
    let (mut c, _) = create(&th, "Alice").await;
    const BURST: i64 = 30;
    for _ in 0..BURST {
        send_msg(&mut c, json!({"type": "unknown_msg_type"})).await;
    }
    let (mut rate_limited, mut unknown) = (0, 0);
    let end = Instant::now() + Duration::from_secs(2);
    while Instant::now() < end {
        let Frame::Msg(m) = next_frame(&mut c, Duration::from_millis(300)).await else {
            break;
        };
        if m["type"] != "error" {
            continue;
        }
        let e = m["error"].as_str().unwrap_or("");
        if e.contains("rate limit") {
            rate_limited += 1;
        } else if e.contains("unknown message") {
            unknown += 1;
        }
    }
    assert!(
        rate_limited >= 1,
        "expected a rate-limit error after a {BURST}-message burst (unknown={unknown})"
    );
    assert!(
        rate_limited <= 1,
        "got {rate_limited} rate-limit notices for one burst, want exactly 1"
    );
    let got = th.hub.metrics_stats().messages_rate_limited;
    assert!(
        got >= BURST - 20,
        "messages_rate_limited = {got} after a {BURST}-message burst, want >= {}",
        BURST - 20
    );
    th.stop().await;
}

// `LOCO_E2E` is read once, as `HubConfig::debug_mode`. Two hubs, one each way.
#[tokio::test]
async fn metrics_debug_mode_flag() {
    let off = new_test_hub().await;
    assert!(!off.hub.metrics_stats().debug_mode_active);
    assert_eq!(get_metric(&off, "debug_mode_active").await, 0.0);
    off.stop().await;

    let on = new_test_hub_with(debug_cfg()).await;
    assert!(on.hub.metrics_stats().debug_mode_active);
    assert_eq!(get_metric(&on, "debug_mode_active").await, 1.0);
    on.stop().await;
}

// A human who lets the turn clock run out AFK-threshold times in a row is told
// afk_kicked and dropped.
#[tokio::test]
async fn afk_kicks_after_consecutive_timeouts() {
    let mut c = HubConfig::default();
    c.timings.turn_timeout = Duration::from_millis(30);
    c.timings.afk_kick_threshold = 2;
    c.timings.bots.think = Duration::from_millis(5);
    c.timings.bots.jitter_max = Duration::ZERO;
    c.timings.bots.catch_prob = 0.0;
    let th = new_test_hub_with(c).await;
    let (mut conn, _) = bot_game(&th, "Idler").await;

    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        assert!(
            Instant::now() < deadline,
            "timed out waiting for the AFK kick"
        );
        match next_frame(&mut conn, Duration::from_millis(500)).await {
            Frame::Closed => break, // the expected end state after the kick
            Frame::Timeout => {}
            Frame::Msg(m) => {
                if m["type"] == "error" && m["error"] == "afk_kicked" {
                    break;
                }
                assert_ne!(
                    m["type"], "match_end",
                    "match ended before the AFK kick fired"
                );
            }
        }
    }
    th.stop().await;
}

// card_played for a Swap carries the target seat.
#[tokio::test]
async fn play_card_swap_broadcasts_chosen_player() {
    let th = new_test_hub_with(debug_cfg()).await;
    let (c1, c2, gs1, gs2) = two_player_game_with_starts(&th).await;
    let (mut active, mut observer, active_idx, target_idx) =
        if gs1["state"]["turn"] == gs1["state"]["your_index"] {
            (
                c1,
                c2,
                i(&gs1["state"]["your_index"]),
                i(&gs2["state"]["your_index"]),
            )
        } else {
            (
                c2,
                c1,
                i(&gs2["state"]["your_index"]),
                i(&gs1["state"]["your_index"]),
            )
        };
    let swap = json!({"color": "red", "kind": "swap"});
    send_msg(
        &mut active,
        json!({"type": "debug_set_state", "debug": {
            "hand": [swap],
            "discard": num("red", 5),
            "active_color": "red",
            "pending_draw": 0,
            "current_turn": active_idx
        }}),
    )
    .await;
    read_msg_of_type(&mut active, "game_state").await;
    read_msg_of_type(&mut observer, "game_state").await;

    // The swap is the seat's only card, so it owes the call first.
    declare_before_winning(&mut active).await;
    send_msg(
        &mut active,
        json!({"type": "play_card", "card": swap, "chosen_player": target_idx}),
    )
    .await;
    for c in [&mut active, &mut observer] {
        let cp = read_msg_of_type(c, "card_played").await;
        assert_eq!(cp["card"]["kind"], "swap", "{cp}");
        assert!(
            cp.get("chosen_player").is_some(),
            "card_played missing chosen_player for swap: {cp}"
        );
        assert_eq!(i(&cp["chosen_player"]), target_idx);
    }
    th.stop().await;
}

// chosen_player is absent on an ordinary play.
#[tokio::test]
async fn play_card_non_swap_omits_chosen_player() {
    let th = new_test_hub_with(debug_cfg()).await;
    let (c1, c2, gs1, gs2) = two_player_game_with_starts(&th).await;
    let (mut active, mut observer, active_idx) =
        if gs1["state"]["turn"] == gs1["state"]["your_index"] {
            (c1, c2, i(&gs1["state"]["your_index"]))
        } else {
            (c2, c1, i(&gs2["state"]["your_index"]))
        };
    send_msg(
        &mut active,
        json!({"type": "debug_set_state", "debug": {
            "hand": [num("red", 7), num("blue", 9)],
            "discard": num("red", 5),
            "active_color": "red",
            "pending_draw": 0,
            "current_turn": active_idx
        }}),
    )
    .await;
    read_msg_of_type(&mut active, "game_state").await;
    read_msg_of_type(&mut observer, "game_state").await;

    send_msg(
        &mut active,
        json!({"type": "play_card", "card": num("red", 7)}),
    )
    .await;
    for c in [&mut active, &mut observer] {
        let cp = read_msg_of_type(c, "card_played").await;
        assert!(
            cp.get("chosen_player").is_none(),
            "chosen_player should be absent for a non-swap: {cp}"
        );
    }
    th.stop().await;
}

// card_played carries the direction after the card's effect.
#[tokio::test]
async fn play_card_direction_in_payload() {
    let th = new_test_hub_with(debug_cfg()).await;
    let (mut c1, mut c2, mut c3) = three_player_game(&th).await;
    let red5 = num("red", 5);
    let red_reverse = json!({"color": "red", "kind": "reverse"});
    let red7 = num("red", 7);
    send_msg(
        &mut c1,
        json!({"type": "debug_set_state", "debug": {
            "discard": red5,
            "active_color": "red",
            "hands": [
                {"player_index": 0, "hand": [red_reverse, red7]},
                {"player_index": 1, "hand": [red5, red5]},
                {"player_index": 2, "hand": [red5, red5]}
            ],
            "pending_draw": 0,
            "current_turn": 0
        }}),
    )
    .await;
    for c in [&mut c1, &mut c2, &mut c3] {
        read_msg_of_type(c, "game_state").await;
    }

    send_msg(&mut c1, json!({"type": "play_card", "card": red_reverse})).await;
    for c in [&mut c1, &mut c2, &mut c3] {
        let cp = read_msg_of_type(c, "card_played").await;
        assert_eq!(cp["direction"], -1, "after Reverse: {cp}");
    }

    // Seat 2 is next going counter-clockwise; a number keeps the direction.
    send_msg(&mut c3, json!({"type": "play_card", "card": red5})).await;
    for c in [&mut c1, &mut c2, &mut c3] {
        let cp = read_msg_of_type(c, "card_played").await;
        assert_eq!(cp["direction"], -1, "after a number: {cp}");
    }
    th.stop().await;
}

fn latency_cfg() -> HubConfig {
    let mut c = HubConfig::default();
    c.timings.latency_broadcast_period = Duration::from_millis(40);
    c.timings.ping_period = Duration::from_millis(20);
    c
}

// The ping column is fed by a broadcast nobody asks for, so its shape (one
// entry per seat, bots flagged, unmeasured seats at -1) is the whole contract.
#[tokio::test]
async fn latency_broadcast_one_entry_per_seat() {
    let th = new_test_hub_with(latency_cfg()).await;
    let (mut c1, mut c2) = lobby_of_two(&th).await;
    send_msg(&mut c1, json!({"type": "add_bot"})).await;
    read_msg_of_type(&mut c1, "player_joined").await;
    send_msg(&mut c1, json!({"type": "start_game"})).await;
    read_msg_of_type(&mut c1, "game_started").await;
    complete_map_load(&mut [&mut c1, &mut c2]).await;

    let m = read_msg_of_type(&mut c1, "latency").await;
    let l = m["latencies"].as_array().expect("latencies");
    assert_eq!(l.len(), 3, "want one entry per seat: {l:?}");
    for (n, e) in l.iter().enumerate() {
        assert_eq!(i(&e["player_index"]), n as i64, "entry {n}: {e}");
    }
    assert_eq!(l[2]["bot"], true, "seat 2 is a bot and must be flagged");
    assert_eq!(l[2]["rtt_ms"], -1, "a bot has no connection to measure");
    assert!(
        i(&l[0]["rtt_ms"]) >= 0 || i(&l[1]["rtt_ms"]) >= 0,
        "no human seat measured: {l:?}"
    );
    for n in [0, 1] {
        assert_ne!(l[n]["bot"], true, "human seat {n} flagged as a bot");
    }
    th.stop().await;
}

// A lobby has nothing to show a ping next to.
#[tokio::test]
async fn latency_broadcast_not_sent_in_lobby() {
    let th = new_test_hub_with(latency_cfg()).await;
    let (mut c, _) = create(&th, "Alice").await;
    if let Err(m) = none_of_type_within(&mut c, "latency", Duration::from_millis(300)).await {
        panic!("latency broadcast sent to a room still in the lobby: {m}");
    }
    th.stop().await;
}

// The event log rides the reconnect snapshot only.
#[tokio::test]
async fn event_log_only_on_reconnect_snapshot() {
    let th = new_test_hub().await;
    let TwoPlayers {
        mut alice,
        bob,
        code,
        tokens,
    } = setup_two_player_game(&th).await;
    drop(bob);
    read_msg_of_type(&mut alice, "player_disconnected").await;

    let mut bob2 = dial_ws(&th).await;
    send_msg(
        &mut bob2,
        json!({"type": "join_room", "nickname": "Bob", "room_code": code, "session_token": tokens[1]}),
    )
    .await;
    let m = read_msg_of_type(&mut bob2, "player_reconnected").await;
    assert!(
        m["state"].is_object(),
        "expected game state in reconnect message"
    );
    assert!(
        m["state"]["event_log"]
            .as_array()
            .is_some_and(|a| !a.is_empty()),
        "the reconnect snapshot carries no event log: {}",
        m["state"]
    );
    th.stop().await;
}

#[tokio::test]
async fn event_log_absent_from_broadcast_game_state() {
    let th = new_test_hub().await;
    let (_c1, _c2, started, _) = two_player_game_with_starts(&th).await;
    assert!(started["state"].is_object());
    assert_eq!(
        started["state"]["event_log"].as_array().map_or(0, Vec::len),
        0,
        "game_started carries an event log; the log is reconnect-only"
    );
    th.stop().await;
}

// The wager: the target's LOCO! reached the hub first, so the call is refused
// and charged one card; the target is untouched.
#[tokio::test]
async fn catch_uno_failed_catch_costs_a_card() {
    let th = new_test_hub_with(debug_cfg()).await;
    let (c1, c2, gs1, gs2) = two_player_game_with_starts(&th).await;
    let (mut active, mut catcher, active_idx, catcher_idx, catcher_hand) =
        if gs1["state"]["turn"] == gs1["state"]["your_index"] {
            (
                c1,
                c2,
                i(&gs1["state"]["your_index"]),
                i(&gs2["state"]["your_index"]),
                hand_len(&gs2),
            )
        } else {
            (
                c2,
                c1,
                i(&gs2["state"]["your_index"]),
                i(&gs1["state"]["your_index"]),
                hand_len(&gs1),
            )
        };

    send_msg(
        &mut active,
        json!({"type": "debug_set_state", "debug": {
            "hand": [num("red", 6), num("red", 7)],
            "discard": num("red", 5),
            "pending_draw": 0
        }}),
    )
    .await;
    read_msg_of_type(&mut active, "game_state").await;
    read_msg_of_type(&mut catcher, "game_state").await;

    send_msg(
        &mut active,
        json!({"type": "play_card", "card": num("red", 7)}),
    )
    .await;
    read_msg_of_type(&mut active, "card_played").await;
    read_msg_of_type(&mut catcher, "card_played").await;

    send_msg(&mut active, json!({"type": "declare_uno"})).await;
    read_msg_of_type(&mut active, "uno_declared").await;
    read_msg_of_type(&mut catcher, "uno_declared").await;

    send_msg(
        &mut catcher,
        json!({"type": "catch_uno", "target_index": active_idx}),
    )
    .await;

    let failed = read_msg_of_type(&mut catcher, "catch_failed").await;
    assert_eq!(seat_of(&failed, "player_index"), catcher_idx);
    let seen = read_msg_of_type(&mut active, "catch_failed").await;
    assert_eq!(seat_of(&seen, "player_index"), catcher_idx);

    let drawn = read_msg_of_type(&mut catcher, "card_drawn").await;
    assert_eq!(
        drawn["cards"].as_array().map_or(0, Vec::len),
        1,
        "the catcher is handed the penalty card itself: {drawn}"
    );
    assert_eq!(seat_of(&drawn, "player_index"), catcher_idx);

    send_msg(&mut catcher, json!({"type": "debug_set_state"})).await;
    let st = read_msg_of_type(&mut catcher, "game_state").await;
    assert_eq!(hand_len(&st), catcher_hand + 1, "catcher hand");
    for p in st["state"]["players"].as_array().into_iter().flatten() {
        if i(&p["index"]) == active_idx {
            assert_eq!(p["hand_size"], 1, "a missed catch never touches its target");
        }
    }
    th.stop().await;
}
