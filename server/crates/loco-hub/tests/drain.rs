//! Draining is what a deploy does to a server people are playing on. These
//! tests pin both halves of the contract: nothing new starts, and nothing
//! already running is disturbed.

#![allow(clippy::field_reassign_with_default)]

use loco_hub::HubConfig;
use loco_hub::testkit::*;
use serde_json::{Value, json};
use std::time::Duration;

/// Reads until an error arrives and checks what it says.
async fn expect_error(ws: &mut Ws, want: &str) {
    let m = read_msg_of_type(ws, "error").await;
    let got = m["error"].as_str().unwrap_or_default();
    assert!(
        got.contains(want),
        "error = {got:?}, want it to contain {want:?}"
    );
}

/// A hub with the debug handlers on, so `debug_set_state` is reachable.
fn e2e() -> HubConfig {
    let mut c = HubConfig::default();
    c.debug_mode = true;
    c
}

fn card(color: &str, value: i64) -> Value {
    json!({"color": color, "kind": "number", "value": value})
}

/// `/health`, decoded.
async fn health_of(th: &TestHub) -> Value {
    let (_, _, body) = http_get(th, "/health").await;
    serde_json::from_str(&body).expect("health json")
}

/// One line of `/metrics`, which is Prometheus text now.
async fn metric_of(th: &TestHub, name: &str) -> String {
    let (_, _, body) = http_get(th, "/metrics").await;
    body.lines()
        .find_map(|l| l.strip_prefix(&format!("{name} ")).map(str::to_owned))
        .unwrap_or_else(|| panic!("no {name} on /metrics:\n{body}"))
}

/// Ends the match: the host is handed one card on its own turn
/// and plays it, after the LOCO! call it owes.
async fn win_match_from_host_turn(host: &mut Ws, others: &mut [&mut Ws]) {
    send_msg(
        host,
        json!({"type": "debug_set_state", "debug": {
            "hand": [card("red", 7)],
            "discard": card("red", 7),
            "pending_draw": 0,
            "current_turn": 0,
        }}),
    )
    .await;
    read_msg_of_type(host, "game_state").await;
    for c in others.iter_mut() {
        read_msg_of_type(c, "game_state").await;
    }
    declare_before_winning(host).await;
    send_msg(host, json!({"type": "play_card", "card": card("red", 7)})).await;
    read_msg_of_type(host, "match_end").await;
    for c in others.iter_mut() {
        read_msg_of_type(c, "match_end").await;
    }
}

#[tokio::test]
async fn drain_refuses_new_tables() {
    let th = new_test_hub().await;

    let mut conn = dial_ws(&th).await;
    send_msg(
        &mut conn,
        json!({"type": "create_room", "nickname": "Alice"}),
    )
    .await;
    let created = read_msg_of_type(&mut conn, "room_created").await;
    let code = created["room_code"].as_str().unwrap().to_owned();

    th.hub.begin_drain();

    let mut other = dial_ws(&th).await;
    send_msg(
        &mut other,
        json!({"type": "create_room", "nickname": "Bob"}),
    )
    .await;
    expect_error(&mut other, "server updating").await;

    // A table that does not exist reads as the update, not as a typo: the
    // code the player was handed a minute ago was real.
    send_msg(
        &mut other,
        json!({"type": "join_room", "nickname": "Bob", "room_code": "ZZZZZZ"}),
    )
    .await;
    expect_error(&mut other, "server updating").await;

    // The lobby that already exists is still joinable, and that is
    // deliberate: the refusal is on dealing, not on sitting down.
    send_msg(
        &mut other,
        json!({"type": "join_room", "nickname": "Bob", "room_code": code}),
    )
    .await;
    read_msg_of_type(&mut other, "room_joined").await;

    // Dealing is what would extend the drain without bound, so it is refused.
    send_msg(&mut conn, json!({"type": "start_game"})).await;
    expect_error(&mut conn, "server updating").await;
    th.stop().await;
}

#[tokio::test]
async fn drain_refuses_matchmaking_and_empties_the_queue() {
    let th = new_test_hub().await;

    let mut waiting = dial_ws(&th).await;
    send_msg(
        &mut waiting,
        json!({"type": "find_match", "nickname": "Alice"}),
    )
    .await;
    read_msg_of_type(&mut waiting, "matchmaking_queued").await;

    th.hub.begin_drain();

    // Somebody already searching is told why and taken off the screen, rather
    // than left waiting for an opponent this process will never pair.
    expect_error(&mut waiting, "server updating").await;
    read_msg_of_type(&mut waiting, "matchmaking_cancelled").await;

    send_msg(
        &mut waiting,
        json!({"type": "find_match", "nickname": "Alice"}),
    )
    .await;
    expect_error(&mut waiting, "server updating").await;

    assert_eq!(
        metric_of(&th, "matchmaking_queue").await,
        "0",
        "matchmaking_queue after drain"
    );
    th.stop().await;
}

#[tokio::test]
async fn drain_match_in_progress_keeps_playing() {
    let th = new_test_hub_with(e2e()).await;

    let mut conn1 = dial_ws(&th).await;
    let mut conn2 = dial_ws(&th).await;
    send_msg(
        &mut conn1,
        json!({"type": "create_room", "nickname": "Alice"}),
    )
    .await;
    let created = read_msg_of_type(&mut conn1, "room_created").await;
    send_msg(
        &mut conn2,
        json!({"type": "join_room", "nickname": "Bob", "room_code": created["room_code"]}),
    )
    .await;
    read_msg_of_type(&mut conn2, "room_joined").await;
    read_msg_of_type(&mut conn1, "player_joined").await;

    send_msg(&mut conn1, json!({"type": "start_game"})).await;
    let gs1 = read_msg_of_type(&mut conn1, "game_started").await;
    let gs2 = read_msg_of_type(&mut conn2, "game_started").await;
    complete_map_load(&mut [&mut conn1, &mut conn2]).await;
    assert!(
        gs1["state"].is_object() && gs2["state"].is_object(),
        "missing game state in game_started"
    );

    th.hub.begin_drain();

    // The table is told, once, so the screen can say what is happening.
    read_msg_of_type(&mut conn1, "server_updating").await;
    read_msg_of_type(&mut conn2, "server_updating").await;

    let first_turn = gs1["state"]["turn"] == gs1["state"]["your_index"];
    let (active, observer, active_idx) = if first_turn {
        (&mut conn1, &mut conn2, gs1["state"]["your_index"].clone())
    } else {
        (&mut conn2, &mut conn1, gs2["state"]["your_index"].clone())
    };

    // Two cards: what is asserted is that a play still resolves during a
    // drain, not that a round can be won, and a one-card hand would make this
    // a finish and put the LOCO! gate in front of it.
    send_msg(
        active,
        json!({"type": "debug_set_state", "debug": {
            "hand": [card("red", 3), card("blue", 9)],
            "discard": card("red", 5),
            "active_color": "red",
            "pending_draw": 0,
            "current_turn": active_idx,
        }}),
    )
    .await;
    read_msg_of_type(active, "game_state").await;
    read_msg_of_type(observer, "game_state").await;

    send_msg(active, json!({"type": "play_card", "card": card("red", 3)})).await;
    let played = read_msg_of_type(observer, "card_played").await;
    assert_eq!(
        played["card"]["value"], 3,
        "a card played during the drain did not resolve: {played}"
    );
    th.stop().await;
}

// The notice used to be gated on StatusPlaying, which meant it missed the
// three places a drain is actually felt. A waiting room is one of them: the
// host is about to press a start button that comes back refused.
#[tokio::test]
async fn drain_notifies_tables_that_have_not_dealt() {
    let th = new_test_hub().await;

    let mut host = dial_ws(&th).await;
    send_msg(
        &mut host,
        json!({"type": "create_room", "nickname": "Alice"}),
    )
    .await;
    let created = read_msg_of_type(&mut host, "room_created").await;

    let mut guest = dial_ws(&th).await;
    send_msg(
        &mut guest,
        json!({"type": "join_room", "nickname": "Bob", "room_code": created["room_code"]}),
    )
    .await;
    read_msg_of_type(&mut guest, "room_joined").await;
    read_msg_of_type(&mut host, "player_joined").await;

    th.hub.begin_drain();

    read_msg_of_type(&mut host, "server_updating").await;
    read_msg_of_type(&mut guest, "server_updating").await;
    th.stop().await;
}

// The other one: a table that is over. The rematch button on that screen stops
// working during a drain, and a refusal on the only control the screen has
// reads as a broken button rather than as a deploy.
#[tokio::test]
async fn drain_notifies_finished_tables() {
    let th = new_test_hub_with(e2e()).await;
    let TwoPlayers {
        mut alice, mut bob, ..
    } = setup_two_player_game(&th).await;
    win_match_from_host_turn(&mut alice, &mut [&mut bob]).await;

    th.hub.begin_drain();

    read_msg_of_type(&mut alice, "server_updating").await;
    read_msg_of_type(&mut bob, "server_updating").await;

    send_msg(&mut alice, json!({"type": "rematch"})).await;
    expect_error(&mut alice, "server updating").await;
    th.stop().await;
}

#[tokio::test]
async fn drain_reconnect_still_works() {
    let th = new_test_hub().await;
    let TwoPlayers {
        mut alice,
        bob,
        code,
        tokens,
    } = setup_two_player_game(&th).await;

    th.hub.begin_drain();
    read_msg_of_type(&mut alice, "server_updating").await;

    drop(bob);
    read_msg_of_type(&mut alice, "player_disconnected").await;

    let mut back = dial_ws(&th).await;
    send_msg(
        &mut back,
        json!({"type": "join_room", "nickname": "Bob", "room_code": code, "session_token": tokens[1]}),
    )
    .await;
    let m = read_msg_of_type(&mut back, "player_reconnected").await;
    assert!(
        m["state"].is_object(),
        "a reconnect during the drain returned no state: {m}"
    );
    th.stop().await;
}

#[tokio::test]
async fn drain_done_only_once_the_last_match_ends() {
    let mut c = HubConfig::default();
    c.timings.empty_room_timeout = Duration::from_millis(50);
    let th = new_test_hub_with(c).await;

    let TwoPlayers { alice, bob, .. } = setup_two_player_game(&th).await;

    th.hub.begin_drain();

    assert!(
        tokio::time::timeout(Duration::from_millis(100), th.hub.drain_done())
            .await
            .is_err(),
        "the drain completed while a match was still being played"
    );

    // Both players walk away: the room empties, the cleanup runs, and that is
    // the last thing holding the drain open.
    drop(alice);
    drop(bob);

    tokio::time::timeout(Duration::from_secs(5), th.hub.drain_done())
        .await
        .expect("the drain never completed after the last table went away");
    th.stop().await;
}

#[tokio::test]
async fn drain_done_immediately_when_nobody_is_playing() {
    let th = new_test_hub().await;
    th.hub.begin_drain();
    tokio::time::timeout(Duration::from_secs(2), th.hub.drain_done())
        .await
        .expect("the drain on an idle server never completed");
    th.stop().await;
}

#[tokio::test]
async fn drain_reported_on_health_and_metrics() {
    let th = new_test_hub().await;

    assert_eq!(
        health_of(&th).await["draining"],
        false,
        "health reported draining before any signal"
    );

    th.hub.begin_drain();
    // The drain is begun on the loop; one round trip through it orders the
    // reads below after it.
    th.hub.on_loop(|_| ()).await;

    assert_eq!(
        health_of(&th).await["draining"],
        true,
        "health did not report draining"
    );
    assert_eq!(
        metric_of(&th, "draining").await,
        "1",
        "metrics did not report draining"
    );
    th.stop().await;
}
