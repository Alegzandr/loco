//! A bot's round-taking move, held to its instant.

#![allow(clippy::field_reassign_with_default)] // a test narrows one knob of the default config

use futures_util::StreamExt;
use loco_hub::HubConfig;
use loco_hub::testkit::*;
use serde_json::{Value, json};
use std::time::Duration;
use tokio::time::Instant;
use tokio_tungstenite::tungstenite::Message;

/// Opens a 1v1 against a bot, past the map gate, and returns the socket with
/// our seat and the bot's.
async fn bot_finish_table(th: &TestHub) -> (Ws, i64, i64) {
    let mut conn = dial_ws(th).await;
    send_msg(
        &mut conn,
        json!({"type": "create_room", "nickname": "Alice"}),
    )
    .await;
    read_msg_of_type(&mut conn, "room_created").await;
    send_msg(&mut conn, json!({"type": "add_bot"})).await;
    read_msg_of_type(&mut conn, "player_joined").await;
    send_msg(&mut conn, json!({"type": "start_game"})).await;
    let gs = read_msg_of_type(&mut conn, "game_started").await;
    complete_map_load(&mut [&mut conn]).await;
    let me = gs["state"]["your_index"]
        .as_i64()
        .expect("missing game state in game_started");
    (conn, me, 1 - me)
}

/// Reads until a message of `typ` arrives or `budget` runs out, and says when
/// it arrived. Unlike `read_msg_of_type` it does not count messages: a held
/// move leaves the socket quiet for a while, and quiet is what is measured.
async fn await_type(conn: &mut Ws, typ: &str, budget: Duration) -> (Value, Instant) {
    let end = Instant::now() + budget;
    loop {
        let frame = tokio::time::timeout_at(end, conn.next())
            .await
            .unwrap_or_else(|_| panic!("no {typ:?} within {budget:?}"))
            .expect("socket closed")
            .expect("read");
        if let Message::Text(t) = frame
            && let Ok(v) = serde_json::from_str::<Value>(t.as_str())
            && v["type"] == typ
        {
            return (v, Instant::now());
        }
    }
}

/// Every jitter off, no bot catch.
fn pinned() -> HubConfig {
    let mut c = HubConfig::default();
    c.debug_mode = true;
    c.timings.bots.jitter_max = Duration::ZERO;
    c.timings.bots.uno_jitter_max = Duration::ZERO;
    c.timings.bots.finish_jitter_max = Duration::ZERO;
    c.timings.bots.interrupt_jitter_max = Duration::ZERO;
    c.timings.bots.catch_prob = 0.0;
    c
}

fn red5() -> Value {
    json!({"color": "red", "kind": "number", "value": 5})
}

// A bot that can take the round by slamming its last card onto ours does not
// do it at the pace of an ordinary slam. The finish waits finish_delay from
// the card it answers.
#[tokio::test]
async fn bot_finish_interject_is_held_to_the_finish_delay() {
    let mut c = pinned();
    c.timings.bots.think = Duration::from_secs(30); // the slam is the only way it can finish
    c.timings.bots.interrupt_delay = Duration::from_millis(10);
    c.timings.bots.interrupt_prob = 1.0;
    c.timings.bots.uno_delay = Duration::ZERO;
    let finish = Duration::from_millis(400);
    c.timings.bots.finish_delay = finish;
    let th = new_test_hub_with(c).await;

    let (mut conn, me, bot) = bot_finish_table(&th).await;
    send_msg(
        &mut conn,
        json!({"type": "debug_set_state", "debug": {
            "hand": [red5(), {"color": "blue", "kind": "number", "value": 9}],
            "hands": [{"player_index": bot, "hand": [red5()]}],
            "discard": {"color": "red", "kind": "number", "value": 3},
            "active_color": "red",
            "pending_draw": 0,
            "current_turn": me
        }}),
    )
    .await;
    read_msg_of_type(&mut conn, "game_state").await;

    let start = Instant::now();
    send_msg(&mut conn, json!({"type": "play_card", "card": red5()})).await;
    let (got, at) = await_type(&mut conn, "interrupt_success", Duration::from_secs(3)).await;
    assert_eq!(
        seat_of(&got, "player_index"),
        bot,
        "interrupt_success named the wrong seat"
    );
    let held = at - start;
    assert!(
        held >= finish,
        "the bot took the round {held:?} after our card, want at least {finish:?}"
    );
    await_type(&mut conn, "round_end", Duration::from_secs(3)).await;
    th.stop().await;
}

// Same floor on the bot's own turn: its last two copies, dumped together with
// the call on the message, were on the table at the ordinary think delay.
#[tokio::test]
async fn bot_finish_turn_batch_is_held_to_the_finish_delay() {
    let mut c = pinned();
    c.timings.bots.think = Duration::from_millis(10);
    c.timings.bots.interrupt_prob = 0.0;
    let finish = Duration::from_millis(400);
    c.timings.bots.finish_delay = finish;
    let th = new_test_hub_with(c).await;

    let (mut conn, me, bot) = bot_finish_table(&th).await;
    let red8 = json!({"color": "red", "kind": "number", "value": 8});
    send_msg(
        &mut conn,
        json!({"type": "debug_set_state", "debug": {
            "hand": [red5(), {"color": "blue", "kind": "number", "value": 9}],
            "hands": [{"player_index": bot, "hand": [red8, red8]}],
            "discard": {"color": "red", "kind": "number", "value": 3},
            "active_color": "red",
            "pending_draw": 0,
            "current_turn": me,
            "direction": 1
        }}),
    )
    .await;
    read_msg_of_type(&mut conn, "game_state").await;

    let start = Instant::now();
    send_msg(&mut conn, json!({"type": "play_card", "card": red5()})).await;
    let (end, at) = await_type(&mut conn, "round_end", Duration::from_secs(3)).await;
    assert_eq!(end["round_winner"], "Bot1", "round_end winner");
    let held = at - start;
    assert!(
        held >= finish,
        "the bot took the round {held:?} after its turn came, want at least {finish:?}"
    );
    th.stop().await;
}

// The other floor: a bot on an undeclared last card does not finish before its
// own declaration would have come, so a bot handed its last card stays
// catchable.
#[tokio::test]
async fn bot_finish_waits_for_its_own_declaration_so_the_catch_can_land() {
    let mut c = pinned();
    c.timings.bots.think = Duration::from_millis(10);
    c.timings.bots.interrupt_prob = 0.0;
    c.timings.bots.finish_delay = Duration::ZERO;
    c.timings.bots.uno_delay = Duration::from_millis(1500);
    let th = new_test_hub_with(c).await;

    let (mut conn, me, bot) = bot_finish_table(&th).await;
    // The Swap hands the bot our last card, a red 7 it can play straight onto
    // the red Swap the moment its turn comes.
    send_msg(
        &mut conn,
        json!({"type": "debug_set_state", "debug": {
            "hand": [{"color": "red", "kind": "swap"}, {"color": "red", "kind": "number", "value": 7}],
            "hands": [{"player_index": bot, "hand": [
                {"color": "green", "kind": "number", "value": 3},
                {"color": "green", "kind": "number", "value": 4},
                {"color": "green", "kind": "number", "value": 5}
            ]}],
            "discard": {"color": "red", "kind": "number", "value": 3},
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
        json!({"type": "play_card", "card": {"color": "red", "kind": "swap"}, "chosen_player": bot}),
    )
    .await;
    read_msg_of_type(&mut conn, "card_played").await;
    // Well past the bot's think delay: before, the round was already over.
    tokio::time::sleep(Duration::from_millis(200)).await;

    send_msg(&mut conn, json!({"type": "catch_uno", "target_index": bot})).await;
    let (caught, _) = await_type(&mut conn, "uno_caught", Duration::from_secs(3)).await;
    assert_eq!(
        seat_of(&caught, "player_index"),
        bot,
        "uno_caught named the wrong seat"
    );
    th.stop().await;
}
