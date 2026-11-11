//! Port of `server/hub/catch_immediate_test.go`.
//!
//! A Contre-LOCO! is answered on the instant it arrives, and two rations keep
//! the button from being mashed: the card is charged once per offer, and the
//! lockout is armed once per press.

#![allow(clippy::field_reassign_with_default)] // a test narrows one knob of the default config

use futures_util::StreamExt;
use loco_hub::HubConfig;
use loco_hub::testkit::*;
use serde_json::{Value, json};
use std::time::{Duration, Instant};
use tokio_tungstenite::tungstenite::Message;

fn e2e() -> HubConfig {
    let mut c = HubConfig::default();
    c.debug_mode = true;
    // The drains below read everything that arrives: no unsolicited frame.
    c.timings.latency_broadcast_period = Duration::from_secs(3600);
    c
}

/// Every message within `wait` (one deadline for the whole drain), skipping
/// players_online.
async fn drain(ws: &mut Ws, wait: Duration) -> Vec<Value> {
    let deadline = tokio::time::Instant::now() + wait;
    let mut out = Vec::new();
    loop {
        match tokio::time::timeout_at(deadline, ws.next()).await {
            Ok(Some(Ok(Message::Text(t)))) => {
                let v: Value = serde_json::from_str(t.as_str()).expect("unmarshal");
                if v["type"] != "players_online" {
                    out.push(v);
                }
            }
            Ok(Some(Ok(Message::Close(_)))) | Ok(Some(Err(_))) | Ok(None) | Err(_) => {
                return out;
            }
            Ok(Some(Ok(_))) => continue,
        }
    }
}

struct Board {
    active: Ws,
    catcher: Ws,
    active_idx: i64,
    catcher_idx: i64,
}

/// The seat at turn holds exactly two cards, so a Contre-LOCO! from the other
/// chair is offered — the button is live — and there is nothing yet to catch.
/// Go's `seatOneCardAway`.
async fn seat_one_card_away(th: &TestHub) -> Board {
    let TwoPlayers {
        mut alice, mut bob, ..
    } = setup_two_player_game(th).await;
    // Whose turn it is decides who plays down to one.
    send_msg(&mut alice, json!({"type": "debug_set_state", "debug": {}})).await;
    let gs1 = read_msg_of_type(&mut alice, "game_state").await;
    let gs2 = read_msg_of_type(&mut bob, "game_state").await;
    let i1 = gs1["state"]["your_index"].as_i64().unwrap();
    let i2 = gs2["state"]["your_index"].as_i64().unwrap();
    let mut b = if gs1["state"]["turn"].as_i64() == Some(i1) {
        Board {
            active: alice,
            catcher: bob,
            active_idx: i1,
            catcher_idx: i2,
        }
    } else {
        Board {
            active: bob,
            catcher: alice,
            active_idx: i2,
            catcher_idx: i1,
        }
    };
    send_msg(
        &mut b.active,
        json!({"type": "debug_set_state", "debug": {
            "hand": [{"color": "red", "kind": "number", "value": 6}, {"color": "red", "kind": "number", "value": 7}],
            "discard": {"color": "red", "kind": "number", "value": 5},
            "pending_draw": 0
        }}),
    )
    .await;
    read_msg_of_type(&mut b.active, "game_state").await;
    read_msg_of_type(&mut b.catcher, "game_state").await;
    b
}

/// The active seat plays to a single card without calling it. Go's
/// `playDownToOne`.
async fn play_down_to_one(th: &TestHub) -> Board {
    let mut b = seat_one_card_away(th).await;
    send_msg(
        &mut b.active,
        json!({"type": "play_card", "card": {"color": "red", "kind": "number", "value": 7}}),
    )
    .await;
    read_msg_of_type(&mut b.active, "card_played").await;
    read_msg_of_type(&mut b.catcher, "card_played").await;
    b
}

// Nothing stands between the press and the verdict. The opening 1.5s of every
// window used to be held for the seat that owed the call. A reaction the server
// delays is not a reaction it measures.
#[tokio::test]
async fn catch_uno_lands_on_the_instant_it_arrives() {
    let th = new_test_hub_with(e2e()).await;
    let mut b = play_down_to_one(&th).await;

    let pressed_at = Instant::now();
    send_msg(
        &mut b.catcher,
        json!({"type": "catch_uno", "target_index": b.active_idx}),
    )
    .await;
    let caught = read_msg_of_type(&mut b.active, "uno_caught").await;
    assert_eq!(seat_of(&caught, "player_index"), b.active_idx);
    // Generous enough to survive a loaded runner, far under the 1.5s hold.
    let waited = pressed_at.elapsed();
    assert!(
        waited <= Duration::from_secs(1),
        "the catch landed {waited:?} after the press: something is holding it back"
    );
    let seen = read_msg_of_type(&mut b.catcher, "uno_caught").await;
    assert_eq!(seat_of(&seen, "player_index"), b.active_idx);
    th.stop().await;
}

// And the seat that speaks first still wins: the declaration arrived before the
// press, so the press is a race lost, charged once and announced once.
#[tokio::test]
async fn catch_uno_declaring_first_beats_the_press() {
    let th = new_test_hub_with(e2e()).await;
    let mut b = play_down_to_one(&th).await;

    send_msg(&mut b.active, json!({"type": "declare_uno"})).await;
    read_msg_of_type(&mut b.active, "uno_declared").await;
    read_msg_of_type(&mut b.catcher, "uno_declared").await;
    send_msg(
        &mut b.catcher,
        json!({"type": "catch_uno", "target_index": b.active_idx}),
    )
    .await;

    let failed = read_msg_of_type(&mut b.catcher, "catch_failed").await;
    assert_eq!(
        seat_of(&failed, "player_index"),
        b.catcher_idx,
        "catch_failed should name the catcher"
    );
    read_msg_of_type(&mut b.catcher, "card_drawn").await;
    let seen = read_msg_of_type(&mut b.active, "catch_failed").await;
    assert_eq!(seat_of(&seen, "player_index"), b.catcher_idx);
    // The count of the catcher's penalty card, which every other seat is told.
    read_msg_of_type(&mut b.active, "card_drawn").await;
    // And nothing else: no uno_caught, no second card.
    assert!(
        stays_silent(&mut b.active, Duration::from_millis(300)).await,
        "the declared seat was still caught, or told about a second charge"
    );
    th.stop().await;
}

// Holding the button down is one press as far as the card is concerned: six
// presses against one offer cost exactly one, and every later one is broadcast
// to nobody. What each buys is another two seconds of lockout, answered to its
// sender alone.
#[tokio::test]
async fn catch_uno_spam_against_one_offer_is_one_card() {
    let th = new_test_hub_with(e2e()).await;
    let mut b = play_down_to_one(&th).await;

    // The seat speaks first, so every press below is a race already lost.
    send_msg(&mut b.active, json!({"type": "declare_uno"})).await;
    read_msg_of_type(&mut b.active, "uno_declared").await;
    read_msg_of_type(&mut b.catcher, "uno_declared").await;

    const PRESSES: usize = 6;
    for _ in 0..PRESSES {
        send_msg(
            &mut b.catcher,
            json!({"type": "catch_uno", "target_index": b.active_idx}),
        )
        .await;
    }

    let (mut failed, mut drawn, mut locked) = (0, 0, 0);
    for msg in drain(&mut b.catcher, Duration::from_millis(600)).await {
        match msg["type"].as_str().unwrap_or("") {
            "catch_failed" => {
                failed += 1;
                assert_eq!(seat_of(&msg, "player_index"), b.catcher_idx);
            }
            "card_drawn" => drawn += 1,
            "catch_locked" => {
                locked += 1;
                assert!(
                    msg["catch_locked_until"].as_i64().unwrap_or(0) > 0,
                    "catch_locked carried no instant to count down to"
                );
            }
            other => panic!("a mashed button produced a {other:?}"),
        }
    }
    assert!(
        failed == 1 && drawn == 1,
        "six presses against one offer: {failed} charges and {drawn} cards, want 1 and 1"
    );
    // One per press: a held thumb keeps pushing its own deadline out, so it is
    // never live at the instant a window opens.
    assert_eq!(
        locked, PRESSES,
        "the caller was told about {locked} lockouts, want one per press"
    );
    th.stop().await;
}

// The exploit the lockout closes, end to end. A catcher mashes the button
// while a seat sits one card from the finish: the first press costs a card,
// and every later one re-arms a two-second lockout, so the press that arrives
// with the window is refused.
#[tokio::test]
async fn catch_uno_mashing_cannot_take_the_window_it_opens_on() {
    let th = new_test_hub_with(e2e()).await;
    let mut b = seat_one_card_away(&th).await;

    // The masher's first press: a real wager that finds nobody.
    send_msg(
        &mut b.catcher,
        json!({"type": "catch_uno", "target_index": b.active_idx}),
    )
    .await;
    read_msg_of_type(&mut b.catcher, "catch_failed").await;
    let locked = read_msg_of_type(&mut b.catcher, "catch_locked").await;
    let until = locked["catch_locked_until"].as_i64().unwrap_or(0);
    assert!(
        until > 0,
        "catch_locked carried no instant to count down to"
    );

    // The seat plays down to its last card without calling it.
    send_msg(
        &mut b.active,
        json!({"type": "play_card", "card": {"color": "red", "kind": "number", "value": 7}}),
    )
    .await;
    read_msg_of_type(&mut b.catcher, "card_played").await;

    send_msg(
        &mut b.catcher,
        json!({"type": "catch_uno", "target_index": b.active_idx}),
    )
    .await;

    // Refused, and told so: the lock is re-stated and nothing is caught.
    let again = read_msg_of_type(&mut b.catcher, "catch_locked").await;
    assert!(
        again["catch_locked_until"].as_i64().unwrap_or(0) >= until,
        "a press inside the lockout moved the deadline backwards"
    );
    for msg in drain(&mut b.catcher, Duration::from_millis(300)).await {
        assert_ne!(
            msg["type"], "uno_caught",
            "a press made inside the lockout still took the catch"
        );
    }
    th.stop().await;
}
