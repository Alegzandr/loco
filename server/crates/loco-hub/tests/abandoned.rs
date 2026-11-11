//! A match nobody is at any more, and the two ways it used to go on anyway:
//! once the other seat's hold has expired, nothing at it will ever act again,
//! and the room went on auto-playing for it until the empty-room timeout.

mod common_b;

use common_b::*;
use loco_hub::HubConfig;
use loco_hub::testkit::*;
use serde_json::json;
use std::time::Duration;

fn hold(d: Duration) -> HubConfig {
    let mut c = HubConfig::default();
    short_reconnect_hold(&mut c, d);
    c
}

// A held seat is somebody who may still come back, so the match is theirs to
// come back to: leaving in front of one is the ordinary 1v1 ending and not the
// abandoned-table one, and the table is still there afterwards.
#[tokio::test]
async fn leave_match_goes_to_the_held_seat_rather_than_closing_the_table() {
    let th = new_test_hub_with(hold(Duration::from_secs(10))).await;
    let TwoPlayers {
        mut alice,
        bob,
        code,
        ..
    } = setup_two_player_game(&th).await;
    drop(bob);
    read_msg_of_type(&mut alice, "player_disconnected").await;

    send_msg(&mut alice, json!({"type": "leave_room"})).await;
    read_msg_of_type(&mut alice, "left_room").await;

    assert!(
        !room_gone(&th, &code).await,
        "the table closed under a seat that was still inside its hold"
    );
    th.stop().await;
}

// Once the hold has expired there is nobody to refuse on behalf of, and the
// survivor had no in-game action left at all.
#[tokio::test]
async fn leave_match_allowed_once_nobody_is_left_to_leave_on() {
    let th = new_test_hub_with(hold(Duration::from_millis(120))).await;
    let TwoPlayers {
        mut alice,
        bob,
        code,
        ..
    } = setup_two_player_game(&th).await;
    drop(bob);
    read_msg_of_type(&mut alice, "player_disconnected").await;
    read_msg_of_type(&mut alice, "player_left").await;

    send_msg(&mut alice, json!({"type": "leave_room"})).await;
    read_msg_of_type(&mut alice, "left_room").await;

    // And the table goes with them: there is no one to award the match to, so
    // nothing is left holding a room code.
    assert!(
        wait_room_gone(&th, &code, Duration::from_secs(3)).await,
        "the table outlived the last player leaving it"
    );
    th.stop().await;
}

// The other half of the same state, reached without anybody pressing anything:
// both sockets go and both holds expire. The empty-room timeout is left at its
// five minutes on purpose: if it were the thing doing this work, this test
// would take five minutes to fail.
#[tokio::test]
async fn abandoned_match_last_expiry_closes_the_table() {
    let th = new_test_hub_with(hold(Duration::from_millis(120))).await;
    let TwoPlayers {
        alice, bob, code, ..
    } = setup_two_player_game(&th).await;
    drop(alice);
    drop(bob);

    assert!(
        wait_room_gone(&th, &code, Duration::from_secs(3)).await,
        "the table outlived both reconnect windows with nobody at it"
    );
    th.stop().await;
}
