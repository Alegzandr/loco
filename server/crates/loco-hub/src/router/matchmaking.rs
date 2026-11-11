//! 1v1 matchmaking, leaving a table, and the forfeit. Port of
//! `server/hub/matchmaking.go`.
//!
//! One FIFO queue whose size is never on the wire (only on `/metrics`). The
//! queue is the hub's and the seat is the table's: `find_match` and
//! `leave_room` are split down the middle, the two halves ordered rather than
//! raced.

use crate::net::client::Client;
use crate::ops::clock;
use crate::router::hub::HubCore;
use crate::table::Table;
use crate::table::actor::{DeadlineKey, TableCtx, TableJob};
use crate::table::convert::match_format_string;
use crate::table::room::new_room;
use loco_game::{Room, Status, room::MatchFormat};
use loco_protocol::{MatchEndMsg, MatchFoundMsg, PlayerLeftMsg, ServerMsg};
use std::sync::Arc;
use std::sync::atomic::Ordering;
use tokio::time::Instant;

/// The format every matchmade match is played in.
pub const MATCHMAKING_FORMAT: MatchFormat = MatchFormat::Bo1;

/// What a match needs to keep being a match: below it a departure ends it.
pub const WALK_OUT_FLOOR: usize = 2;

/// One player waiting for an opponent.
#[derive(Clone, Debug)]
pub struct QueuedPlayer {
    pub client: Arc<Client>,
    pub nickname: String,
    pub since: Instant,
}

impl HubCore {
    fn queue_index(&self, c: &Arc<Client>) -> Option<usize> {
        self.queue.iter().position(|q| Arc::ptr_eq(&q.client, c))
    }

    fn publish_queue(&self) {
        self.hub
            .metrics()
            .matchmaking_queue
            .store(self.queue.len() as i32, Ordering::Relaxed);
    }

    /// Takes a socket out of the queue, and reports whether it was in it.
    pub(crate) fn dequeue(&mut self, c: &Arc<Client>) -> bool {
        let Some(i) = self.queue_index(c) else {
            return false;
        };
        self.queue.remove(i);
        self.publish_queue();
        true
    }

    fn enqueue(&mut self, c: &Arc<Client>, nickname: String) {
        tracing::info!(conn = %c.conn_id, nickname = %nickname, "matchmaking queued");
        self.queue.push(QueuedPlayer {
            client: c.clone(),
            nickname,
            since: Instant::now(),
        });
        self.publish_queue();
        c.send(ServerMsg::MatchmakingQueued(Default::default()));
    }

    pub(crate) fn handle_find_match(&mut self, c: &Arc<Client>, nickname: &str) {
        if self.refuse_while_draining(c) {
            return;
        }
        let Some(nickname) = Self::validate_nickname(c, nickname) else {
            return;
        };
        if self.already_seated(c) {
            let Some(t) = self.table_of(c) else {
                self.enqueue_and_pair(c, nickname);
                return;
            };
            // Relaunching the search is one message: the seat is given up on
            // the table, then the queue is joined on the hub — in that order.
            let c2 = c.clone();
            let job = TableJob::new("find_match_release", move |t: &mut Table, cx: &TableCtx| {
                if t.room.status == Status::Playing {
                    c2.refuse(crate::table::refusal::Refusal::AlreadyInRoom);
                    return;
                }
                t.release_seat(cx, &c2);
                let c3 = c2.clone();
                cx.hub
                    .post_to_router("enqueue", move |core| core.enqueue_and_pair(&c3, nickname));
            })
            .from_client(c.clone());
            if t.post(job).is_err() {
                c.refuse(crate::table::refusal::Refusal::ServerBusy);
            }
            return;
        }
        self.enqueue_and_pair(c, nickname);
    }

    pub(crate) fn enqueue_and_pair(&mut self, c: &Arc<Client>, nickname: String) {
        if self.queue_index(c).is_some() {
            c.refuse(crate::table::refusal::Refusal::AlreadySearching);
            return;
        }
        self.enqueue(c, nickname);
        self.try_pair();
    }

    pub(crate) fn handle_cancel_matchmaking(&mut self, c: &Arc<Client>) {
        if self.dequeue(c) {
            tracing::info!(conn = %c.conn_id, "matchmaking cancelled");
        }
        c.send(ServerMsg::MatchmakingCancelled(Default::default()));
    }

    fn try_pair(&mut self) {
        while self.queue.len() >= 2 {
            let a = self.queue.remove(0);
            let b = self.queue.remove(0);
            self.publish_queue();
            self.pair_match(a, b);
        }
    }

    fn pair_match(&mut self, a: QueuedPlayer, b: QueuedPlayer) {
        let code = self.generate_code();
        let mut room = new_room(&code);
        if let Err(e) = room.set_max_players(2) {
            tracing::warn!(code = %code, "matchmaking SetMaxPlayers err={e}");
        }
        if let Err(e) = room.set_format(MATCHMAKING_FORMAT) {
            tracing::warn!(code = %code, "matchmaking SetFormat err={e}");
        }
        if let Err(e) = room.join(&a.nickname) {
            tracing::warn!(code = %code, nickname = %a.nickname, "matchmaking join err={e}");
            self.fail_pairing(a, b);
            return;
        }
        let b_name = unique_nickname(&room, &b.nickname);
        if let Err(e) = room.join(&b_name) {
            tracing::warn!(code = %code, nickname = %b.nickname, "matchmaking join err={e}");
            self.fail_pairing(a, b);
            return;
        }
        let paired_at = Instant::now();
        let mut t = self.new_table(&code, room);
        t.matchmade_at = Some(paired_at);
        self.seat_into(&mut t, &a.client, 0);
        self.seat_into(&mut t, &b.client, 1);
        self.hub
            .metrics()
            .matches_matchmade
            .fetch_add(1, Ordering::Relaxed);
        tracing::info!(
            code = %code,
            a = %t.room.players[0].nickname,
            b = %t.room.players[1].nickname,
            waited_ms = paired_at.saturating_duration_since(a.since).as_millis() as u64,
            "matchmaking paired"
        );
        t.announce_match_found();
        t.schedule_matchmaking_start(paired_at);
        self.open_table(t);
    }

    /// The pair goes back to the head of the queue, in the order it was taken.
    fn fail_pairing(&mut self, a: QueuedPlayer, b: QueuedPlayer) {
        self.queue.insert(0, b);
        self.queue.insert(0, a);
        self.publish_queue();
    }

    /// leave_room: the queue first, then the seat, on its table.
    pub(crate) fn handle_leave_room(&mut self, c: &Arc<Client>) {
        self.dequeue(c);
        if !self.already_seated(c) {
            c.send(ServerMsg::LeftRoom(Default::default()));
            return;
        }
        let Some(t) = self.table_of(c) else {
            c.send(ServerMsg::LeftRoom(Default::default()));
            return;
        };
        let c2 = c.clone();
        let job = TableJob::new("leave_room", move |t: &mut Table, cx: &TableCtx| {
            t.leave_at_table(cx, &c2)
        })
        .from_client(c.clone());
        if t.post(job).is_err() {
            c.refuse(crate::table::refusal::Refusal::ServerBusy);
        }
    }
}

impl Table {
    /// match_found to each seat, with its own fresh token.
    fn announce_match_found(&mut self) {
        let pl = self.player_list();
        let starts_in = self.timings.matchmaking.reveal_delay.as_millis() as i64;
        let seats: Vec<usize> = self.clients().map(|(s, _)| s).collect();
        for seat in seats {
            let tok = self.issue_token(seat);
            if let Some(m) = self.client(seat) {
                m.send(ServerMsg::MatchFound(MatchFoundMsg {
                    room_code: self.code.to_string(),
                    player_id: Some(seat as i32),
                    players: pl.clone(),
                    session_token: tok.into_string(),
                    match_format: Some(match_format_string(self.room.format)),
                    max_players: self.room.max_players as i32,
                    starts_in_ms: starts_in,
                    ..Default::default()
                }));
            }
        }
    }

    /// The reveal's deal, armed twice: every other dropped job is lossy, this
    /// one is unbounded. The second fire finds the table dealt and does nothing.
    fn schedule_matchmaking_start(&mut self, paired_at: Instant) {
        let m = &self.timings.matchmaking;
        let first = paired_at + m.reveal_delay;
        let backstop = first + m.reveal_backstop;
        // A rematch re-arms both keys, so neither fire can belong to an
        // earlier pairing; the status check is what makes the second a no-op.
        self.deadlines
            .arm(DeadlineKey::MatchmakingReveal, first, |t, cx| {
                t.handle_matchmaking_start(cx)
            });
        self.deadlines
            .arm(DeadlineKey::MatchmakingRevealBackstop, backstop, |t, cx| {
                t.handle_matchmaking_start(cx)
            });
    }

    fn handle_matchmaking_start(&mut self, cx: &TableCtx) {
        if !self.is_matchmade() || self.room.status != Status::Lobby {
            return;
        }
        // A held seat counts as present: a reload during the reveal keeps it.
        if self.connected() == 0 || self.connected() + self.held_seats().len() < 2 {
            self.requeue_survivor(cx);
            return;
        }
        self.start_match(cx);
    }

    /// The pairing fell apart before it dealt: whoever is left goes back to
    /// searching, and the room goes.
    pub(crate) fn requeue_survivor(&mut self, cx: &TableCtx) {
        let mut survivor = None;
        let mut nickname = String::new();
        for (seat, m) in self.clients() {
            {
                survivor = Some(m.clone());
                nickname = self
                    .room
                    .players
                    .get(seat)
                    .map(|p| p.nickname.clone())
                    .unwrap_or_default();
            }
        }
        tracing::info!(
            requeued = survivor.is_some(),
            "matchmaking pairing lost before start"
        );
        if let Some(s) = &survivor {
            s.leave_seat();
        }
        let code = self.code.clone();
        cx.hub.post_to_router("requeue_survivor", move |core| {
            core.delete_room(&code);
            let Some(s) = survivor else { return };
            if nickname.is_empty() {
                s.send(ServerMsg::MatchmakingCancelled(Default::default()));
                return;
            }
            core.enqueue(&s, nickname);
            core.try_pair();
        });
    }

    /// A matchmade table that agreed to play again goes straight back through
    /// the reveal, no lobby in between.
    pub(crate) fn start_rematched_match(&mut self, cx: &TableCtx) {
        if let Err(e) = self.room.reset_for_rematch() {
            tracing::warn!("matchmade rematch reset failed err={e}");
            return;
        }
        self.reset_for_next_match();
        let paired_at = Instant::now();
        self.matchmade_at = Some(paired_at);
        cx.hub
            .metrics()
            .matches_matchmade
            .fetch_add(1, Ordering::Relaxed);
        tracing::info!(players = self.room.players.len(), "matchmade rematch");
        self.announce_match_found();
        self.schedule_matchmaking_start(paired_at);
    }

    /// Gives a seat up outside a running match: the lobby departure, the
    /// player_left with the re-based recap, the rematch offer re-based too.
    pub(crate) fn release_seat(&mut self, cx: &TableCtx, c: &Arc<Client>) {
        let leaving = c.player_id();
        let nickname = self
            .room
            .players
            .get(leaving)
            .map(|p| p.nickname.clone())
            .unwrap_or_default();
        if self.reindex_lobby_disconnect(cx, c) {
            self.broadcast_all(ServerMsg::PlayerLeft(PlayerLeftMsg {
                nickname: nickname.clone(),
                players: self.player_list(),
                match_history: self.match_history_dto(),
                ..Default::default()
            }));
        } else if !self.close_abandoned_match(cx) {
            self.schedule_room_cleanup();
        }
        c.leave_seat();
        self.release_rematch_offer(cx, leaving);
        tracing::info!(nickname = %nickname, "player left room");
    }

    /// leave_room on the table, four branches in order: a matchmade match is
    /// forfeited; a solo game or a table nobody can come back to is closed;
    /// above the walk-out floor the seat is retired and the round carries on;
    /// at or below it the match goes to the seat that stayed.
    pub(crate) fn leave_at_table(&mut self, cx: &TableCtx, c: &Arc<Client>) {
        if c.room_code().as_deref() != Some(self.code.as_str()) {
            c.send(ServerMsg::LeftRoom(Default::default()));
            return;
        }
        let seat = c.player_id();
        if self.room.status == Status::Playing {
            if self.is_matchmade() {
                self.forfeit_match(cx, seat);
            } else if self.solo || self.abandoned_by(seat) {
                tracing::info!(
                    player = seat,
                    solo = self.solo,
                    "leave allowed, nothing left to play"
                );
                self.sweep(c);
                c.leave_seat();
                self.close_abandoned_match(cx);
                c.send(ServerMsg::LeftRoom(Default::default()));
                return;
            } else if self.can_walk_out() {
                self.retire_seat(cx, c);
                c.send(ServerMsg::LeftRoom(Default::default()));
                return;
            } else {
                self.forfeit_match(cx, seat);
            }
        }
        self.release_seat(cx, c);
        c.send(ServerMsg::LeftRoom(Default::default()));
    }

    /// Evaluated once, at the ask.
    pub fn can_walk_out(&self) -> bool {
        if self.is_matchmade() || self.solo {
            return false;
        }
        self.playable_seats().saturating_sub(1) >= WALK_OUT_FLOOR
    }

    fn retire_seat(&mut self, cx: &TableCtx, c: &Arc<Client>) {
        let seat = c.player_id();
        let nickname = self
            .room
            .players
            .get(seat)
            .map(|p| p.nickname.clone())
            .unwrap_or_default();
        let turn_before = self.room.state.as_ref().map(|s| s.current_turn);
        if let Err(e) = self.room.retire_seat(seat, clock::now_ms()) {
            c.refuse(e);
            return;
        }
        self.sweep(c);
        c.leave_seat();
        self.mark_gone(seat, true);
        tracing::info!(
            player = seat,
            nickname = %nickname,
            left = self.playable_seats(),
            "player walked out mid-match"
        );
        self.broadcast_all(ServerMsg::PlayerLeft(PlayerLeftMsg {
            nickname,
            player_index: Some(seat as i32),
            players: self.player_list(),
            ..Default::default()
        }));
        self.announce_retired_seat(cx, turn_before);
    }

    pub(crate) fn retire_absent_seat(&mut self, cx: &TableCtx, seat: usize) {
        let turn_before = self.room.state.as_ref().map(|s| s.current_turn);
        if let Err(e) = self.room.retire_seat(seat, clock::now_ms()) {
            tracing::warn!(player = seat, "retire on expiry failed err={e}");
            return;
        }
        self.mark_gone(seat, true);
        tracing::info!(
            player = seat,
            left = self.playable_seats(),
            "absent seat retired"
        );
        self.announce_retired_seat(cx, turn_before);
    }

    fn announce_retired_seat(&mut self, cx: &TableCtx, turn_before: Option<usize>) {
        self.broadcast_personalized_game_state();
        if self
            .room
            .state
            .as_ref()
            .is_some_and(|s| Some(s.current_turn) != turn_before)
        {
            self.schedule_turn_timer(cx);
            self.broadcast_turn_changed();
        }
        self.maybe_schedule_bot(cx);
    }

    /// Ends the match in favour of whoever is left, announced as the forfeit
    /// it is. The scoreboard is left alone.
    pub fn forfeit_match(&mut self, cx: &TableCtx, away_seat: usize) {
        let Some(winner) = self.remaining_seat(away_seat) else {
            return;
        };
        if let Err(e) = self.room.forfeit_to(winner, clock::now_ms()) {
            tracing::warn!(away = away_seat, "forfeit failed err={e}");
            return;
        }
        self.turn_started_at = None;
        self.loading = None;
        for s in &mut self.seats {
            s.afk = 0;
        }
        // Everything the match armed goes with it: the turn clock, the map
        // gate, the reveal, every bot move and reaction. What is about the
        // table rather than the match stays — the cleanup, and the holds of
        // seats still away, which settle those seats after the match.
        self.deadlines.retain(|k| {
            matches!(
                k,
                DeadlineKey::RoomCleanup | DeadlineKey::ReconnectExpiry(_)
            )
        });
        cx.hub
            .metrics()
            .matches_finished
            .fetch_add(1, Ordering::Relaxed);
        tracing::info!(away = away_seat, winner = %self.room.match_winner, "match forfeited");
        self.record_finished_match(clock::system_now());
        self.broadcast_all(ServerMsg::MatchEnd(MatchEndMsg {
            match_winner: self.room.match_winner.clone(),
            scoreboard: self.build_scoreboard(),
            match_history: self.match_history_dto(),
            forfeit: true,
            player_index: Some(away_seat as i32),
            ..Default::default()
        }));
    }
}

/// `want`, or `want (2)`, `(3)`… when somebody at the table already has it.
pub fn unique_nickname(room: &Room, want: &str) -> String {
    let taken = |n: &str| room.players.iter().any(|p| p.nickname == n);
    if !taken(want) {
        return want.to_owned();
    }
    let base: String = want.chars().take(16).collect::<String>().trim().to_owned();
    for n in 2..100 {
        let candidate = format!("{base} ({n})");
        if !taken(&candidate) {
            return candidate;
        }
    }
    format!("{base} ({})", clock::now_ms() % 1000)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_taken_name_gets_a_number() {
        let mut room = Room::from_u64_seed("AAAAAA", 1);
        room.join("Alice").unwrap();
        assert_eq!(unique_nickname(&room, "Bob"), "Bob");
        assert_eq!(unique_nickname(&room, "Alice"), "Alice (2)");
        room.join("Alice (2)").unwrap();
        assert_eq!(unique_nickname(&room, "Alice"), "Alice (3)");
    }
}
