//! The table itself: opening one, taking a seat at it, the host controls, and
//! the bookkeeping that frees a seat or deletes an empty room. Port of
//! `server/hub/rooms.go`.

use crate::actor::{DeadlineKey, TableCtx, TableJob};
use crate::client::Client;
use crate::clock;
use crate::convert::{match_format_of, match_format_string};
use crate::hub::HubCore;
use crate::room::new_room;
use crate::table::Table;
use loco_game::Status;
use loco_protocol::{
    GameStartedMsg, HostChangedMsg, JoinRoomMsg, LobbyConfigChangedMsg, MatchFormat as WireFormat,
    PlayerJoinedMsg, PlayerLeftMsg, RoomCreatedMsg, RoomJoinedMsg, ServerMsg,
    StreamerModeChangedMsg,
};
use std::sync::Arc;
use std::sync::atomic::Ordering;
use tokio::time::Instant;

/// The alphabet a table code is validated against on `join_room`. Read by
/// `client/src/test/serverSource.ts`, which pins the client's mirror
/// (`tableCodeRules.ts`) to it. The same 32 characters `tokens.rs` draws from.
pub const ROOM_CODE_CHARS: &str = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/// How many characters a table code has.
pub const ROOM_CODE_LEN: usize = 6;

/// Whether `code` is a table code at all, case aside.
pub fn valid_room_code(code: &str) -> bool {
    code.len() == ROOM_CODE_LEN
        && code
            .to_ascii_uppercase()
            .bytes()
            .all(|b| ROOM_CODE_CHARS.as_bytes().contains(&b))
}

const CLEANUP: DeadlineKey = DeadlineKey::table("room_cleanup");

/// One network's recent tally of table codes that led nowhere.
#[derive(Clone, Copy, Debug)]
pub struct JoinBudget {
    pub count: usize,
    pub window_start: Instant,
}

/// When the budget map is swept of expired entries.
const MAX_JOIN_BUDGETS: usize = 4096;

impl HubCore {
    /// Canonicalises and checks a nickname, or refuses it with the one string
    /// that never says which rule fired.
    pub(crate) fn validate_nickname(c: &Client, raw: &str) -> Option<String> {
        match loco_game::validate_nickname(raw) {
            Ok(n) => Some(n),
            Err(e) => {
                tracing::info!(conn = %c.conn_id, reason = %e, "nickname refused");
                c.refuse(crate::refusal::Refusal::NicknameRejected);
                None
            }
        }
    }

    /// Whether this socket already holds a seat. A seat at a table that no
    /// longer exists is not one, and is released.
    pub(crate) fn already_seated(&self, c: &Client) -> bool {
        let Some(code) = c.room_code() else {
            return false;
        };
        if !self.tables.contains_key(&code) {
            c.leave_seat();
            return false;
        }
        true
    }

    pub(crate) fn join_throttled(&mut self, c: &Client) -> bool {
        let window = self.hub.config().timings.failed_join_window;
        let Some(b) = self.join_budgets.get(&c.net_key) else {
            return false;
        };
        if b.window_start.elapsed() > window {
            self.join_budgets.remove(&c.net_key);
            return false;
        }
        b.count >= self.hub.config().limits.max_failed_joins
    }

    /// Charges one wrong code against this connection's network.
    pub(crate) fn note_failed_join(&mut self, c: &Client) {
        let window = self.hub.config().timings.failed_join_window;
        let max = self.hub.config().limits.max_failed_joins;
        let now = Instant::now();
        match self.join_budgets.get_mut(&c.net_key) {
            Some(b) if now.saturating_duration_since(b.window_start) <= window => {
                b.count += 1;
                if b.count == max {
                    tracing::warn!(conn = %c.conn_id, addr = %c.net_key, attempts = b.count, "table code sweep suspected");
                }
            }
            _ => {
                if self.join_budgets.len() >= MAX_JOIN_BUDGETS {
                    self.join_budgets
                        .retain(|_, b| now.saturating_duration_since(b.window_start) <= window);
                }
                self.join_budgets.insert(
                    c.net_key.clone(),
                    JoinBudget {
                        count: 1,
                        window_start: now,
                    },
                );
            }
        }
    }

    /// Seats a client at a table the hub is still building. The sweep of any
    /// other table it was at is asked of that table.
    pub(crate) fn seat_into(&self, t: &mut Table, c: &Arc<Client>, id: usize) {
        if let Some(old) = c.room_code()
            && old != t.code
            && let Some(ot) = self.tables.get(&old)
        {
            let c2 = c.clone();
            ot.post_from_timer("sweep_old_seat", move |ot, _| ot.sweep(&c2));
        }
        t.seat(c, id);
    }

    pub(crate) fn handle_create_room(&mut self, c: &Arc<Client>, nickname: &str) {
        if self.refuse_while_draining(c) {
            return;
        }
        if self.already_seated(c) {
            c.refuse(crate::refusal::Refusal::AlreadyInRoom);
            return;
        }
        let Some(nickname) = Self::validate_nickname(c, nickname) else {
            return;
        };
        let max_rooms = self.hub.config().limits.max_rooms;
        if self.tables.len() >= max_rooms {
            tracing::warn!(rooms = self.tables.len(), conn = %c.conn_id, "room cap reached");
            c.refuse(crate::refusal::Refusal::ServerFull);
            return;
        }
        let code = self.generate_code();
        let mut room = new_room(&code);
        if let Err(e) = room.join(&nickname) {
            c.refuse(e);
            return;
        }
        let mut t = self.new_table(&code, room);
        self.seat_into(&mut t, c, 0);
        tracing::info!(code = %code, host = %nickname, "room created");
        let tok = t.issue_token(0);
        c.send(ServerMsg::RoomCreated(RoomCreatedMsg {
            room_code: code.clone(),
            player_id: Some(0),
            players: t.player_list(),
            session_token: tok,
            match_format: Some(match_format_string(t.room.format)),
            max_players: t.room.max_players,
            ..Default::default()
        }));
        // Last, when the hub has finished filling it in.
        self.open_table(t);
    }

    /// A code no live table holds.
    pub(crate) fn generate_code(&self) -> String {
        crate::tokens::generate_code(|c| self.tables.contains_key(c))
    }

    pub(crate) fn handle_join_room(&mut self, c: &Arc<Client>, msg: JoinRoomMsg) {
        if self.already_seated(c) {
            c.refuse(crate::refusal::Refusal::AlreadyInRoom);
            return;
        }
        let Some(nickname) = Self::validate_nickname(c, &msg.nickname) else {
            return;
        };
        if !valid_room_code(&msg.room_code) {
            self.note_failed_join(c);
            c.refuse(crate::refusal::Refusal::InvalidRoomCode);
            return;
        }
        // A sweep is refused before the lookup, so a throttled network learns
        // nothing from the answer either.
        if self.join_throttled(c) {
            self.hub
                .metrics()
                .joins_throttled
                .fetch_add(1, Ordering::Relaxed);
            c.refuse(crate::refusal::Refusal::TooManyAttempts);
            return;
        }
        let code = msg.room_code.to_ascii_uppercase();
        let Some(t) = self.tables.get(&code) else {
            // While draining, a code this process does not have is very likely
            // one the previous process had: not the player's mistake.
            if self.refuse_while_draining(c) {
                return;
            }
            self.note_failed_join(c);
            c.refuse(crate::refusal::Refusal::RoomNotFound);
            return;
        };
        // The rest of a join is the table's, which also makes two people
        // typing the same code in the same instant a queue, not a race.
        let c2 = c.clone();
        let token = msg.session_token;
        let job = TableJob::new("join_room", move |t: &mut Table, cx: &TableCtx| {
            t.join_at_table(cx, &c2, &nickname, &token)
        })
        .from_client(c.clone());
        if t.post(job).is_err() {
            c.refuse(crate::refusal::Refusal::ServerBusy);
        }
    }
}

impl Table {
    /// Binds a client to a seat at this (running) table; the sweep of any
    /// other table it was at goes through the hub.
    pub fn seat_client(&mut self, cx: &TableCtx, c: &Arc<Client>, id: usize) {
        if let Some(old) = c.room_code()
            && old != self.code
        {
            let c2 = c.clone();
            cx.hub.post_to_router("sweep_old_seat", move |core| {
                if let Some(ot) = core.tables.get(&old) {
                    ot.post_from_timer("sweep_old_seat", move |ot, _| ot.sweep(&c2));
                }
            });
        }
        self.seat(c, id);
    }

    fn join_at_table(&mut self, cx: &TableCtx, c: &Arc<Client>, nickname: &str, token: &str) {
        // A table that has dealt (or finished, or is a matchmade reveal) takes
        // nothing but a reclaim, and a stranger gets the same one string as a
        // stale token: two refusals would be a roster oracle.
        if self.room.status != Status::Lobby || self.is_matchmade() {
            if let Some(seat) = self.find_held_seat(nickname)
                && self.validate_token(seat, token)
            {
                self.handle_reconnect(cx, c, seat, nickname);
                return;
            }
            let c2 = c.clone();
            cx.hub
                .post_to_router("failed_join", move |core| core.note_failed_join(&c2));
            c.refuse(crate::refusal::Refusal::GameAlreadyInProgress);
            return;
        }
        if let Err(e) = self.room.join(nickname) {
            c.refuse(e);
            return;
        }
        self.seat_client(cx, c, self.room.players.len() - 1);
        // A table whose last human dropped keeps its bots, the first of them
        // in the host's seat; this arrival takes it back.
        self.keep_host_human(cx);
        let seat = c.player_id();
        let tok = self.issue_token(seat);
        c.send(ServerMsg::RoomJoined(RoomJoinedMsg {
            room_code: self.code.clone(),
            player_id: Some(seat as i32),
            players: self.player_list(),
            session_token: tok,
            match_format: Some(match_format_string(self.room.format)),
            max_players: self.room.max_players,
            streamer_mode: self.streamer_mode,
            ..Default::default()
        }));
        self.broadcast(
            ServerMsg::PlayerJoined(PlayerJoinedMsg {
                nickname: nickname.to_owned(),
                players: self.player_list(),
                ..Default::default()
            }),
            Some(c),
        );
    }

    /// A table with no host — matchmade or solo — refuses every host control.
    pub fn refuse_without_host(&self, c: &Client) -> bool {
        if !self.hostless() {
            return false;
        }
        c.refuse(crate::refusal::Refusal::Hostless);
        true
    }

    pub(crate) fn handle_start_game(&mut self, cx: &TableCtx, c: &Arc<Client>) {
        if cx.hub.draining() {
            c.refuse(crate::refusal::Refusal::Draining);
            return;
        }
        if self.refuse_without_host(c) {
            return;
        }
        if c.player_id() != 0 {
            c.refuse(crate::refusal::Refusal::OwnerOnlyStart);
            return;
        }
        if let Err(e) = self.room.start(clock::now_ms()) {
            c.refuse(e);
            return;
        }
        self.deal_match(cx);
    }

    /// The matchmaking reveal's way into the same deal.
    pub(crate) fn start_match(&mut self, cx: &TableCtx) {
        if let Err(e) = self.room.start(clock::now_ms()) {
            tracing::warn!("matchmade start failed err={e}");
            return;
        }
        self.deal_match(cx);
    }

    /// Each seat's own game_started, then the gate. The clock and the bots
    /// are not armed here: the match begins at match_ready.
    pub(crate) fn deal_match(&mut self, cx: &TableCtx) {
        cx.hub
            .metrics()
            .matches_started
            .fetch_add(1, Ordering::Relaxed);
        tracing::info!(
            players = self.room.players.len(),
            format = match_format_string(self.room.format).as_str(),
            matchmade = self.is_matchmade(),
            solo = self.solo,
            "match started"
        );
        let pl = self.player_list();
        let shared = self.shared_game_state();
        for (seat, m) in self.clients() {
            {
                m.send(ServerMsg::GameStarted(GameStartedMsg {
                    state: Some(self.player_game_state_with(seat, pl.clone(), &shared)),
                    ..Default::default()
                }));
            }
        }
        self.begin_map_loading(cx);
    }

    pub(crate) fn handle_set_match_format(&mut self, c: &Arc<Client>, f: Option<WireFormat>) {
        if self.refuse_without_host(c) {
            return;
        }
        if c.player_id() != 0 {
            c.refuse(crate::refusal::Refusal::HostOnlyFormat);
            return;
        }
        let Some(f) = f else {
            c.refuse(crate::refusal::Refusal::Other(
                r#"invalid match format "": must be BO1, BO3, BO5, or BO7"#.into(),
            ));
            return;
        };
        if let Err(e) = self.room.set_format(match_format_of(f)) {
            c.refuse(e);
            return;
        }
        self.broadcast_lobby_config();
    }

    pub(crate) fn handle_set_max_players(&mut self, c: &Arc<Client>, n: i32) {
        if self.refuse_without_host(c) {
            return;
        }
        if c.player_id() != 0 {
            c.refuse(crate::refusal::Refusal::HostOnlyMaxPlayers);
            return;
        }
        if let Err(e) = self.room.set_max_players(n) {
            c.refuse(e);
            return;
        }
        self.broadcast_lobby_config();
    }

    /// The host saying the table code must not be readable on anybody's
    /// screen. Host only, hostless never, every status; a repeat is answered
    /// by nobody.
    pub(crate) fn handle_set_streamer_mode(&mut self, c: &Arc<Client>, on: bool) {
        if self.refuse_without_host(c) {
            return;
        }
        if c.player_id() != 0 {
            c.refuse(crate::refusal::Refusal::HostOnlyStreamerMode);
            return;
        }
        if self.streamer_mode == on {
            return;
        }
        self.streamer_mode = on;
        self.broadcast_all(ServerMsg::StreamerModeChanged(StreamerModeChangedMsg {
            streamer_mode: on,
            ..Default::default()
        }));
    }

    fn broadcast_lobby_config(&self) {
        self.broadcast_all(ServerMsg::LobbyConfigChanged(LobbyConfigChangedMsg {
            match_format: Some(match_format_string(self.room.format)),
            max_players: self.room.max_players,
            ..Default::default()
        }));
    }

    /// Frees a seat on the host's say-so: host only, lobby only, matchmade
    /// never, never seat 0. Not a ban, and must not become one.
    pub(crate) fn handle_kick_player(
        &mut self,
        cx: &TableCtx,
        c: &Arc<Client>,
        target: Option<i32>,
    ) {
        if self.refuse_without_host(c) {
            return;
        }
        if c.player_id() != 0 {
            c.refuse(crate::refusal::Refusal::OwnerOnlyKick);
            return;
        }
        if self.room.status != Status::Lobby {
            c.refuse(crate::refusal::Refusal::KickLobbyOnly);
            return;
        }
        let Some(seat) = target.filter(|&s| s > 0 && (s as usize) < self.room.players.len()) else {
            c.refuse(crate::refusal::Refusal::InvalidPlayerIndex);
            return;
        };
        let seat = seat as usize;
        let nickname = self.room.players[seat].nickname.clone();
        let Some(target) = self.client(seat).cloned() else {
            // No socket at that slot: in a lobby that is a bot.
            self.remove_unmanned_seat(cx, seat);
            tracing::info!(nickname = %nickname, bot = true, "player kicked");
            return;
        };
        // The seat first, the notice second: the removed client is out of the
        // members by then, so it gets this instead of the player_left about
        // itself.
        self.release_seat(cx, &target);
        target.send(ServerMsg::Kicked(Default::default()));
        tracing::info!(nickname = %nickname, bot = false, "player kicked");
    }

    /// Hands the table over: a swap of seat 0 with the target, the token
    /// travelling with the player. Lobby only, never to a bot.
    pub(crate) fn handle_transfer_host(&mut self, c: &Arc<Client>, target: Option<i32>) {
        if self.refuse_without_host(c) {
            return;
        }
        if c.player_id() != 0 {
            c.refuse(crate::refusal::Refusal::OwnerOnlyTransfer);
            return;
        }
        if self.room.status != Status::Lobby {
            c.refuse(crate::refusal::Refusal::TransferLobbyOnly);
            return;
        }
        let Some(seat) = target.filter(|&s| s > 0 && (s as usize) < self.room.players.len()) else {
            c.refuse(crate::refusal::Refusal::InvalidPlayerIndex);
            return;
        };
        let seat = seat as usize;
        if self.is_bot(seat) {
            c.refuse(crate::refusal::Refusal::BotCannotHost);
            return;
        }
        let nickname = self.room.players[seat].nickname.clone();
        if let Err(e) = self.room.swap_lobby_players(0, seat as i32) {
            c.refuse(e);
            return;
        }
        self.swap_seats(0, seat);
        // Per recipient: the two seats that moved read their own player_id.
        let pl = self.player_list();
        for (i, m) in self.clients() {
            {
                m.send(ServerMsg::HostChanged(HostChangedMsg {
                    player_id: Some(i as i32),
                    nickname: nickname.clone(),
                    players: pl.clone(),
                    ..Default::default()
                }));
            }
        }
        tracing::info!(nickname = %nickname, "host transferred");
    }

    /// Drops a seat with no socket behind it and re-bases everything above it.
    pub(crate) fn remove_unmanned_seat(&mut self, cx: &TableCtx, seat: usize) {
        let nickname = self.room.players[seat].nickname.clone();
        if let Err(e) = self.room.remove_lobby_player(seat as i32) {
            tracing::warn!(player = seat, "RemoveLobbyPlayer failed err={e}");
            return;
        }
        if self.is_bot(seat) {
            cx.hub.metrics().bots_active.fetch_sub(1, Ordering::Relaxed);
        }
        self.drop_seat(seat);
        self.broadcast_all(ServerMsg::PlayerLeft(PlayerLeftMsg {
            nickname,
            players: self.player_list(),
            ..Default::default()
        }));
    }

    /// Starts the clock that deletes the room if it stays empty. Seating
    /// anybody clears `empty_at`, which is what the fire re-checks.
    pub fn schedule_room_cleanup(&mut self) {
        let now = Instant::now();
        self.empty_at = Some(now);
        let at = now + self.timings.empty_room_timeout;
        self.deadlines
            .arm(CLEANUP, at, move |t, cx| t.handle_cleanup(cx, now));
    }

    fn handle_cleanup(&mut self, cx: &TableCtx, empty_at: Instant) {
        if self.empty_at != Some(empty_at) {
            tracing::info!("room cleanup skipped, room rejoined");
            return;
        }
        if !self.all_seats_empty() {
            self.empty_at = None;
            tracing::info!("room cleanup skipped, active members still present");
            return;
        }
        let code = self.code.clone();
        cx.hub
            .post_to_router("delete_room", move |core| core.delete_room(&code));
    }

    /// Tears down a match nobody is at and nobody can come back to, the moment
    /// that becomes true rather than on the five-minute cleanup. A lobby is
    /// left to the cleanup: its code is live.
    pub fn close_abandoned_match(&mut self, cx: &TableCtx) -> bool {
        if self.room.status == Status::Lobby
            || !self.held_seats().is_empty()
            || !self.all_seats_empty()
        {
            return false;
        }
        tracing::info!("match abandoned, closing table");
        let code = self.code.clone();
        cx.hub
            .post_to_router("delete_abandoned", move |core| core.delete_room(&code));
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_code_rule_is_the_generator_s() {
        assert_eq!(ROOM_CODE_CHARS.as_bytes(), crate::tokens::ROOM_CODE_CHARS);
        assert_eq!(ROOM_CODE_LEN, crate::tokens::ROOM_CODE_LEN);
        assert!(valid_room_code("abcdef"));
        assert!(valid_room_code("AB23CD"));
        assert!(!valid_room_code("ABCDE0"), "0 is not in the alphabet");
        assert!(!valid_room_code("ABCDE"));
        assert!(!valid_room_code("ABCDEFG"));
    }
}
