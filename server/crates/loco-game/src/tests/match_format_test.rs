//! The match format, since rounds won started deciding it.
//!
//! Two rules live here and they are separate: who wins a match that has run its
//! course (the tiebreak chain), and when a match stops running (decisiveLeader).
//! Both used to be one line of endRound and neither was tested on its own.

use super::support::*;
use crate::card::{Color, Kind};
use crate::room::MatchFormat;

// The headline rule: rounds won decide, points only measure the gap. Before the
// change the score was filtered first, so the seat that took one expensive round
// beat the seat that took two cheap ones.
#[test]
fn determine_match_winner_rounds_won_beats_score() {
    let mut r = match_room("MW1", MatchFormat::Bo3, &["alice", "bob"]);
    r.round_number = 3;
    r.rounds_won = vec![2, 1];
    r.scores = vec![10, 500];
    r.lost_hand_total = vec![0, 0];

    let got = r
        .determine_match_winner()
        .map(|i| r.players[i].nickname.clone());
    assert_eq!(
        got.as_deref(),
        Some("alice"),
        "winner = {got:?}, want alice (2 rounds beats 500 points)"
    );
}

#[test]
fn determine_match_winner_score_breaks_rounds_tie() {
    let mut r = match_room("MW2", MatchFormat::Bo3, &["alice", "bob"]);
    r.round_number = 3;
    r.rounds_won = vec![1, 1];
    r.scores = vec![40, 90];
    r.lost_hand_total = vec![0, 0];

    let got = r
        .determine_match_winner()
        .map(|i| r.players[i].nickname.clone());
    assert_eq!(
        got.as_deref(),
        Some("bob"),
        "winner = {got:?}, want bob (level on rounds, ahead on points)"
    );
}

#[test]
fn determine_match_winner_lost_hand_breaks_score_tie() {
    let mut r = match_room("MW3", MatchFormat::Bo3, &["alice", "bob"]);
    r.round_number = 3;
    r.rounds_won = vec![1, 1];
    r.scores = vec![60, 60];
    r.lost_hand_total = vec![12, 40];

    let got = r
        .determine_match_winner()
        .map(|i| r.players[i].nickname.clone());
    assert_eq!(
        got.as_deref(),
        Some("alice"),
        "winner = {got:?}, want alice (smallest pile of leftovers)"
    );
}

#[test]
fn determine_match_winner_sudden_death_when_nothing_separates() {
    let mut r = match_room("MW4", MatchFormat::Bo3, &["alice", "bob"]);
    r.round_number = 3;
    r.rounds_won = vec![1, 1];
    r.scores = vec![60, 60];
    r.lost_hand_total = vec![20, 20];

    let got = r
        .determine_match_winner()
        .map(|i| r.players[i].nickname.clone());
    assert_eq!(got, None, "winner = {got:?}, want None (sudden death)");
}

// A match stops the moment the rounds left cannot close the gap. One case per
// format, plus the round before it, so the test fails both on a match that runs
// too long and on one that stops too early.
#[test]
fn room_match_stops_once_the_lead_is_uncatchable() {
    struct Case {
        name: &'static str,
        format: MatchFormat,
        wins: &'static [usize], // rounds alice must win, in order, to take the match
        stops_after: u32,       // how many rounds the match should last
    }
    let cases = [
        Case {
            name: "BO1 ends on its only round",
            format: MatchFormat::Bo1,
            wins: &[0],
            stops_after: 1,
        },
        Case {
            name: "BO3 stops at two nil",
            format: MatchFormat::Bo3,
            wins: &[0, 0],
            stops_after: 2,
        },
        Case {
            name: "BO5 stops at three nil",
            format: MatchFormat::Bo5,
            wins: &[0, 0, 0],
            stops_after: 3,
        },
        Case {
            name: "BO7 stops at four nil",
            format: MatchFormat::Bo7,
            wins: &[0, 0, 0, 0],
            stops_after: 4,
        },
    ];
    for tc in cases {
        let mut r = match_room("STOP", tc.format, &["alice", "bob"]);
        for (i, &seat) in tc.wins.iter().enumerate() {
            assert!(
                !r.match_over,
                "{}: match over after {i} rounds, want {}",
                tc.name, tc.stops_after
            );
            play_round(&mut r, seat, &[num(Color::Blue, 5)]);
        }
        assert!(
            r.match_over,
            "match still open after {} rounds of {}",
            tc.stops_after, tc.name
        );
        assert_eq!(
            r.round_number, tc.stops_after,
            "{}: RoundNumber = {}, want {}",
            tc.name, r.round_number, tc.stops_after
        );
        assert_eq!(
            r.match_winner, "alice",
            "{}: MatchWinner = {:?}, want alice",
            tc.name, r.match_winner
        );
    }
}

// The other half of the same rule: a lead that is still catchable does not stop
// anything, however large the points gap is.
#[test]
fn room_match_runs_on_while_the_lead_is_catchable() {
    let mut r = match_room("OPEN", MatchFormat::Bo7, &["alice", "bob"]);
    // 3–1 with three rounds left: bob can still reach 4.
    play_round(&mut r, 0, &[wild(Kind::WildDrawFour)]);
    play_round(&mut r, 0, &[wild(Kind::WildDrawFour)]);
    play_round(&mut r, 1, &[num(Color::Blue, 1)]);
    play_round(&mut r, 0, &[wild(Kind::WildDrawFour)]);

    assert!(
        !r.match_over,
        "match over at 3-1 in a BO7 (round {})",
        r.round_number
    );
    assert_eq!(r.rounds_won, vec![3, 1], "RoundsWon, want [3 1]");
}

// Past two seats the majority is the wrong number — six players sharing a BO7
// never reach four — so the rule is a lead nobody can catch, not a threshold.
#[test]
fn room_uncatchable_lead_at_more_than_two_seats() {
    let mut r = match_room("MANY", MatchFormat::Bo3, &["alice", "bob", "carol"]);
    play_round(&mut r, 0, &[num(Color::Blue, 3)]);
    assert!(!r.match_over, "match over after one round of a BO3");
    play_round(&mut r, 0, &[num(Color::Blue, 3)]);
    assert!(
        r.match_over,
        "2-0-0 with one round left should end a BO3 (round {})",
        r.round_number
    );
    assert_eq!(r.match_winner, "alice", "MatchWinner, want alice");
}

// A perfectly level last round keeps the room dealing rather than crowning
// anybody: the format runs out, the chain separates nobody, sudden death.
#[test]
fn room_sudden_death_deals_another_round() {
    let mut r = match_room("SUD", MatchFormat::Bo3, &["alice", "bob"]);
    let loser = [num(Color::Blue, 5)];
    play_round(&mut r, 0, &loser);
    play_round(&mut r, 1, &loser);
    play_round(&mut r, 0, &loser);
    // 2–1 after three rounds: decisive, and no sudden death to reach.
    assert!(
        r.match_over,
        "2-1 after the last round of a BO3 should end it"
    );

    // Now the level case, built directly: identical rounds, points and leftovers.
    let mut r2 = match_room("SUD2", MatchFormat::Bo3, &["alice", "bob"]);
    r2.round_number = 3;
    r2.rounds_won = vec![1, 1];
    r2.scores = vec![30, 30];
    r2.lost_hand_total = vec![30, 30];
    assert!(
        r2.decisive_leader().is_none(),
        "decisiveLeader = {:?} on a level table, want -1",
        r2.decisive_leader()
    );
    let got = r2
        .determine_match_winner()
        .map(|i| r2.players[i].nickname.clone());
    assert_eq!(got, None, "winner = {got:?}, want None");
    r2.begin_next_round(NOW)
        .unwrap_or_else(|e| panic!("BeginNextRound: {e}"));
    assert_eq!(r2.round_number, 4, "RoundNumber, want 4 (sudden death)");
    // And the extra round settles it: the winner is a round ahead of everyone.
    play_round(&mut r2, 1, &[num(Color::Blue, 5)]);
    assert!(
        r2.match_over && r2.match_winner == "bob",
        "sudden death: over={} winner={:?}, want true/bob",
        r2.match_over,
        r2.match_winner
    );
}

// A forfeit hands the match over whatever the board said, and leaves the board
// alone. Worth pinning against the uncatchable-lead rule: the seat that walks
// out is the one that was about to win.
#[test]
fn room_forfeit_during_an_uncatchable_lead() {
    let mut r = match_room("FF", MatchFormat::Bo7, &["alice", "bob"]);
    play_round(&mut r, 0, &[wild(Kind::WildDrawFour)]);
    play_round(&mut r, 0, &[wild(Kind::WildDrawFour)]);
    play_round(&mut r, 0, &[wild(Kind::WildDrawFour)]);
    let scores = r.scores.clone();
    let rounds_won = r.rounds_won.clone();

    r.forfeit_to(1, NOW)
        .unwrap_or_else(|e| panic!("ForfeitTo: {e}"));
    assert_eq!(r.match_winner, "bob", "MatchWinner, want bob");
    assert!(
        r.scores == scores && r.rounds_won == rounds_won,
        "forfeit moved the scoreboard: scores={:?} roundsWon={:?}, want {scores:?}/{rounds_won:?}",
        r.scores,
        r.rounds_won
    );
}

// The next round's opener is still the seat with the fewest points, on purpose:
// rounds won is too coarse a signal — most of the table sits on zero.
#[test]
fn room_biggest_loser_stays_on_points() {
    let mut r = match_room("BL", MatchFormat::Bo7, &["alice", "bob", "carol"]);
    r.scores = vec![80, 5, 40];
    r.rounds_won = vec![0, 3, 0];
    let got = r.biggest_loser();
    assert_eq!(
        got, 1,
        "biggestLoser = {got}, want 1 (fewest points, whatever the rounds say)"
    );
}
