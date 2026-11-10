//! Ported from Go: `server/game/room_test.go`, lines 1-1518 (TestRoom_Create
//! through TestRoom_Skip_EndToEnd). The rest of the file is
//! `room_test_part2.rs`.

use super::support::*;
use crate::card::{Card, Color, Kind};
use crate::error::GameError;
use crate::room::{MatchFormat, Room, Status};
use crate::rules::can_play;

#[test]
fn room_create() {
    let r = new_room("ABCD");
    assert_eq!(r.code, "ABCD", "Room code");
    assert_eq!(r.status, Status::Lobby, "Initial status");
    assert_eq!(r.players.len(), 0, "Initial players");
}

#[test]
fn room_join() {
    let mut r = new_room("TEST");
    r.join("alice").expect("Join() error");
    assert_eq!(r.players.len(), 1, "Players after join");
    assert_eq!(r.players[0].nickname, "alice", "Player nickname");
}

#[test]
fn room_join_duplicate_nickname() {
    let mut r = new_room("TEST");
    let _ = r.join("alice");
    assert!(
        r.join("alice").is_err(),
        "Duplicate nickname should return error"
    );
}

#[test]
fn room_join_full() {
    let mut r = new_room("TEST");
    for i in 0..7u8 {
        let name = char::from(b'a' + i).to_string();
        if let Err(e) = r.join(&name) {
            panic!("seat {} of 7 refused: {e}", i + 1);
        }
    }
    assert!(
        r.join("overflow").is_err(),
        "Joining a full room should return error"
    );
}

#[test]
fn room_join_in_progress() {
    let mut r = new_room("TEST");
    let _ = r.join("alice");
    let _ = r.join("bob");
    let _ = r.start(NOW);
    assert!(
        r.join("charlie").is_err(),
        "Joining an in-progress game should return error"
    );
}

#[test]
fn room_start_minimum_players() {
    let mut r = new_room("TEST");
    let _ = r.join("solo");
    assert!(
        r.start(NOW).is_err(),
        "Start with 1 player should return error"
    );
}

#[test]
fn room_start_success() {
    let mut r = new_room("TEST");
    let _ = r.join("alice");
    let _ = r.join("bob");
    r.start(NOW).expect("Start() error");
    assert_eq!(r.status, Status::Playing, "Status after start");
}

#[test]
fn room_start_deals_cards() {
    let mut r = new_room("TEST");
    let _ = r.join("alice");
    let _ = r.join("bob");
    let _ = r.start(NOW);
    for p in &r.players {
        let n = st_ref(&r).hands[p.index as usize].cards.len();
        assert_eq!(n, 8, "Player {:?} hand size", p.nickname);
    }
}

#[test]
fn room_play_card_not_your_turn() {
    let mut r = setup_two_player_game();
    // bob (index 1) tries to play on alice's turn (index 0)
    let card = st(&mut r).hands[1].cards[0];
    assert!(
        r.play_card(1, card, Color::Red, -1, NOW).is_err(),
        "Playing out of turn should return error"
    );
}

#[test]
fn room_play_card_illegal_card() {
    let mut r = setup_two_player_game();
    // Force alice's hand to have only a card that doesn't match top
    let s = st(&mut r);
    s.hands[0].cards = vec![num(Color::Blue, 3)];
    s.discard = vec![num(Color::Red, 5)];
    s.active_color = Color::Red;

    assert!(
        r.play_card(0, num(Color::Blue, 3), Color::Red, -1, NOW)
            .is_err(),
        "Playing an illegal card should return error"
    );
}

#[test]
fn room_play_card_success() {
    let mut r = setup_two_player_game();
    // Give alice a card matching the top
    let top = st(&mut r).top_card();
    let match_card = num(top.color, 0);
    st(&mut r).hands[0].cards.insert(0, match_card);

    r.play_card(0, match_card, match_card.color, -1, NOW)
        .expect("PlayCard() error");
    // Turn should advance to bob (index 1)
    assert_eq!(st_ref(&r).current_turn, 1, "After play, CurrentTurn");
}

#[test]
fn room_play_card_not_in_hand() {
    let mut r = setup_two_player_game();
    let fake_card = num(Color::Red, 9);
    // Make sure it's not in hand
    st(&mut r).hands[0].cards = vec![num(Color::Red, 1)];
    assert!(
        r.play_card(0, fake_card, Color::Red, -1, NOW).is_err(),
        "Playing a card not in hand should return error"
    );
}

#[test]
fn room_draw_card() {
    let mut r = setup_two_player_game();
    st(&mut r).pending_draw = 0; // ensure no pending draw from first card effect
    let before = st_ref(&r).hands[0].cards.len();
    r.draw_card(0, NOW).expect("DrawCard() error");
    assert_eq!(
        st_ref(&r).hands[0].cards.len(),
        before + 1,
        "After DrawCard, hand size"
    );
}

#[test]
fn room_draw_card_not_your_turn() {
    let mut r = setup_two_player_game();
    assert!(
        r.draw_card(1, NOW).is_err(), // bob's not the current turn
        "DrawCard out of turn should return error"
    );
}

#[test]
fn room_draw_card_once_per_turn() {
    let mut r = setup_two_player_game();
    st(&mut r).pending_draw = 0;

    // First draw should succeed and set HasDrawn
    r.draw_card(0, NOW).expect("first DrawCard error");
    assert!(
        st_ref(&r).has_drawn,
        "HasDrawn should be true after drawing"
    );

    // Second draw in the same turn should fail
    assert!(
        r.draw_card(0, NOW).is_err(),
        "second DrawCard in same turn should return error"
    );
}

#[test]
fn room_pass_turn_requires_draw() {
    let mut r = setup_two_player_game();
    st(&mut r).pending_draw = 0;

    // PassTurn without drawing should fail
    assert!(
        r.pass_turn(0, NOW).is_err(),
        "PassTurn without drawing should return error"
    );
}

#[test]
fn room_draw_then_pass_resets_has_drawn() {
    let mut r = setup_two_player_game();
    st(&mut r).pending_draw = 0;

    // Alice draws then passes
    r.draw_card(0, NOW).expect("DrawCard error");
    r.pass_turn(0, NOW).expect("PassTurn error");
    assert!(
        !st_ref(&r).has_drawn,
        "HasDrawn should be false after PassTurn"
    );
    // Now Bob (index 1) should be able to draw
    st(&mut r).pending_draw = 0;
    r.draw_card(1, NOW)
        .expect("Bob DrawCard after turn change error");
}

#[test]
fn room_play_card_resets_has_drawn() {
    let mut r = setup_two_player_game();
    // Give alice a card matching the top
    let top = st(&mut r).top_card();
    let match_card = num(top.color, 0);
    st(&mut r).hands[0].cards.insert(0, match_card);
    st(&mut r).has_drawn = true; // simulate having drawn

    r.play_card(0, match_card, match_card.color, -1, NOW)
        .expect("PlayCard error");
    assert!(
        !st_ref(&r).has_drawn,
        "HasDrawn should be false after playing a card"
    );
}

#[test]
fn room_win_detection() {
    let mut r = setup_two_player_game();
    // Give alice exactly 1 card that matches top
    let top = st(&mut r).top_card();
    let win_card = num(top.color, 1);
    st(&mut r).hands[0].cards = vec![win_card];
    st(&mut r).last_card_declared[0] = true; // alice has declared

    r.play_card(0, win_card, win_card.color, -1, NOW)
        .expect("PlayCard() error");
    assert_eq!(r.status, Status::Finished, "Game should be finished");
    assert_eq!(r.winner, "alice", "Winner");
}

#[test]
fn room_last_card_declaration() {
    let mut r = setup_two_player_game();
    // Give alice exactly 1 card
    st(&mut r).hands[0].cards.truncate(1);
    r.declare_last_card(0, NOW)
        .expect("DeclareLastCard() error");
    assert!(
        st_ref(&r).last_card_declared[0],
        "LastCardDeclared[0] should be true"
    );
}

// TestRoom_LastCardDeclaration_OnlyOnce pins that a declaration is spent: the
// same single card cannot be announced twice. Repeating it re-broadcast
// uno_declared and re-logged the event, so a player could spam the banner (and
// the sting that goes with it) for as long as they held that card.
#[test]
fn room_last_card_declaration_only_once() {
    let mut r = setup_two_player_game();
    st(&mut r).hands[0].cards.truncate(1);
    r.declare_last_card(0, NOW).expect("DeclareLastCard");
    let err = r
        .declare_last_card(0, NOW)
        .expect_err("expected error declaring twice, got nil");
    assert_eq!(err, GameError::AlreadyDeclared);
    assert_eq!(err.to_string(), "player already declared");
}

// TestRoom_LastCardDeclaration_AgainAfterRearrange verifies the flip side: a
// Swap or a GlobalSwitch hands the seat a *different* single card, which nobody
// at the table has heard announced, so the seat owes a fresh declaration.
#[test]
fn room_last_card_declaration_again_after_rearrange() {
    let mut r = setup_two_player_game();
    st(&mut r).hands[0].cards.truncate(1);
    r.declare_last_card(0, NOW).expect("DeclareLastCard");
    st(&mut r).open_catch_windows_after_rearrange(NOW);
    r.declare_last_card(0, NOW)
        .expect("DeclareLastCard after rearrange");
}

#[test]
fn room_last_card_declaration_penalty_if_forgot() {
    let mut r = setup_two_player_game();
    let top = st(&mut r).top_card();
    let win_card = num(top.color, 1);
    let second_card = num(top.color, 2);
    st(&mut r).hands[0].cards = vec![win_card, second_card];

    // Play one card leaving 1 in hand, but don't declare
    r.play_card(0, second_card, second_card.color, -1, NOW)
        .expect("PlayCard() error");

    // Bob catches alice for not declaring
    r.catch_undeclared(1, 0, NOW)
        .expect("CatchUndeclared() error");
    // Alice should have drawn 2 penalty cards
    assert_eq!(
        st_ref(&r).hands[0].cards.len(),
        3, // 1 remaining + 2 penalty
        "After catch, alice's hand size"
    );
}

// TestRoom_CatchUndeclared_WindowExpired verifies that a catch attempt is rejected
// if more than catchWindow (5 s) has elapsed since the last card was played.
#[test]
fn room_catch_undeclared_window_expired() {
    let mut r = setup_two_player_game();
    let top = st(&mut r).top_card();
    let play_card = num(top.color, 1);
    let leave_card = num(top.color, 2);
    st(&mut r).hands[0].cards = vec![leave_card, play_card];

    // Alice plays leaveCard → now at 1 card (playCard remains), catch window opens
    r.play_card(0, leave_card, leave_card.color, -1, NOW)
        .expect("PlayCard");
    assert!(
        st_ref(&r).last_card_at[0].is_some(),
        "expected LastCardAt to be set after playing to 1 card"
    );

    // Simulate 6 seconds later — window is expired
    let future = NOW + 6000;
    let err = r
        .catch_undeclared(1, 0, future)
        .expect_err("expected error for expired catch window, got nil");
    assert_eq!(err, GameError::CatchWindowExpired);
    assert_eq!(err.to_string(), "catch window expired");
}

// TestRoom_CatchUndeclared_AfterDeclared verifies that once a player declares UNO,
// no other player can catch them.
#[test]
fn room_catch_undeclared_after_declared() {
    let mut r = setup_two_player_game();
    let top = st(&mut r).top_card();
    let play_card = num(top.color, 1);
    let leave_card = num(top.color, 2);
    st(&mut r).hands[0].cards = vec![leave_card, play_card];

    r.play_card(0, leave_card, leave_card.color, -1, NOW)
        .expect("PlayCard");
    r.declare_last_card(0, NOW).expect("DeclareLastCard");
    assert!(
        st_ref(&r).last_card_declared[0],
        "expected LastCardDeclared[0] = true after declaration"
    );

    // Bob tries to catch — must fail
    let err = r
        .catch_undeclared(1, 0, NOW)
        .expect_err("expected error catching after declaration, got nil");
    assert_eq!(err, GameError::AlreadyDeclared);
    assert_eq!(err.to_string(), "player already declared");
}

// TestRoom_CatchUndeclared_NotReopenedByLaterPlay pins the regression where a
// declaration was silently voided by the *next* play from anyone: LastCardDeclared
// was reset unconditionally, so a player who had declared became catchable again
// as soon as somebody else discarded inside their 5 s window. With interjections
// that happens on almost every hand.
#[test]
fn room_catch_undeclared_not_reopened_by_later_play() {
    let mut r = setup_three_player_game();
    {
        let s = st(&mut r);
        s.current_turn = 0;
        s.direction = 1;
        s.active_color = Color::Red;
        s.discard = vec![num(Color::Red, 5)];
    }

    let alice_play = num(Color::Red, 3);
    st(&mut r).hands[0].cards = vec![alice_play, num(Color::Blue, 9)];
    r.play_card(0, alice_play, Color::Red, -1, NOW)
        .expect("alice PlayCard");
    r.declare_last_card(0, NOW).expect("DeclareLastCard");

    // Bob plays immediately after — this must not void alice's declaration.
    let bob_play = num(Color::Red, 6);
    st(&mut r).hands[1].cards.insert(0, bob_play);
    r.play_card(1, bob_play, Color::Red, -1, NOW)
        .expect("bob PlayCard");

    assert!(
        r.catch_undeclared(2, 0, NOW).is_err(),
        "alice declared; a later play by bob must not make her catchable again"
    );
    assert_eq!(
        st_ref(&r).hands[0].cards.len(),
        1,
        "alice hand (no penalty)"
    );
}

// TestRoom_UNOStateCleanOnNewRound verifies that the per-seat UNO-tracking slices
// (LastCardDeclared, LastCardAt) are reallocated clean when a new round starts.
// Specifically, stale catch attempts on the new round must fail the catch window
// check (a zero LastCardAt is always outside the 5-second window).
#[test]
fn room_uno_state_clean_on_new_round() {
    let mut r = setup_two_player_game();
    r.format = MatchFormat::BO3; // multi-round match so ending round 1 starts round 2

    let top = st(&mut r).top_card();
    let match_color = top.color;

    // Alice: 2 cards (both playable); Bob: 1 card (playable off Alice's play)
    let alice_card1 = num(match_color, 2);
    let alice_card2 = num(match_color, 3);
    let bob_card = num(match_color, 4);
    st(&mut r).hands[0].cards = vec![alice_card1, alice_card2];
    st(&mut r).hands[1].cards = vec![bob_card];

    // Alice plays aliceCard1 → drops to 1 card. Catch window opens.
    r.play_card(0, alice_card1, match_color, -1, NOW)
        .expect("alice play");
    assert!(
        st_ref(&r).last_card_at[0].is_some(),
        "round 1: expected LastCardAt set after alice plays to 1 card"
    );
    assert!(
        !st_ref(&r).last_card_declared[0],
        "round 1: expected LastCardDeclared[0] = false (no declaration)"
    );

    // Bob plays his only card → 0 cards → round 1 ends.
    // BeginNextRound is now an explicit step (the hub calls it after broadcasting
    // round_end) so the card_played broadcast for the round-winning play sees the
    // pre-deal state instead of the new round's freshly-flipped first card.
    declare_last(&mut r, 1);
    r.play_card(1, bob_card, match_color, -1, NOW)
        .expect("bob play");
    assert!(r.round_ended, "expected RoundEnded after bob empties hand");
    assert_eq!(
        r.round_number, 1,
        "expected RoundNumber to remain 1 until BeginNextRound"
    );
    r.begin_next_round(NOW).expect("BeginNextRound");
    assert_eq!(r.round_number, 2, "expected round 2 after BeginNextRound");

    // New round must have clean UNO state
    assert!(
        !st_ref(&r).last_card_declared[0],
        "round 2: LastCardDeclared[0] should be false (fresh slice from dealRound)"
    );
    assert_eq!(
        st_ref(&r).last_card_at[0],
        None,
        "round 2: LastCardAt should be zero (fresh deal)"
    );

    // Any catch attempt must fail: zero LastCardAt → window is always expired
    assert!(
        r.catch_undeclared(0, 1, NOW).is_err(),
        "catch at round-2 start must fail (zero LastCardAt means window expired)"
    );
}

#[test]
fn room_counter_draw_two() {
    let mut r = setup_two_player_game();
    // Give alice a Draw Two matching top
    let top = st(&mut r).top_card();
    let draw_card = act(top.color, Kind::DrawTwo);
    st(&mut r).hands[0].cards.insert(0, draw_card);

    r.play_card(0, draw_card, draw_card.color, -1, NOW)
        .expect("PlayCard with DrawTwo error");
    assert_eq!(st_ref(&r).pending_draw, 2, "PendingDraw");

    // Bob counters with another DrawTwo
    let counter_card = act(draw_card.color, Kind::DrawTwo);
    st(&mut r).hands[1].cards.insert(0, counter_card);
    r.counter_draw(1, counter_card, counter_card.color, NOW)
        .expect("CounterDraw error");
    assert_eq!(st_ref(&r).pending_draw, 4, "After counter, PendingDraw");
}

// --- Scoring and match system tests ---

#[test]
fn room_card_value_scoring() {
    // Verify scoring: winner gets sum of losers' card values
    let mut r = new_room("SCOR");
    let _ = r.join("alice");
    let _ = r.join("bob");
    let _ = r.start(NOW);
    st(&mut r).current_turn = 0;
    st(&mut r).pending_draw = 0;

    // Give bob a known hand (value = 7 + 20 + 40 = 67 per docs/rules.md §10:
    // Number=face value, Skip=20, Wild=40)
    st(&mut r).hands[1].cards = vec![
        num(Color::Red, 7),
        act(Color::Red, Kind::Skip),
        wild(Kind::WildCard),
    ];

    // Give alice exactly 1 card that matches the top
    let top = st(&mut r).top_card();
    let win_card = num(top.color, top.value);
    st(&mut r).hands[0].cards = vec![win_card];

    declare_last(&mut r, 0);
    r.play_card(0, win_card, win_card.color, -1, NOW)
        .expect("PlayCard error");

    assert_eq!(r.scores[0], 67, "alice score");
    assert_eq!(r.scores[1], 0, "bob score");
    assert_eq!(r.rounds_won[0], 1, "alice rounds won");
}

// The in-game score table shows one column per round played, so every finished
// round must leave its own row behind: cumulative Scores cannot be broken back
// down once the same player wins twice.
#[test]
fn room_round_history_one_row_per_round() {
    let mut r = new_room("HIST");
    let _ = r.join("alice");
    let _ = r.join("bob");
    r.format = MatchFormat::BO3;
    let _ = r.start(NOW);

    assert!(
        r.round_history.is_empty(),
        "fresh match RoundHistory = {:?}, want empty",
        r.round_history
    );

    // Round 1: alice finishes holding nothing, bob holds 7 + Skip(20) = 27.
    st(&mut r).hands[0].cards.clear();
    st(&mut r).hands[1].cards = vec![num(Color::Red, 7), act(Color::Red, Kind::Skip)];
    r.end_round(0, NOW);

    r.begin_next_round(NOW).expect("BeginNextRound");

    // Round 2: bob finishes, alice holds a Wild (40).
    st(&mut r).hands[1].cards.clear();
    st(&mut r).hands[0].cards = vec![wild(Kind::WildCard)];
    r.end_round(1, NOW);

    let want: Vec<Vec<i32>> = vec![vec![27, 0], vec![0, 40]];
    assert_eq!(r.round_history.len(), want.len(), "RoundHistory");
    for (round, row) in want.iter().enumerate() {
        for (idx, &points) in row.iter().enumerate() {
            assert_eq!(
                r.round_history[round][idx],
                points,
                "round {} player {}",
                round + 1,
                idx
            );
        }
    }
    // The rows must add up to the cumulative scores the scoreboard shows.
    assert_eq!(r.scores, vec![27, 40], "Scores");
}

#[test]
fn room_round_end_match_not_over_bo3() {
    let mut r = new_room("BO3T");
    let _ = r.join("alice");
    let _ = r.join("bob");
    r.format = MatchFormat::BO3;
    let _ = r.start(NOW);
    st(&mut r).current_turn = 0;
    st(&mut r).pending_draw = 0;

    // Play round 1: alice wins
    let top = st(&mut r).top_card();
    let win_card = num(top.color, top.value);
    st(&mut r).hands[0].cards = vec![win_card];
    st(&mut r).hands[1].cards = vec![num(Color::Red, 5)];

    declare_last(&mut r, 0);
    r.play_card(0, win_card, win_card.color, -1, NOW)
        .expect("round 1 PlayCard error");

    // Match should NOT be over; round 1 ended but the next round is dealt
    // explicitly by the hub via BeginNextRound (not inside PlayCard).
    assert!(
        !r.match_over,
        "match should not be over after round 1 of BO3"
    );
    assert_eq!(r.round_number, 1, "RoundNumber before BeginNextRound");
    assert_eq!(r.status, Status::Playing, "Status");
    assert!(r.round_ended, "RoundEnded should be true");
    r.begin_next_round(NOW).expect("BeginNextRound");
    assert_eq!(r.round_number, 2, "RoundNumber after BeginNextRound");
}

#[test]
fn room_bo1_match_over() {
    let mut r = new_room("BO1T");
    let _ = r.join("alice");
    let _ = r.join("bob");
    r.format = MatchFormat::BO1;
    let _ = r.start(NOW);
    st(&mut r).current_turn = 0;
    st(&mut r).pending_draw = 0;

    let top = st(&mut r).top_card();
    let win_card = num(top.color, top.value);
    st(&mut r).hands[0].cards = vec![win_card];
    st(&mut r).hands[1].cards = vec![act(Color::Red, Kind::Skip)];

    declare_last(&mut r, 0);
    r.play_card(0, win_card, win_card.color, -1, NOW)
        .expect("PlayCard error");

    assert!(r.match_over, "match should be over after BO1");
    assert_eq!(r.match_winner, "alice", "MatchWinner");
    assert_eq!(r.status, Status::Finished, "Status");
}

/// Go: the `winRound` closure of `TestRoom_MatchScoreAccumulation`.
fn win_round(r: &mut Room, winner_idx: usize, loser_idx: usize, loser_cards: Vec<Card>) {
    let top = num(Color::Red, 1);
    let win_card = num(Color::Red, 1);
    {
        let s = st(r);
        s.current_turn = winner_idx as i32;
        s.pending_draw = 0;
        s.active_color = Color::Red;
        s.discard = vec![top];
        s.hands[winner_idx].cards = vec![win_card];
        s.hands[loser_idx].cards = loser_cards;
    }
    declare_last(r, winner_idx as i32);
    r.play_card(winner_idx as i32, win_card, win_card.color, -1, NOW)
        .expect("PlayCard error");
    // Simulate the hub: clear RoundEnded and deal the next round
    // (only if the match isn't already decided).
    r.round_ended = false;
    if !r.match_over {
        r.begin_next_round(NOW).expect("BeginNextRound");
    }
}

#[test]
fn room_match_score_accumulation() {
    // Play 3 rounds and verify scores accumulate
    let mut r = new_room("ACC");
    let _ = r.join("alice");
    let _ = r.join("bob");
    r.format = MatchFormat::BO3;
    let _ = r.start(NOW);

    // Round 1: alice wins, bob has 10 points worth
    win_round(&mut r, 0, 1, vec![num(Color::Red, 10)]);
    assert_eq!(r.scores[0], 10, "after round 1, alice score");

    // Round 2: bob wins, alice has 20 points worth
    win_round(&mut r, 1, 0, vec![act(Color::Red, Kind::Skip)]);
    assert_eq!(r.scores[1], 20, "after round 2, bob score");

    // Round 3: alice wins, bob has WildCard (40 pts per docs/rules.md §10) → match over
    win_round(&mut r, 0, 1, vec![wild(Kind::WildCard)]);
    assert_eq!(r.scores[0], 50, "after round 3, alice score"); // 10 + 40
    assert!(r.match_over, "match should be over after 3 rounds of BO3");
    assert_eq!(r.match_winner, "alice", "MatchWinner");
}

#[test]
fn room_tiebreaker_rounds_won() {
    // Same score, tiebreak by rounds won
    let mut r = new_room("TIE1");
    let _ = r.join("alice");
    let _ = r.join("bob");
    r.format = MatchFormat::BO3;
    let _ = r.start(NOW);

    // Manually set state to simulate after 2 rounds:
    // alice: 50 pts, 1 win; bob: 50 pts, 1 win (same score, same wins before round 3)
    r.round_number = 2;
    r.scores = vec![50, 50];
    r.rounds_won = vec![1, 1];
    r.lost_hand_total = vec![50, 50];

    // Round 3: alice wins with score = 0 (bob has no cards — shouldn't happen normally,
    // but for tiebreaker test: give both players different rounds-won so we can test)
    // Instead test determineMatchWinner directly with different rounds won
    let mut r2 = new_room("TIE2");
    let _ = r2.join("alice");
    let _ = r2.join("bob");
    r2.format = MatchFormat::BO3;
    r2.scores = vec![50, 50];
    r2.rounds_won = vec![2, 1];
    r2.lost_hand_total = vec![25, 60];
    let winner = r2.determine_match_winner();
    assert_eq!(winner.as_deref(), Some("alice"), "tiebreaker by rounds won");
}

#[test]
fn room_tiebreaker_lost_hand_total() {
    let mut r = new_room("TIE3");
    let _ = r.join("alice");
    let _ = r.join("bob");
    r.format = MatchFormat::BO3;
    // Same score, same rounds won → tiebreak by lowest lost hand total
    r.scores = vec![50, 50];
    r.rounds_won = vec![1, 1];
    r.lost_hand_total = vec![10, 30]; // alice has lower loss total
    let winner = r.determine_match_winner();
    assert_eq!(
        winner.as_deref(),
        Some("alice"),
        "tiebreaker by lost hand total"
    );
}

#[test]
fn room_sudden_death() {
    let mut r = new_room("TIE4");
    let _ = r.join("alice");
    let _ = r.join("bob");
    r.format = MatchFormat::BO1;
    // All tiebreakers exhausted: sudden death
    r.scores = vec![50, 50];
    r.rounds_won = vec![1, 1];
    r.lost_hand_total = vec![10, 10];
    let winner = r.determine_match_winner();
    assert_eq!(winner, None, "perfectly tied: determineMatchWinner()");
}

#[test]
fn room_set_format() {
    let mut r = new_room("FMT");
    let _ = r.join("alice");
    let _ = r.join("bob");
    r.set_format(MatchFormat::BO5)
        .expect("SetFormat(BO5) error");
    assert_eq!(r.format, MatchFormat::BO5, "Format");
    let _ = r.start(NOW);
    assert!(
        r.set_format(MatchFormat::BO3).is_err(),
        "SetFormat after game start should return error"
    );
}

#[test]
fn room_set_max_players() {
    let mut r = new_room("MAX");
    let _ = r.join("alice");
    let _ = r.join("bob");
    r.set_max_players(5).expect("SetMaxPlayers(5) error");
    assert_eq!(r.max_players, 5, "MaxPlayers");
    // Cannot set below current player count
    assert!(
        r.set_max_players(1).is_err(),
        "SetMaxPlayers below current count should return error"
    );
    // Seven is the cap: it is accepted, and one more is refused.
    r.set_max_players(7).expect("SetMaxPlayers(7) error");
    assert!(
        r.set_max_players(8).is_err(),
        "SetMaxPlayers above server max should return error"
    );
    let fresh = new_room("NEW");
    assert_eq!(fresh.max_players, 7, "default MaxPlayers");
}

#[test]
fn room_room_code_collision() {
    // Room codes must be unique — the hub retries generation on collision.
    // At the game layer, two rooms can have the same code (code uniqueness is hub's job).
    // This test verifies NewRoom accepts any code string.
    let mut r1 = new_room("AABBCC");
    let r2 = new_room("AABBCC");
    assert_eq!(r1.code, r2.code, "code mismatch");
    // Both rooms are independent objects
    let _ = r1.join("alice");
    assert_eq!(r2.players.len(), 0, "rooms should be independent");
}

// --- Round-end model: first player to empty hand wins ---

#[test]
fn room_round_ends_immediately_first_finisher() {
    // New ruleset: round ends the moment any player empties their hand.
    let mut r = setup_three_player_game();
    {
        let s = st(&mut r);
        s.active_color = Color::Red;
        s.discard = vec![num(Color::Red, 1)];
        s.pending_draw = 0;
        s.direction = 1;

        // alice has 1 matching card; bob has Skip (20pts); carol has WildDrawFour (50pts)
        s.hands[0].cards = vec![num(Color::Red, 1)];
        s.hands[1].cards = vec![act(Color::Red, Kind::Skip)];
        s.hands[2].cards = vec![wild(Kind::WildDrawFour)];
    }

    declare_last(&mut r, 0);
    r.play_card(0, num(Color::Red, 1), Color::Red, -1, NOW)
        .expect("alice play");
    assert!(
        r.round_ended,
        "round must end the moment alice empties her hand"
    );
    assert_eq!(r.winner, "alice", "round winner");
    assert_eq!(r.rounds_won[0], 1, "alice rounds won");
    // alice scores bob(Skip=20) + carol(W+4=50) = 70
    assert_eq!(r.scores[0], 70, "alice score");
    // Other players get 0 this round
    assert_eq!((r.scores[1], r.scores[2]), (0, 0), "losers scores");
    // LostHandTotal accumulates losing-round hand values
    assert_eq!(r.lost_hand_total[1], 20, "bob LostHandTotal");
    assert_eq!(r.lost_hand_total[2], 50, "carol LostHandTotal");
}

#[test]
fn room_biggest_loser_starts_next_round() {
    // After a round ends, the player with the lowest cumulative score starts next round.
    let mut r = new_room("BIGL");
    for n in ["alice", "bob", "carol"] {
        r.join(n).unwrap();
    }
    r.format = MatchFormat::BO3;
    r.start(NOW).unwrap();
    // Force a deterministic round 1 win for bob (so alice has 0 score, bob wins big).
    {
        let s = st(&mut r);
        s.current_turn = 1;
        s.pending_draw = 0;
        s.direction = 1;
        s.active_color = Color::Red;
        s.discard = vec![num(Color::Red, 1)];
        s.hands[0].cards = vec![num(Color::Red, 5), num(Color::Red, 5)];
        s.hands[1].cards = vec![num(Color::Red, 1)];
        s.hands[2].cards = vec![num(Color::Red, 3)];
    }

    declare_last(&mut r, 1);
    r.play_card(1, num(Color::Red, 1), Color::Red, -1, NOW)
        .expect("bob play");
    assert!(r.round_ended, "expected RoundEnded after bob finishes");
    r.round_ended = false;

    r.begin_next_round(NOW).expect("BeginNextRound");
    // alice (0) and carol (2) are tied at 0; deterministic tiebreak picks lowest idx (0).
    assert_eq!(
        st_ref(&r).current_turn,
        0,
        "biggest loser starter (alice; lowest score, lowest idx)"
    );
}

#[test]
fn room_swap_with_self_rejected() {
    let mut r = setup_two_player_game();
    let swap = act(Color::Red, Kind::Swap);
    {
        let s = st(&mut r);
        s.hands[0].cards = vec![swap];
        s.discard = vec![num(Color::Red, 3)];
        s.active_color = Color::Red;
    }
    assert!(
        r.play_card(0, swap, Color::Red, 0, NOW).is_err(),
        "swap with self should fail"
    );
}

// --- Swap and GlobalSwitch tests ---

#[test]
fn room_swap_card_swaps_hands() {
    let mut r = setup_two_player_game();

    // Swap is now a colored action card (1 per color). Use a Red Swap on a Red top.
    let swap_card = act(Color::Red, Kind::Swap);
    {
        let s = st(&mut r);
        s.hands[0].cards = vec![swap_card, num(Color::Red, 1)];
        s.hands[1].cards = vec![act(Color::Blue, Kind::Skip), num(Color::Green, 7)];
        s.discard = vec![num(Color::Red, 3)];
        s.active_color = Color::Red;
    }

    r.play_card(0, swap_card, Color::Red, 1, NOW) // swap with bob (index 1)
        .expect("PlayCard Swap error");

    let s = st_ref(&r);
    // Alice should now have bob's original 2 cards; bob should have alice's remaining 1 card
    assert_eq!(s.hands[0].cards.len(), 2, "after swap, alice hand size");
    assert_eq!(s.hands[1].cards.len(), 1, "after swap, bob hand size");
    // Alice's new hand should be bob's original cards
    assert_eq!(
        s.hands[0].cards[0].kind,
        Kind::Skip,
        "after swap, alice card[0] kind"
    );
    // Turn should advance to bob (index 1)
    assert_eq!(s.current_turn, 1, "after swap, CurrentTurn");
}

#[test]
fn room_swap_card_invalid_target() {
    let mut r = setup_two_player_game();
    let swap_card = act(Color::Red, Kind::Swap);
    {
        let s = st(&mut r);
        s.hands[0].cards = vec![swap_card];
        s.discard = vec![num(Color::Red, 3)];
        s.active_color = Color::Red;
    }

    assert!(
        r.play_card(0, swap_card, Color::Red, 0, NOW).is_err(),
        "swapping with self should return error"
    );
    assert!(
        r.play_card(0, swap_card, Color::Red, 99, NOW).is_err(),
        "swap with out-of-range index should return error"
    );
}

#[test]
fn room_global_switch_rotates_hands_clockwise() {
    let mut r = setup_three_player_game();

    let gs_card = wild(Kind::GlobalSwitch);
    let hand0 = [num(Color::Red, 1), num(Color::Blue, 2)];
    let hand1 = vec![num(Color::Green, 3)];
    let hand2 = vec![
        act(Color::Yellow, Kind::Skip),
        act(Color::Red, Kind::DrawTwo),
        act(Color::Blue, Kind::Reverse),
    ];

    {
        let s = st(&mut r);
        s.hands[0].cards = [&[gs_card][..], &hand0[..]].concat();
        s.hands[1].cards = hand1;
        s.hands[2].cards = hand2;
        s.discard = vec![num(Color::Red, 9)];
        s.active_color = Color::Red;
        s.direction = 1; // clockwise: 0→1→2
    }

    r.play_card(0, gs_card, Color::Blue, -1, NOW)
        .expect("PlayCard GlobalSwitch error");

    // With direction=1 (clockwise), rotation means each player gets the hand of
    // the previous player: player[i] gets old hand[(i-1+n)%n]
    // player0 gets old hand2 (3 cards), player1 gets old hand0 minus gsCard (2 cards),
    // player2 gets old hand1 (1 card)
    let s = st_ref(&r);
    assert_eq!(
        s.hands[0].cards.len(),
        3,
        "after GlobalSwitch, player0 hand size"
    );
    assert_eq!(
        s.hands[1].cards.len(),
        2,
        "after GlobalSwitch, player1 hand size"
    );
    assert_eq!(
        s.hands[2].cards.len(),
        1,
        "after GlobalSwitch, player2 hand size"
    );
}

#[test]
fn room_global_switch_rotates_by_direction_counter_clockwise() {
    // GlobalSwitch passes each hand to the next player in the current game direction.
    let mut r = setup_three_player_game();

    let gs_card = wild(Kind::GlobalSwitch);
    let hand0 = num(Color::Red, 1);
    let hand1 = vec![num(Color::Green, 3), num(Color::Blue, 4)];
    let hand2 = vec![
        act(Color::Yellow, Kind::Skip),
        act(Color::Red, Kind::DrawTwo),
        act(Color::Blue, Kind::Reverse),
    ];

    {
        let s = st(&mut r);
        s.hands[0].cards = vec![gs_card, hand0];
        s.hands[1].cards = hand1;
        s.hands[2].cards = hand2;
        s.discard = vec![num(Color::Red, 9)];
        s.active_color = Color::Red;
        s.direction = -1; // counter-clockwise: each hand passes to (i+1)→(i)
    }

    r.play_card(0, gs_card, Color::Blue, -1, NOW)
        .expect("PlayCard GlobalSwitch");
    // With direction=-1, rotation: newHands[i] = Hands[(i+1)%n]
    // → p0 gets old hand1 (2), p1 gets old hand2 (3), p2 gets old hand0 minus gsCard (1)
    let s = st_ref(&r);
    assert_eq!(s.hands[0].cards.len(), 2, "p0 hand");
    assert_eq!(s.hands[1].cards.len(), 3, "p1 hand");
    assert_eq!(s.hands[2].cards.len(), 1, "p2 hand");
}

#[test]
fn room_swap_card_not_wild() {
    // Swap is now a colored card, so it should NOT be playable on a non-matching top.
    let swap_card = act(Color::Red, Kind::Swap);
    let top = num(Color::Blue, 7);
    assert!(
        !can_play(swap_card, top, Color::Blue),
        "Red Swap should not be playable on Blue Number"
    );
    // But it IS playable on a matching color or matching kind.
    assert!(
        can_play(swap_card, num(Color::Red, 7), Color::Red),
        "Red Swap should be playable on Red Number"
    );
    assert!(
        can_play(swap_card, act(Color::Blue, Kind::Swap), Color::Blue),
        "Red Swap should be playable on Blue Swap (matching kind)"
    );
}

#[test]
fn room_global_switch_always_playable() {
    let gs_card = wild(Kind::GlobalSwitch);
    assert!(
        can_play(gs_card, act(Color::Green, Kind::Skip), Color::Green),
        "GlobalSwitch is wild; must always be playable"
    );
}

#[test]
fn room_global_switch_sets_chosen_color_playable() {
    // A GlobalSwitch names a colour like any other wild, and that colour must be
    // a real one so the next player can answer with an ordinary coloured card.
    // If ActiveColor became Wild the only legal cards at the table would be wilds
    // and everybody would be stuck drawing.
    let mut r = setup_three_player_game();
    let gs_card = wild(Kind::GlobalSwitch);
    {
        let s = st(&mut r);
        // Hands rotate one seat, so the card the next player will hold is the one
        // left in seat 0 after the play.
        s.hands[0].cards = vec![gs_card, num(Color::Red, 2)];
        s.hands[1].cards = vec![num(Color::Blue, 3)];
        s.hands[2].cards = vec![num(Color::Green, 4)];
        s.discard = vec![num(Color::Red, 9)];
        s.active_color = Color::Red;
        s.direction = 1;
    }

    r.play_card(0, gs_card, Color::Red, -1, NOW)
        .expect("PlayCard GlobalSwitch");
    let s = st_ref(&r);
    assert_eq!(s.active_color, Color::Red, "ActiveColor (chosen)");
    let next = s.current_turn as usize;
    let playable = s.hands[next]
        .cards
        .iter()
        .any(|&c| can_play(c, s.top_card(), s.active_color));
    assert!(
        playable,
        "player {next} holds {:?} — no legal card after GlobalSwitch",
        s.hands[next].cards
    );
}

#[test]
fn room_interrupt_play_global_switch_sets_chosen_color() {
    let mut r = setup_three_player_game();
    {
        let s = st(&mut r);
        s.current_turn = 1;
        s.direction = 1;
        s.active_color = Color::Red;
        s.discard = vec![wild(Kind::GlobalSwitch)];
    }
    arm_interrupt(&mut r, 0);

    let gs = wild(Kind::GlobalSwitch);
    {
        let s = st(&mut r);
        s.hands[0].cards = vec![num(Color::Red, 1)];
        s.hands[1].cards = vec![num(Color::Red, 2)];
        s.hands[2].cards = vec![gs, num(Color::Red, 3)];
    }

    r.interrupt_play(2, gs, Color::Green, -1, NOW)
        .expect("GlobalSwitch interject");
    assert_eq!(
        st_ref(&r).active_color,
        Color::Green,
        "ActiveColor (chosen by the interjecter)"
    );
}

// A GlobalSwitch is a wild: it must name the colour that becomes active, on a
// normal play and on an interject alike. Letting a colourless one through would
// hand the table a rotation whose colour nobody chose.
#[test]
fn room_global_switch_requires_chosen_color() {
    let mut r = setup_three_player_game();
    let gs = wild(Kind::GlobalSwitch);
    {
        let s = st(&mut r);
        s.hands[0].cards = vec![gs, num(Color::Red, 1)];
        s.discard = vec![num(Color::Red, 9)];
        s.active_color = Color::Red;
    }

    assert!(
        r.play_card(0, gs, Color::Wild, -1, NOW).is_err(),
        "a GlobalSwitch play must name a real colour"
    );
    assert_eq!(
        st_ref(&r).discard.len(),
        1,
        "a rejected GlobalSwitch must not touch the discard pile"
    );
}

#[test]
fn room_interrupt_play_global_switch_requires_chosen_color() {
    let mut r = setup_three_player_game();
    {
        let s = st(&mut r);
        s.current_turn = 1;
        s.active_color = Color::Red;
        s.discard = vec![wild(Kind::GlobalSwitch)];
    }
    arm_interrupt(&mut r, 0);

    let gs = wild(Kind::GlobalSwitch);
    st(&mut r).hands[2].cards = vec![gs, num(Color::Red, 3)];

    assert!(
        r.interrupt_play(2, gs, Color::Wild, -1, NOW).is_err(),
        "a GlobalSwitch interject must name a real colour"
    );
    assert_eq!(
        st_ref(&r).discard.len(),
        1,
        "a rejected GlobalSwitch must not touch the discard pile"
    );
}

#[test]
fn room_global_switch_as_last_card_does_not_leave_wild_active() {
    let mut r = setup_three_player_game();
    let gs_card = wild(Kind::GlobalSwitch);
    {
        let s = st(&mut r);
        s.hands[0].cards = vec![gs_card];
        s.hands[1].cards = vec![num(Color::Green, 3)];
        s.hands[2].cards = vec![act(Color::Yellow, Kind::Skip)];
        s.discard = vec![num(Color::Red, 9)];
        s.active_color = Color::Red;
    }

    declare_last(&mut r, 0);
    r.play_card(0, gs_card, Color::Green, -1, NOW)
        .expect("PlayCard GlobalSwitch as last card");
    assert_ne!(
        st_ref(&r).active_color,
        Color::Wild,
        "ActiveColor must never be Wild — the round summary would show a colourless ring"
    );
}

// Per rules.md §11.1: if the actor empties their hand by playing Swap,
// the round ends immediately and the swap is aborted (the actor must not
// receive the opponent's hand and lose the win).
#[test]
fn room_swap_as_last_card_ends_round_without_swapping() {
    let mut r = setup_two_player_game();
    let swap_card = act(Color::Red, Kind::Swap);
    {
        let s = st(&mut r);
        s.hands[0].cards = vec![swap_card];
        s.hands[1].cards = vec![act(Color::Blue, Kind::Skip), num(Color::Green, 7)];
        s.discard = vec![num(Color::Red, 3)];
        s.active_color = Color::Red;
    }

    declare_last(&mut r, 0);
    r.play_card(0, swap_card, Color::Red, 1, NOW)
        .expect("PlayCard Swap as last card");
    assert!(r.round_ended, "playing last card (Swap) must end the round");
    assert_eq!(r.winner, r.players[0].nickname, "Winner");
    let s = st_ref(&r);
    assert_eq!(s.hands[0].cards.len(), 0, "actor hand size (swap aborted)");
    assert_eq!(
        s.hands[1].cards.len(),
        2,
        "opponent hand size (swap aborted)"
    );
}

// Per rules.md §11.1 (analogous to Swap): if the actor empties their hand
// by playing GlobalSwitch, the round ends immediately and the rotation is
// aborted.
#[test]
fn room_global_switch_as_last_card_ends_round_without_rotating() {
    let mut r = setup_three_player_game();
    let gs_card = wild(Kind::GlobalSwitch);
    {
        let s = st(&mut r);
        s.hands[0].cards = vec![gs_card];
        s.hands[1].cards = vec![num(Color::Green, 3)];
        s.hands[2].cards = vec![
            act(Color::Yellow, Kind::Skip),
            act(Color::Red, Kind::DrawTwo),
        ];
        s.discard = vec![num(Color::Red, 9)];
        s.active_color = Color::Red;
        s.direction = 1;
    }

    declare_last(&mut r, 0);
    r.play_card(0, gs_card, Color::Green, -1, NOW)
        .expect("PlayCard GlobalSwitch as last card");
    assert!(
        r.round_ended,
        "playing last card (GlobalSwitch) must end the round"
    );
    assert_eq!(r.winner, r.players[0].nickname, "Winner");
    let s = st_ref(&r);
    assert_eq!(
        s.hands[0].cards.len(),
        0,
        "actor hand size (rotation aborted)"
    );
    assert_eq!(s.hands[1].cards.len(), 1, "p1 hand size (rotation aborted)");
    assert_eq!(s.hands[2].cards.len(), 2, "p2 hand size (rotation aborted)");
}

// --- Draw stack regression tests ---

// TestPenaltyDraw_ConsumesStack verifies that DrawCard when PendingDraw > 0
// draws exactly PendingDraw cards and resets PendingDraw to 0.
#[test]
fn penalty_draw_consumes_stack() {
    let mut r = setup_two_player_game();

    // Simulate alice playing a +2: bob is now facing a penalty of 2.
    st(&mut r).current_turn = 1; // bob's turn
    st(&mut r).pending_draw = 2;

    let bob_before = st_ref(&r).hands[1].cards.len();
    r.draw_card(1, NOW).expect("DrawCard error");

    assert_eq!(st_ref(&r).pending_draw, 0, "PendingDraw after penalty draw");
    assert_eq!(
        st_ref(&r).hands[1].cards.len(),
        bob_before + 2,
        "bob hand size"
    );
}

// TestPenaltyDraw_KeepsTurn verifies rules.md §14.5: a forced draw costs cards,
// not the turn. The victim takes the whole stack and then plays normally — or
// passes, which is the only thing that moves the turn on from there.
#[test]
fn penalty_draw_keeps_turn() {
    let mut r = setup_two_player_game();

    // Bob faces a +4 penalty stack.
    st(&mut r).current_turn = 1;
    st(&mut r).pending_draw = 4;

    r.draw_card(1, NOW).expect("DrawCard error");

    assert_eq!(
        st_ref(&r).current_turn,
        1,
        "CurrentTurn after penalty draw (bob keeps the turn)"
    );
    // HasDrawn gates the second draw and unlocks PassTurn.
    assert!(
        st_ref(&r).has_drawn,
        "HasDrawn should be true after a penalty draw"
    );
    assert!(
        r.draw_card(1, NOW).is_err(),
        "a second draw in the same turn must be refused"
    );
    r.pass_turn(1, NOW).expect("PassTurn after a penalty draw");
    assert_eq!(
        st_ref(&r).current_turn,
        0,
        "CurrentTurn after passing (alice)"
    );
}

// TestCounterDraw_StackContinues verifies that CounterDraw accumulates the
// penalty and passes it to the next player, keeping PendingDraw non-zero.
#[test]
fn counter_draw_stack_continues() {
    let mut r = setup_three_player_game();
    // alice(0) → bob(1) → carol(2)

    // alice plays +2; bob faces a 2-card penalty.
    let top = st(&mut r).top_card();
    let alice_draw_two = act(top.color, Kind::DrawTwo);
    st(&mut r).hands[0].cards.insert(0, alice_draw_two);
    r.play_card(0, alice_draw_two, alice_draw_two.color, -1, NOW)
        .expect("alice PlayCard DrawTwo");
    assert_eq!(st_ref(&r).pending_draw, 2, "PendingDraw after +2");
    assert_eq!(st_ref(&r).current_turn, 1, "turn (bob)");

    // bob counters with another +2; carol now faces a 4-card penalty.
    let bob_counter = act(alice_draw_two.color, Kind::DrawTwo);
    st(&mut r).hands[1].cards.insert(0, bob_counter);
    r.counter_draw(1, bob_counter, bob_counter.color, NOW)
        .expect("bob CounterDraw");
    assert_eq!(st_ref(&r).pending_draw, 4, "PendingDraw after stack +2+2");
    assert_eq!(st_ref(&r).current_turn, 2, "turn (carol)");

    // carol draws; must consume all 4 and keep the turn (§14.5) until she passes.
    let carol_before = st_ref(&r).hands[2].cards.len();
    r.draw_card(2, NOW).expect("carol DrawCard");
    assert_eq!(st_ref(&r).pending_draw, 0, "PendingDraw after carol draws");
    assert_eq!(
        st_ref(&r).hands[2].cards.len(),
        carol_before + 4,
        "carol hand size"
    );
    assert_eq!(
        st_ref(&r).current_turn,
        2,
        "turn after carol draws (carol keeps the turn)"
    );
    r.pass_turn(2, NOW).expect("carol PassTurn");
    assert_eq!(
        st_ref(&r).current_turn,
        0,
        "turn after carol passes (alice)"
    );
}

// A counter that empties the hand wins the round, and a round that is over has
// no interrupt window. CounterDraw used to carry its own copy of the win path
// and that copy left the window armed: nothing could be interjected into it,
// but only because of the order the hub runs its checks in. This asserts the
// state rather than the caller.
#[test]
fn counter_draw_win_closes_the_interrupt_window() {
    let mut r = setup_two_player_game();

    // Bob is under a red +2, holds exactly the red +2 that answers it, and the
    // window is open from the play that put him there.
    let counter = act(Color::Red, Kind::DrawTwo);
    {
        let s = st(&mut r);
        s.current_turn = 1;
        s.pending_draw = 2;
        s.discard = vec![act(Color::Red, Kind::DrawTwo)];
        s.active_color = Color::Red;
        s.arm_interrupt_window(0, NOW);
        s.hands[1].cards = vec![counter];
    }

    declare_last(&mut r, 1);
    r.counter_draw(1, counter, Color::Red, NOW)
        .expect("CounterDraw");
    assert!(
        r.round_ended,
        "emptying the hand with a counter did not end the round"
    );
    assert!(
        st_ref(&r).last_play_by < 0,
        "LastPlayBy = {} after a round-winning counter, want the window closed",
        st_ref(&r).last_play_by
    );
}

// TestCounterDraw_RequiresSameColor verifies that a counter is the same card:
// a red +2 is answered by a red +2 only. The off-colour +2 is not lost — the
// forced draw keeps the turn (§14.5), so the victim takes the stack and then
// plays it as an ordinary kind-match on the very same discard.
#[test]
fn counter_draw_requires_same_color() {
    let mut r = setup_two_player_game();

    // Bob is under a red +2 and holds a blue one.
    let blue_draw_two = act(Color::Blue, Kind::DrawTwo);
    {
        let s = st(&mut r);
        s.current_turn = 1;
        s.pending_draw = 2;
        s.discard = vec![act(Color::Red, Kind::DrawTwo)];
        s.active_color = Color::Red;
        s.hands[1].cards.insert(0, blue_draw_two);
    }

    assert!(
        r.counter_draw(1, blue_draw_two, Color::Blue, NOW).is_err(),
        "CounterDraw with a differently-coloured +2 should be refused"
    );
    assert_eq!(
        st_ref(&r).pending_draw,
        2,
        "PendingDraw after refused counter"
    );

    // Take the penalty: the turn stays with bob, and the blue +2 is now legal.
    r.draw_card(1, NOW).expect("bob DrawCard");
    assert_eq!(
        st_ref(&r).current_turn,
        1,
        "turn after forced draw (bob keeps the turn)"
    );
    r.play_card(1, blue_draw_two, Color::Blue, -1, NOW)
        .expect("blue +2 on a red +2 after the forced draw");
    assert_eq!(
        st_ref(&r).pending_draw,
        2,
        "PendingDraw (the newly played +2)"
    );
    assert_eq!(st_ref(&r).active_color, Color::Blue, "ActiveColor");
}

// TestCounterDraw_WildChainIgnoresColorTest verifies the colour check never
// blocks a +4 chain: every WildDrawFour is Wild-coloured, so same-colour holds
// by construction whatever colour was chosen.
#[test]
fn counter_draw_wild_chain_ignores_color_test() {
    let mut r = setup_two_player_game();

    let wd4 = wild(Kind::WildDrawFour);
    {
        let s = st(&mut r);
        s.current_turn = 1;
        s.pending_draw = 4;
        s.discard = vec![wild(Kind::WildDrawFour)];
        s.active_color = Color::Red;
        s.hands[1].cards.insert(0, wd4);
    }

    r.counter_draw(1, wd4, Color::Green, NOW)
        .expect("CounterDraw +4 on +4");
    assert_eq!(st_ref(&r).pending_draw, 8, "PendingDraw");
    assert_eq!(
        st_ref(&r).active_color,
        Color::Green,
        "ActiveColor (the counter's chosen colour)"
    );
}

// TestPlayCard_RejectedDuringPendingDraw verifies that normal play_card cannot be
// used to bypass an active draw penalty; the player must counter_draw or draw_card.
#[test]
fn play_card_rejected_during_pending_draw() {
    let mut r = setup_two_player_game();

    // Bob is under a pending +2 penalty.
    let illegal = num(Color::Red, 7);
    {
        let s = st(&mut r);
        s.current_turn = 1;
        s.pending_draw = 2;
        s.discard = vec![act(Color::Red, Kind::DrawTwo)];
        s.active_color = Color::Red;
        s.hands[1].cards.insert(0, illegal);
    }
    let hand_before = st_ref(&r).hands[1].cards.len();

    assert!(
        r.play_card(1, illegal, Color::Red, -1, NOW).is_err(),
        "expected PlayCard to fail during pending draw"
    );
    assert_eq!(
        st_ref(&r).pending_draw,
        2,
        "PendingDraw changed after rejected play"
    );
    assert_eq!(
        st_ref(&r).hands[1].cards.len(),
        hand_before,
        "hand size changed after rejected play"
    );
}

// --- Card effect end-to-end tests ---

#[test]
fn room_skip_end_to_end() {
    let mut r = setup_three_player_game();
    // alice(0) → bob(1) → carol(2); alice plays a Skip → bob is skipped → carol's turn.
    let skip_card = act(Color::Red, Kind::Skip);
    {
        let s = st(&mut r);
        s.active_color = Color::Red;
        s.discard = vec![num(Color::Red, 5)];
        s.direction = 1;
        s.hands[0].cards.insert(0, skip_card);
    }

    r.play_card(0, skip_card, Color::Red, -1, NOW)
        .expect("PlayCard Skip");
    assert_eq!(
        st_ref(&r).current_turn,
        2,
        "after Skip, CurrentTurn (carol)"
    );
}
