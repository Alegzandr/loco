//! A rematch by agreement: an ask, not a decision, in every room. Port of
//! `server/hub/rematch.go`.
//!
//! Every ask is broadcast with the whole offer state and the quorum; two asks
//! deal the next match at any size (bots are not asked), and nobody is
//! dropped by that. The reopened table is hosted by somebody who asked.

use crate::actor::TableCtx;
use crate::client::Client;
use crate::convert::match_format_string;
use crate::table::Table;
use loco_game::Status;
use loco_protocol::{RematchOfferedMsg, RematchStartedMsg, ServerMsg};
use std::collections::BTreeSet;
use std::sync::Arc;

/// Two asks deal the next match, whatever the table's size.
pub const REMATCH_QUORUM: usize = 2;

impl Table {
    pub(crate) fn handle_rematch(&mut self, cx: &TableCtx, c: &Arc<Client>) {
        if cx.hub.draining() {
            c.send_error(crate::DRAIN_REFUSAL);
            return;
        }
        if self.room.status != Status::Finished {
            c.send_error("rematch is only available once the match is over");
            return;
        }
        if self.solo {
            c.send_error("not available in this game");
            return;
        }
        if self.is_matchmade() && (self.room.players.len() < 2 || self.connected() < 2) {
            c.send_error("your opponent has left the table");
            return;
        }
        let seat = c.player_id();
        // A repeat publishes nothing.
        if !self.rematch_offers.insert(seat) {
            return;
        }
        self.broadcast_rematch_offers(Some(seat as i32));
        if self.rematch_offers.len() < self.rematch_quorum() {
            return;
        }
        self.deal_agreed_rematch(cx);
    }

    /// How many asks deal: two, or everybody present when fewer are.
    pub fn rematch_quorum(&self) -> usize {
        self.connected().clamp(1, REMATCH_QUORUM)
    }

    pub(crate) fn broadcast_rematch_offers(&self, seat: Option<i32>) {
        let offers: Vec<i32> = self.rematch_offers.iter().map(|&s| s as i32).collect();
        self.broadcast_all(ServerMsg::RematchOffered(RematchOfferedMsg {
            player_index: seat,
            rematch_offers: Some(offers),
            rematch_needed: self.rematch_quorum() as i32,
            ..Default::default()
        }));
    }

    fn deal_agreed_rematch(&mut self, cx: &TableCtx) {
        if self.is_matchmade() {
            self.start_rematched_match(cx);
            return;
        }
        self.open_rematched_lobby(cx);
    }

    fn open_rematched_lobby(&mut self, cx: &TableCtx) {
        let askers = self.rematch_askers();
        self.prune_absent_players();
        if let Err(e) = self.room.reset_for_rematch() {
            tracing::warn!("rematch reset failed err={e}");
            return;
        }
        self.promote_rematch_host(&askers);
        self.keep_host_human(cx);
        self.reset_for_next_match();
        tracing::info!(
            players = self.room.players.len(),
            format = match_format_string(self.room.format).as_str(),
            "rematch opened"
        );
        let pl = self.player_list();
        for m in self.members.iter().flatten() {
            m.send(ServerMsg::RematchStarted(RematchStartedMsg {
                room_code: self.code.clone(),
                player_id: Some(m.player_id() as i32),
                players: pl.clone(),
                match_format: Some(match_format_string(self.room.format)),
                max_players: self.room.max_players,
                ..Default::default()
            }));
        }
    }

    /// The sockets that asked, in seat order.
    fn rematch_askers(&self) -> Vec<Arc<Client>> {
        self.rematch_offers
            .iter()
            .filter_map(|&s| self.client(s).cloned())
            .collect()
    }

    /// Hands seat 0 to the first asker unless the host is one of them.
    fn promote_rematch_host(&mut self, askers: &[Arc<Client>]) {
        if self.room.players.is_empty() {
            return;
        }
        if let Some(host) = self.client(0)
            && !self.is_bot(0)
            && askers.iter().any(|c| Arc::ptr_eq(c, host))
        {
            return;
        }
        for c in askers {
            let seat = c.player_id();
            if seat == 0 || seat >= self.room.players.len() || self.is_bot(seat) {
                continue;
            }
            let nickname = self.room.players[seat].nickname.clone();
            if let Err(e) = self.room.swap_lobby_players(0, seat as i32) {
                tracing::warn!(seat, "rematch host promotion failed err={e}");
                return;
            }
            self.swap_seats(0, seat);
            tracing::info!(seat, nickname = %nickname, "rematch host promoted");
            return;
        }
    }

    /// A departure re-bases the asks above it, and may complete the quorum.
    pub(crate) fn release_rematch_offer(&mut self, cx: &TableCtx, seat: usize) {
        if self.rematch_offers.is_empty() {
            return;
        }
        self.rematch_offers = self
            .rematch_offers
            .iter()
            .filter(|&&s| s != seat)
            .map(|&s| if s > seat { s - 1 } else { s })
            .collect::<BTreeSet<_>>();
        if self.room.status != Status::Finished || self.is_matchmade() {
            self.rematch_offers.clear();
            return;
        }
        self.after_offer_change(cx);
    }

    /// A seat going away (held, not removed) retires its ask.
    pub(crate) fn retire_rematch_offer(&mut self, cx: &TableCtx, seat: usize) {
        if self.rematch_offers.is_empty() {
            return;
        }
        self.rematch_offers.remove(&seat);
        if self.room.status != Status::Finished || self.is_matchmade() {
            return;
        }
        self.after_offer_change(cx);
    }

    fn after_offer_change(&mut self, cx: &TableCtx) {
        self.broadcast_rematch_offers(None);
        let n = self.rematch_offers.len();
        if n > 0 && n >= self.rematch_quorum() {
            self.deal_agreed_rematch(cx);
        }
    }

    /// Drops every human seat with nobody in it before a rematch deals.
    fn prune_absent_players(&mut self) {
        for id in (0..self.members.len()).rev() {
            if self.members[id].is_some() || self.is_bot(id) {
                continue;
            }
            if let Err(e) = self.room.remove_lobby_player(id as i32) {
                tracing::warn!(player = id, "prune failed err={e}");
                continue;
            }
            self.drop_seat(id);
            tracing::info!(player = id, "pruned absent player");
        }
    }
}
