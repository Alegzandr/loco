//! Helpers shared by the ported matchmaking, solo, rematch, match history,
//! walk-out, expiry and abandoned-table tests. Each test file uses a subset.

#![allow(dead_code)]
#![allow(clippy::field_reassign_with_default)] // a test narrows one knob of the default config

use loco_hub::HubConfig;
use loco_hub::testkit::*;
use serde_json::{Value, json};
use std::time::Duration;

/// A config with `debug_set_state` reachable (Go's `t.Setenv("LOCO_E2E", "1")`).
pub fn debug_cfg() -> HubConfig {
    let mut c = HubConfig::default();
    c.debug_mode = true;
    c
}

/// Go's `shortReveal`: the versus screen collapsed to 30 ms.
pub fn short_reveal(c: &mut HubConfig) {
    c.timings.matchmaking.reveal_delay = Duration::from_millis(30);
}

/// Go's `shortReconnectHold`.
pub fn short_reconnect_hold(c: &mut HubConfig, d: Duration) {
    c.timings.reconnect_timeout = d;
}

/// `find_match`, and the acknowledgement read back. Go's `queueUp`.
pub async fn queue_up(th: &TestHub, nickname: &str) -> Ws {
    let mut ws = dial_ws(th).await;
    send_msg(&mut ws, json!({"type": "find_match", "nickname": nickname})).await;
    read_msg_of_type(&mut ws, "matchmaking_queued").await;
    ws
}

/// Queues two players and takes them through to an open table. Go's
/// `pairedMatch`.
pub async fn paired_match(th: &TestHub) -> (Ws, Ws) {
    let mut a = queue_up(th, "Alice").await;
    let mut b = queue_up(th, "Bob").await;
    read_msg_of_type(&mut a, "match_found").await;
    read_msg_of_type(&mut b, "match_found").await;
    read_msg_of_type(&mut a, "game_started").await;
    read_msg_of_type(&mut b, "game_started").await;
    complete_map_load(&mut [&mut a, &mut b]).await;
    (a, b)
}

/// `read_msg_of_type` with room for the traffic a few auto-played turns
/// produce. Go's `waitForType`.
pub async fn wait_for_type(ws: &mut Ws, typ: &str, limit: usize) -> Value {
    for _ in 0..limit {
        let m = read_msg(ws).await;
        if m["type"] == typ {
            return m;
        }
    }
    panic!("did not receive {typ:?} within {limit} messages");
}

pub fn card(color: &str, value: i64) -> Value {
    json!({"color": color, "kind": "number", "value": value})
}

/// Plays seat 0 down to an empty hand through the debug seam (a BO1 match
/// ends with it). Go's `finishRoundForSeat`.
pub async fn finish_round_for_seat(winner: &mut Ws, other: &mut Ws) {
    send_msg(
        winner,
        json!({"type": "debug_set_state", "debug": {
            "hands": [
                {"player_index": 0, "hand": [card("red", 5)]},
                {"player_index": 1, "hand": [card("blue", 9)]}
            ],
            "discard": card("red", 3),
            "active_color": "red",
            "pending_draw": 0,
            "current_turn": 0,
            "direction": 1
        }}),
    )
    .await;
    read_msg_of_type(winner, "game_state").await;
    declare_before_winning(winner).await;
    send_msg(winner, json!({"type": "play_card", "card": card("red", 5)})).await;
    read_msg_of_type(winner, "match_end").await;
    read_msg_of_type(other, "match_end").await;
}

/// Hands the host a single playable card on their turn and plays it, ending a
/// BO1 match; returns the host's `match_end`. Go's `winMatchFromHostTurn` /
/// `winMatchReturningEnd`. The hub must be on `debug_cfg()`.
pub async fn win_match_from_host_turn(host: &mut Ws, others: &mut [&mut Ws]) -> Value {
    send_msg(
        host,
        json!({"type": "debug_set_state", "debug": {
            "hand": [card("red", 7)],
            "discard": card("red", 7),
            "pending_draw": 0,
            "current_turn": 0
        }}),
    )
    .await;
    read_msg_of_type(host, "game_state").await;
    for c in others.iter_mut() {
        read_msg_of_type(c, "game_state").await;
    }
    declare_before_winning(host).await;
    send_msg(host, json!({"type": "play_card", "card": card("red", 7)})).await;
    let end = read_msg_of_type(host, "match_end").await;
    for c in others.iter_mut() {
        read_msg_of_type(c, "match_end").await;
    }
    end
}

/// Seats `names` at one table and deals; the first is the host. Returns the
/// sockets, the code and every session token. Go's `openTable`.
pub async fn open_table(th: &TestHub, names: &[&str]) -> (Vec<Ws>, String, Vec<String>) {
    let mut host = dial_ws(th).await;
    send_msg(
        &mut host,
        json!({"type": "create_room", "nickname": names[0]}),
    )
    .await;
    let created = read_msg_of_type(&mut host, "room_created").await;
    let code = created["room_code"].as_str().unwrap().to_owned();
    let mut tokens = vec![created["session_token"].as_str().unwrap_or("").to_owned()];
    let mut conns = vec![host];
    for name in &names[1..] {
        let mut c = dial_ws(th).await;
        send_msg(
            &mut c,
            json!({"type": "join_room", "nickname": name, "room_code": code}),
        )
        .await;
        let joined = read_msg_of_type(&mut c, "room_joined").await;
        tokens.push(joined["session_token"].as_str().unwrap_or("").to_owned());
        for seated in conns.iter_mut() {
            read_msg_of_type(seated, "player_joined").await;
        }
        conns.push(c);
    }
    send_msg(&mut conns[0], json!({"type": "start_game"})).await;
    for c in conns.iter_mut() {
        read_msg_of_type(c, "game_started").await;
    }
    let mut refs: Vec<&mut Ws> = conns.iter_mut().collect();
    complete_map_load(&mut refs).await;
    (conns, code, tokens)
}

/// A table of `names` dealt and won by the host. Go's `winBO1` (two names),
/// `winBO1AtThree` / `winBO1WithThree` / `finishedTableOfThree` (three).
pub async fn won_table(th: &TestHub, names: &[&str]) -> (Vec<Ws>, String, Vec<String>) {
    let (mut conns, code, tokens) = open_table(th, names).await;
    let (host, rest) = conns.split_first_mut().unwrap();
    let mut others: Vec<&mut Ws> = rest.iter_mut().collect();
    win_match_from_host_turn(host, &mut others).await;
    (conns, code, tokens)
}

/// Whether a fresh socket is told this code does not exist. Go's `roomGone`.
pub async fn room_gone(th: &TestHub, code: &str) -> bool {
    let mut probe = dial_ws(th).await;
    send_msg(
        &mut probe,
        json!({"type": "join_room", "nickname": "Probe", "room_code": code}),
    )
    .await;
    let m = read_msg_of_type(&mut probe, "error").await;
    m["error"] == "room not found"
}

/// Polls `room_gone` until it holds or `budget` passes. Go's `waitFor` around
/// `roomGone`.
pub async fn wait_room_gone(th: &TestHub, code: &str, budget: Duration) -> bool {
    let deadline = tokio::time::Instant::now() + budget;
    loop {
        if room_gone(th, code).await {
            return true;
        }
        if tokio::time::Instant::now() >= deadline {
            return false;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

/// Reads until a message of `typ` arrives (true) or `within` passes (false).
/// Go's `drainUntil`.
pub async fn drain_until(ws: &mut Ws, typ: &str, within: Duration) -> bool {
    let end = tokio::time::Instant::now() + within;
    loop {
        let now = tokio::time::Instant::now();
        if now >= end {
            return false;
        }
        let wait = (end - now).min(Duration::from_millis(500));
        match tokio::time::timeout(wait, read_raw(ws)).await {
            Ok(m) if m["type"] == typ => return true,
            Ok(_) => continue,
            Err(_) => {
                if tokio::time::Instant::now() >= end {
                    return false;
                }
            }
        }
    }
}

/// A seat's `connected` flag in a roster, and whether the seat is in it at
/// all. Go's `seatConnected`.
pub fn seat_connected(players: &Value, seat: i64) -> (bool, bool) {
    for p in players.as_array().into_iter().flatten() {
        if p["index"].as_i64() == Some(seat) {
            return (p["connected"].as_bool().unwrap_or(false), true);
        }
    }
    (false, false)
}

pub fn len_of(v: &Value) -> usize {
    v.as_array().map_or(0, Vec::len)
}

pub fn ints(v: &Value) -> Vec<i64> {
    v.as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_i64)
        .collect()
}
