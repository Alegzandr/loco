//! Hardening: the refusals that stand between a stranger with a socket and this
//! process. Every test here is a security property, not a game rule: send
//! something no honest client sends, and assert the server answers rather than
//! dies, grows or tells.

#![allow(clippy::field_reassign_with_default)] // a test narrows one knob of the default config

use loco_hub::HubConfig;
use loco_hub::testkit::*;
use serde_json::{Value, json};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

async fn create(th: &TestHub, nickname: &str) -> (Ws, Value) {
    let mut ws = dial_ws(th).await;
    send_msg(
        &mut ws,
        json!({"type": "create_room", "nickname": nickname}),
    )
    .await;
    let created = read_msg_of_type(&mut ws, "room_created").await;
    (ws, created)
}

// --- A gameplay message at a table that has not dealt ---
//
// The room's state is empty in a lobby, and two frames (create_room then
// draw_card) used to take the event loop down with every match on it. The gate
// in dispatch is the fix; these are the vectors that found it.
#[tokio::test]
async fn gameplay_message_in_lobby_is_refused() {
    let cases = [
        ("draw_card", json!({"type": "draw_card"})),
        ("catch_uno", json!({"type": "catch_uno", "target_index": 0})),
        ("catch_uno without a target", json!({"type": "catch_uno"})),
        ("pass_turn", json!({"type": "pass_turn"})),
        ("declare_uno", json!({"type": "declare_uno"})),
        ("interrupt_play", json!({"type": "interrupt_play"})),
    ];
    for (name, msg) in cases {
        let th = new_test_hub().await;
        let (mut ws, _) = create(&th, "Auditeur").await;

        send_msg(&mut ws, msg).await;
        let got = read_msg(&mut ws).await;
        assert_eq!(got["type"], "error", "{name}: expected an error, got {got}");

        // The hub is still answering, which is the half a panic would fail.
        send_msg(&mut ws, json!({"type": "add_bot"})).await;
        read_msg_of_type(&mut ws, "player_joined").await;
        th.stop().await;
    }
}

// --- A panic in a handler must cost one message, not the server ---
#[tokio::test]
async fn dispatch_panic_does_not_kill_the_hub() {
    let th = new_test_hub().await;
    let armed = Arc::new(AtomicBool::new(true));
    let flag = armed.clone();
    th.hub.set_dispatch_probe(move |_| {
        if flag.load(Ordering::SeqCst) {
            panic!("audit probe");
        }
    });

    let mut ws = dial_ws(&th).await;
    send_msg(
        &mut ws,
        json!({"type": "create_room", "nickname": "Auditeur"}),
    )
    .await;
    let got = read_msg(&mut ws).await;
    assert_eq!(
        got["type"], "error",
        "a panicking handler must answer an error, got {got}"
    );

    // The event loop survived it: a second client is served normally.
    armed.store(false, Ordering::SeqCst);
    create(&th, "Survivant").await;
    th.stop().await;
}

// --- Resource caps ---
//
// Nothing bounded the rooms or the clients, and the token bucket is per
// socket, so it bounds nothing in aggregate.
#[tokio::test]
async fn rooms_are_capped() {
    let mut c = HubConfig::default();
    c.limits.max_rooms = 3;
    let th = new_test_hub_with(c).await;

    let mut held = Vec::new();
    for i in 0..3 {
        held.push(create(&th, &format!("Hote{i}")).await.0);
    }
    let mut over = dial_ws(&th).await;
    send_msg(
        &mut over,
        json!({"type": "create_room", "nickname": "DeTrop"}),
    )
    .await;
    let msg = read_msg(&mut over).await;
    assert_eq!(
        msg["type"], "error",
        "expected the cap to refuse, got {msg}"
    );
    th.stop().await;
}

#[tokio::test]
async fn connections_per_network_are_capped() {
    let mut c = HubConfig::default();
    c.limits.max_conns_per_net = 2;
    let th = new_test_hub_with(c).await;

    // Every test connection comes from loopback, so they all count against the
    // same bucket.
    let mut held = Vec::new();
    for i in 0..2 {
        held.push(create(&th, &format!("Hote{i}")).await.0);
    }
    // Refused at the upgrade, before a Client exists.
    let err = try_dial_ws(&th, &[])
        .await
        .expect_err("the cap accepted one connection too many");
    assert_eq!(refusal_status(&err), Some(429), "expected 429, got {err:?}");
    th.stop().await;
}

// The cap above is per network, and in production this server never sees one:
// every socket arrives from the same container. Two players behind the proxy,
// on different networks, must not share a bucket — and one player must still
// not be able to take the whole cap.
#[tokio::test]
async fn connections_are_capped_per_player_network_behind_a_proxy() {
    let mut c = HubConfig::default();
    c.limits.max_conns_per_net = 2;
    let th = new_test_hub_with(c).await;
    let as_ip = |ip: &'static str| [("Cf-Connecting-Ip", ip)];

    // Loopback is in the default trusted-proxy set, so the forwarded address is
    // the one that counts.
    let mut held = Vec::new();
    for i in 0..2 {
        held.push(
            try_dial_ws(&th, &as_ip("203.0.113.7"))
                .await
                .unwrap_or_else(|e| panic!("first network, connection {i}: {e}")),
        );
    }

    // That network is full. It is one household, not the server.
    let err = try_dial_ws(&th, &as_ip("203.0.113.9"))
        .await
        .expect_err("the cap accepted one connection too many from a network already at it");
    assert_eq!(refusal_status(&err), Some(429), "expected 429, got {err:?}");

    // Somebody else, still admitted — this is the assertion the bug broke.
    held.push(
        try_dial_ws(&th, &as_ip("198.51.100.4"))
            .await
            .expect("a second network was refused a slot of its own"),
    );
    // And an IPv6 player is a network of their own too.
    held.push(
        try_dial_ws(&th, &as_ip("2001:861:3240:54b0::1"))
            .await
            .expect("an IPv6 player was refused a slot of their own"),
    );
    th.stop().await;
}

// --- Table-code enumeration ---
//
// A wrong code cost nothing, so a sweep lands in somebody else's lobby on a
// busy server.
#[tokio::test]
async fn repeated_bad_table_codes_are_throttled() {
    let mut c = HubConfig::default();
    c.limits.max_failed_joins = 3;
    let th = new_test_hub_with(c).await;

    let (_host, created) = create(&th, "Hote").await;
    let mut sweeper = dial_ws(&th).await;
    for code in ["AAAAAA", "BBBBBB", "CCCCCC", "DDDDDD", "EEEEEE"] {
        send_msg(
            &mut sweeper,
            json!({"type": "join_room", "nickname": "Balayeur", "room_code": code}),
        )
        .await;
        let msg = read_msg(&mut sweeper).await;
        assert_eq!(msg["type"], "error", "code {code}: expected an error");
    }

    // Past the budget the real code is refused too: the sweep cannot cash in
    // the hit it just paid for.
    send_msg(
        &mut sweeper,
        json!({"type": "join_room", "nickname": "Balayeur", "room_code": created["room_code"]}),
    )
    .await;
    let msg = read_msg(&mut sweeper).await;
    assert_eq!(
        msg["type"], "error",
        "a throttled sweeper must not be seated, got {msg}"
    );
    th.stop().await;
}

// A player who mistypes once still gets in: the budget is for a sweep, not for
// a human at a keyboard.
#[tokio::test]
async fn one_mistyped_code_does_not_lock_a_player_out() {
    let th = new_test_hub().await;
    let (_host, created) = create(&th, "Hote").await;

    let mut guest = dial_ws(&th).await;
    send_msg(
        &mut guest,
        json!({"type": "join_room", "nickname": "Invite", "room_code": "ZZZZZZ"}),
    )
    .await;
    let msg = read_msg(&mut guest).await;
    assert_eq!(msg["type"], "error", "expected room not found, got {msg}");
    send_msg(
        &mut guest,
        json!({"type": "join_room", "nickname": "Invite", "room_code": created["room_code"]}),
    )
    .await;
    read_msg_of_type(&mut guest, "room_joined").await;
    th.stop().await;
}

/// A host and a guest at a dealt table (the map gate left
/// shut). Returns the host, the guest, the room_created and the
/// room_joined.
async fn dealt_table(th: &TestHub) -> (Ws, Ws, Value, Value) {
    let (mut host, created) = create(th, "Hote").await;
    let mut guest = dial_ws(th).await;
    send_msg(
        &mut guest,
        json!({"type": "join_room", "nickname": "Invite", "room_code": created["room_code"]}),
    )
    .await;
    let joined = read_msg_of_type(&mut guest, "room_joined").await;
    send_msg(&mut host, json!({"type": "start_game"})).await;
    read_msg_of_type(&mut host, "game_started").await;
    read_msg_of_type(&mut guest, "game_started").await;
    (host, guest, created, joined)
}

// --- The nickname oracle on a reclaim ---
//
// "invalid session token" for a seated nickname and "game already in progress"
// for anything else told a stranger which names are playing. One string for
// both.
#[tokio::test]
async fn reclaim_refusal_reveals_nothing_about_the_roster() {
    let th = new_test_hub().await;
    let (_host, guest, created, _) = dealt_table(&th).await;

    // Drop the guest so its seat is genuinely reclaimable, then try to take it
    // with no token, and try a name nobody at the table has.
    drop(guest);

    let mut seated = dial_ws(&th).await;
    send_msg(
        &mut seated,
        json!({"type": "join_room", "nickname": "Invite", "room_code": created["room_code"], "session_token": "00"}),
    )
    .await;
    let with_seat = read_msg_of_type(&mut seated, "error").await;

    let mut stranger = dial_ws(&th).await;
    send_msg(
        &mut stranger,
        json!({"type": "join_room", "nickname": "Inconnu", "room_code": created["room_code"], "session_token": "00"}),
    )
    .await;
    let without_seat = read_msg_of_type(&mut stranger, "error").await;

    assert_eq!(
        with_seat["error"], without_seat["error"],
        "the refusal names the roster"
    );
    th.stop().await;
}

// --- A reclaimed seat gets a fresh token ---
//
// The old one has been on a socket that died, in sessionStorage, and in a
// snapshot on disk. Once it has been spent, it stops being the proof.
#[tokio::test]
async fn reconnect_rotates_the_session_token() {
    let th = new_test_hub().await;
    let (_host, guest, created, joined) = dealt_table(&th).await;
    drop(guest);

    let mut back = dial_ws(&th).await;
    send_msg(
        &mut back,
        json!({"type": "join_room", "nickname": "Invite", "room_code": created["room_code"], "session_token": joined["session_token"]}),
    )
    .await;
    let reconnected = read_msg_of_type(&mut back, "player_reconnected").await;
    let fresh = reconnected["session_token"].as_str().unwrap_or("");
    assert!(
        !fresh.is_empty(),
        "a reclaim must hand back a token, or the next one cannot be made"
    );
    assert_ne!(
        fresh,
        joined["session_token"].as_str().unwrap(),
        "the spent token is still the proof"
    );

    // And the spent one no longer opens the seat.
    drop(back);
    let mut replay = dial_ws(&th).await;
    send_msg(
        &mut replay,
        json!({"type": "join_room", "nickname": "Invite", "room_code": created["room_code"], "session_token": joined["session_token"]}),
    )
    .await;
    let msg = read_msg(&mut replay).await;
    assert_eq!(
        msg["type"], "error",
        "a replayed token reclaimed the seat: {msg}"
    );
    th.stop().await;
}

// --- One network filling the server with tables ---
//
// Opening a table and walking away left it standing for the empty-room
// timeout, so one network alternating create_room and leave_room could hold
// every table the server allows and refuse a new one to everybody else.
#[tokio::test]
async fn one_network_cannot_hold_every_table() {
    let mut c = HubConfig::default();
    c.limits.max_tables_per_net = 2;
    let th = new_test_hub_with(c).await;
    let from = |ip: &'static str| [("Cf-Connecting-Ip", ip)];

    let mut held = Vec::new();
    for name in ["Un", "Deux"] {
        let mut ws = try_dial_ws(&th, &from("203.0.113.7")).await.expect("dial");
        send_msg(&mut ws, json!({"type": "create_room", "nickname": name})).await;
        read_msg_of_type(&mut ws, "room_created").await;
        held.push(ws);
    }

    // The third from that network is refused, solo included.
    for msg in [
        json!({"type": "create_room", "nickname": "Trois"}),
        json!({"type": "play_bot", "nickname": "Trois"}),
    ] {
        let mut ws = try_dial_ws(&th, &from("203.0.113.9")).await.expect("dial");
        send_msg(&mut ws, msg.clone()).await;
        let got = read_msg(&mut ws).await;
        assert_eq!(got["type"], "error", "{msg}: a third table was opened: {got}");
        assert_eq!(got["error"], "too many attempts, wait a moment");
    }

    // Another network still opens its own.
    let mut other = try_dial_ws(&th, &from("198.51.100.4")).await.expect("dial");
    send_msg(&mut other, json!({"type": "create_room", "nickname": "Autre"})).await;
    read_msg_of_type(&mut other, "room_created").await;
    th.stop().await;
}

// --- Two joins pipelined from one socket ---
//
// Both passed the hub's "already seated" check before the table had bound the
// first, so the second seated the socket again and left the first chair a
// nameless ghost, dealt a hand at the start.
#[tokio::test]
async fn pipelined_joins_seat_a_socket_once() {
    let th = new_test_hub().await;
    let (mut host, created) = create(&th, "Hote").await;
    let code = created["room_code"].as_str().expect("room_code").to_owned();

    let mut guest = dial_ws(&th).await;
    for name in ["Fantome", "Revenant", "Spectre"] {
        send_msg(
            &mut guest,
            json!({"type": "join_room", "nickname": name, "room_code": code}),
        )
        .await;
    }
    let joined = read_msg_of_type(&mut guest, "room_joined").await;
    assert_eq!(
        joined["players"].as_array().map(Vec::len),
        Some(2),
        "room_joined = {joined}"
    );
    for _ in 0..2 {
        let got = read_msg_of_type(&mut guest, "error").await;
        assert_eq!(got["error"], "already in a room", "got {got}");
    }
    let seen = read_msg_of_type(&mut host, "player_joined").await;
    assert_eq!(seen["players"].as_array().map(Vec::len), Some(2));
    assert!(
        stays_silent(&mut host, std::time::Duration::from_millis(300)).await,
        "the host heard a second arrival from the same socket"
    );
    th.stop().await;
}
