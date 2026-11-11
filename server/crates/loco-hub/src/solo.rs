//! `play_bot`: a 1v1 against the server, the queue's shape without the queue.
//! Port of `server/hub/solo.go`. No code, no waiting room, nothing to
//! configure, BO1, and it touches nothing the queue owns.

use crate::actor::{TableCtx, TableJob};
use crate::bots::next_bot_name;
use crate::client::Client;
use crate::hub::HubCore;
use crate::room::new_room;
use crate::table::Table;
use loco_game::{Status, room::MatchFormat};
use loco_protocol::{GameStartedMsg, ServerMsg};
use std::sync::Arc;
use std::sync::atomic::Ordering;

/// The format a solo game is played in.
pub const SOLO_FORMAT: MatchFormat = MatchFormat::Bo1;

impl HubCore {
    pub(crate) fn handle_play_bot(&mut self, c: &Arc<Client>, nickname: &str) {
        if self.refuse_while_draining(c) {
            return;
        }
        let Some(nickname) = Self::validate_nickname(c, nickname) else {
            return;
        };
        if self.already_seated(c) {
            let Some(t) = self.table_of(c) else {
                self.open_solo_table(c, &nickname);
                return;
            };
            let c2 = c.clone();
            let job = TableJob::new("play_bot_release", move |t: &mut Table, cx: &TableCtx| {
                if t.room.status == Status::Playing {
                    c2.refuse(crate::refusal::Refusal::AlreadyInRoom);
                    return;
                }
                t.release_seat(cx, &c2);
                let c3 = c2.clone();
                cx.hub.post_to_router("open_solo", move |core| {
                    core.open_solo_table(&c3, &nickname)
                });
            })
            .from_client(c.clone());
            if t.post(job).is_err() {
                c.refuse(crate::refusal::Refusal::ServerBusy);
            }
            return;
        }
        self.open_solo_table(c, &nickname);
    }

    pub(crate) fn open_solo_table(&mut self, c: &Arc<Client>, nickname: &str) {
        let max_rooms = self.hub.config().limits.max_rooms;
        if self.tables.len() >= max_rooms {
            tracing::warn!(rooms = self.tables.len(), conn = %c.conn_id, "room cap reached");
            c.refuse(crate::refusal::Refusal::ServerFull);
            return;
        }
        let code = self.generate_code();
        let mut room = new_room(&code);
        if let Err(e) = room.set_max_players(2) {
            tracing::warn!(code = %code, "solo SetMaxPlayers err={e}");
        }
        if let Err(e) = room.set_format(SOLO_FORMAT) {
            tracing::warn!(code = %code, "solo SetFormat err={e}");
        }
        if let Err(e) = room.join(nickname) {
            c.refuse(e);
            return;
        }
        let bot_name = next_bot_name(&room);
        if let Err(e) = room.join(&bot_name) {
            c.refuse(e);
            return;
        }
        if let Err(e) = room.start(crate::clock::now_ms()) {
            tracing::warn!(code = %code, "solo start failed err={e}");
            c.refuse(e);
            return;
        }
        let mut t = self.new_table(&code, room);
        t.solo = true;
        self.seat_into(&mut t, c, 0);
        t.add_bot_seat();
        let m = self.hub.metrics();
        m.bots_active.fetch_add(1, Ordering::Relaxed);
        m.matches_solo.fetch_add(1, Ordering::Relaxed);
        tracing::info!(code = %code, nickname = %nickname, bot = %bot_name, "solo match started");
        let c2 = c.clone();
        let handle = self.open_table(t);
        // The deal and the gate are the table's first job: they arm deadlines,
        // which only a running table can sleep on.
        let _ = handle.post(TableJob::new(
            "solo_deal",
            move |t: &mut Table, cx: &TableCtx| t.deal_solo_match(cx, &c2),
        ));
    }
}

impl Table {
    /// The one human's game_started carries what a room_created would have:
    /// the code, the seat and the token.
    fn deal_solo_match(&mut self, cx: &TableCtx, c: &Arc<Client>) {
        cx.hub
            .metrics()
            .matches_started
            .fetch_add(1, Ordering::Relaxed);
        let seat = c.player_id();
        let tok = self.issue_token(seat);
        c.send(ServerMsg::GameStarted(GameStartedMsg {
            room_code: self.code.to_string(),
            player_id: Some(seat as i32),
            session_token: tok.into_string(),
            state: Some(self.player_game_state(seat)),
            ..Default::default()
        }));
        self.begin_map_loading(cx);
    }
}
