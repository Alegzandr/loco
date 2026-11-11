//! The audit these tests come out of asked one question of every message a
//! client can send: what does it cost, and who else pays for it. Four answers
//! were wrong, and each of them was wrong in the same direction — a message the
//! server refused was cheaper than a message it took.

#![allow(clippy::field_reassign_with_default)] // a test narrows one knob of the default config

use futures_util::{SinkExt, StreamExt};
use loco_hub::HubConfig;
use loco_hub::testkit::*;
use serde_json::{Value, json};
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

/// The default config, with the latency broadcast pushed out of every test's
/// way: the negative reads below must not be broken by an unsolicited frame.
fn base() -> HubConfig {
    let mut c = HubConfig::default();
    c.timings.latency_broadcast_period = Duration::from_secs(3600);
    c
}

fn e2e() -> HubConfig {
    let mut c = base();
    c.debug_mode = true;
    c
}

/// The next message within `wait`, or `None` on a timeout or a closed socket.
async fn try_read(ws: &mut Ws, wait: Duration) -> Option<Value> {
    let deadline = tokio::time::Instant::now() + wait;
    loop {
        match tokio::time::timeout_at(deadline, ws.next()).await {
            Ok(Some(Ok(Message::Text(t)))) => {
                let v: Value = serde_json::from_str(t.as_str()).ok()?;
                if v["type"] == "players_online" {
                    continue;
                }
                return Some(v);
            }
            Ok(Some(Ok(Message::Close(_)))) | Ok(Some(Err(_))) | Ok(None) | Err(_) => {
                return None;
            }
            Ok(Some(Ok(_))) => continue,
        }
    }
}

// A gameplay message proves a socket is alive. It does not prove anybody is
// playing, and the AFK threshold is the only thing between a stranger and an
// opponent who has walked away. One refused declare_uno per turn used to buy
// permanent immunity: the seat timed out for ever and was never counted away.
#[tokio::test]
async fn afk_refused_action_does_not_clear_the_counter() {
    let mut c = base();
    c.timings.turn_timeout = Duration::from_millis(300);
    c.timings.afk_kick_threshold = 2;
    let th = new_test_hub_with(c).await;
    let TwoPlayers {
        mut alice, mut bob, ..
    } = setup_two_player_game(&th).await;

    // Both seats hold eight cards, so declare_uno is refused every time. Neither
    // player ever plays; both let every turn expire while keeping the socket
    // busy. A kick is an afk_kicked frame and then a close, and the two race,
    // so the socket going away is the observable.
    let mut alice_gone = false;
    let mut bob_gone = false;
    let deadline = tokio::time::sleep(Duration::from_secs(3));
    tokio::pin!(deadline);
    let mut tick = tokio::time::interval(Duration::from_millis(150));
    let kicked = |m: Option<Result<Message, _>>| -> bool {
        match m {
            Some(Ok(Message::Text(t))) => {
                let v: Value = serde_json::from_str(t.as_str()).unwrap_or_default();
                v["type"] == "error" && v["error"] == "afk_kicked"
            }
            Some(Ok(Message::Close(_))) | Some(Err(_)) | None => true,
            Some(Ok(_)) => false,
        }
    };
    loop {
        tokio::select! {
            m = alice.next(), if !alice_gone => {
                if kicked(m) { alice_gone = true; }
            }
            m = bob.next(), if !bob_gone => {
                if kicked(m) { bob_gone = true; }
            }
            _ = &mut deadline => {
                panic!("a seat that never played was never counted away: a refused message cleared its AFK counter");
            }
            _ = tick.tick() => {
                // Deliberately under the token bucket's 10/s.
                let m = Message::text(json!({"type": "declare_uno"}).to_string());
                let _ = alice.send(m.clone()).await;
                let _ = bob.send(m).await;
            }
        }
        if alice_gone || bob_gone {
            break; // the counter survived the noise, which is the whole assertion
        }
    }
    th.stop().await;
}

// An accepted action still clears it, or the fix above would have turned the
// threshold into a timer nobody can stop.
#[tokio::test]
async fn afk_accepted_action_still_clears_the_counter() {
    let th = new_test_hub_with(base()).await;
    let TwoPlayers {
        mut alice, mut bob, ..
    } = setup_two_player_game(&th).await;

    // draw_card from whichever seat holds the turn is accepted; from the other
    // it is refused. What is asserted is that neither socket is closed.
    send_msg(&mut alice, json!({"type": "draw_card"})).await;
    send_msg(&mut bob, json!({"type": "draw_card"})).await;
    for (i, ws) in [&mut alice, &mut bob].into_iter().enumerate() {
        assert!(
            try_read(ws, Duration::from_secs(1)).await.is_some(),
            "client {i}: socket died on an ordinary draw"
        );
    }
    th.stop().await;
}

// A Contre-LOCO! on a seat that is not on the hook is not a lost race. It used
// to be charged like one, which meant it also announced itself to every seat.
#[tokio::test]
async fn catch_forged_target_tells_nobody() {
    let th = new_test_hub_with(base()).await;
    let TwoPlayers {
        mut alice, mut bob, ..
    } = setup_two_player_game(&th).await;

    send_msg(&mut alice, json!({"type": "catch_uno", "target_index": 7})).await;
    let msg = read_msg_of_type(&mut alice, "error").await;
    assert!(
        !msg["error"].as_str().unwrap_or("").is_empty(),
        "a seat number the table does not have must be refused"
    );
    // And the refusal stays between the server and whoever sent it.
    assert!(
        stays_silent(&mut bob, Duration::from_millis(300)).await,
        "a forged catch reached the rest of the table"
    );
    th.stop().await;
}

// One step in from a forged seat: seat 1 exists and holds eight cards. No
// honest screen has the button live against that table, so the press is not a
// wager. Nothing is charged, and nothing is answered.
#[tokio::test]
async fn catch_with_nobody_near_the_finish_is_silent() {
    let th = new_test_hub_with(base()).await;
    let TwoPlayers {
        mut alice, mut bob, ..
    } = setup_two_player_game(&th).await;

    send_msg(&mut alice, json!({"type": "catch_uno", "target_index": 1})).await;
    send_msg(&mut alice, json!({"type": "catch_uno"})).await;

    assert!(
        stays_silent(&mut bob, Duration::from_millis(300)).await,
        "a Contre-LOCO! against a table nobody is near the finish at reached the table"
    );
    assert!(
        stays_silent(&mut alice, Duration::from_millis(300)).await,
        "the caller was answered for a press that was not a wager"
    );
    th.stop().await;
}

/// Puts the seat behind `ws` one play from the finish, which is what makes a
/// Contre-LOCO! from the other chair a wager. Both sockets are drained of the
/// snapshot the fixture answers with.
async fn near_the_finish(ws: &mut Ws, other: &mut Ws) {
    send_msg(
        ws,
        json!({"type": "debug_set_state", "debug": {
            "hand": [{"color": "red", "kind": "number", "value": 6}, {"color": "red", "kind": "number", "value": 7}]
        }}),
    )
    .await;
    read_msg_of_type(ws, "game_state").await;
    read_msg_of_type(other, "game_state").await;
}

// The wager itself, and its ration. Seat 1 is on two cards, so a press from
// seat 0 is a read of the table; it finds nobody on the hook and costs a card.
// What it may not cost is a card per press: the charge is rationed by the
// offer.
#[tokio::test]
async fn catch_on_an_offer_is_charged_once_per_offer() {
    let th = new_test_hub_with(e2e()).await;
    let TwoPlayers {
        mut alice, mut bob, ..
    } = setup_two_player_game(&th).await;
    near_the_finish(&mut bob, &mut alice).await;

    send_msg(&mut alice, json!({"type": "catch_uno", "target_index": 1})).await;
    let msg = read_msg_of_type(&mut bob, "catch_failed").await;
    assert_eq!(
        seat_of(&msg, "player_index"),
        0,
        "catch_failed should name the caller's seat 0"
    );
    // The card that went with it, so the socket is quiet before the loop below.
    read_msg_of_type(&mut bob, "card_drawn").await;

    for _ in 0..4 {
        send_msg(&mut alice, json!({"type": "catch_uno", "target_index": 1})).await;
    }
    assert!(
        stays_silent(&mut bob, Duration::from_millis(300)).await,
        "a second Contre-LOCO! against an unchanged offer reached the table"
    );
    th.stop().await;
}

// The shape the live button actually produces: no seat named at all. It is the
// same wager and the same card.
#[tokio::test]
async fn catch_with_no_seat_named_is_charged_like_any_other_miss() {
    let th = new_test_hub_with(e2e()).await;
    let TwoPlayers {
        mut alice, mut bob, ..
    } = setup_two_player_game(&th).await;
    near_the_finish(&mut bob, &mut alice).await;

    send_msg(&mut alice, json!({"type": "catch_uno"})).await;
    let msg = read_msg_of_type(&mut bob, "catch_failed").await;
    assert_eq!(
        seat_of(&msg, "player_index"),
        0,
        "catch_failed should name the caller's seat 0"
    );
    th.stop().await;
}

// A snapshot answers a client whose board has drifted, and one is enough.
// Without a floor, a client offering the same stale card at the rate limit
// pulled the most expensive message this server sends ten times a second.
#[tokio::test]
async fn resync_is_throttled_to_one_per_second() {
    let th = new_test_hub_with(base()).await;
    let TwoPlayers { mut alice, .. } = setup_two_player_game(&th).await;

    // A card no deck ships (there is no red zero), refused as "card not in
    // hand" or "not your turn": both state mismatches, which carry a correction.
    for _ in 0..4 {
        send_msg(
            &mut alice,
            json!({"type": "play_card", "card": {"color": "red", "kind": "number", "value": 0}}),
        )
        .await;
    }
    let mut states = 0;
    let mut errs = 0;
    while errs < 4 {
        let Some(msg) = try_read(&mut alice, Duration::from_secs(1)).await else {
            break;
        };
        match msg["type"].as_str() {
            Some("error") => errs += 1,
            Some("game_state") => states += 1,
            _ => {}
        }
    }
    assert_eq!(errs, 4, "expected 4 refusals");
    assert_eq!(
        states, 1,
        "got {states} corrections for 4 refusals in the same instant, want 1"
    );
    th.stop().await;
}

/// Drives a fresh 2-player BO1 table to match_end. Alice hosts at seat 0.
async fn win_bo1(th: &TestHub) -> (Ws, Ws, String) {
    let TwoPlayers {
        mut alice,
        mut bob,
        code,
        ..
    } = setup_two_player_game(th).await;
    win_match_from_host_turn(&mut alice, &mut [&mut bob]).await;
    (alice, bob, code)
}

/// Hands the host a single playable card on their turn and plays it, ending a
/// BO1 match.
async fn win_match_from_host_turn(host: &mut Ws, others: &mut [&mut Ws]) {
    let card = json!({"color": "red", "kind": "number", "value": 7});
    send_msg(
        host,
        json!({"type": "debug_set_state", "debug": {
            "hand": [card], "discard": card, "pending_draw": 0, "current_turn": 0
        }}),
    )
    .await;
    read_msg_of_type(host, "game_state").await;
    for o in others.iter_mut() {
        read_msg_of_type(o, "game_state").await;
    }
    declare_before_winning(host).await;
    send_msg(host, json!({"type": "play_card", "card": card})).await;
    read_msg_of_type(host, "match_end").await;
    for o in others.iter_mut() {
        read_msg_of_type(o, "match_end").await;
    }
}

// An ask is a set membership, so asking twice changes nothing. It used to be
// republished anyway, ten broadcasts a second at the rate limit.
#[tokio::test]
async fn rematch_re_asking_publishes_nothing() {
    let th = new_test_hub_with(e2e()).await;
    let (mut alice, mut bob, _) = win_bo1(&th).await;

    send_msg(&mut bob, json!({"type": "rematch"})).await;
    read_msg_of_type(&mut alice, "rematch_offered").await;
    read_msg_of_type(&mut bob, "rematch_offered").await;

    send_msg(&mut bob, json!({"type": "rematch"})).await;
    assert!(
        stays_silent(&mut alice, Duration::from_millis(300)).await,
        "a repeated ask was republished to the table"
    );
    th.stop().await;
}
