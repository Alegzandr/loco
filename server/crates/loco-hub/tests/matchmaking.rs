//! The 1v1 queue.

#![allow(clippy::field_reassign_with_default)] // a test narrows one knob of the default config

mod common_b;

use common_b::*;
use loco_hub::HubConfig;
use loco_hub::testkit::*;
use serde_json::json;
use std::time::Duration;

fn reveal_cfg() -> HubConfig {
    let mut c = debug_cfg();
    short_reveal(&mut c);
    c
}

// A lone player waits. The acknowledgement says nothing about how many other
// people are searching, which is the rule the whole mode is built on: a count
// that reads "1" is an instruction to give up.
#[tokio::test]
async fn matchmaking_first_player_waits_and_learns_nothing_about_the_queue() {
    let th = new_test_hub().await;
    let mut conn = dial_ws(&th).await;
    send_msg(
        &mut conn,
        json!({"type": "find_match", "nickname": "Alice"}),
    )
    .await;
    let ack = read_msg_of_type(&mut conn, "matchmaking_queued").await;
    assert!(
        ack.get("players").is_none()
            && ack.get("max_players").is_none()
            && ack.get("room_code").is_none(),
        "matchmaking_queued leaked room or roster data: {ack}"
    );
    // And nothing else arrives: there is nobody to pair with.
    assert!(
        stays_silent(&mut conn, Duration::from_millis(200)).await,
        "a solitary searcher was sent a second message"
    );
    th.stop().await;
}

#[tokio::test]
async fn matchmaking_pairs_two_players_and_deals_without_anybody_pressing_start() {
    let th = new_test_hub_with(reveal_cfg()).await;
    let mut a = queue_up(&th, "Alice").await;
    let mut b = queue_up(&th, "Bob").await;

    let found_a = read_msg_of_type(&mut a, "match_found").await;
    let found_b = read_msg_of_type(&mut b, "match_found").await;

    let code = found_a["room_code"].as_str().unwrap_or("");
    assert!(
        !code.is_empty() && found_a["room_code"] == found_b["room_code"],
        "match_found room codes = {} / {}, want one shared code",
        found_a["room_code"],
        found_b["room_code"]
    );
    assert_eq!(seat_of(&found_a, "player_id"), 0);
    assert_eq!(seat_of(&found_b, "player_id"), 1);
    let tok = found_a["session_token"].as_str().unwrap_or("");
    assert!(
        !tok.is_empty() && found_a["session_token"] != found_b["session_token"],
        "each seat must get its own session token"
    );
    assert_eq!(found_a["max_players"], 2, "the mode is 1v1");
    assert_eq!(len_of(&found_a["players"]), 2);
    assert!(
        found_a["starts_in_ms"].as_i64().unwrap_or(0) > 0,
        "starts_in_ms must tell the client how long the reveal lasts"
    );

    // Nobody sends start_game. The match deals itself.
    read_msg_of_type(&mut a, "game_started").await;
    read_msg_of_type(&mut b, "game_started").await;
    complete_map_load(&mut [&mut a, &mut b]).await;
    th.stop().await;
}

// Two strangers picking the same name is ordinary, and it must not fail a
// pairing neither of them did anything wrong in.
#[tokio::test]
async fn matchmaking_disambiguates_identical_nicknames() {
    let th = new_test_hub_with(reveal_cfg()).await;
    let mut a = queue_up(&th, "Alex").await;
    let mut b = queue_up(&th, "Alex").await;

    let found = read_msg_of_type(&mut a, "match_found").await;
    read_msg_of_type(&mut b, "match_found").await;
    assert_eq!(len_of(&found["players"]), 2);
    let (n0, n1) = (
        &found["players"][0]["nickname"],
        &found["players"][1]["nickname"],
    );
    assert_ne!(
        n0, n1,
        "both seats share a name; the second must be disambiguated"
    );
    assert_eq!(n0, "Alex", "the first seat keeps the name they typed");
    th.stop().await;
}

#[tokio::test]
async fn matchmaking_cancel_takes_the_player_out_of_the_queue() {
    let th = new_test_hub_with(reveal_cfg()).await;
    let mut a = queue_up(&th, "Alice").await;
    send_msg(&mut a, json!({"type": "cancel_matchmaking"})).await;
    read_msg_of_type(&mut a, "matchmaking_cancelled").await;

    // A second player arriving now has nobody to be paired with.
    let mut b = queue_up(&th, "Bob").await;
    assert!(
        stays_silent(&mut b, Duration::from_millis(300)).await,
        "a cancelled searcher was still paired"
    );
    th.stop().await;
}

// A socket that goes away must not be paired with somebody who is still there:
// the survivor would be seated opposite an empty chair.
#[tokio::test]
async fn matchmaking_disconnect_leaves_the_queue() {
    let th = new_test_hub_with(reveal_cfg()).await;
    let a = queue_up(&th, "Alice").await;
    drop(a);
    // Give the hub its unregister.
    assert!(
        eventually(Duration::from_secs(2), || th
            .hub
            .metrics_stats()
            .matchmaking_queue
            == 0)
        .await
    );

    let mut b = queue_up(&th, "Bob").await;
    assert!(
        stays_silent(&mut b, Duration::from_millis(300)).await,
        "a departed searcher was still paired"
    );
    th.stop().await;
}

// A matchmade room has no host: the format is fixed, the size is two, the
// match starts by itself and there is nobody to add a bot for.
#[tokio::test]
async fn matchmaking_host_controls_are_refused() {
    let th = new_test_hub_with(reveal_cfg()).await;
    let (mut a, _b) = paired_match(&th).await;
    // `rematch` is deliberately not in this list: it is not refused in a
    // matchmade room, it means something else there. See the rematch tests.
    for msg in [
        json!({"type": "add_bot"}),
        json!({"type": "start_game"}),
        json!({"type": "set_match_format", "match_format": "BO7"}),
        json!({"type": "set_max_players", "max_players": 4}),
        json!({"type": "kick_player", "target_index": 1}),
    ] {
        send_msg(&mut a, msg.clone()).await;
        let got = read_msg_of_type(&mut a, "error").await;
        assert_eq!(
            got["error"], "not available in this game",
            "{}: want the hostless refusal",
            msg["type"]
        );
    }
    th.stop().await;
}

// The frustrating case, and the reason the mode has its own timings: the
// opponent stops being there. The player still at the table must be told the
// match is over, not left auto-passing against an empty seat.
#[tokio::test]
async fn matchmaking_opponent_disconnect_forfeits_after_the_short_hold() {
    let mut c = reveal_cfg();
    c.timings.matchmaking.reconnect_timeout = Duration::from_millis(150);
    let th = new_test_hub_with(c).await;
    let (mut a, b) = paired_match(&th).await;

    drop(b);

    let gone = read_msg_of_type(&mut a, "player_disconnected").await;
    assert!(
        gone["forfeit_deadline"].as_i64().unwrap_or(0) != 0,
        "player_disconnected carried no forfeit deadline"
    );
    let end = read_msg_of_type(&mut a, "match_end").await;
    assert_eq!(end["forfeit"], true);
    assert_eq!(end["match_winner"], "Alice");
    assert_eq!(
        seat_of(&end, "player_index"),
        1,
        "match_end must name the seat that left"
    );
    th.stop().await;
}

// An ordinary room keeps the 60s hold: those are people who came in together,
// and the hold exists so a drop is not the end. Nothing is forfeited while it
// runs. Once it has run out the seat is gone for good, and a match of two ends
// the way it ends when that seat walks out on purpose.
#[tokio::test]
async fn matchmaking_ordinary_room_holds_the_seat_before_forfeiting() {
    let mut c = HubConfig::default();
    c.timings.reconnect_timeout = Duration::from_millis(150);
    let th = new_test_hub_with(c).await;
    let TwoPlayers { mut alice, bob, .. } = setup_two_player_game(&th).await;
    drop(bob);

    let gone = read_msg_of_type(&mut alice, "player_disconnected").await;
    assert!(
        gone.get("forfeit_deadline").is_none(),
        "forfeit_deadline in an ordinary room: {gone}"
    );
    // The whole hold passes with the seat held and the match untouched: the
    // next thing the table hears is the departure, never a match_end.
    let next = read_msg(&mut alice).await;
    assert_eq!(
        next["type"], "player_left",
        "after the disconnect the table heard {next}"
    );
    // Only once the hold has run out does the match end, and it ends the way
    // leave_room ends a match of two: a forfeit to the seat that stayed.
    let end = read_msg_of_type(&mut alice, "match_end").await;
    assert_eq!(end["forfeit"], true);
    assert_eq!(end["match_winner"], "Alice");
    th.stop().await;
}

// Quitting on purpose is a forfeit, announced as one and immediate: there is
// nothing to wait for when the player has said they are leaving.
#[tokio::test]
async fn matchmaking_leave_room_forfeits_immediately() {
    let th = new_test_hub_with(reveal_cfg()).await;
    let (mut a, mut b) = paired_match(&th).await;

    send_msg(&mut b, json!({"type": "leave_room"})).await;

    let end = read_msg_of_type(&mut a, "match_end").await;
    assert_eq!(end["forfeit"], true, "{end}");
    assert_eq!(end["match_winner"], "Alice", "{end}");
    read_msg_of_type(&mut b, "left_room").await;
    th.stop().await;
}

// The other half of "nobody waits for somebody who is not there": a player who
// is connected but has stopped playing. Two turn timeouts end the match. Whoever
// is left gets the win; the seat that went quiet is named.
#[tokio::test]
async fn matchmaking_afk_forfeits_the_match() {
    let mut c = reveal_cfg();
    c.timings.turn_timeout = Duration::from_millis(80);
    let th = new_test_hub_with(c).await;
    let (mut a, mut b) = paired_match(&th).await;

    // Neither of them plays. Turns alternate, so the seat that started runs out
    // of its second turn first and is the one declared away.
    let end = wait_for_type(&mut a, "match_end", 60).await;
    assert_eq!(
        end["forfeit"], true,
        "an AFK match must end as a forfeit, not as a win on points"
    );
    let away = seat_of(&end, "player_index");
    assert!(
        (0..=1).contains(&away),
        "match_end named seat {away}, want the seat that went quiet"
    );
    let want = ["Alice", "Bob"][(1 - away) as usize];
    assert_eq!(end["match_winner"], want, "the seat still at the table");
    wait_for_type(&mut b, "match_end", 60).await;
    th.stop().await;
}

// A rematch between two strangers is an agreement, not a decision: one offer
// changes nothing on its own.
#[tokio::test]
async fn matchmaking_one_rematch_offer_deals_nothing() {
    let th = new_test_hub_with(reveal_cfg()).await;
    let (mut a, mut b) = paired_match(&th).await;
    finish_round_for_seat(&mut a, &mut b).await;

    send_msg(&mut a, json!({"type": "rematch"})).await;
    let offered = read_msg_of_type(&mut a, "rematch_offered").await;
    assert_eq!(seat_of(&offered, "player_index"), 0);
    // The other side is told somebody is waiting on them: an offer nobody can
    // see is an offer nobody answers.
    let got = read_msg_of_type(&mut b, "rematch_offered").await;
    assert_eq!(seat_of(&got, "player_index"), 0);

    assert!(
        stays_silent(&mut a, Duration::from_millis(300)).await,
        "a single rematch offer started a match on its own"
    );
    th.stop().await;
}

// Both offers in, and the same two are dealt again: another reveal, another
// match, no queue in between.
#[tokio::test]
async fn matchmaking_both_offers_deal_the_same_pair_again() {
    let th = new_test_hub_with(reveal_cfg()).await;
    let (mut a, mut b) = paired_match(&th).await;
    finish_round_for_seat(&mut a, &mut b).await;

    send_msg(&mut a, json!({"type": "rematch"})).await;
    read_msg_of_type(&mut a, "rematch_offered").await;
    read_msg_of_type(&mut b, "rematch_offered").await;

    send_msg(&mut b, json!({"type": "rematch"})).await;
    let found = read_msg_of_type(&mut a, "match_found").await;
    read_msg_of_type(&mut b, "match_found").await;
    assert_eq!(len_of(&found["players"]), 2, "want the same 2");
    assert_eq!(
        seat_of(&found, "player_id"),
        0,
        "want the seat they already had"
    );
    read_msg_of_type(&mut a, "game_started").await;
    read_msg_of_type(&mut b, "game_started").await;
    complete_map_load(&mut [&mut a, &mut b]).await;
    th.stop().await;
}

// There is nobody to agree with once the other side has gone. The client's
// other button, which finds the next opponent, is the answer to that.
#[tokio::test]
async fn matchmaking_rematch_refused_when_the_opponent_has_left() {
    let th = new_test_hub_with(reveal_cfg()).await;
    let (mut a, mut b) = paired_match(&th).await;

    send_msg(&mut b, json!({"type": "leave_room"})).await;
    read_msg_of_type(&mut a, "match_end").await;

    send_msg(&mut a, json!({"type": "rematch"})).await;
    let got = read_msg_of_type(&mut a, "error").await;
    assert_eq!(got["error"], "your opponent has left the table");
    th.stop().await;
}

// An ordinary match of two is a 1v1 whatever the door it was opened through,
// so it ends the way every other 1v1 does: the match goes to the seat that
// stayed, announced as a forfeit.
#[tokio::test]
async fn leave_room_ordinary_match_of_two_goes_to_whoever_stayed() {
    let th = new_test_hub().await;
    let TwoPlayers {
        mut alice, mut bob, ..
    } = setup_two_player_game(&th).await;

    send_msg(&mut alice, json!({"type": "leave_room"})).await;
    read_msg_of_type(&mut alice, "left_room").await;

    let end = read_msg_of_type(&mut bob, "match_end").await;
    assert_eq!(end["forfeit"], true, "want the match announced as one");
    assert_eq!(end["match_winner"], "Bob", "the seat that stayed");
    assert_eq!(seat_of(&end, "player_index"), 0, "the seat that left");
    th.stop().await;
}

// The waiting room has a way out, and nothing has been dealt yet: the seat is
// freed on the spot rather than held, and the players still there are told
// immediately.
#[tokio::test]
async fn leave_room_frees_a_seat_in_an_ordinary_lobby() {
    let th = new_test_hub().await;
    let mut conn1 = dial_ws(&th).await;
    send_msg(
        &mut conn1,
        json!({"type": "create_room", "nickname": "Alice"}),
    )
    .await;
    let created = read_msg_of_type(&mut conn1, "room_created").await;
    let code = created["room_code"].as_str().unwrap().to_owned();

    let mut conn2 = dial_ws(&th).await;
    send_msg(
        &mut conn2,
        json!({"type": "join_room", "nickname": "Bob", "room_code": code}),
    )
    .await;
    read_msg_of_type(&mut conn2, "room_joined").await;
    read_msg_of_type(&mut conn1, "player_joined").await;

    send_msg(&mut conn2, json!({"type": "leave_room"})).await;
    read_msg_of_type(&mut conn2, "left_room").await;

    let left = read_msg_of_type(&mut conn1, "player_left").await;
    assert_eq!(len_of(&left["players"]), 1, "{left}");
    assert_eq!(left["players"][0]["nickname"], "Alice");

    // The socket is seatless again, so it can take a seat somewhere else.
    send_msg(
        &mut conn2,
        json!({"type": "create_room", "nickname": "Bob"}),
    )
    .await;
    read_msg_of_type(&mut conn2, "room_created").await;
    th.stop().await;
}

// "Find another opponent" is one button on the game-over screen: a player still
// sitting in the finished room goes straight back into the queue.
#[tokio::test]
async fn matchmaking_find_match_releases_a_finished_seat() {
    let th = new_test_hub_with(reveal_cfg()).await;
    let (mut a, mut b) = paired_match(&th).await;

    // Bob quits, which finishes the match for both of them.
    send_msg(&mut b, json!({"type": "leave_room"})).await;
    read_msg_of_type(&mut a, "match_end").await;

    // Alice, still seated in the finished room, searches again.
    send_msg(&mut a, json!({"type": "find_match", "nickname": "Alice"})).await;
    read_msg_of_type(&mut a, "matchmaking_queued").await;

    let mut c = queue_up(&th, "Carol").await;
    let found = read_msg_of_type(&mut a, "match_found").await;
    read_msg_of_type(&mut c, "match_found").await;
    assert_eq!(len_of(&found["players"]), 2, "want a fresh 1v1");
    th.stop().await;
}

// A player who is actually playing cannot queue out from under their opponent.
#[tokio::test]
async fn matchmaking_find_match_refused_during_a_match() {
    let th = new_test_hub().await;
    let TwoPlayers { mut alice, .. } = setup_two_player_game(&th).await;
    send_msg(
        &mut alice,
        json!({"type": "find_match", "nickname": "Alice"}),
    )
    .await;
    let got = read_msg_of_type(&mut alice, "error").await;
    assert_eq!(got["error"], "already in a room");
    th.stop().await;
}

// The reveal's deal is armed twice: once on the reveal itself, once again a few
// seconds later. The second arming is only safe because running the deal again
// finds a room that is no longer a lobby and does nothing. So this is the
// property the backstop rests on: two attempts, one deal.
#[tokio::test]
async fn matchmaking_the_reveal_backstop_does_not_deal_twice() {
    let mut c = reveal_cfg();
    c.timings.matchmaking.reveal_backstop = Duration::from_millis(60);
    let th = new_test_hub_with(c).await;
    let mut a = queue_up(&th, "Alice").await;
    let mut b = queue_up(&th, "Bob").await;
    read_msg_of_type(&mut a, "match_found").await;
    read_msg_of_type(&mut b, "match_found").await;

    let first = read_msg_of_type(&mut a, "game_started").await;
    read_msg_of_type(&mut b, "game_started").await;

    // Well past the backstop. A second deal would arrive as a second
    // game_started carrying a fresh hand; the map-loading gate is what
    // legitimately speaks next.
    assert!(
        !drain_until(&mut a, "game_started", Duration::from_millis(300)).await,
        "the backstop dealt the match a second time"
    );
    assert!(
        first.get("state").is_some_and(|s| !s.is_null()),
        "the first deal carried no state"
    );
    th.stop().await;
}
