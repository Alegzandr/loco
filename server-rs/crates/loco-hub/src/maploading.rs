//! The map-loading gate: the table is shut between `game_started` and the
//! moment every client has the room decoded. Port of
//! `server/hub/maploading.go`.
//!
//! The turn clock and the bots are not armed until it opens: a clock that
//! starts while somebody's table is still a grey rectangle is a head start in a
//! game decided by arrival order. Per match, not per round.

use crate::actor::{DeadlineKey, TableCtx};
use crate::clock;
use crate::table::{MapLoadState, Table};
use loco_game::Status;
use loco_protocol::{ClientMsg, MatchLoadingMsg, MatchReadyMsg, ServerMsg};
use std::collections::BTreeSet;
use tokio::time::Instant;

const MAP_LOAD: DeadlineKey = DeadlineKey::table("map_load_timeout");

/// The messages the gate (and the not-playing gate) refuse.
pub fn is_gameplay_msg(m: &ClientMsg) -> bool {
    matches!(
        m,
        ClientMsg::PlayCard(_)
            | ClientMsg::DrawCard
            | ClientMsg::PassTurn
            | ClientMsg::DeclareUno
            | ClientMsg::CatchUno(_)
            | ClientMsg::CounterDraw(_)
            | ClientMsg::InterruptPlay(_)
            | ClientMsg::InterruptPlayCard(_)
    )
}

impl Table {
    /// Shuts the table until every seated client has loaded the map. Bots are
    /// ready by definition.
    pub fn begin_map_loading(&mut self, cx: &TableCtx) {
        let started_at = Instant::now();
        self.loading = Some(MapLoadState {
            ready: self.bot_seats().into_iter().collect::<BTreeSet<_>>(),
            started_at,
        });
        tracing::info!(
            map = %self.room.map_id.map(|m| m.as_str()).unwrap_or(""),
            waiting = self.pending_loaders().len(),
            "map loading"
        );
        self.broadcast_loading_progress();
        let timeout = self.timings.map_load_timeout;
        self.deadlines
            .arm(MAP_LOAD, started_at + timeout, move |t, cx| {
                t.handle_map_load_timeout(cx, started_at)
            });
        self.maybe_open_table(cx);
    }

    /// The seated clients the gate is still waiting on.
    pub fn pending_loaders(&self) -> Vec<usize> {
        let Some(st) = self.loading.as_ref() else {
            return Vec::new();
        };
        self.clients()
            .map(|(seat, _)| seat)
            .filter(|seat| !st.ready.contains(seat))
            .collect()
    }

    /// The seats that have answered, sorted.
    pub fn ready_seats(&self) -> Vec<i32> {
        self.loading
            .as_ref()
            .map(|st| st.ready.iter().map(|&s| s as i32).collect())
            .unwrap_or_default()
    }

    pub fn broadcast_loading_progress(&self) {
        self.broadcast_all(ServerMsg::MatchLoading(MatchLoadingMsg {
            players_ready: self.ready_seats(),
            ..Default::default()
        }));
    }

    pub(crate) fn handle_map_ready(&mut self, cx: &TableCtx, seat: usize) {
        let Some(st) = self.loading.as_mut() else {
            return;
        };
        if !st.ready.insert(seat) {
            return;
        }
        self.broadcast_loading_progress();
        self.maybe_open_table(cx);
    }

    pub fn maybe_open_table(&mut self, cx: &TableCtx) {
        if self.loading.is_none() || !self.pending_loaders().is_empty() {
            return;
        }
        self.open_gate(cx, "all_ready");
    }

    fn open_gate(&mut self, cx: &TableCtx, reason: &str) {
        let Some(st) = self.loading.take() else {
            return;
        };
        self.deadlines.disarm(MAP_LOAD);
        if self.room.status != Status::Playing {
            return;
        }
        tracing::info!(
            map = %self.room.map_id.map(|m| m.as_str()).unwrap_or(""),
            reason,
            waited_ms = st.started_at.elapsed().as_millis() as u64,
            "table opened"
        );
        // The gate is a wait, not the game: the match's duration starts here.
        self.match_started_at = Some(clock::system_now());
        self.schedule_turn_timer(cx);
        let Some(state) = self.room.state.as_ref() else {
            return;
        };
        self.broadcast_all(ServerMsg::MatchReady(MatchReadyMsg {
            turn: state.current_turn,
            turn_deadline: self.turn_deadline_ms(),
            interrupt_open: Some(state.interrupt_open),
            ..Default::default()
        }));
        self.maybe_schedule_bot(cx);
    }

    fn handle_map_load_timeout(&mut self, cx: &TableCtx, started_at: Instant) {
        let Some(st) = self.loading.as_ref() else {
            return;
        };
        if st.started_at != started_at {
            return; // this timer belongs to a previous gate
        }
        tracing::warn!(waiting_on = ?self.pending_loaders(), "map load timeout");
        self.open_gate(cx, "timeout");
    }
}
