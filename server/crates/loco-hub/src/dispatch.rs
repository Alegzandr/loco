//! Inbound routing: the floor every message stands on, the not-playing gate,
//! and the switch. Port of `server/hub/dispatch.go`.
//!
//! Replay protection is implicit: the protocol carries no nonce, and every
//! gameplay handler validates against the current authoritative state, so a
//! replayed message fails the moment the state has moved past it. Identity
//! (the seat, the table) is server-assigned and never read from the message.

use crate::actor::{TableCtx, TableJob};
use crate::client::Client;
use crate::hub::HubCore;
use crate::logsink::panic_message;
use crate::maploading::is_gameplay_msg;
use crate::table::Table;
use loco_game::Status;
use loco_protocol::ClientMsg;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::Arc;
use std::sync::atomic::Ordering;

/// A client message's `type`, for a log line or a probe.
pub fn client_type(msg: &ClientMsg) -> String {
    serde_json::to_value(msg)
        .ok()
        .and_then(|v| v.get("type").and_then(|t| t.as_str()).map(str::to_owned))
        .unwrap_or_default()
}

/// Whether a message acts on the table its sender already sits at, and
/// nothing else. `leave_room` is not one: it empties the queue as well.
fn table_scoped(msg: &ClientMsg) -> bool {
    matches!(
        msg,
        ClientMsg::MapReady
            | ClientMsg::StartGame
            | ClientMsg::AddBot
            | ClientMsg::SetMatchFormat(_)
            | ClientMsg::SetMaxPlayers(_)
            | ClientMsg::SetStreamerMode(_)
            | ClientMsg::KickPlayer(_)
            | ClientMsg::TransferHost(_)
            | ClientMsg::Rematch
            | ClientMsg::SendEmote(_)
            | ClientMsg::DebugSetState(_)
    ) || is_gameplay_msg(msg)
}

/// Every inbound message passes through here, on the hub's loop. One message
/// must never be able to cost the server: a panic below is recovered, counted
/// and answered.
pub(crate) fn dispatch(core: &mut HubCore, c: &Arc<Client>, msg: ClientMsg) {
    let result = catch_unwind(AssertUnwindSafe(|| {
        #[cfg(any(test, feature = "testkit"))]
        {
            let probe = core
                .hub
                .shared()
                .dispatch_probe
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone();
            if let Some(p) = probe {
                p(&client_type(&msg));
            }
        }
        route(core, c, msg.clone());
    }));
    if let Err(p) = result {
        core.hub
            .metrics()
            .handler_panics
            .fetch_add(1, Ordering::Relaxed);
        let seat = c.seat();
        tracing::warn!(
            r#type = %client_type(&msg),
            conn = %c.conn_id,
            code = %seat.as_ref().map_or("", |s| s.code.as_str()),
            player = seat.as_ref().map_or(-1, |s| s.id as i64),
            panic = %panic_message(p.as_ref()),
            "handler panic recovered"
        );
        c.refuse(crate::refusal::Refusal::ServerError);
    }
}

fn route(core: &mut HubCore, c: &Arc<Client>, msg: ClientMsg) {
    // map_ready with no table behind it is a duplicate answer, or one that
    // lost the race with the loading timeout: not a mistake to refuse.
    if matches!(msg, ClientMsg::MapReady) && core.table_of(c).is_none() {
        return;
    }
    if table_scoped(&msg) {
        let what = client_type(&msg);
        let c2 = c.clone();
        let job = TableJob::new(what, move |t: &mut Table, cx: &TableCtx| {
            t.dispatch_at_table(cx, &c2, msg)
        });
        post_to_table(core, c, job);
        return;
    }
    match msg {
        ClientMsg::CreateRoom(m) => core.handle_create_room(c, &m.nickname),
        ClientMsg::JoinRoom(m) => core.handle_join_room(c, m),
        ClientMsg::FindMatch(m) => core.handle_find_match(c, &m.nickname),
        ClientMsg::PlayBot(m) => core.handle_play_bot(c, &m.nickname),
        ClientMsg::CancelMatchmaking => core.handle_cancel_matchmaking(c),
        ClientMsg::LeaveRoom => core.handle_leave_room(c),
        _ => c.refuse(crate::refusal::Refusal::UnknownMessageType),
    }
}

/// Hands a message's work to the table the sender sits at. A full box means
/// that one table is behind, and only its own players are told so.
pub fn post_to_table(core: &HubCore, c: &Arc<Client>, job: TableJob) -> bool {
    let Some(code) = c.room_code() else {
        c.refuse(crate::refusal::Refusal::NotInRoom);
        return false;
    };
    let Some(t) = core.tables.get(&code) else {
        c.refuse(crate::refusal::Refusal::RoomNotFound);
        return false;
    };
    let what = job.what.clone();
    if t.post(job.from_client(c.clone())).is_err() {
        core.hub
            .metrics()
            .messages_dropped_busy
            .fetch_add(1, Ordering::Relaxed);
        tracing::info!(r#type = %what, conn = %c.conn_id, code = %code, "table box full, dropping message");
        c.refuse(crate::refusal::Refusal::ServerBusy);
        return false;
    }
    true
}

impl Table {
    /// The table's half of routing, on its own task.
    pub fn dispatch_at_table(&mut self, cx: &TableCtx, c: &Arc<Client>, msg: ClientMsg) {
        // Routed while the sender sat here; re-checked, because the seat can
        // have been given up, held or re-based since.
        if c.room_code().as_deref() != Some(self.code.as_str()) {
            return;
        }
        let gameplay = is_gameplay_msg(&msg);
        if gameplay {
            // A gameplay message only means something at a table that has
            // dealt, from a seat the deal has a hand for, past the gate.
            let Some(state) = self.room.state.as_ref() else {
                c.refuse(crate::refusal::Refusal::GameNotInProgress);
                return;
            };
            if self.room.status != Status::Playing || c.player_id() >= state.hands.len() {
                c.refuse(crate::refusal::Refusal::GameNotInProgress);
                return;
            }
            if self.is_loading() {
                c.refuse(crate::refusal::Refusal::TableLoading);
                return;
            }
        }
        // An action the server took clears the AFK count; one it refused does
        // not. Read as a before/after pair, because `Client::refuse` is the single
        // funnel every refusal goes through.
        let before = c.refusals();
        match msg {
            ClientMsg::MapReady => self.handle_map_ready(cx, c.player_id()),
            ClientMsg::StartGame => self.handle_start_game(cx, c),
            ClientMsg::AddBot => self.handle_add_bot(cx, c),
            ClientMsg::SetMatchFormat(m) => self.handle_set_match_format(c, m.match_format),
            ClientMsg::SetMaxPlayers(m) => self.handle_set_max_players(c, m.max_players),
            ClientMsg::SetStreamerMode(m) => self.handle_set_streamer_mode(c, m.streamer_mode),
            ClientMsg::KickPlayer(m) => self.handle_kick_player(cx, c, m.target_index),
            ClientMsg::TransferHost(m) => self.handle_transfer_host(c, m.target_index),
            ClientMsg::Rematch => self.handle_rematch(cx, c),
            ClientMsg::SendEmote(m) => self.handle_send_emote(c, m.emote),
            ClientMsg::PlayCard(m) => self.handle_play_card(cx, c, &m),
            ClientMsg::DrawCard => self.handle_draw_card(cx, c),
            ClientMsg::PassTurn => self.handle_pass_turn(cx, c),
            ClientMsg::DeclareUno => self.handle_declare_uno(c),
            ClientMsg::CatchUno(m) => self.handle_catch_uno(c, m.target_index),
            ClientMsg::CounterDraw(m) => self.handle_counter_draw(cx, c, &m),
            ClientMsg::InterruptPlay(m) | ClientMsg::InterruptPlayCard(m) => {
                self.handle_interrupt_play(cx, c, &m)
            }
            ClientMsg::DebugSetState(m) => self.handle_debug_set_state(cx, c, m.debug),
            _ => {}
        }
        if gameplay && c.refusals() == before {
            self.reset_afk(c.player_id());
        }
    }
}
