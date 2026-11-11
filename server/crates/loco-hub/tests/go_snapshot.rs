//! The deploy that replaces the Go server with this one: a match in flight
//! when Go drained must come back on the Rust server.
//!
//! `fixtures/go_snapshot_v5.json` was written by the real Go server
//! (`server/`, before its removal), not by hand: two humans at a table, the
//! map gate passed, Bob holding the turn after one draw, then Ctrl-Break, a 2s
//! drain that timed out, and the snapshot Go writes on the way out. The two
//! session tokens below are the ones Go issued for those seats.

#![allow(clippy::field_reassign_with_default)]

use loco_hub::HubConfig;
use loco_hub::testkit::*;
use serde_json::json;
use std::time::Duration;

const FIXTURE: &str = include_str!("fixtures/go_snapshot_v5.json");
const CODE: &str = "HMUKRC";
const ALICE_TOKEN: &str = "606fa97edf4b4748bb1db8932e770807";
const BOB_TOKEN: &str = "ffceb063b02cea6ea507364f660fc77f";

#[tokio::test]
async fn a_match_go_snapshotted_is_reclaimed_on_rust() {
    let dir = std::env::temp_dir().join(format!(
        "loco-go-snap-{}",
        loco_hub::tokens::generate_conn_id()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("snapshot.json");
    std::fs::write(&path, FIXTURE).unwrap();

    // The file is as old as the fixture; the age check is tested elsewhere.
    let mut c = HubConfig::default();
    c.timings.snapshot_max_age = Duration::from_secs(100 * 365 * 24 * 3600);
    let th = new_test_hub_with(c).await;
    th.hub.load_snapshot(&path).await.expect("load_snapshot");
    assert!(!path.exists(), "a snapshot is never replayed twice");
    assert_eq!(th.hub.health().rooms, 1, "the Go match was not restored");

    let mut alice = dial_ws(&th).await;
    send_msg(
        &mut alice,
        json!({"type": "join_room", "nickname": "Alice", "room_code": CODE, "session_token": ALICE_TOKEN}),
    )
    .await;
    let back = read_msg_of_type(&mut alice, "player_reconnected").await;
    let st = &back["state"];
    assert_eq!(back["room_code"], CODE);
    assert_eq!(st["your_index"], 0);
    assert_eq!(st["hand"].as_array().map(Vec::len), Some(8), "{st}");
    assert_eq!(st["turn"], 1);
    assert_eq!(st["discard"]["color"], "red");
    assert_eq!(st["discard"]["value"], 2);
    assert_eq!(st["map_id"], "orbit");
    assert_eq!(st["time_of_day"], "day");
    assert_eq!(st["weather"], "fog");
    assert_ne!(
        back["session_token"], ALICE_TOKEN,
        "a reclaim spends Go's token too"
    );

    let mut bob = dial_ws(&th).await;
    send_msg(
        &mut bob,
        json!({"type": "join_room", "nickname": "Bob", "room_code": CODE, "session_token": BOB_TOKEN}),
    )
    .await;
    let back = read_msg_of_type(&mut bob, "player_reconnected").await;
    assert_eq!(back["state"]["hand"].as_array().map(Vec::len), Some(9));

    // Bob had drawn before the deploy, so the turn he holds is his to pass.
    send_msg(&mut bob, json!({"type": "pass_turn"})).await;
    let tc = read_msg_of_type(&mut alice, "turn_changed").await;
    assert_eq!(tc["turn"], 0);

    th.stop().await;
    let _ = std::fs::remove_dir_all(&dir);
}
