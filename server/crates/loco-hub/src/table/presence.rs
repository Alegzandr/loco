//! Leaving and coming back: what a disconnect costs at a table that has dealt
//! and at one that has not, the hold, and the reclaim. Port of
//! `server/hub/presence.go`.

use crate::net::client::Client;
use crate::router::hub::HubCore;
use crate::table::Table;
use crate::table::actor::TableCtx;
use loco_game::Status;
use loco_protocol::{
    MatchLoadingMsg, PlayerDisconnectedMsg, PlayerLeftMsg, PlayerReconnectedMsg, ServerMsg,
};
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::Duration;
use tokio::time::Instant;

impl HubCore {
    /// A socket has gone. The queue is the hub's and is left first; the seat
    /// is the table's, and is handed to it.
    pub(crate) fn handle_disconnect(&mut self, c: &Arc<Client>) {
        self.dequeue(c);
        let Some(code) = c.room_code() else {
            tracing::info!(conn = %c.conn_id, addr = %c.net_prefix(), "player disconnected (no room)");
            return;
        };
        let Some(t) = self.tables.get(&code) else {
            return;
        };
        let c2 = c.clone();
        t.post_critical(
            &self.hub,
            "disconnect",
            Duration::from_secs(1),
            move |t, cx| t.disconnect_at_table(cx, &c2),
        );
    }
}

impl Table {
    fn nickname_of(&self, seat: usize) -> String {
        self.room
            .players
            .get(seat)
            .map(|p| p.nickname.clone())
            .unwrap_or_default()
    }

    /// The hold a seat gets: 15s at a matchmade table, 60s anywhere else.
    pub fn reconnect_hold(&self) -> Duration {
        if self.is_matchmade() {
            self.timings.matchmaking.reconnect_timeout
        } else {
            self.timings.reconnect_timeout
        }
    }

    /// The forfeit deadline a matchmade table's survivor is shown, or 0.
    pub fn forfeit_deadline_ms(&self, disconnected_at: Instant) -> i64 {
        if !self.is_matchmade() {
            return 0;
        }
        crate::ops::clock::ms_of(disconnected_at + self.timings.matchmaking.reconnect_timeout)
    }

    pub(crate) fn disconnect_at_table(&mut self, cx: &TableCtx, c: &Arc<Client>) {
        // The socket may have been seated elsewhere, or released, since.
        if c.room_code().as_deref() != Some(self.code.as_str()) {
            return;
        }
        let seat = c.player_id();
        let nickname = self.nickname_of(seat);
        tracing::info!(nickname = %nickname, player_id = seat, "player disconnected");
        let status = self.room.status;

        // A match, a finished ordinary table, and a matchmade reveal hold the
        // seat; everything else removes it.
        let held = status == Status::Playing
            || (status == Status::Finished && !self.is_matchmade())
            || (status == Status::Lobby && self.is_matchmade());
        if held {
            let at = Instant::now();
            self.hold(seat, at);
            let forfeit_deadline = if status == Status::Finished {
                0
            } else {
                self.forfeit_deadline_ms(at)
            };
            self.broadcast_all(ServerMsg::PlayerDisconnected(PlayerDisconnectedMsg {
                player_index: Some(seat as i32),
                nickname,
                players: self.player_list(),
                forfeit_deadline,
                ..Default::default()
            }));
            // A seat that left during the gate is no longer one it waits on.
            if status == Status::Playing && self.is_loading() {
                self.broadcast_loading_progress();
                self.maybe_open_table(cx);
            }
            self.schedule_reconnect_expiry(seat, at);
            if self.all_seats_empty() {
                self.schedule_room_cleanup();
            }
            if status == Status::Finished {
                // Last, because it can deal: whoever is left may have asked.
                self.retire_rematch_offer(cx, seat);
            }
            return;
        }

        // A lobby, or a matchmade table that is over: removed, and everything
        // keyed by seat re-based, or the next match deals a hand to nobody.
        let finished = status == Status::Finished;
        if !self.reindex_lobby_disconnect(cx, c) {
            self.schedule_room_cleanup();
            return;
        }
        self.broadcast_all(ServerMsg::PlayerLeft(PlayerLeftMsg {
            nickname,
            players: self.player_list(),
            match_history: self.match_history_dto(),
            ..Default::default()
        }));
        if finished {
            self.release_rematch_offer(cx, seat);
        }
    }

    /// Arms the close of a held seat's window. Keyed uniquely: two holds can
    /// be re-based onto each other's seat numbers, and the expiry finds its
    /// hold by the instant it began, never by the seat it was armed with.
    pub fn schedule_reconnect_expiry(&mut self, seat: usize, at: Instant) {
        let key = self.reconnect_key();
        let fire = at + self.reconnect_hold();
        self.deadlines.arm(key, fire, move |t, cx| {
            t.handle_expire_reconnect(cx, seat, at)
        });
    }

    /// Removes the leaving client from a lobby and re-bases every seat above
    /// it. Returns whether a human remains.
    pub(crate) fn reindex_lobby_disconnect(&mut self, cx: &TableCtx, c: &Arc<Client>) -> bool {
        let leaving = c.player_id();
        if let Err(e) = self.room.remove_lobby_player(leaving) {
            tracing::warn!(player = leaving, "RemoveLobbyPlayer failed err={e}");
        }
        let has_human = self.drop_client(c, leaving);
        self.keep_host_human(cx);
        has_human
    }

    pub(crate) fn handle_expire_reconnect(&mut self, cx: &TableCtx, hint: usize, at: Instant) {
        let Some(seat) = self.held_seat_at(hint, at) else {
            tracing::info!(
                player = hint,
                "reconnect expiry skipped, hold cleared or superseded"
            );
            return;
        };
        cx.hub
            .metrics()
            .reconnect_expirations
            .fetch_add(1, Ordering::Relaxed);
        tracing::info!(player = seat, "reconnect window expired");
        let nickname = self.nickname_of(seat);
        // Absent for good: the roster must stop calling it connected. The
        // token stays, as Go's did: a finished table removes the seat anyway.
        self.mark_gone(seat, false);

        let status = self.room.status;
        let mut removed = false;
        if status != Status::Playing {
            match self.room.remove_lobby_player(seat) {
                Ok(_) => {
                    self.drop_seat(seat);
                    removed = true;
                }
                Err(e) => {
                    tracing::warn!(player = seat, "expiry remove failed err={e}")
                }
            }
        }
        let mut left = PlayerLeftMsg {
            nickname,
            players: self.player_list(),
            ..Default::default()
        };
        if !removed {
            // A running match indexes hands by the seat, so nothing moved and
            // the seat number is still true.
            left.player_index = Some(seat as i32);
        } else {
            left.match_history = self.match_history_dto();
            if !self.room.scores.is_empty() {
                left.scoreboard = self.build_scoreboard();
                left.round_history = self.room.round_history.clone();
            }
        }
        self.broadcast_all(ServerMsg::PlayerLeft(left));

        if removed && status == Status::Finished {
            self.release_rematch_offer(cx, seat);
        }
        // A seat held through the reveal and never reclaimed: the pairing fell
        // apart before it dealt.
        if removed && status == Status::Lobby && self.is_matchmade() {
            self.requeue_survivor(cx);
            return;
        }
        if status == Status::Playing && self.is_matchmade() {
            self.forfeit_match(cx, seat);
        }
        if status == Status::Playing && !self.is_matchmade() {
            self.settle_expired_seat(cx, seat);
        }
        self.close_abandoned_match(cx);
    }

    /// leave_room's answer, given to the same departure arrived at by a hold
    /// running out: retired above the walk-out floor, a forfeit at or below.
    pub(crate) fn settle_expired_seat(&mut self, cx: &TableCtx, seat: usize) {
        if self.room.status != Status::Playing || self.is_matchmade() || self.room.is_retired(seat)
        {
            return;
        }
        if self.connected() == 0 && self.held_seats().is_empty() {
            return;
        }
        if self.playable_seats() >= crate::router::matchmaking::WALK_OUT_FLOOR {
            self.retire_absent_seat(cx, seat);
            return;
        }
        self.forfeit_match(cx, seat);
    }

    /// Restores a held seat. The token that opened it is spent and replaced.
    pub(crate) fn handle_reconnect(
        &mut self,
        cx: &TableCtx,
        c: &Arc<Client>,
        seat: usize,
        nickname: &str,
    ) {
        // Seating replaces the hold.
        self.seat_client(cx, c, seat);
        // The counter measured a connection that died; a reclaim is somebody
        // there.
        self.seats[seat].afk = 0;
        tracing::info!(nickname = %nickname, player_id = seat, "player reconnected");
        let tok = self.issue_token(seat);
        // A reclaim at a finished table gets no board: the match is over.
        let state = (self.room.status == Status::Playing).then(|| self.player_game_state(seat));
        c.send(ServerMsg::PlayerReconnected(PlayerReconnectedMsg {
            room_code: self.code.to_string(),
            player_id: Some(seat as i32),
            state,
            players: self.player_list(),
            session_token: tok.into_string(),
            ..Default::default()
        }));
        self.broadcast(
            ServerMsg::PlayerReconnected(PlayerReconnectedMsg {
                player_index: Some(seat as i32),
                nickname: nickname.to_owned(),
                players: self.player_list(),
                ..Default::default()
            }),
            Some(c),
        );
        if self.room.status == Status::Finished {
            self.broadcast_rematch_offers(None);
        }
        // Back mid-drain: they missed the announcement on a dead socket.
        if cx.hub.draining() {
            c.send(ServerMsg::ServerUpdating(Default::default()));
        }
        // Back while the table is shut: told so, or the gate waits on them.
        if self.is_loading() {
            c.send(ServerMsg::MatchLoading(MatchLoadingMsg {
                players_ready: self.ready_seats(),
                ..Default::default()
            }));
        }
    }
}
