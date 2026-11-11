//! The two things a table owning its own task is supposed to buy, and the one
//! it could have cost. Both are through real sockets, because what is being
//! claimed is about the server a player is connected to and not about a
//! function.

use loco_hub::testkit::*;
use serde_json::json;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

// A panic on a table's own task would take that task, and a room whose task is
// gone does not fail, it goes quiet: every message to it would queue behind
// nothing, for ever. So the recover in actor.rs is load-bearing, and this is
// what says so: the table answers the failed message and then keeps playing.
#[tokio::test]
async fn table_panic_costs_one_message_not_the_table() {
    let th = new_test_hub().await;
    let panicking = Arc::new(AtomicBool::new(true));
    let p = panicking.clone();
    th.hub.set_table_probe(move |_| {
        if p.load(Ordering::SeqCst) {
            panic!("audit probe");
        }
    });

    let mut conn = dial_ws(&th).await;
    send_msg(
        &mut conn,
        json!({"type": "create_room", "nickname": "Auditeur"}),
    )
    .await;
    read_msg_of_type(&mut conn, "room_created").await;

    // create_room is the hub's; the first message this table handles is the
    // one that panics.
    send_msg(
        &mut conn,
        json!({"type": "set_max_players", "max_players": 4}),
    )
    .await;
    let m = read_msg(&mut conn).await;
    assert_eq!(
        m["type"], "error",
        "a panicking handler must answer an error, got {m}"
    );
    assert_eq!(th.hub.metrics_stats().handler_panics, 1);

    // The table's task survived it: the very next message is served.
    panicking.store(false, Ordering::SeqCst);
    send_msg(
        &mut conn,
        json!({"type": "set_max_players", "max_players": 4}),
    )
    .await;
    let m = read_msg_of_type(&mut conn, "lobby_config_changed").await;
    assert_eq!(m["max_players"], 4, "max players after the table recovered");
    th.stop().await;
}

// One table is held still inside a handler and another one deals a whole match
// around it. Before the split this could not pass at all: the hub would be
// sitting in the first table's handler and would not read the second table's
// messages until it came back.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn one_slow_table_does_not_hold_up_another() {
    let th = new_test_hub().await;
    let slow_code = Arc::new(Mutex::new(String::new()));
    let entered = Arc::new(AtomicBool::new(false));
    let (release_tx, release_rx) = std::sync::mpsc::channel::<()>();
    let release_rx = Arc::new(Mutex::new(release_rx));
    {
        let slow_code = slow_code.clone();
        let entered = entered.clone();
        th.hub.set_table_probe(move |code| {
            let slow = slow_code.lock().unwrap().clone();
            if !slow.is_empty() && code == slow {
                entered.store(true, Ordering::SeqCst);
                let _ = release_rx
                    .lock()
                    .unwrap()
                    .recv_timeout(Duration::from_secs(10));
            }
        });
    }

    // The table that is about to stop answering.
    let mut slow = dial_ws(&th).await;
    send_msg(
        &mut slow,
        json!({"type": "create_room", "nickname": "Lente"}),
    )
    .await;
    let created = read_msg_of_type(&mut slow, "room_created").await;

    // The table that must not care. Opened first, so its own create_room is
    // not itself queued behind anything.
    let mut quick = dial_ws(&th).await;
    send_msg(
        &mut quick,
        json!({"type": "create_room", "nickname": "Rapide"}),
    )
    .await;
    read_msg_of_type(&mut quick, "room_created").await;

    // Wedge the slow table inside a handler and make sure it is really in
    // there before asking anything of the other one: the probe says so itself.
    *slow_code.lock().unwrap() = created["room_code"].as_str().unwrap().to_owned();
    send_msg(
        &mut slow,
        json!({"type": "set_max_players", "max_players": 4}),
    )
    .await;
    let e = entered.clone();
    assert!(
        eventually(Duration::from_secs(3), move || e.load(Ordering::SeqCst)).await,
        "the slow table never settled inside its handler"
    );

    // A whole match is dealt at the other table meanwhile.
    send_msg(&mut quick, json!({"type": "add_bot"})).await;
    read_msg_of_type(&mut quick, "player_joined").await;
    send_msg(&mut quick, json!({"type": "start_game"})).await;
    read_msg_of_type(&mut quick, "game_started").await;
    complete_map_load(&mut [&mut quick]).await;

    // And the slow table catches up once it is let go, rather than having
    // lost the message.
    release_tx.send(()).unwrap();
    let m = read_msg_of_type(&mut slow, "lobby_config_changed").await;
    assert_eq!(m["max_players"], 4, "the held table lost its message");
    th.stop().await;
}
