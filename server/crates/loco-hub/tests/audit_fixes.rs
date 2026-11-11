//! Regressions the hub's audit found, each pinned through real sockets.

#![allow(clippy::field_reassign_with_default)] // a test narrows one knob of the default config

use futures_util::StreamExt;
use loco_hub::HubConfig;
use loco_hub::testkit::*;
use serde_json::{Value, json};
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

fn e2e() -> HubConfig {
    let mut c = HubConfig::default();
    c.debug_mode = true;
    c.timings.latency_broadcast_period = Duration::from_secs(3600);
    c
}

/// Alice creates a table, adds a bot, deals and loads. Returns her socket, the
/// room_created and the game_started.
async fn alice_and_a_bot(th: &TestHub) -> (Ws, Value, Value) {
    let mut ws = dial_ws(th).await;
    send_msg(&mut ws, json!({"type": "create_room", "nickname": "Alice"})).await;
    let created = read_msg_of_type(&mut ws, "room_created").await;
    send_msg(&mut ws, json!({"type": "add_bot"})).await;
    read_msg_of_type(&mut ws, "player_joined").await;
    send_msg(&mut ws, json!({"type": "start_game"})).await;
    let gs = read_msg_of_type(&mut ws, "game_started").await;
    complete_map_load(&mut [&mut ws]).await;
    (ws, created, gs)
}

/// `find_match`, and the acknowledgement read back.
async fn queue_up(th: &TestHub, nickname: &str) -> Ws {
    let mut ws = dial_ws(th).await;
    send_msg(&mut ws, json!({"type": "find_match", "nickname": nickname})).await;
    read_msg_of_type(&mut ws, "matchmaking_queued").await;
    ws
}

/// Two players queued and taken through to an open table.
async fn paired_match(th: &TestHub) -> (Ws, Ws) {
    let mut a = queue_up(th, "Alice").await;
    let mut b = queue_up(th, "Bob").await;
    read_msg_of_type(&mut a, "match_found").await;
    read_msg_of_type(&mut b, "match_found").await;
    read_msg_of_type(&mut a, "game_started").await;
    read_msg_of_type(&mut b, "game_started").await;
    complete_map_load(&mut [&mut a, &mut b]).await;
    (a, b)
}

/// `winner` (seat 0) plays down to an empty hand
/// through the debug seam.
async fn finish_round_for_seat(winner: &mut Ws, other: &mut Ws) {
    send_msg(
        winner,
        json!({"type": "debug_set_state", "debug": {
            "hands": [
                {"player_index": 0, "hand": [{"color": "red", "kind": "number", "value": 5}]},
                {"player_index": 1, "hand": [{"color": "blue", "kind": "number", "value": 9}]}
            ],
            "discard": {"color": "red", "kind": "number", "value": 3},
            "active_color": "red",
            "pending_draw": 0,
            "current_turn": 0,
            "direction": 1
        }}),
    )
    .await;
    read_msg_of_type(winner, "game_state").await;
    declare_before_winning(winner).await;
    send_msg(
        winner,
        json!({"type": "play_card", "card": {"color": "red", "kind": "number", "value": 5}}),
    )
    .await;
    read_msg_of_type(winner, "match_end").await;
    read_msg_of_type(other, "match_end").await;
}

// An AFK kick answers the socket, never the turn: the seat is held like any
// other drop, and the clock goes on drawing and passing for it. It used to
// return before the auto-pass, and a table of two humans and a bot sat on the
// kicked seat's turn for the rest of the match.
#[tokio::test]
async fn afk_kick_still_moves_the_turn() {
    let mut c = e2e();
    c.timings.turn_timeout = Duration::from_millis(40);
    c.timings.afk_kick_threshold = 2;
    c.timings.bots.think = Duration::from_millis(5);
    c.timings.bots.jitter_max = Duration::ZERO;
    c.timings.bots.catch_prob = 0.0;
    let th = new_test_hub_with(c).await;

    let mut idler = dial_ws(&th).await;
    let mut watcher = dial_ws(&th).await;
    send_msg(
        &mut idler,
        json!({"type": "create_room", "nickname": "Idler"}),
    )
    .await;
    let created = read_msg_of_type(&mut idler, "room_created").await;
    send_msg(
        &mut watcher,
        json!({"type": "join_room", "nickname": "Watcher", "room_code": created["room_code"]}),
    )
    .await;
    read_msg_of_type(&mut watcher, "room_joined").await;
    read_msg_of_type(&mut idler, "player_joined").await;
    send_msg(&mut idler, json!({"type": "add_bot"})).await;
    read_msg_of_type(&mut idler, "player_joined").await;
    read_msg_of_type(&mut watcher, "player_joined").await;
    send_msg(&mut idler, json!({"type": "start_game"})).await;
    let gs = read_msg_of_type(&mut idler, "game_started").await;
    read_msg_of_type(&mut watcher, "game_started").await;
    send_msg(&mut idler, json!({"type": "map_ready"})).await;
    send_msg(&mut watcher, json!({"type": "map_ready"})).await;
    read_msg_of_type(&mut idler, "match_ready").await;
    let ready = read_msg_of_type(&mut watcher, "match_ready").await;

    let me = gs["state"]["your_index"].as_i64().unwrap();
    let watcher_seat = 1;
    // The watcher answers every turn of its own with a draw and a pass, so it
    // never trips the threshold itself; the idler answers nothing.
    async fn answer(watcher: &mut Ws, msg: &Value, watcher_seat: i64) {
        if msg["turn"].as_i64().unwrap_or(0) != watcher_seat {
            return;
        }
        if matches!(
            msg["type"].as_str(),
            Some("match_ready" | "turn_changed" | "card_played")
        ) {
            send_msg(watcher, json!({"type": "draw_card"})).await;
            send_msg(watcher, json!({"type": "pass_turn"})).await;
        }
    }
    answer(&mut watcher, &ready, watcher_seat).await;

    // The watcher sees the idler go (the kick closes the socket), and then the
    // turn has to keep moving: a turn_changed or a play after that.
    let deadline = tokio::time::Instant::now() + Duration::from_secs(4);
    let mut gone = false;
    loop {
        let frame = match tokio::time::timeout_at(deadline, watcher.next()).await {
            Err(_) => break,
            Ok(f) => f,
        };
        let msg: Value = match frame {
            Some(Ok(Message::Text(t))) => match serde_json::from_str(t.as_str()) {
                Ok(v) => v,
                Err(_) => continue,
            },
            Some(Ok(Message::Close(_))) | Some(Err(_)) | None => {
                panic!("watcher read failed (kicked seat seen leaving: {gone})")
            }
            Some(Ok(_)) => continue,
        };
        assert_ne!(
            msg["type"], "match_end",
            "match ended before the kick could be observed"
        );
        answer(&mut watcher, &msg, watcher_seat).await;
        if msg["type"] == "player_disconnected" && seat_of(&msg, "player_index") == me {
            gone = true;
            continue;
        }
        // The disconnect broadcast may land after the kick's own auto-pass:
        // what proves the turn still moves is any change after the seat went.
        if gone && (msg["type"] == "turn_changed" || msg["type"] == "card_played") {
            drop(idler);
            th.stop().await;
            return;
        }
    }
    assert!(gone, "the idler was never kicked");
    panic!("the turn never moved off the kicked seat");
}

// A seat number below zero is the out-of-range case with the sign flipped:
// refused and counted, never charged as a wager.
#[tokio::test]
async fn catch_uno_negative_target_is_refused_not_charged() {
    let mut c = e2e();
    // Keeps the bot off the board so the answer is the next message.
    c.timings.bots.think = Duration::from_secs(30);
    let th = new_test_hub_with(c).await;
    let (mut ws, _, _) = alice_and_a_bot(&th).await;

    send_msg(&mut ws, json!({"type": "catch_uno", "target_index": -1})).await;
    let msg = read_msg(&mut ws).await;
    assert_eq!(msg["type"], "error", "got {msg}, want an error");
    assert!(
        msg.get("cards")
            .is_none_or(|c| c.as_array().is_none_or(Vec::is_empty)),
        "a forged target drew cards: {msg}"
    );
    th.stop().await;
}

// A batch longer than the hand is refused before a card of it is decoded.
#[tokio::test]
async fn play_card_batch_longer_than_the_hand_is_refused() {
    let th = new_test_hub_with(e2e()).await;
    let (mut ws, _, gs) = alice_and_a_bot(&th).await;

    let n = gs["state"]["hand"].as_array().unwrap().len() + 1;
    let batch: Vec<Value> = (0..n)
        .map(|_| json!({"color": "red", "kind": "number", "value": 5}))
        .collect();
    send_msg(&mut ws, json!({"type": "play_card", "play_cards": batch})).await;
    let msg = read_msg_of_type(&mut ws, "error").await;
    assert!(
        msg["error"]
            .as_str()
            .unwrap_or("")
            .contains("exceeds the hand"),
        "error = {}, want the batch refused for its length",
        msg["error"]
    );
    th.stop().await;
}

// A snapshot carries the catch state: a tab that reloads inside a window lands
// on a board where that window is still open, and a seat whose call is spent
// does not get its LOCO! button back.
#[tokio::test]
async fn reconnect_snapshot_carries_catch_state() {
    let mut c = e2e();
    c.timings.bots.catch_prob = 0.0;
    c.timings.bots.uno_delay = Duration::from_secs(3600);
    let th = new_test_hub_with(c).await;
    let (mut conn, created, gs) = alice_and_a_bot(&th).await;
    let code = created["room_code"].as_str().unwrap().to_owned();

    let me = gs["state"]["your_index"].as_i64().unwrap();
    let bot = 1 - me;
    // Two cards for us; play one of ours: we are on one card, undeclared.
    send_msg(
        &mut conn,
        json!({"type": "debug_set_state", "debug": {
            "hand": [{"color": "red", "kind": "number", "value": 5}, {"color": "red", "kind": "number", "value": 6}],
            "hands": [{"player_index": bot, "hand": [
                {"color": "blue", "kind": "number", "value": 3},
                {"color": "blue", "kind": "number", "value": 4},
                {"color": "blue", "kind": "number", "value": 7}
            ]}],
            "discard": {"color": "red", "kind": "number", "value": 9},
            "active_color": "red",
            "pending_draw": 0,
            "current_turn": me,
            "direction": 1
        }}),
    )
    .await;
    read_msg_of_type(&mut conn, "game_state").await;
    send_msg(
        &mut conn,
        json!({"type": "play_card", "card": {"color": "red", "kind": "number", "value": 5}}),
    )
    .await;
    let played = read_msg_of_type(&mut conn, "card_played").await;
    let seats = played["catch_seats"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    assert!(
        seats.len() == 1 && seats[0]["player_index"] == me,
        "card_played catch_seats = {seats:?}, want our seat on the hook"
    );

    // Reload: the old socket goes, and a fresh one reclaims the seat.
    drop(conn);
    tokio::time::sleep(Duration::from_millis(50)).await;
    let mut conn2 = dial_ws(&th).await;
    send_msg(
        &mut conn2,
        json!({"type": "join_room", "nickname": "Alice", "room_code": code, "session_token": created["session_token"]}),
    )
    .await;
    let back = read_msg_of_type(&mut conn2, "player_reconnected").await;
    assert!(back["state"].is_object(), "reclaim carried no state");
    let snap = back["state"]["catch_seats"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    assert!(
        snap.len() == 1 && snap[0]["player_index"] == me,
        "snapshot catch_seats = {snap:?}, want our seat still on the hook"
    );
    assert_eq!(
        snap[0]["ends_at"], seats[0]["ends_at"],
        "the snapshot's window end differs from card_played's"
    );

    // Call it, reload again: the call is spent and the snapshot says so.
    send_msg(&mut conn2, json!({"type": "declare_uno"})).await;
    read_msg_of_type(&mut conn2, "uno_declared").await;
    drop(conn2);
    tokio::time::sleep(Duration::from_millis(50)).await;
    let mut conn3 = dial_ws(&th).await;
    send_msg(
        &mut conn3,
        json!({"type": "join_room", "nickname": "Alice", "room_code": code, "session_token": back["session_token"]}),
    )
    .await;
    let again = read_msg_of_type(&mut conn3, "player_reconnected").await;
    assert!(
        again["state"].is_object(),
        "second reclaim carried no state"
    );
    assert_eq!(
        again["state"]["declared_seats"],
        json!([me]),
        "snapshot declared_seats, want our seat"
    );
    assert!(
        again["state"]["catch_seats"]
            .as_array()
            .is_none_or(Vec::is_empty),
        "snapshot catch_seats = {} after our call, want none",
        again["state"]["catch_seats"]
    );
    th.stop().await;
}

fn assert_one_record_of_two_columns(gs: &Value) {
    let hist = gs["state"]["match_history"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    assert_eq!(
        hist.len(),
        1,
        "game_started match_history = {}, want the one finished match",
        gs["state"]["match_history"]
    );
    let rec = &hist[0];
    assert!(
        rec["rounds_won"].as_array().map(Vec::len) == Some(2)
            && rec["scores"].as_array().map(Vec::len) == Some(2),
        "record = {rec}, want two columns"
    );
}

// The recap a rematch carries has one column per seat: a record with no seats
// in it is a `null` on the wire, which the client's schema refuses.
#[tokio::test]
async fn matchmaking_rematch_recap_has_one_column_per_seat() {
    let mut c = e2e();
    c.timings.matchmaking.reveal_delay = Duration::from_millis(30);
    let th = new_test_hub_with(c).await;

    let (mut a, mut b) = paired_match(&th).await;
    finish_round_for_seat(&mut a, &mut b).await;

    send_msg(&mut a, json!({"type": "rematch"})).await;
    read_msg_of_type(&mut a, "rematch_offered").await;
    read_msg_of_type(&mut b, "rematch_offered").await;
    send_msg(&mut b, json!({"type": "rematch"})).await;
    read_msg_of_type(&mut a, "match_found").await;
    read_msg_of_type(&mut b, "match_found").await;
    let gs = read_msg_of_type(&mut a, "game_started").await;
    read_msg_of_type(&mut b, "game_started").await;
    assert_one_record_of_two_columns(&gs);
    th.stop().await;
}

// A matchmade table is a lobby for the versus reveal, and a reload there used
// to be a lobby departure. Held instead: the reload reclaims its own seat, the
// deal goes ahead with it.
#[tokio::test]
async fn matchmaking_reload_during_the_reveal_keeps_the_seat() {
    let mut c = e2e();
    c.timings.matchmaking.reveal_delay = Duration::from_millis(600);
    let th = new_test_hub_with(c).await;

    let a = queue_up(&th, "Alice").await;
    let mut b = queue_up(&th, "Bob").await;
    let mut a = a;
    let found_a = read_msg_of_type(&mut a, "match_found").await;
    read_msg_of_type(&mut b, "match_found").await;
    let seat_a = seat_of(&found_a, "player_id");

    // Alice's tab reloads inside the reveal.
    drop(a);
    tokio::time::sleep(Duration::from_millis(50)).await;
    let away = read_msg_of_type(&mut b, "player_disconnected").await;
    assert_eq!(
        seat_of(&away, "player_index"),
        seat_a,
        "player_disconnected should name Alice's seat"
    );

    let mut a2 = dial_ws(&th).await;
    send_msg(
        &mut a2,
        json!({"type": "join_room", "nickname": "Alice", "room_code": found_a["room_code"], "session_token": found_a["session_token"]}),
    )
    .await;
    let back = read_msg_of_type(&mut a2, "player_reconnected").await;
    assert_eq!(
        seat_of(&back, "player_id"),
        seat_a,
        "the reclaim should seat Alice at her own seat"
    );
    read_msg_of_type(&mut b, "player_reconnected").await;

    // The deal still comes, to the same two seats.
    let gs_a = read_msg_of_type(&mut a2, "game_started").await;
    let gs_b = read_msg_of_type(&mut b, "game_started").await;
    assert!(
        gs_a["state"].is_object()
            && gs_b["state"].is_object()
            && gs_a["state"]["players"].as_array().map(Vec::len) == Some(2),
        "deal after a reveal reload: {gs_a} / {gs_b}"
    );
    assert_eq!(
        gs_a["state"]["your_index"].as_i64(),
        Some(seat_a),
        "Alice dealt at the wrong seat"
    );
    th.stop().await;
}

// The same reload, inside a rematch's reveal: the finished match keeps its two
// columns in the recap the next deal carries.
#[tokio::test]
async fn matchmaking_reload_during_rematch_reveal_keeps_the_recap() {
    let mut c = e2e();
    c.timings.matchmaking.reveal_delay = Duration::from_millis(600);
    let th = new_test_hub_with(c).await;

    let (mut a, mut b) = paired_match(&th).await;
    finish_round_for_seat(&mut a, &mut b).await;
    send_msg(&mut a, json!({"type": "rematch"})).await;
    read_msg_of_type(&mut a, "rematch_offered").await;
    read_msg_of_type(&mut b, "rematch_offered").await;
    send_msg(&mut b, json!({"type": "rematch"})).await;
    let found_a = read_msg_of_type(&mut a, "match_found").await;
    read_msg_of_type(&mut b, "match_found").await;

    drop(a);
    tokio::time::sleep(Duration::from_millis(50)).await;
    read_msg_of_type(&mut b, "player_disconnected").await;
    let mut a2 = dial_ws(&th).await;
    send_msg(
        &mut a2,
        json!({"type": "join_room", "nickname": "Alice", "room_code": found_a["room_code"], "session_token": found_a["session_token"]}),
    )
    .await;
    read_msg_of_type(&mut a2, "player_reconnected").await;
    read_msg_of_type(&mut b, "player_reconnected").await;

    let gs = read_msg_of_type(&mut a2, "game_started").await;
    read_msg_of_type(&mut b, "game_started").await;
    assert_one_record_of_two_columns(&gs);
    th.stop().await;
}

// A pairing whose other half closed the tab during the reveal is still torn
// down for the survivor: nobody connected at all deals nothing.
#[tokio::test]
async fn matchmaking_both_gone_during_the_reveal_deals_nothing() {
    let mut c = HubConfig::default();
    c.timings.matchmaking.reveal_delay = Duration::from_millis(200);
    let th = new_test_hub_with(c).await;

    let mut a = queue_up(&th, "Alice").await;
    let mut b = queue_up(&th, "Bob").await;
    read_msg_of_type(&mut a, "match_found").await;
    read_msg_of_type(&mut b, "match_found").await;
    drop(a);
    drop(b);
    tokio::time::sleep(Duration::from_millis(500)).await;
    let rooms = th.hub.health().rooms;
    assert_eq!(
        rooms, 0,
        "rooms after both left during the reveal = {rooms}, want 0"
    );
    th.stop().await;
}
