//! What a departure looks like from the other side of the table, once the seat
//! stops being held.

mod common_b;

use common_b::*;
use loco_hub::HubConfig;
use loco_hub::testkit::*;
use serde_json::json;
use std::time::Duration;

fn hold(d: Duration) -> HubConfig {
    let mut c = debug_cfg();
    short_reconnect_hold(&mut c, d);
    c
}

// A seat whose reconnect window closes mid-match cannot be removed — the hands,
// the scores and the turn order are all indexed by it until the round ends — so
// it stays in the roster. It used to stay in it as *connected*: the player_left
// saying Bob is gone carried a roster saying Bob is here.
#[tokio::test]
async fn reconnect_expiry_seat_stops_being_reported_connected() {
    let th = new_test_hub_with(hold(Duration::from_millis(120))).await;
    let TwoPlayers { mut alice, bob, .. } = setup_two_player_game(&th).await;
    drop(bob);

    read_msg_of_type(&mut alice, "player_disconnected").await;
    let left = read_msg_of_type(&mut alice, "player_left").await;
    assert_eq!(left["nickname"], "Bob", "{left}");
    let (connected, present) = seat_connected(&left["players"], 1);
    assert!(
        present,
        "seat 1 missing from the roster; a running match indexes hands by it"
    );
    assert!(
        !connected,
        "seat 1 reported connected in the message announcing it left"
    );
    th.stop().await;
}

// The match is over and the rematch is not. A socket that drops on the
// game-over screen used to lose its seat outright. The seat is held now, and
// reclaimed with its token like any other.
#[tokio::test]
async fn game_over_disconnect_seat_is_held_and_reclaimable() {
    let th = new_test_hub_with(hold(Duration::from_secs(5))).await;
    let (conns, code, tokens) = won_table(&th, &["Alice", "Bob"]).await;
    let mut it = conns.into_iter();
    let (mut conn1, conn2) = (it.next().unwrap(), it.next().unwrap());

    drop(conn2);

    // Held, not released: a departure would be player_left.
    let away = read_msg_of_type(&mut conn1, "player_disconnected").await;
    assert_eq!(seat_of(&away, "player_index"), 1);
    assert_eq!(
        len_of(&away["players"]),
        2,
        "want the seat held rather than removed"
    );

    let mut back = dial_ws(&th).await;
    send_msg(
        &mut back,
        json!({"type": "join_room", "nickname": "Bob", "room_code": code, "session_token": tokens[1]}),
    )
    .await;
    let msg = read_msg_of_type(&mut back, "player_reconnected").await;
    assert_eq!(seat_of(&msg, "player_id"), 1);
    // A finished table has no board to rebuild.
    assert!(
        msg.get("state").is_none_or(|s| s.is_null()),
        "player_reconnected carried a game state at a finished table: {msg}"
    );
    let tok = msg["session_token"].as_str().unwrap_or("");
    assert!(
        !tok.is_empty() && tok != tokens[1],
        "reclaim did not spend and reissue the token"
    );

    // A seat that comes back is handed the whole offer state, not an increment.
    read_msg_of_type(&mut back, "rematch_offered").await;

    // And the button works, which is the whole point of holding the seat.
    send_msg(&mut back, json!({"type": "rematch"})).await;
    let offered = read_msg_of_type(&mut back, "rematch_offered").await;
    assert_eq!(
        ints(&offered["rematch_offers"]),
        vec![1],
        "want the reclaimed seat's ask: {offered}"
    );
    th.stop().await;
}

// The hold is a hold, not a reprieve. When it expires at a finished table the
// seat is removed for real — a phantom there is worse than a stale flag,
// because the next match would deal a hand to nobody.
#[tokio::test]
async fn game_over_disconnect_expiry_removes_the_seat() {
    let th = new_test_hub_with(hold(Duration::from_millis(120))).await;
    let (conns, _, _) = won_table(&th, &["Alice", "Bob"]).await;
    let mut it = conns.into_iter();
    let (mut conn1, conn2) = (it.next().unwrap(), it.next().unwrap());

    drop(conn2);
    read_msg_of_type(&mut conn1, "player_disconnected").await;

    let left = read_msg_of_type(&mut conn1, "player_left").await;
    assert_eq!(len_of(&left["players"]), 1, "{left}");
    let (_, present) = seat_connected(&left["players"], 1);
    assert!(!present, "seat 1 still in the roster of a finished table");
    th.stop().await;
}
