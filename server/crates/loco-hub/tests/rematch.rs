//! A rematch by agreement.

mod common_b;

use common_b::*;
use loco_hub::testkit::*;
use serde_json::json;
use std::time::Duration;

const PAIR: &[&str] = &["Alice", "Bob"];
const THREE: &[&str] = &["Alice", "Bob", "Carol"];

// Two asks are a game. The seat that said nothing is not left behind by it: the
// room reopens as a lobby with the whole table still in it, which is the reason
// the quorum can stop at two without anybody losing their seat.
#[tokio::test]
async fn rematch_two_asks_deal_it_past_two_seats() {
    let th = new_test_hub_with(debug_cfg()).await;
    let (mut conns, _, _) = won_table(&th, THREE).await;

    send_msg(&mut conns[1], json!({"type": "rematch"})).await;
    for c in conns.iter_mut() {
        let msg = read_msg_of_type(c, "rematch_offered").await;
        assert_eq!(msg["rematch_needed"], 2);
    }
    send_msg(&mut conns[2], json!({"type": "rematch"})).await;

    for (i, c) in conns.iter_mut().enumerate() {
        let msg = read_msg_of_type(c, "rematch_started").await;
        assert_eq!(
            len_of(&msg["players"]),
            3,
            "client {i}: players in the reopened room"
        );
    }
    th.stop().await;
}

// The table goes to somebody who asked for it. Alice hosted and said nothing,
// so the badge lands on the earliest-seated asker — Bob at seat 1, even though
// Carol pressed first — and the press that starts the match is his.
#[tokio::test]
async fn rematch_host_who_never_asked_hands_the_table_over() {
    let th = new_test_hub_with(debug_cfg()).await;
    let (mut conns, _, _) = won_table(&th, THREE).await;

    send_msg(&mut conns[2], json!({"type": "rematch"})).await;
    for c in conns.iter_mut() {
        read_msg_of_type(c, "rematch_offered").await;
    }
    send_msg(&mut conns[1], json!({"type": "rematch"})).await;

    let want_seats = [1, 0, 2]; // Alice and Bob traded places; Carol stayed put.
    for (i, c) in conns.iter_mut().enumerate() {
        let msg = read_msg_of_type(c, "rematch_started").await;
        assert_eq!(seat_of(&msg, "player_id"), want_seats[i], "client {i}");
        assert_eq!(
            msg["players"][0]["nickname"], "Bob",
            "client {i}: host of the reopened room"
        );
    }

    // The badge is the real thing and not a label: the new host starts the match.
    send_msg(&mut conns[1], json!({"type": "start_game"})).await;
    for c in conns.iter_mut() {
        read_msg_of_type(c, "game_started").await;
    }
    th.stop().await;
}

#[tokio::test]
async fn rematch_reopens_room_once_two_have_asked() {
    let th = new_test_hub_with(debug_cfg()).await;
    let (mut conns, code, _) = won_table(&th, PAIR).await;

    send_msg(&mut conns[0], json!({"type": "rematch"})).await;
    read_msg_of_type(&mut conns[0], "rematch_offered").await;
    read_msg_of_type(&mut conns[1], "rematch_offered").await;
    send_msg(&mut conns[1], json!({"type": "rematch"})).await;

    for (i, c) in conns.iter_mut().enumerate() {
        let msg = read_msg_of_type(c, "rematch_started").await;
        assert_eq!(msg["room_code"], code.as_str(), "client {i}");
        assert_eq!(seat_of(&msg, "player_id"), i as i64, "client {i}");
        assert_eq!(len_of(&msg["players"]), 2, "client {i}");
        assert!(
            !msg["match_format"].as_str().unwrap_or("").is_empty()
                && msg["max_players"].as_i64().unwrap_or(0) != 0,
            "client {i}: lobby config missing: {msg}"
        );
    }

    // The reopened room must be startable again, and the new match must begin
    // from a clean slate: full hands, round 1, zeroed scores.
    send_msg(&mut conns[0], json!({"type": "start_game"})).await;
    let gs = read_msg_of_type(&mut conns[0], "game_started").await;
    read_msg_of_type(&mut conns[1], "game_started").await;
    let (a, b) = conns.split_at_mut(1);
    complete_map_load(&mut [&mut a[0], &mut b[0]]).await;
    let state = &gs["state"];
    assert!(
        state.is_object(),
        "game_started without state after rematch"
    );
    assert_eq!(len_of(&state["hand"]), 8);
    assert_eq!(state["round_number"], 1);
    for e in state["scoreboard"].as_array().into_iter().flatten() {
        assert!(
            e["score"] == 0 && e["rounds_won"] == 0,
            "stale score for {}: {e}",
            e["nickname"]
        );
    }
    th.stop().await;
}

// The host owns the format, the size and the start. They do not own whether
// anybody else wants another match, so the button is an offer on every screen.
#[tokio::test]
async fn rematch_any_seat_may_ask_and_one_ask_deals_nothing() {
    let th = new_test_hub_with(debug_cfg()).await;
    let (mut conns, _, _) = won_table(&th, PAIR).await;

    send_msg(&mut conns[1], json!({"type": "rematch"})).await;

    // The whole offer state travels, to both of them: the player who has not
    // answered has to know somebody is waiting on them.
    for i in [1, 0] {
        let msg = read_msg_of_type(&mut conns[i], "rematch_offered").await;
        assert_eq!(seat_of(&msg, "player_index"), 1, "client {i}");
        assert_eq!(ints(&msg["rematch_offers"]), vec![1], "client {i}");
        assert_eq!(msg["rematch_needed"], 2, "client {i}");
    }

    assert!(
        stays_silent(&mut conns[1], Duration::from_millis(300)).await,
        "a single ask reopened the room on its own"
    );
    th.stop().await;
}

// Nobody is left waiting on a player who is not there. The ask that could not
// be answered is retired with the seat, and the answer to the table's question
// is the departure itself.
#[tokio::test]
async fn rematch_departure_completes_the_agreement() {
    let th = new_test_hub_with(debug_cfg()).await;
    let (mut conns, _, _) = won_table(&th, PAIR).await;

    send_msg(&mut conns[0], json!({"type": "rematch"})).await;
    read_msg_of_type(&mut conns[0], "rematch_offered").await;
    read_msg_of_type(&mut conns[1], "rematch_offered").await;

    send_msg(&mut conns[1], json!({"type": "leave_room"})).await;

    let msg = read_msg_of_type(&mut conns[0], "rematch_started").await;
    assert_eq!(len_of(&msg["players"]), 1, "{msg}");
    assert_eq!(msg["players"][0]["nickname"], "Alice");
    th.stop().await;
}

// The seats above a departure move down, and so do their asks. Alice at seat 0
// drops from a table of three: the seat is held rather than removed (the match
// is over and the rematch is not), so Bob keeps index 1, and what goes is the
// quorum the absent seat was part of.
#[tokio::test]
async fn rematch_reindexes_offers_when_a_seat_leaves() {
    let th = new_test_hub_with(debug_cfg()).await;
    let (conns, _, _) = won_table(&th, THREE).await;
    let mut it = conns.into_iter();
    let (conn1, mut bob, mut carol) = (it.next().unwrap(), it.next().unwrap(), it.next().unwrap());

    send_msg(&mut bob, json!({"type": "rematch"})).await;
    let msg = read_msg_of_type(&mut carol, "rematch_offered").await;
    assert_eq!(msg["rematch_needed"], 2);

    drop(conn1);
    read_msg_of_type(&mut carol, "player_disconnected").await;
    let msg = read_msg_of_type(&mut carol, "rematch_offered").await;
    assert_eq!(
        ints(&msg["rematch_offers"]),
        vec![1],
        "offers after the host dropped: want Bob, seat unchanged"
    );
    assert_eq!(msg["rematch_needed"], 2);

    // Carol answering is now the whole table.
    send_msg(&mut carol, json!({"type": "rematch"})).await;
    let started = read_msg_of_type(&mut bob, "rematch_started").await;
    assert_eq!(len_of(&started["players"]), 2);
    th.stop().await;
}

#[tokio::test]
async fn rematch_rejected_before_match_is_over() {
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

    // In the lobby there is nothing to rematch yet.
    send_msg(&mut conn1, json!({"type": "rematch"})).await;
    let e = read_msg_of_type(&mut conn1, "error").await;
    assert!(
        e["error"].as_str().unwrap_or("").contains("match is over"),
        "lobby rematch error = {e}"
    );

    // Mid-match it is still rejected.
    send_msg(&mut conn1, json!({"type": "start_game"})).await;
    read_msg_of_type(&mut conn1, "game_started").await;
    read_msg_of_type(&mut conn2, "game_started").await;
    complete_map_load(&mut [&mut conn1, &mut conn2]).await;
    send_msg(&mut conn1, json!({"type": "rematch"})).await;
    let e = read_msg_of_type(&mut conn1, "error").await;
    assert!(
        e["error"].as_str().unwrap_or("").contains("match is over"),
        "mid-match rematch error = {e}"
    );
    th.stop().await;
}

// A player who leaves after the match ends must not be dealt a hand in the
// rematch: their seat is pruned and the survivors are re-indexed.
#[tokio::test]
async fn rematch_prunes_player_who_left_after_match_end() {
    let th = new_test_hub_with(debug_cfg()).await;
    let (conns, _, _) = won_table(&th, PAIR).await;
    let mut it = conns.into_iter();
    let (mut conn1, conn2) = (it.next().unwrap(), it.next().unwrap());

    drop(conn2);
    // A finished table holds the seat rather than releasing it, so this is
    // player_disconnected; what makes the seat go is the prune at the moment
    // the rematch deals, which is what this test is about.
    read_msg_of_type(&mut conn1, "player_disconnected").await;

    send_msg(&mut conn1, json!({"type": "rematch"})).await;
    let msg = read_msg_of_type(&mut conn1, "rematch_started").await;
    assert_eq!(len_of(&msg["players"]), 1, "Bob left: {msg}");
    assert_eq!(msg["players"][0]["nickname"], "Alice");
    assert_eq!(msg["players"][0]["index"], 0);
    assert_eq!(seat_of(&msg, "player_id"), 0);

    // One human alone cannot start: the room stays a usable lobby awaiting a
    // join or a bot rather than dealing a broken match.
    send_msg(&mut conn1, json!({"type": "start_game"})).await;
    let e = read_msg_of_type(&mut conn1, "error").await;
    assert!(
        e["error"].as_str().unwrap_or("").contains("at least"),
        "start error = {e}, want a minimum-player error"
    );

    // Adding a bot works again because the room is genuinely back in lobby state.
    send_msg(&mut conn1, json!({"type": "add_bot"})).await;
    read_msg_of_type(&mut conn1, "player_joined").await;
    send_msg(&mut conn1, json!({"type": "start_game"})).await;
    let gs = read_msg_of_type(&mut conn1, "game_started").await;
    assert_eq!(
        len_of(&gs["state"]["players"]),
        2,
        "rematch with bot did not start with 2 players"
    );
    complete_map_load(&mut [&mut conn1]).await;
    th.stop().await;
}

// Bots occupy empty member slots; pruning must leave them alone.
#[tokio::test]
async fn rematch_keeps_bots() {
    let th = new_test_hub_with(debug_cfg()).await;
    let mut conn = dial_ws(&th).await;
    send_msg(
        &mut conn,
        json!({"type": "create_room", "nickname": "Alice"}),
    )
    .await;
    read_msg_of_type(&mut conn, "room_created").await;
    send_msg(&mut conn, json!({"type": "add_bot"})).await;
    read_msg_of_type(&mut conn, "player_joined").await;

    send_msg(&mut conn, json!({"type": "start_game"})).await;
    read_msg_of_type(&mut conn, "game_started").await;
    complete_map_load(&mut [&mut conn]).await;
    win_match_from_host_turn(&mut conn, &mut []).await;

    send_msg(&mut conn, json!({"type": "rematch"})).await;
    let msg = read_msg_of_type(&mut conn, "rematch_started").await;
    assert_eq!(len_of(&msg["players"]), 2, "want Alice + Bot1");
    assert_eq!(
        msg["players"][1]["nickname"], "Bot1",
        "the bot must survive the prune"
    );
    send_msg(&mut conn, json!({"type": "start_game"})).await;
    let gs = read_msg_of_type(&mut conn, "game_started").await;
    assert!(gs["state"].is_object(), "rematch with bot failed to start");
    complete_map_load(&mut [&mut conn]).await;
    th.stop().await;
}
