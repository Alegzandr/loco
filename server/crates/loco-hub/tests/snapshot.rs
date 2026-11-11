//! A snapshot is what turns a deploy from "everybody loses their match" into
//! a reconnect the client already knows how to do. These tests exercise the
//! whole round trip through real sockets rather than the marshalling alone:
//! the thing that has to survive is a player's hand, and the only proof of
//! that is a player getting it back.

#![allow(clippy::field_reassign_with_default)]

use loco_hub::testkit::*;
use loco_hub::{HubConfig, SNAPSHOT_SCHEMA_VERSION};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// A path in a fresh temp dir that no snapshot has written yet; the directory
/// is removed by the guard.
struct TempPath {
    dir: PathBuf,
    path: PathBuf,
}

impl Drop for TempPath {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn snapshot_path(name: &str) -> TempPath {
    let dir = std::env::temp_dir().join(format!(
        "loco-snap-{name}-{}",
        loco_hub::tokens::generate_conn_id()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("snapshot.json");
    TempPath { dir, path }
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

/// `setup_two_player_game` plus the personalised state each player was dealt,
/// which is the thing a restart has to give back.
struct Kept {
    game: TwoPlayers,
    states: [Value; 2],
}

async fn setup_game_keeping_state(th: &TestHub) -> Kept {
    let mut alice = dial_ws(th).await;
    send_msg(
        &mut alice,
        json!({"type": "create_room", "nickname": "Alice"}),
    )
    .await;
    let created = read_msg_of_type(&mut alice, "room_created").await;
    let code = created["room_code"].as_str().unwrap().to_owned();

    let mut bob = dial_ws(th).await;
    send_msg(
        &mut bob,
        json!({"type": "join_room", "nickname": "Bob", "room_code": code}),
    )
    .await;
    let joined = read_msg_of_type(&mut bob, "room_joined").await;
    read_msg_of_type(&mut alice, "player_joined").await;

    send_msg(&mut alice, json!({"type": "start_game"})).await;
    let gs1 = read_msg_of_type(&mut alice, "game_started").await;
    let gs2 = read_msg_of_type(&mut bob, "game_started").await;
    complete_map_load(&mut [&mut alice, &mut bob]).await;
    assert!(
        gs1["state"].is_object() && gs2["state"].is_object(),
        "game_started carried no state"
    );
    let tokens = [
        created["session_token"].as_str().unwrap().to_owned(),
        joined["session_token"].as_str().unwrap().to_owned(),
    ];
    Kept {
        game: TwoPlayers {
            alice,
            bob,
            code,
            tokens,
        },
        states: [gs1["state"].clone(), gs2["state"].clone()],
    }
}

/// Dials and asks for a seat back.
async fn reconnect_as(th: &TestHub, code: &str, nickname: &str, token: &str) -> Ws {
    let mut ws = dial_ws(th).await;
    send_msg(
        &mut ws,
        json!({"type": "join_room", "nickname": nickname, "room_code": code, "session_token": token}),
    )
    .await;
    ws
}

/// Compares everything a player would notice.
fn assert_same_state(who: &str, want: &Value, got: &Value) {
    for field in [
        "your_index",
        "hand",
        "discard",
        "active_color",
        "turn",
        "direction",
        "pending_draw",
        "round_number",
        // The map is drawn once per match. A restored table that redrew it
        // would put two players in different rooms.
        "map_id",
        "time_of_day",
        "weather",
        "match_format",
    ] {
        assert_eq!(got[field], want[field], "{who}: {field}");
    }
    assert_eq!(
        got["players"].as_array().map(Vec::len),
        want["players"].as_array().map(Vec::len),
        "{who}: players"
    );
}

/// Ends the match: the host is handed one card on its own turn
/// and plays it, after the LOCO! call it owes.
async fn win_match_returning_end(host: &mut Ws, others: &mut [&mut Ws]) -> Value {
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
    let end = read_msg_of_type(host, "match_end").await;
    for c in others.iter_mut() {
        read_msg_of_type(c, "match_end").await;
    }
    end
}

fn read_snapshot_file(path: &Path) -> Value {
    serde_json::from_slice(&std::fs::read(path).expect("read snapshot")).expect("unmarshal")
}

fn write_snapshot_file(path: &Path, raw: &Value) {
    std::fs::write(path, raw.to_string()).expect("write snapshot");
}

fn backdate_snapshot(path: &Path, by: Duration) {
    let mut raw = read_snapshot_file(path);
    let at = (SystemTime::now() - by)
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    raw["saved_at"] = json!(at);
    write_snapshot_file(path, &raw);
}

fn rewrite_schema_version(path: &Path, version: i64) {
    let mut raw = read_snapshot_file(path);
    raw["schema_version"] = json!(version);
    write_snapshot_file(path, &raw);
}

#[tokio::test]
async fn snapshot_match_survives_a_restart() {
    let tp = snapshot_path("survive");

    // --- the process that is about to be replaced ---
    let th1 = new_test_hub().await;
    let Kept {
        game:
            TwoPlayers {
                mut alice,
                mut bob,
                code,
                tokens,
            },
        states,
    } = setup_game_keeping_state(&th1).await;

    th1.hub.begin_drain();
    read_msg_of_type(&mut alice, "server_updating").await;
    read_msg_of_type(&mut bob, "server_updating").await;

    th1.hub
        .save_snapshot(&tp.path)
        .await
        .expect("save_snapshot");
    drop((alice, bob));
    th1.stop().await;

    // --- the process that replaces it ---
    let th2 = new_test_hub().await;
    th2.hub
        .load_snapshot(&tp.path)
        .await
        .expect("load_snapshot");
    assert!(
        !tp.path.exists(),
        "the snapshot file survived the load; a snapshot must never be replayed twice"
    );

    // Both clients come back exactly the way a dropped socket does: same
    // nickname, same table code, same token out of sessionStorage.
    let mut back1 = reconnect_as(&th2, &code, "Alice", &tokens[0]).await;
    let mut back2 = reconnect_as(&th2, &code, "Bob", &tokens[1]).await;

    let after1 = read_msg_of_type(&mut back1, "player_reconnected").await;
    assert!(after1["state"].is_object(), "no state after reconnecting");
    assert_same_state("Alice", &states[0], &after1["state"]);

    let after2 = read_msg_of_type(&mut back2, "player_reconnected").await;
    assert!(after2["state"].is_object(), "no state after reconnecting");
    assert_same_state("Bob", &states[1], &after2["state"]);
    th2.stop().await;
}

// The stream does not stop because the server was deployed. A host who came
// back to a table whose code had gone readable again would find that out from
// their own capture, which is late.
#[tokio::test]
async fn snapshot_streamer_mode_survives_a_restart() {
    let tp = snapshot_path("streamer");

    let th1 = new_test_hub().await;
    let Kept {
        game:
            TwoPlayers {
                mut alice,
                mut bob,
                code,
                tokens,
            },
        ..
    } = setup_game_keeping_state(&th1).await;

    send_msg(
        &mut alice,
        json!({"type": "set_streamer_mode", "streamer_mode": true}),
    )
    .await;
    read_msg_of_type(&mut alice, "streamer_mode_changed").await;
    read_msg_of_type(&mut bob, "streamer_mode_changed").await;

    th1.hub
        .save_snapshot(&tp.path)
        .await
        .expect("save_snapshot");
    drop((alice, bob));
    th1.stop().await;

    let th2 = new_test_hub().await;
    th2.hub
        .load_snapshot(&tp.path)
        .await
        .expect("load_snapshot");

    let mut back = reconnect_as(&th2, &code, "Bob", &tokens[1]).await;
    let after = read_msg_of_type(&mut back, "player_reconnected").await;
    assert!(after["state"].is_object(), "no state after reconnecting");
    assert_eq!(
        after["state"]["streamer_mode"], true,
        "the restored table forgot the host was streaming"
    );
    th2.stop().await;
}

// The match is timed from the moment it opened, and a deploy in the middle of
// it must not restart that clock: the record written on the far side of the
// restart still measures from the real open.
#[tokio::test]
async fn snapshot_match_duration_survives_a_restart() {
    let tp = snapshot_path("duration");

    let th1 = new_test_hub_with(e2e()).await;
    let Kept {
        game:
            TwoPlayers {
                alice,
                bob,
                code,
                tokens,
            },
        ..
    } = setup_game_keeping_state(&th1).await;

    th1.hub
        .save_snapshot(&tp.path)
        .await
        .expect("save_snapshot");
    drop((alice, bob));
    th1.stop().await;

    let th2 = new_test_hub_with(e2e()).await;
    th2.hub
        .load_snapshot(&tp.path)
        .await
        .expect("load_snapshot");

    let mut back1 = reconnect_as(&th2, &code, "Alice", &tokens[0]).await;
    read_msg_of_type(&mut back1, "player_reconnected").await;
    let mut back2 = reconnect_as(&th2, &code, "Bob", &tokens[1]).await;
    read_msg_of_type(&mut back2, "player_reconnected").await;

    let end = win_match_returning_end(&mut back1, &mut [&mut back2]).await;
    let history = end["match_history"].as_array().expect("match_history");
    assert_eq!(history.len(), 1, "match_history rows: {end}");
    let got = history[0]["duration_ms"].as_i64().unwrap_or(0);
    assert!(
        got >= 1,
        "duration_ms after a restart = {got}, want at least 1: the open stamp did not travel"
    );
    th2.stop().await;
}

#[tokio::test]
async fn snapshot_restored_seat_keeps_playing() {
    let tp = snapshot_path("keeps");

    let th1 = new_test_hub_with(e2e()).await;
    let Kept {
        game:
            TwoPlayers {
                alice,
                bob,
                code,
                tokens,
            },
        states,
    } = setup_game_keeping_state(&th1).await;

    th1.hub
        .save_snapshot(&tp.path)
        .await
        .expect("save_snapshot");
    drop((alice, bob));
    th1.stop().await;

    let th2 = new_test_hub_with(e2e()).await;
    th2.hub
        .load_snapshot(&tp.path)
        .await
        .expect("load_snapshot");

    let mut back1 = reconnect_as(&th2, &code, "Alice", &tokens[0]).await;
    read_msg_of_type(&mut back1, "player_reconnected").await;
    let mut back2 = reconnect_as(&th2, &code, "Bob", &tokens[1]).await;
    read_msg_of_type(&mut back2, "player_reconnected").await;

    // A restored room is a room: it takes moves, and the table is open. If the
    // map-loading gate came back shut and nothing reopened it, this play is
    // refused with "waiting for every player to load the table". Two cards, so
    // the play is an ordinary one rather than a finish behind the LOCO! gate.
    send_msg(
        &mut back1,
        json!({"type": "debug_set_state", "debug": {
            "hand": [card("red", 3), card("blue", 9)],
            "discard": card("red", 5),
            "active_color": "red",
            "pending_draw": 0,
            "current_turn": states[0]["your_index"],
        }}),
    )
    .await;
    read_msg_of_type(&mut back1, "game_state").await;

    send_msg(
        &mut back1,
        json!({"type": "play_card", "card": card("red", 3)}),
    )
    .await;
    let played = read_msg_of_type(&mut back2, "card_played").await;
    assert_eq!(
        played["card"]["value"], 3,
        "a restored match refused a legal play: {played}"
    );
    th2.stop().await;
}

#[tokio::test]
async fn snapshot_lobbies_are_not_saved() {
    let tp = snapshot_path("lobbies");

    let th = new_test_hub().await;
    let mut conn = dial_ws(&th).await;
    send_msg(
        &mut conn,
        json!({"type": "create_room", "nickname": "Alice"}),
    )
    .await;
    read_msg_of_type(&mut conn, "room_created").await;

    th.hub.save_snapshot(&tp.path).await.expect("save_snapshot");
    th.stop().await;

    // A lobby has nothing to lose and its host is on the table screen, not in
    // a match. With nothing else to carry there is no file at all: a clean
    // deploy leaves no snapshot behind.
    assert!(
        !tp.path.exists(),
        "a snapshot was written for a lobby-only server: {}",
        read_snapshot_file(&tp.path)
    );
}

#[tokio::test]
async fn snapshot_refused_when_too_old() {
    let tp = snapshot_path("old");

    let th1 = new_test_hub().await;
    let game = setup_two_player_game(&th1).await;
    th1.hub
        .save_snapshot(&tp.path)
        .await
        .expect("save_snapshot");
    drop(game);
    th1.stop().await;

    let max_age = HubConfig::default().timings.snapshot_max_age;
    backdate_snapshot(&tp.path, max_age + Duration::from_secs(60));

    let th2 = new_test_hub().await;
    th2.hub
        .load_snapshot(&tp.path)
        .await
        .expect("load_snapshot on a stale file should be a no-op");
    // Nobody is coming back after that long, and reviving their table would
    // put a room nobody can reach on a fresh server.
    assert_eq!(
        th2.hub.metrics_stats().rooms_active,
        0,
        "a stale snapshot restored a room"
    );
    th2.stop().await;
}

#[tokio::test]
async fn snapshot_refused_on_schema_mismatch() {
    let tp = snapshot_path("schema");

    let th1 = new_test_hub().await;
    let game = setup_two_player_game(&th1).await;
    th1.hub
        .save_snapshot(&tp.path)
        .await
        .expect("save_snapshot");
    drop(game);
    th1.stop().await;

    rewrite_schema_version(&tp.path, SNAPSHOT_SCHEMA_VERSION + 1);

    let th2 = new_test_hub().await;
    // The whole point of the version: a room shaped by another build is not a
    // room this one can play, and guessing is worse than dropping it.
    th2.hub
        .load_snapshot(&tp.path)
        .await
        .expect("load_snapshot on a foreign schema should be a no-op");
    assert_eq!(
        th2.hub.metrics_stats().rooms_active,
        0,
        "a foreign-schema snapshot restored a room"
    );
    th2.stop().await;
}

#[tokio::test]
async fn snapshot_no_file_is_not_an_error() {
    let tp = snapshot_path("none");
    let th = new_test_hub().await;
    // The ordinary start: nothing was ever written, and the server boots.
    th.hub
        .load_snapshot(&tp.path)
        .await
        .expect("load_snapshot with no file");
    th.stop().await;
}

#[tokio::test]
async fn snapshot_disabled_when_no_path_is_configured() {
    let th = new_test_hub().await;
    // Local dev and the E2E suite run without a snapshot path, and must behave
    // exactly as they did before this existed.
    th.hub
        .save_snapshot(Path::new(""))
        .await
        .expect("save_snapshot(\"\")");
    th.hub
        .load_snapshot(Path::new(""))
        .await
        .expect("load_snapshot(\"\")");
    th.stop().await;
}

// A game against the bot is a match in flight like any other: the deploy that
// interrupts it must hand it back, the bot still in its chair.
#[tokio::test]
async fn snapshot_solo_game_survives_a_restart() {
    let tp = snapshot_path("solo");

    let th1 = new_test_hub().await;
    let mut alice = dial_ws(&th1).await;
    send_msg(&mut alice, json!({"type": "play_bot", "nickname": "Alice"})).await;
    let started = read_msg_of_type(&mut alice, "game_started").await;
    send_msg(&mut alice, json!({"type": "map_ready"})).await;
    let code = started["room_code"].as_str().unwrap().to_owned();
    let token = started["session_token"].as_str().unwrap().to_owned();

    th1.hub.begin_drain();
    read_msg_of_type(&mut alice, "server_updating").await;
    th1.hub
        .save_snapshot(&tp.path)
        .await
        .expect("save_snapshot");
    drop(alice);
    th1.stop().await;
    assert!(tp.path.exists(), "a game against the bot wrote no snapshot");

    let th2 = new_test_hub().await;
    th2.hub
        .load_snapshot(&tp.path)
        .await
        .expect("load_snapshot");
    let mut back = reconnect_as(&th2, &code, "Alice", &token).await;
    let after = read_msg_of_type(&mut back, "player_reconnected").await;
    assert!(after["state"].is_object(), "no state after reconnecting");
    th2.stop().await;
}
