//! One table, as one thing. Port of `server/hub/table.go`.
//!
//! Everything the hub knows about one room code is a field here, and nothing
//! here is touched by any task but the table's own — which is why none of it is
//! locked. Add per-table state as a field, never as a map somewhere else and
//! never as something another task reads. The seat bookkeeping below is the
//! only code allowed to move a seat: `seat`, `drop_seat`, `swap_seats`.

use crate::actor::{Deadlines, Phase};
use crate::client::Client;
use crate::room::{RoomPayload, RoomStatus};
use crate::wire::{LatencyEntry, Outgoing, ServerMsg, now_ms};
use axum::extract::ws::Utf8Bytes;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;
use std::time::{Duration, SystemTime};
use tokio::time::Instant;

/// One finished match: what each seat won or lost it by, and who took it.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct MatchRecord {
    pub rounds_won: Vec<i64>,
    pub scores: Vec<i64>,
    /// The seat that took the match, or -1 once that seat has left the table.
    pub winner: i64,
    /// How long it was played. Zero is "cannot say" and stays off the wire.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub duration_ms: i64,
}

fn is_zero(v: &i64) -> bool {
    *v == 0
}

/// Everything the hub knows about one room code.
pub struct Table {
    pub code: String,
    /// TODO(after loco-game merges): `loco_game::Room`.
    pub room: RoomPayload,

    /// Indexed by seat; `None` is a seat whose socket has gone. Never written
    /// directly: [`Table::seat`] and [`Table::drop_seat`] are the ways in.
    pub members: Vec<Option<Arc<Client>>>,
    /// The proof a returning player has to produce. Spent and reissued on
    /// every reclaim.
    pub tokens: BTreeMap<usize, String>,
    /// When a held seat's socket went.
    pub away_at: BTreeMap<usize, Instant>,
    /// Seats whose hold expired while the match was still running.
    pub gone: BTreeSet<usize>,
    /// Seats nobody is sitting in.
    pub bots: BTreeSet<usize>,
    /// Consecutive turn timeouts; any voluntary action clears it.
    pub afk: BTreeMap<usize, i64>,
    pub rematch_offers: BTreeSet<usize>,
    /// Every match this table has finished, oldest first. Survives
    /// `reset_for_next_match`; cleared only with the table.
    pub match_history: Vec<MatchRecord>,
    /// Wall clock, because it travels in the snapshot.
    pub match_started_at: Option<SystemTime>,
    pub turn_started_at: Option<Instant>,
    pub empty_at: Option<Instant>,
    pub matchmade_at: Option<Instant>,
    pub solo: bool,
    pub streamer_mode: bool,

    /// Every deadline this table has armed. See `actor.rs`.
    pub deadlines: Deadlines,
}

impl std::fmt::Debug for Table {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Table")
            .field("code", &self.code)
            .field("seats", &self.members.len())
            .field("bots", &self.bots)
            .finish_non_exhaustive()
    }
}

impl Table {
    /// Builds a table but does not start it: the caller finishes filling it in
    /// and then hands it to `HubCore::open_table`.
    pub fn new(code: &str, room: RoomPayload) -> Table {
        Table {
            code: code.to_owned(),
            room,
            members: Vec::new(),
            tokens: BTreeMap::new(),
            away_at: BTreeMap::new(),
            gone: BTreeSet::new(),
            bots: BTreeSet::new(),
            afk: BTreeMap::new(),
            rematch_offers: BTreeSet::new(),
            match_history: Vec::new(),
            match_started_at: None,
            turn_started_at: None,
            empty_at: None,
            matchmade_at: None,
            solo: false,
            streamer_mode: false,
            deadlines: Deadlines::default(),
        }
    }

    /// Whether a shutdown would interrupt something here. Recomputed after
    /// every job the table runs.
    pub fn phase(&self) -> Phase {
        match self.room.status() {
            RoomStatus::Playing => Phase::InFlight,
            RoomStatus::Lobby if self.is_matchmade() => Phase::InFlight,
            _ => Phase::Idle,
        }
    }

    // ── who is where ────────────────────────────────────────────────────────

    /// The socket at a seat, or `None` for one that is empty, held or out of
    /// range. Bounds-checked because seat numbers arrive from the wire.
    pub fn client(&self, seat: usize) -> Option<&Arc<Client>> {
        self.members.get(seat).and_then(Option::as_ref)
    }

    pub fn has_left(&self, seat: usize) -> bool {
        self.gone.contains(&seat)
    }

    /// Appends a seat with no socket behind it — a bot.
    pub fn add_empty_seat(&mut self) {
        self.members.push(None);
    }

    pub fn is_bot(&self, seat: usize) -> bool {
        self.bots.contains(&seat)
    }

    pub fn is_matchmade(&self) -> bool {
        self.matchmade_at.is_some()
    }

    /// A matchmade pair and a solo game: nobody with standing over the table.
    pub fn hostless(&self) -> bool {
        self.is_matchmade() || self.solo
    }

    pub fn all_seats_empty(&self) -> bool {
        self.members.iter().all(Option::is_none)
    }

    pub fn connected(&self) -> usize {
        self.members.iter().filter(|m| m.is_some()).count()
    }

    /// Binds a client to a seat. A seat lives in two places — the client's own
    /// seat and the pointer in `members` — and this is the one way to move
    /// both. The sweep is unconditional: wherever this client was here, it is
    /// not there any more.
    pub fn seat(&mut self, c: &Arc<Client>, id: usize) {
        for (i, m) in self.members.iter_mut().enumerate() {
            if i != id && m.as_ref().is_some_and(|m| Arc::ptr_eq(m, c)) {
                *m = None;
            }
        }
        if self.members.len() <= id {
            self.members.resize(id + 1, None);
        }
        self.members[id] = Some(c.clone());
        c.sit_at(&self.code, id);
        self.gone.remove(&id);
        // Somebody is here, so any cleanup counting this table down is stale.
        self.empty_at = None;
    }

    /// Empties a seat without removing it: the player has the reconnect window
    /// to come back into it.
    pub fn hold(&mut self, seat: usize, at: Instant) {
        if let Some(m) = self.members.get_mut(seat) {
            *m = None;
        }
        self.away_at.insert(seat, at);
    }

    /// Rewrites every seated client's seat from where it actually sits, and
    /// reports whether anybody is still here.
    pub fn reseat(&self) -> bool {
        let mut has_human = false;
        for (i, m) in self.members.iter().enumerate() {
            if let Some(c) = m {
                c.sit_at(&self.code, i);
                has_human = true;
            }
        }
        has_human
    }

    /// Removes a seat entirely and re-bases everything keyed above it, in one
    /// move. The room's own roster is the caller's half.
    pub fn drop_seat(&mut self, id: usize) -> bool {
        if id < self.members.len() {
            self.members.remove(id);
        }
        self.shift_seat_keys(id);
        self.reseat()
    }

    /// `drop_seat` for a departure identified by socket: the pointer is the one
    /// of the pair that cannot be stale.
    pub fn drop_client(&mut self, c: &Arc<Client>, id: usize) -> bool {
        self.members
            .retain(|m| !m.as_ref().is_some_and(|m| Arc::ptr_eq(m, c)));
        self.shift_seat_keys(id);
        self.reseat()
    }

    /// Re-bases every seat-keyed structure above a removed seat. One list on
    /// purpose: a structure added to the table and not to this list keeps its
    /// old indices while `members` moves.
    pub fn shift_seat_keys(&mut self, removed: usize) {
        self.bots = shift_set(&self.bots, removed);
        self.tokens = shift_map(&self.tokens, removed);
        self.gone = shift_set(&self.gone, removed);
        self.away_at = shift_map(&self.away_at, removed);
        self.afk = shift_map(&self.afk, removed);
        drop_seat_from_history(&mut self.match_history, removed);
    }

    /// The seat whose hold began at `at`, preferring `hint`. An expiry is armed
    /// against a seat number that can be re-based before it fires; the instant
    /// the hold began is what does not move.
    pub fn held_seat_at(&self, hint: usize, at: Instant) -> Option<usize> {
        if self.away_at.get(&hint) == Some(&at) {
            return Some(hint);
        }
        self.away_at
            .iter()
            .find(|&(_, &held)| held == at)
            .map(|(&s, _)| s)
    }

    /// Exchanges two seats and everything keyed by them. The token travels
    /// with the player, not with the index.
    pub fn swap_seats(&mut self, a: usize, b: usize) {
        if a == b {
            return;
        }
        let hi = a.max(b);
        if self.members.len() <= hi {
            self.members.resize(hi + 1, None);
        }
        self.members.swap(a, b);
        let (a_bot, b_bot) = (self.bots.contains(&a), self.bots.contains(&b));
        set_membership(&mut self.bots, a, b_bot);
        set_membership(&mut self.bots, b, a_bot);
        let (a_tok, b_tok) = (self.tokens.remove(&a), self.tokens.remove(&b));
        if let Some(t) = b_tok {
            self.tokens.insert(a, t);
        }
        if let Some(t) = a_tok {
            self.tokens.insert(b, t);
        }
        swap_seats_in_history(&mut self.match_history, a, b);
        self.reseat();
    }

    /// Clears everything that belonged to the match that just ended. The seats,
    /// the tokens, the bots and the history survive: they describe who is at
    /// the table, not what they were playing.
    ///
    /// TODO(handler port): the map-loading gate goes here too (`loading`).
    pub fn reset_for_next_match(&mut self) {
        self.rematch_offers.clear();
        self.afk.clear();
        self.away_at.clear();
        self.gone.clear();
        self.match_started_at = None;
        self.turn_started_at = None;
        self.empty_at = None;
        self.deadlines.clear();
    }

    /// Takes a socket out of `members` without touching anything else. Only
    /// for a client that has turned up at another table.
    pub fn sweep(&mut self, c: &Arc<Client>) {
        for m in &mut self.members {
            if m.as_ref().is_some_and(|m| Arc::ptr_eq(m, c)) {
                *m = None;
            }
        }
    }

    // ── tokens ──────────────────────────────────────────────────────────────

    /// Creates and stores a session token for a seat.
    pub fn issue_token(&mut self, seat: usize) -> String {
        let tok = crate::tokens::generate_session_token();
        self.tokens.insert(seat, tok.clone());
        tok
    }

    /// Checks a token against the one stored for the seat, in constant time.
    pub fn validate_token(&self, seat: usize, token: &str) -> bool {
        crate::tokens::tokens_match(self.tokens.get(&seat).map(String::as_str), token)
    }

    // ── sending ─────────────────────────────────────────────────────────────

    /// Marshals once and sends the same bytes to every seated socket.
    pub fn broadcast_all<M: Outgoing>(&self, mut msg: M) {
        msg.stamp(now_ms());
        let Ok(s) = serde_json::to_string(&msg) else {
            return;
        };
        let bytes = Utf8Bytes::from(s);
        for c in self.members.iter().flatten() {
            c.send_bytes(bytes.clone());
        }
    }

    /// Fans this table's per-seat round trips out, if it is playing and
    /// something has been measured. A payload of all `-1` says exactly what
    /// the client's own default already says.
    pub fn send_latencies(&self) {
        if self.room.status() != RoomStatus::Playing {
            return;
        }
        let mut measured = false;
        let entries: Vec<LatencyEntry> = (0..self.room.players_len())
            .map(|i| {
                let mut e = LatencyEntry {
                    player_index: i,
                    rtt_ms: -1,
                    bot: false,
                };
                if self.is_bot(i) {
                    e.bot = true;
                } else if let Some(c) = self.client(i) {
                    e.rtt_ms = c.latency();
                    measured |= e.rtt_ms >= 0;
                }
                e
            })
            .collect();
        if measured {
            self.broadcast_all(ServerMsg::latency(entries));
        }
    }
}

/// How long a match that opened at `started_at` and ended at `now` was played,
/// in whole milliseconds, rounded up: zero is "cannot say" on the wire, so a
/// played match is at least 1 ms.
pub fn match_duration_ms(started_at: Option<SystemTime>, now: SystemTime) -> i64 {
    let Some(start) = started_at else { return 0 };
    match now.duration_since(start) {
        Ok(d) if !d.is_zero() => {
            let ms = d.as_millis() as i64;
            if d > Duration::from_millis(ms as u64) {
                ms + 1
            } else {
                ms
            }
        }
        _ => 0,
    }
}

/// Removes one seat from every recorded match, so the recap still lines up
/// with a roster that shrank.
pub fn drop_seat_from_history(history: &mut [MatchRecord], removed: usize) {
    for h in history {
        if removed < h.rounds_won.len() {
            h.rounds_won.remove(removed);
        }
        if removed < h.scores.len() {
            h.scores.remove(removed);
        }
        let r = removed as i64;
        if h.winner == r {
            h.winner = -1;
        } else if h.winner > r {
            h.winner -= 1;
        }
    }
}

/// Exchanges two seats in every recorded match, so a host transfer moves what
/// a player won along with the player.
pub fn swap_seats_in_history(history: &mut [MatchRecord], a: usize, b: usize) {
    for h in history {
        if a < h.rounds_won.len() && b < h.rounds_won.len() {
            h.rounds_won.swap(a, b);
        }
        if a < h.scores.len() && b < h.scores.len() {
            h.scores.swap(a, b);
        }
        let (ai, bi) = (a as i64, b as i64);
        if h.winner == ai {
            h.winner = bi;
        } else if h.winner == bi {
            h.winner = ai;
        }
    }
}

fn shift_set(s: &BTreeSet<usize>, removed: usize) -> BTreeSet<usize> {
    s.iter()
        .filter(|&&k| k != removed)
        .map(|&k| if k > removed { k - 1 } else { k })
        .collect()
}

fn shift_map<V: Clone>(m: &BTreeMap<usize, V>, removed: usize) -> BTreeMap<usize, V> {
    m.iter()
        .filter(|&(&k, _)| k != removed)
        .map(|(&k, v)| (if k > removed { k - 1 } else { k }, v.clone()))
        .collect()
}

fn set_membership(s: &mut BTreeSet<usize>, key: usize, present: bool) {
    if present {
        s.insert(key);
    } else {
        s.remove(&key);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Hub;

    // Port of the parts of table_internal_test.go and
    // match_history_internal_test.go that need no game.

    fn table() -> Table {
        Table::new("AAAAAA", RoomPayload::lobby("AAAAAA"))
    }

    #[tokio::test]
    async fn seat_moves_rather_than_duplicates() {
        let hub = Hub::start(Default::default());
        let (c, _rx) = Client::detached(&hub);
        let mut t = table();
        t.seat(&c, 2);
        t.seat(&c, 0);
        let seen = t
            .members
            .iter()
            .flatten()
            .filter(|m| Arc::ptr_eq(m, &c))
            .count();
        assert_eq!(seen, 1, "the client sits at {seen} indices");
        assert!(
            Arc::ptr_eq(t.client(0).unwrap(), &c),
            "not at the seat it was moved to"
        );
        assert_eq!(c.player_id(), 0);
        hub.stop().await;
    }

    // Seating somebody means the table is not empty, so a cleanup counting it
    // down is stale.
    #[tokio::test]
    async fn seat_cancels_the_pending_cleanup() {
        let hub = Hub::start(Default::default());
        let (c, _rx) = Client::detached(&hub);
        let mut t = table();
        t.empty_at = Some(Instant::now());
        t.seat(&c, 0);
        assert!(
            t.empty_at.is_none(),
            "a seated table is still counting down to deletion"
        );
        hub.stop().await;
    }

    // Removing a seat shifts the members, the clients' own seats, the bots and
    // the tokens in one move.
    #[tokio::test]
    async fn drop_seat_shifts_everything_together() {
        let hub = Hub::start(Default::default());
        let (a, _ra) = Client::detached(&hub);
        let (c, _rc) = Client::detached(&hub);
        let mut t = table();
        t.seat(&a, 0);
        t.add_empty_seat(); // seat 1: a bot
        t.bots.insert(1);
        t.seat(&c, 2);
        t.tokens.insert(0, "tok-a".into());
        t.tokens.insert(1, "tok-bot".into());
        t.tokens.insert(2, "tok-c".into());
        let away = Instant::now();
        t.away_at.insert(2, away);
        t.afk.insert(2, 1);

        assert!(
            t.drop_seat(0),
            "drop_seat reported nobody left, but c is still seated"
        );

        assert_eq!(t.members.len(), 2);
        assert!(t.members[0].is_none() && Arc::ptr_eq(t.members[1].as_ref().unwrap(), &c));
        assert_eq!(c.player_id(), 1, "the client's own seat did not follow");
        assert!(
            t.is_bot(0) && !t.is_bot(1),
            "the bot set did not shift: {:?}",
            t.bots
        );
        assert_eq!(t.tokens.get(&0).map(String::as_str), Some("tok-bot"));
        assert_eq!(t.tokens.get(&1).map(String::as_str), Some("tok-c"));
        assert!(
            !t.tokens.contains_key(&2),
            "the removed seat's token survived"
        );
        assert_eq!(t.away_at.get(&1), Some(&away), "a hold kept its old key");
        assert_eq!(t.afk.get(&1), Some(&1), "an AFK counter kept its old key");
        hub.stop().await;
    }

    // An expiry finds its hold by the instant it began, never by the seat it
    // was armed with.
    #[test]
    fn held_seat_at_follows_the_instant() {
        let mut t = table();
        let (t1, t2) = (Instant::now(), Instant::now() + Duration::from_secs(1));
        t.away_at.insert(1, t1);
        t.away_at.insert(3, t2);
        assert_eq!(t.held_seat_at(3, t2), Some(3));
        t.shift_seat_keys(0);
        assert_eq!(t.held_seat_at(3, t2), Some(2), "the hold moved down a key");
        assert_eq!(t.held_seat_at(0, t1), Some(0));
        assert_eq!(t.held_seat_at(0, t1 + Duration::from_secs(9)), None);
    }

    // The token travels with the player, and an absence moves as readily as a
    // presence.
    #[tokio::test]
    async fn swap_seats_moves_the_token_and_the_bot_flag() {
        let hub = Hub::start(Default::default());
        let (a, _ra) = Client::detached(&hub);
        let mut t = table();
        t.seat(&a, 0);
        t.add_empty_seat();
        t.bots.insert(1);
        t.tokens.insert(0, "tok-a".into());
        t.match_history.push(MatchRecord {
            rounds_won: vec![2, 0],
            scores: vec![0, 40],
            winner: 0,
            duration_ms: 5,
        });

        t.swap_seats(0, 1);

        assert!(Arc::ptr_eq(t.client(1).unwrap(), &a));
        assert_eq!(a.player_id(), 1);
        assert!(t.is_bot(0) && !t.is_bot(1));
        assert_eq!(t.tokens.get(&1).map(String::as_str), Some("tok-a"));
        assert!(!t.tokens.contains_key(&0));
        assert_eq!(t.match_history[0].rounds_won, vec![0, 2]);
        assert_eq!(t.match_history[0].winner, 1);
        hub.stop().await;
    }

    #[tokio::test]
    async fn reset_for_next_match_empties_the_match_not_the_table() {
        let hub = Hub::start(Default::default());
        let (c, _rx) = Client::detached(&hub);
        let mut t = table();
        t.seat(&c, 0);
        t.tokens.insert(0, "tok".into());
        t.bots.insert(1);
        t.afk.insert(0, 3);
        t.away_at.insert(0, Instant::now());
        t.rematch_offers.insert(0);
        t.deadlines.arm(
            crate::actor::DeadlineKey::table("turn"),
            Instant::now(),
            |_, _| {},
        );

        t.reset_for_next_match();

        assert!(t.afk.is_empty() && t.away_at.is_empty() && t.rematch_offers.is_empty());
        assert!(
            t.deadlines.is_empty(),
            "a deadline from the last match survived"
        );
        assert!(t.client(0).is_some() && t.validate_token(0, "tok") && t.is_bot(1));
        hub.stop().await;
    }

    #[test]
    fn match_duration_rounds_up_and_zero_means_unknown() {
        let start = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000);
        assert_eq!(match_duration_ms(None, start), 0);
        assert_eq!(match_duration_ms(Some(start), start), 0);
        assert_eq!(
            match_duration_ms(Some(start), start + Duration::from_micros(1)),
            1
        );
        assert_eq!(
            match_duration_ms(Some(start), start + Duration::from_millis(1500)),
            1500
        );
        assert_eq!(
            match_duration_ms(Some(start), start - Duration::from_secs(1)),
            0
        );
    }

    #[test]
    fn a_departure_rebases_the_winner() {
        let mut h = vec![
            MatchRecord {
                rounds_won: vec![1, 2, 0],
                scores: vec![10, 0, 30],
                winner: 1,
                duration_ms: 0,
            },
            MatchRecord {
                rounds_won: vec![2, 0, 1],
                scores: vec![0, 5, 3],
                winner: 0,
                duration_ms: 0,
            },
        ];
        drop_seat_from_history(&mut h, 0);
        assert_eq!(h[0].rounds_won, vec![2, 0]);
        assert_eq!(h[0].winner, 0, "a winner above the removed seat moves down");
        assert_eq!(
            h[1].winner, -1,
            "a winner who left is nobody, not whoever slid in"
        );
        // A record older than the seat is shorter than the roster: a no-op.
        drop_seat_from_history(&mut h, 9);
    }

    #[test]
    fn the_record_keeps_the_go_json() {
        let r = MatchRecord {
            rounds_won: vec![1],
            scores: vec![0],
            winner: 0,
            duration_ms: 0,
        };
        assert_eq!(
            serde_json::to_string(&r).unwrap(),
            r#"{"rounds_won":[1],"scores":[0],"winner":0}"#
        );
    }

    #[tokio::test]
    async fn a_token_is_checked_against_its_own_seat() {
        let mut t = table();
        let tok = t.issue_token(1);
        assert!(t.validate_token(1, &tok));
        assert!(!t.validate_token(0, &tok));
        assert!(!t.validate_token(1, ""));
    }
}
