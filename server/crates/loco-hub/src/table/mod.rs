//! One table, as one thing.
//!
//! Everything the hub knows about one room code is a field here, and nothing
//! here is touched by any task but the table's own — which is why none of it is
//! locked.
//!
//! **A seat is one value.** The socket, the session token, the hold, the
//! departure, the bot, the AFK counter and the rematch ask are not seven
//! structures keyed by seat number, each to be re-based by hand on every
//! removal, where one forgotten would keep its old indices while the others
//! moved. They are the fields of one [`Seat`] in one `Vec`: removing a seat
//! is `Vec::remove`, a host transfer is `Vec::swap`, and there is nothing to
//! forget. Who is in the chair is an
//! [`Occupant`], so a seat cannot be at once held and seated, or a bot with a
//! socket.
//!
//! **A chair is three columns, moved by two operations.** The domain's
//! `RoomSeat` (the seat's game), this table's [`Seat`] (its people) and the
//! seat's column in [`Table::match_history`] are indexed alike, and
//! [`Table::remove_seat`] and [`Table::swap_seats`] are the only code that
//! removes or exchanges a seat: each moves all three or none
//! (`tests/funnels.rs` holds every other file to that).
//!
//! The modules under this one are the table's task and one module per kind of
//! message it handles; every one of them runs on the table's own task.

pub mod actor;
pub mod bots;
pub mod broadcast;
pub mod convert;
pub mod debug;
pub mod emotes;
pub mod gameplay;
pub mod maploading;
pub mod presence;
pub mod refusal;
pub mod rematch;
pub mod room;
pub mod statedto;
pub mod turntimer;

use crate::ids::{RoomCode, SessionToken};
use crate::net::client::Client;
use crate::net::wire::{LatencyEntry, msg};
use crate::table::actor::{DeadlineKey, Deadlines, Phase};
use crate::table::room::{Room, Status};
use loco_game::GameError;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::sync::Arc;
use std::time::{Duration, SystemTime};
use tokio::time::Instant;

/// One finished match: what each seat won or lost it by, and who took it.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct MatchRecord {
    pub rounds_won: Vec<i64>,
    pub scores: Vec<i64>,
    /// The seat that took the match, or `None` (`null`) once that seat has
    /// left the table.
    pub winner: Option<usize>,
    /// How long it was played. Zero is "cannot say" and stays off the wire.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub duration_ms: i64,
}

fn is_zero(v: &i64) -> bool {
    *v == 0
}

/// Who is in a chair.
#[derive(Clone, Debug)]
pub enum Occupant {
    /// A socket is sitting here.
    Human(Arc<Client>),
    /// The socket went and the player has the reconnect window to come back,
    /// since this instant.
    Held { since: Instant },
    /// The hold ran out, or the player walked out, while the match was still
    /// running: the seat stays (hands and turn order are indexed by it) and
    /// the roster must stop calling it connected.
    Gone,
    /// Played by the server.
    Bot,
    /// Nobody, and nobody owed it: a socket swept away to another table, or a
    /// hold the next match cleared.
    Vacant,
}

/// One seat and everything the table keeps about it.
#[derive(Clone, Debug)]
pub struct Seat {
    pub occupant: Occupant,
    /// The proof a returning player has to produce. Spent and reissued on
    /// every reclaim; travels with the player on a swap.
    pub token: Option<SessionToken>,
    /// Consecutive turn timeouts; any voluntary action clears it.
    pub afk: i64,
    /// This seat has asked for another match.
    pub wants_rematch: bool,
}

impl Seat {
    pub fn new(occupant: Occupant) -> Seat {
        Seat {
            occupant,
            token: None,
            afk: 0,
            wants_rematch: false,
        }
    }
}

/// Everything the hub knows about one room code.
pub struct Table {
    pub code: RoomCode,
    pub room: Room,
    /// Indexed by seat number. Never written directly: [`Table::seat`],
    /// [`Table::hold`], [`Table::remove_seat`] and [`Table::swap_seats`] are
    /// the ways in, because a seat also lives in its client (`Client::seat`)
    /// and in the room (`Room::seats`).
    pub seats: Vec<Seat>,
    /// Every match this table has finished, oldest first, each indexed by
    /// seat. Survives `reset_for_next_match`; cleared only with the table.
    pub match_history: Vec<MatchRecord>,
    /// Wall clock, because it travels in the snapshot.
    pub match_started_at: Option<SystemTime>,
    pub turn_started_at: Option<Instant>,
    pub matchmade_at: Option<Instant>,
    pub solo: bool,
    pub streamer_mode: bool,

    /// The map-loading gate. `Some` means the table is shut: no turn clock,
    /// no bots, no gameplay message accepted. See `maploading.rs`.
    pub loading: Option<MapLoadState>,

    /// The clocks this table runs on: the hub's, copied in when it opens.
    pub timings: Arc<crate::ops::config::Timings>,

    /// Every deadline this table has armed. See `actor.rs`.
    pub deadlines: Deadlines,
    /// Mints the keys of the reconnect holds, which must not replace each
    /// other (a hold's seat number can be re-based under it).
    pub(crate) next_key: u64,
}

/// The gate between `game_started` and the first legal move.
#[derive(Clone, Debug)]
pub struct MapLoadState {
    pub ready: BTreeSet<usize>,
    pub started_at: Instant,
}

impl std::fmt::Debug for Table {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Table")
            .field("code", &self.code)
            .field("seats", &self.seats)
            .finish_non_exhaustive()
    }
}

impl Table {
    /// Builds a table but does not start it: the caller finishes filling it in
    /// and then hands it to `HubCore::open_table`. `code` is one this server
    /// minted (or a test's), never one a player typed: that goes through
    /// [`RoomCode::parse`] and is looked up, not built.
    pub fn new(code: &str, room: Room) -> Table {
        Table {
            code: RoomCode::from_trusted(code),
            room,
            seats: Vec::new(),
            match_history: Vec::new(),
            match_started_at: None,
            turn_started_at: None,
            matchmade_at: None,
            solo: false,
            streamer_mode: false,
            loading: None,
            timings: Arc::new(crate::ops::config::Timings::default()),
            deadlines: Deadlines::default(),
            next_key: 0,
        }
    }

    /// Whether a shutdown would interrupt something here. Recomputed after
    /// every job the table runs.
    pub fn phase(&self) -> Phase {
        match self.room.status {
            Status::Playing => Phase::InFlight,
            Status::Lobby if self.is_matchmade() => Phase::InFlight,
            _ => Phase::Idle,
        }
    }

    // ── who is where ────────────────────────────────────────────────────────

    fn occupant(&self, seat: usize) -> Option<&Occupant> {
        self.seats.get(seat).map(|s| &s.occupant)
    }

    /// The socket at a seat, or `None` for one that is empty, held or out of
    /// range. Bounds-checked because seat numbers arrive from the wire.
    pub fn client(&self, seat: usize) -> Option<&Arc<Client>> {
        match self.occupant(seat) {
            Some(Occupant::Human(c)) => Some(c),
            _ => None,
        }
    }

    /// Every seated socket, with its seat.
    pub fn clients(&self) -> impl Iterator<Item = (usize, &Arc<Client>)> {
        self.seats
            .iter()
            .enumerate()
            .filter_map(|(i, s)| match &s.occupant {
                Occupant::Human(c) => Some((i, c)),
                _ => None,
            })
    }

    /// The sockets by seat, `None` where nobody is seated: a read-only view
    /// for the tests and the log.
    pub fn members(&self) -> Vec<Option<Arc<Client>>> {
        (0..self.seats.len())
            .map(|s| self.client(s).cloned())
            .collect()
    }

    /// Lays the seats out by hand, a socket or an empty chair each: how a
    /// white-box test builds a table without dealing through the handlers.
    #[cfg(any(test, feature = "testkit"))]
    pub fn set_members(&mut self, members: Vec<Option<Arc<Client>>>) {
        self.seats = members
            .into_iter()
            .map(|m| Seat::new(m.map_or(Occupant::Vacant, Occupant::Human)))
            .collect();
        self.reseat();
    }

    /// Whether the seat's hold expired (or it walked out) mid-match.
    pub fn has_left(&self, seat: usize) -> bool {
        matches!(self.occupant(seat), Some(Occupant::Gone))
    }

    /// When the seat's hold began, if it is held.
    pub fn held_since(&self, seat: usize) -> Option<Instant> {
        match self.occupant(seat) {
            Some(Occupant::Held { since }) => Some(*since),
            _ => None,
        }
    }

    pub fn is_held(&self, seat: usize) -> bool {
        self.held_since(seat).is_some()
    }

    /// The held seats, in seat order.
    pub fn held_seats(&self) -> Vec<usize> {
        (0..self.seats.len()).filter(|&s| self.is_held(s)).collect()
    }

    pub fn is_bot(&self, seat: usize) -> bool {
        matches!(self.occupant(seat), Some(Occupant::Bot))
    }

    /// The bots' seats, in seat order.
    pub fn bot_seats(&self) -> Vec<usize> {
        (0..self.seats.len()).filter(|&s| self.is_bot(s)).collect()
    }

    pub fn bot_count(&self) -> usize {
        self.seats
            .iter()
            .filter(|s| matches!(s.occupant, Occupant::Bot))
            .count()
    }

    /// Appends a seat played by the server.
    pub fn add_bot_seat(&mut self) {
        self.seats.push(Seat::new(Occupant::Bot));
    }

    /// Makes a seat the server's (or a human's again): used when the seats
    /// are rebuilt rather than moved, by a restore.
    pub fn set_occupant(&mut self, seat: usize, occupant: Occupant) {
        self.ensure(seat);
        self.seats[seat].occupant = occupant;
    }

    pub fn is_matchmade(&self) -> bool {
        self.matchmade_at.is_some()
    }

    /// A matchmade pair and a solo game: nobody with standing over the table.
    pub fn hostless(&self) -> bool {
        self.is_matchmade() || self.solo
    }

    pub fn all_seats_empty(&self) -> bool {
        self.connected() == 0
    }

    pub fn connected(&self) -> usize {
        self.clients().count()
    }

    fn ensure(&mut self, seat: usize) {
        while self.seats.len() <= seat {
            self.seats.push(Seat::new(Occupant::Vacant));
        }
    }

    /// Binds a client to a seat. A seat lives in two places — the client's own
    /// seat and the occupant here — and this is the one way to move both. The
    /// sweep is unconditional: wherever this client was here, it is not there
    /// any more.
    pub fn seat(&mut self, c: &Arc<Client>, id: usize) {
        for (i, s) in self.seats.iter_mut().enumerate() {
            if i != id && matches!(&s.occupant, Occupant::Human(m) if Arc::ptr_eq(m, c)) {
                s.occupant = Occupant::Vacant;
            }
        }
        self.ensure(id);
        self.seats[id].occupant = Occupant::Human(c.clone());
        c.sit_at(&self.code, id);
        // Somebody is here: the empty-room cleanup stops counting.
        self.deadlines.disarm(DeadlineKey::RoomCleanup);
    }

    /// Empties a seat without removing it: the player has the reconnect window
    /// to come back into it.
    pub fn hold(&mut self, seat: usize, at: Instant) {
        self.ensure(seat);
        self.seats[seat].occupant = Occupant::Held { since: at };
    }

    /// The seat is gone for the rest of the match: its hold ran out, or its
    /// player walked out. What it was owed (a reclaim, a count) goes with it.
    pub fn mark_gone(&mut self, seat: usize, forget_token: bool) {
        self.ensure(seat);
        let s = &mut self.seats[seat];
        s.occupant = Occupant::Gone;
        if forget_token {
            s.token = None;
            s.afk = 0;
        }
    }

    /// Rewrites every seated client's seat from where it actually sits, and
    /// reports whether anybody is still here.
    pub fn reseat(&self) -> bool {
        let mut has_human = false;
        for (i, c) in self.clients() {
            c.sit_at(&self.code, i);
            has_human = true;
        }
        has_human
    }

    /// Removes a seat from the table: the room's record of it, its chair here
    /// and its column in the recap go together, and every seat above it moves
    /// down one with everything it is. The room decides whether a seat may be
    /// removed now (a lobby or a finished match); a refusal leaves all three
    /// untouched. Returns whether a human is still seated.
    pub fn remove_seat(&mut self, seat: usize) -> Result<bool, GameError> {
        self.room.remove_lobby_player(seat)?;
        if seat < self.seats.len() {
            self.seats.remove(seat);
        }
        drop_seat_from_history(&mut self.match_history, seat);
        Ok(self.reseat())
    }

    /// `remove_seat` for a departure identified by socket: the pointer is the
    /// one of the pair that cannot be stale.
    pub fn remove_client_seat(&mut self, c: &Arc<Client>, id: usize) -> Result<bool, GameError> {
        let at = self
            .clients()
            .find(|(_, m)| Arc::ptr_eq(m, c))
            .map_or(id, |(i, _)| i);
        self.remove_seat(at)
    }

    /// The seat whose hold began at `at`, preferring `hint`. An expiry is armed
    /// against a seat number that can be re-based before it fires; the instant
    /// the hold began is what does not move.
    pub fn held_seat_at(&self, hint: usize, at: Instant) -> Option<usize> {
        if self.held_since(hint) == Some(at) {
            return Some(hint);
        }
        (0..self.seats.len()).find(|&s| self.held_since(s) == Some(at))
    }

    /// Exchanges two seats and everything about them: the room's records, the
    /// chairs here (the token travels with the player, not with the index) and
    /// their columns in the recap. The room decides whether seats may move now
    /// (a lobby); a refusal leaves all three untouched.
    pub fn swap_seats(&mut self, a: usize, b: usize) -> Result<(), GameError> {
        self.room.swap_lobby_players(a, b)?;
        if a == b {
            return Ok(());
        }
        self.ensure(a.max(b));
        self.seats.swap(a, b);
        swap_seats_in_history(&mut self.match_history, a, b);
        self.reseat();
        Ok(())
    }

    /// Clears everything that belonged to the match that just ended. Who is at
    /// the table — the sockets, the tokens, the bots — and the history survive.
    pub fn reset_for_next_match(&mut self) {
        for s in &mut self.seats {
            s.afk = 0;
            s.wants_rematch = false;
            if matches!(s.occupant, Occupant::Held { .. } | Occupant::Gone) {
                s.occupant = Occupant::Vacant;
            }
        }
        self.match_started_at = None;
        self.turn_started_at = None;
        self.loading = None;
        self.deadlines.clear();
    }

    pub fn is_loading(&self) -> bool {
        self.loading.is_some()
    }

    /// A key for a reconnect hold, never equal to another hold's.
    pub fn reconnect_key(&mut self) -> DeadlineKey {
        self.next_key = self.next_key.wrapping_add(1);
        DeadlineKey::ReconnectExpiry(self.next_key)
    }

    /// Whether every seat other than this one is an absent human: no socket
    /// at it, no bot behind it, and no hold still running. It is what tells a
    /// lone survivor apart from a quitter.
    pub fn abandoned_by(&self, seat: usize) -> bool {
        (0..self.room.seat_count()).filter(|&i| i != seat).all(|i| {
            matches!(
                self.occupant(i),
                None | Some(Occupant::Gone | Occupant::Vacant)
            )
        })
    }

    /// The seats that can still act in the match: a bot, or a human who is
    /// here or inside their reconnect window, and not retired.
    pub fn playable_seats(&self) -> usize {
        (0..self.room.seat_count())
            .filter(|&seat| match self.occupant(seat) {
                Some(Occupant::Bot) => true,
                Some(Occupant::Human(_) | Occupant::Held { .. }) => !self.room.is_retired(seat),
                _ => false,
            })
            .count()
    }

    /// The seat held for a disconnected player of that nickname, if any.
    pub fn find_held_seat(&self, nickname: &str) -> Option<usize> {
        self.held_seats()
            .into_iter()
            .find(|&s| self.room.nickname(s) == Some(nickname))
    }

    /// The seat a forfeit is awarded to: somebody still here, else somebody
    /// held, else anybody not retired.
    pub fn remaining_seat(&self, away_seat: usize) -> Option<usize> {
        let n = self.room.seat_count();
        let here = (0..n).find(|&s| s != away_seat && self.client(s).is_some());
        here.or_else(|| {
            (0..n).find(|&s| s != away_seat && self.is_held(s) && !self.room.is_retired(s))
        })
        .or_else(|| (0..n).find(|&s| s != away_seat && !self.room.is_retired(s)))
    }

    /// Appends the match that has just ended. The seats' tallies are copied:
    /// a reset clears them, and a record reading them would be the next match.
    pub fn record_finished_match(&mut self, now: SystemTime) {
        let room = &self.room;
        let rec = MatchRecord {
            rounds_won: room
                .seats()
                .iter()
                .map(|s| i64::from(s.rounds_won))
                .collect(),
            scores: room.seats().iter().map(|s| i64::from(s.score)).collect(),
            winner: room.seat_of(&room.match_winner),
            duration_ms: match_duration_ms(self.match_started_at, now),
        };
        self.match_history.push(rec);
    }

    /// Takes a socket out of its chair without touching anything else: for a
    /// client that has turned up at another table, or walked out.
    pub fn sweep(&mut self, c: &Arc<Client>) {
        for s in &mut self.seats {
            if matches!(&s.occupant, Occupant::Human(m) if Arc::ptr_eq(m, c)) {
                s.occupant = Occupant::Vacant;
            }
        }
    }

    // ── per-seat bookkeeping ────────────────────────────────────────────────

    /// Creates and stores a session token for a seat.
    pub fn issue_token(&mut self, seat: usize) -> SessionToken {
        let tok = crate::tokens::generate_session_token();
        self.ensure(seat);
        self.seats[seat].token = Some(tok.clone());
        tok
    }

    /// Checks a token against the one stored for the seat, in constant time.
    pub fn validate_token(&self, seat: usize, token: &SessionToken) -> bool {
        self.token(seat).is_some_and(|stored| stored.matches(token))
    }

    pub fn token(&self, seat: usize) -> Option<&SessionToken> {
        self.seats.get(seat).and_then(|s| s.token.as_ref())
    }

    pub fn afk(&self, seat: usize) -> i64 {
        self.seats.get(seat).map_or(0, |s| s.afk)
    }

    /// The seats that have asked for another match, in seat order.
    pub fn rematch_offers(&self) -> Vec<usize> {
        (0..self.seats.len())
            .filter(|&s| self.seats[s].wants_rematch)
            .collect()
    }

    // ── sending ─────────────────────────────────────────────────────────────

    /// Fans this table's per-seat round trips out, if it is playing and
    /// something has been measured. A payload of all `-1` says exactly what
    /// the client's own default already says.
    pub fn send_latencies(&self) {
        if self.room.status != Status::Playing {
            return;
        }
        let mut measured = false;
        let entries: Vec<LatencyEntry> = (0..self.room.seat_count())
            .map(|i| {
                let mut e = LatencyEntry {
                    player_index: i as i32,
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
            self.broadcast_all(msg::latency(entries));
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
/// with a roster that shrank. [`Table::remove_seat`]'s third column.
fn drop_seat_from_history(history: &mut [MatchRecord], removed: usize) {
    for h in history {
        if removed < h.rounds_won.len() {
            h.rounds_won.remove(removed);
        }
        if removed < h.scores.len() {
            h.scores.remove(removed);
        }
        h.winner = match h.winner {
            Some(w) if w == removed => None,
            Some(w) if w > removed => Some(w - 1),
            w => w,
        };
    }
}

/// Exchanges two seats in every recorded match, so a host transfer moves what
/// a player won along with the player. [`Table::swap_seats`]'s third column.
fn swap_seats_in_history(history: &mut [MatchRecord], a: usize, b: usize) {
    for h in history {
        if a < h.rounds_won.len() && b < h.rounds_won.len() {
            h.rounds_won.swap(a, b);
        }
        if a < h.scores.len() && b < h.scores.len() {
            h.scores.swap(a, b);
        }
        h.winner = match h.winner {
            Some(w) if w == a => Some(b),
            Some(w) if w == b => Some(a),
            w => w,
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // The seat bookkeeping's tests are in internal_tests/table_internal.rs.

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
                winner: Some(1),
                duration_ms: 0,
            },
            MatchRecord {
                rounds_won: vec![2, 0, 1],
                scores: vec![0, 5, 3],
                winner: Some(0),
                duration_ms: 0,
            },
        ];
        drop_seat_from_history(&mut h, 0);
        assert_eq!(h[0].rounds_won, vec![2, 0]);
        assert_eq!(
            h[0].winner,
            Some(0),
            "a winner above the removed seat moves down"
        );
        assert_eq!(
            h[1].winner, None,
            "a winner who left is nobody, not whoever slid in"
        );
        // A record older than the seat is shorter than the roster: a no-op.
        drop_seat_from_history(&mut h, 9);
    }

    #[test]
    fn the_record_writes_nobody_as_null() {
        let r = MatchRecord {
            rounds_won: vec![1],
            scores: vec![0],
            winner: Some(0),
            duration_ms: 0,
        };
        assert_eq!(
            serde_json::to_string(&r).unwrap(),
            r#"{"rounds_won":[1],"scores":[0],"winner":0}"#
        );
        let nobody = MatchRecord { winner: None, ..r };
        assert_eq!(
            serde_json::to_string(&nobody).unwrap(),
            r#"{"rounds_won":[1],"scores":[0],"winner":null}"#
        );
    }
}
