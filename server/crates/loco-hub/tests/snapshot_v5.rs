//! The migration from schema 5 to 6 is the version gate: a version-5 file is
//! dropped whole and nothing in it is restored.
//!
//! `fixtures/snapshot_v5.json` is a real version-5 file, written by a drain
//! rather than by hand: two humans at a table, the map gate passed, Bob
//! holding the turn after one draw. Everything that would let it restore under
//! the old shape is in it, including the session tokens below, so the only
//! thing keeping it out is the gate.

#![allow(clippy::field_reassign_with_default)]

use loco_hub::testkit::*;
use loco_hub::{HubConfig, SNAPSHOT_SCHEMA_VERSION};
use serde_json::json;
use std::time::Duration;

const FIXTURE: &str = include_str!("fixtures/snapshot_v5.json");
const CODE: &str = "HMUKRC";
const ALICE_TOKEN: &str = "606fa97edf4b4748bb1db8932e770807";

#[tokio::test]
async fn a_version_5_snapshot_is_dropped_whole() {
    assert_ne!(SNAPSHOT_SCHEMA_VERSION, 5, "the fixture is the old shape");
    let dir = std::env::temp_dir().join(format!(
        "loco-snap-v5-{}",
        loco_hub::tokens::generate_conn_id()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("snapshot.json");
    std::fs::write(&path, FIXTURE).unwrap();

    // Old enough to fail the age check too, were the version not checked
    // first: the age must not be what keeps it out.
    let mut c = HubConfig::default();
    c.timings.snapshot_max_age = Duration::from_secs(100 * 365 * 24 * 3600);
    let th = new_test_hub_with(c).await;
    th.hub
        .load_snapshot(&path)
        .await
        .expect("an old snapshot refused the boot");
    assert!(!path.exists(), "a refused snapshot was left to be replayed");
    assert_eq!(th.hub.health().rooms, 0, "a version-5 match was restored");

    // The table is not there to come back to: the token is a stranger's.
    let mut alice = dial_ws(&th).await;
    send_msg(
        &mut alice,
        json!({"type": "join_room", "nickname": "Alice", "room_code": CODE, "session_token": ALICE_TOKEN}),
    )
    .await;
    let refused = read_msg_of_type(&mut alice, "error").await;
    assert!(refused["error"].is_string(), "{refused}");

    th.stop().await;
    let _ = std::fs::remove_dir_all(&dir);
}
