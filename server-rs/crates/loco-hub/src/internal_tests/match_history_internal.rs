//! Port of `server/hub/match_history_internal_test.go`.
//!
//! The recap is indexed by seat like everything else on a table, so it moves
//! with every move that re-bases a seat. These are the two the black-box suite
//! cannot reach cheaply: a swap (transfer_host in the lobby a rematch reopened)
//! and the reset that must NOT touch it.

use crate::room::new_room;
use crate::table::{MatchRecord, Table, match_duration_ms};
use std::time::{Duration, SystemTime};

fn rec(rounds_won: &[i64], scores: &[i64], winner: i64) -> MatchRecord {
    MatchRecord {
        rounds_won: rounds_won.to_vec(),
        scores: scores.to_vec(),
        winner,
        duration_ms: 0,
    }
}

fn history_table() -> Table {
    let mut room = new_room("HIST");
    room.join("alice").unwrap();
    room.join("bob").unwrap();
    room.join("carol").unwrap();
    let mut t = Table::new("HIST", room);
    t.members = vec![None, None, None];
    t.match_history = vec![
        rec(&[2, 1, 0], &[80, 40, 10], 0),
        rec(&[0, 0, 2], &[5, 15, 70], 2),
    ];
    t
}

/// 2026-09-05 21:00:00 UTC.
fn opened() -> SystemTime {
    SystemTime::UNIX_EPOCH + Duration::from_secs(1_788_642_000)
}

#[test]
fn match_history_swap_seats_moves_the_columns() {
    let mut tb = history_table();
    tb.swap_seats(0, 2);
    let want = vec![
        rec(&[0, 1, 2], &[10, 40, 80], 2),
        rec(&[2, 0, 0], &[70, 15, 5], 0),
    ];
    assert_eq!(tb.match_history, want);
}

#[test]
fn match_history_drop_seat_removes_the_column() {
    let mut tb = history_table();
    tb.drop_seat(0);
    let want = vec![
        // Alice took the first match and has left: nobody owns that row now.
        rec(&[1, 0], &[40, 10], -1),
        // Carol took the second and has slid from seat 2 to seat 1.
        rec(&[0, 2], &[15, 70], 1),
    ];
    assert_eq!(tb.match_history, want);
}

// reset_for_next_match clears what belonged to the match that just ended. The
// recap is the one thing there that is about the matches before it, so it stays.
#[test]
fn match_history_survives_reset_for_next_match() {
    let mut tb = history_table();
    let before = tb.match_history.len();
    tb.reset_for_next_match();
    assert_eq!(tb.match_history.len(), before);
}

// The record copies the room's arrays rather than pointing at them: the reset
// for a rematch empties those, and a row holding the live slice would read as
// the next match. (In Rust the copy is a given; the test pins it anyway.)
#[test]
fn match_history_record_copies_the_scoreboard() {
    let mut room = new_room("COPY");
    room.join("alice").unwrap();
    room.join("bob").unwrap();
    room.scores = vec![70, 20];
    room.rounds_won = vec![2, 0];
    room.match_winner = "alice".into();
    let mut tb = Table::new("COPY", room);

    tb.record_finished_match(SystemTime::now());
    tb.room.scores[0] = 999;
    tb.room.rounds_won.clear();

    assert_eq!(
        tb.match_history[0].scores[0], 70,
        "recorded score followed the room"
    );
    assert_eq!(tb.match_history[0].rounds_won, vec![2, 0]);
    assert_eq!(tb.match_history[0].winner, 0);
}

// The duration on a record is the difference between the moment the table
// opened and the moment the match ended, and nothing else: no clock is read
// inside the record, so a test chooses both stamps.
#[test]
fn match_history_record_measures_the_match_from_the_open() {
    let mut room = new_room("TIME");
    room.join("alice").unwrap();
    room.join("bob").unwrap();
    room.match_winner = "alice".into();
    let mut tb = Table::new("TIME", room);

    tb.match_started_at = Some(opened());
    tb.record_finished_match(opened() + Duration::from_secs(12 * 60 + 30));
    assert_eq!(tb.match_history[0].duration_ms, 750_000);
}

// Zero on the wire means "cannot say", so a match that opened is never reported
// as zero however fast it went: the millisecond is rounded up, not down.
#[test]
fn match_duration_ms_rounds_up_to_at_least_one_millisecond() {
    let o = opened();
    assert_eq!(
        match_duration_ms(Some(o), o + Duration::from_micros(200)),
        1,
        "a 200µs match"
    );
    assert_eq!(
        match_duration_ms(Some(o), o + Duration::from_micros(1500)),
        2,
        "a 1.5ms match"
    );
}

// A match that never opened has no duration. That is the forfeit inside the
// loading gate, and the match a snapshot from an older process brought back
// without its stamp: both must read as unknown rather than as instant.
#[test]
fn match_duration_ms_unknown_without_an_open() {
    let now = opened();
    assert_eq!(match_duration_ms(None, now), 0);
    assert_eq!(match_duration_ms(Some(now), now), 0);
}

// The next match at this table is timed from its own open, so the stamp goes
// with everything else about the match that just ended.
#[test]
fn match_history_reset_clears_the_open_stamp() {
    let mut tb = history_table();
    tb.match_started_at = Some(SystemTime::now());
    tb.reset_for_next_match();
    assert!(
        tb.match_started_at.is_none(),
        "match_started_at survived reset_for_next_match"
    );
}
