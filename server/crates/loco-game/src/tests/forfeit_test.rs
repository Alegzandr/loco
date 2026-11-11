//! Ported from Go: `server/game/forfeit_test.go`.

use super::support::*;
use crate::room::Status;

// A forfeit ends the match on the spot and hands it to whoever is still there.
// It is the only way a match can finish without a round finishing, so it has to
// leave the room in exactly the state the finished path leaves it in: the hub
// broadcasts match_end from these fields and the client's game-over screen is
// built from them.
#[test]
fn forfeit_to_ends_match_for_the_remaining_player() {
    let mut r = new_room("ABCDEF");
    must_join(&mut r, "Alice");
    must_join(&mut r, "Bob");
    r.start(NOW).unwrap_or_else(|e| panic!("Start: {e}"));

    r.forfeit_to(1, NOW)
        .unwrap_or_else(|e| panic!("ForfeitTo: {e}"));

    assert!(r.match_over, "MatchOver = false, want true");
    assert_eq!(r.match_winner, "Bob", "MatchWinner");
    assert_eq!(r.status, Status::Finished, "Status");
}

// The abandoned round scores nothing. A forfeit is not a win on points, and
// inventing points for it would put a round in the score table that nobody
// played to the end.
#[test]
fn forfeit_to_leaves_the_scoreboard_alone() {
    let mut r = new_room("ABCDEF");
    must_join(&mut r, "Alice");
    must_join(&mut r, "Bob");
    r.start(NOW).unwrap_or_else(|e| panic!("Start: {e}"));
    r.scores[0] = 40;
    let rounds = r.round_history.len();

    r.forfeit_to(0, NOW)
        .unwrap_or_else(|e| panic!("ForfeitTo: {e}"));

    assert_eq!(r.scores, vec![40, 0], "Scores, want [40 0] unchanged");
    assert_eq!(
        r.round_history.len(),
        rounds,
        "RoundHistory grew to {} rows, want {rounds}",
        r.round_history.len()
    );
    assert!(
        !r.round_ended,
        "RoundEnded = true: a forfeit ends the match, not a round"
    );
}

#[test]
fn forfeit_to_rejects_when_not_playing() {
    let mut r = new_room("ABCDEF");
    must_join(&mut r, "Alice");
    must_join(&mut r, "Bob");

    assert!(
        r.forfeit_to(0, NOW).is_err(),
        "ForfeitTo in a lobby: want error, got Ok"
    );
}

#[test]
fn forfeit_to_rejects_unknown_seat() {
    let mut r = new_room("ABCDEF");
    must_join(&mut r, "Alice");
    must_join(&mut r, "Bob");
    r.start(NOW).unwrap_or_else(|e| panic!("Start: {e}"));

    assert!(
        r.forfeit_to(2, NOW).is_err(),
        "ForfeitTo(2) with 2 seats: want error, got Ok"
    );
    assert!(!r.match_over, "a refused forfeit must not end the match");
}
