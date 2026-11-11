//! Sending: the fan-out, `send_hand_growth`, `refuse_action`, the
//! personalised state. Port of `server/hub/broadcast.go`.

use crate::net::client::Client;
use crate::net::wire::Outgoing;
use crate::ops::clock;
use crate::table::Table;
use crate::table::actor::TableCtx;
use crate::table::convert::{card_dtos, card_to_dto, color_name};
use crate::table::statedto::catch_seats;
use axum::extract::ws::Utf8Bytes;
use loco_game::{Card, ErrorKind, GameError, Kind, Seat};
use loco_protocol::{CardDrawnMsg, CardPlayedMsg, GameStateMsg, ServerMsg, TurnChangedMsg};
use std::sync::Arc;

impl Table {
    /// Marshals once and sends the same bytes to every seated socket but
    /// `exclude`. Every message carries `server_now`, stamped here.
    pub fn broadcast(&self, mut msg: ServerMsg, exclude: Option<&Arc<Client>>) {
        if self.all_seats_empty() {
            return;
        }
        msg.stamp_now(clock::now_ms());
        let s = match serde_json::to_string(&msg) {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!("broadcast marshal error err={e}");
                return;
            }
        };
        let bytes = Utf8Bytes::from(s);
        for (_, c) in self.clients() {
            if exclude.is_some_and(|x| Arc::ptr_eq(x, c)) {
                continue;
            }
            c.send_bytes(bytes.clone());
        }
    }

    pub fn broadcast_all(&self, msg: ServerMsg) {
        self.broadcast(msg, None);
    }

    /// Every path that grows a hand goes through here: the player gets the
    /// cards, everyone else the count. A penalty that drew nothing announces
    /// nothing.
    pub fn send_hand_growth(&self, seat: usize, new_cards: &[Card]) {
        if new_cards.is_empty() {
            return;
        }
        self.announce_cards_drawn(seat, new_cards, true);
    }

    /// The one builder of `card_drawn`, so the cards themselves can only ever
    /// reach the seat that drew them. A draw is announced even when the piles
    /// gave nothing (the seat has still drawn, and keeps the turn), which is
    /// why it calls this directly rather than `send_hand_growth`.
    /// `with_deadline` is false for a bot's own draw, whose announcement has
    /// never carried the turn clock.
    pub(crate) fn announce_cards_drawn(
        &self,
        seat: usize,
        new_cards: &[Card],
        with_deadline: bool,
    ) {
        let Some(state) = self.room.state.as_ref() else {
            return;
        };
        let dl = if with_deadline {
            self.turn_deadline_ms()
        } else {
            0
        };
        let base = CardDrawnMsg {
            player_index: Some(seat as i32),
            turn: state.current_turn as i32,
            pending_draw: Some(state.pending_draw as i32),
            has_drawn: Some(state.has_drawn),
            turn_deadline: dl,
            interrupt_open: Some(state.interrupt_open),
            ..Default::default()
        };
        let client = self.client(seat).cloned();
        if let Some(c) = &client {
            c.send(ServerMsg::CardDrawn(CardDrawnMsg {
                cards: card_dtos(new_cards),
                ..base.clone()
            }));
        }
        self.broadcast(
            ServerMsg::CardDrawn(CardDrawnMsg {
                drawn_count: new_cards.len() as i32,
                ..base
            }),
            client.as_ref(),
        );
    }

    /// The turn moved without a card: a pass, a timeout, a bot giving up.
    pub fn broadcast_turn_changed(&self) {
        let Some(state) = self.room.state.as_ref() else {
            return;
        };
        self.broadcast_all(ServerMsg::TurnChanged(TurnChangedMsg {
            turn: state.current_turn as i32,
            turn_deadline: self.turn_deadline_ms(),
            interrupt_open: Some(state.interrupt_open),
            ..Default::default()
        }));
    }

    /// Answers a refused action. A refusal that can only mean the client's
    /// state has drifted carries the correction with it, throttled to one per
    /// socket per `resync_period`; a lost race does not.
    pub fn refuse_action(&self, cx: &TableCtx, c: &Arc<Client>, err: &GameError) {
        c.refuse(err.clone());
        c.note_rejection(err);
        if err.kind() != ErrorKind::StaleState {
            return;
        }
        if !c.claim_resync(cx.hub.config().timings.resync_period) {
            return;
        }
        let seat = c.player_id();
        tracing::info!(conn = %c.conn_id, player = seat, reason = %err, "state resync");
        c.send(ServerMsg::GameState(GameStateMsg {
            state: Some(self.player_game_state_using(seat, self.player_list())),
            ..Default::default()
        }));
    }

    /// A game_state to every seat, each its own: after a Swap or a Global
    /// Switch moved hands about. The player list and the shared half are
    /// built once.
    pub fn broadcast_personalized_game_state(&self) {
        let pl = self.player_list();
        let shared = self.shared_game_state();
        for (seat, m) in self.clients() {
            {
                m.send(ServerMsg::GameState(GameStateMsg {
                    state: Some(self.player_game_state_with(seat, pl.clone(), &shared)),
                    ..Default::default()
                }));
            }
        }
    }

    /// The card that just landed, the turn it leaves, and who is on the hook.
    pub fn broadcast_card_played(&mut self, cx: &TableCtx, seat: usize, target: Option<Seat>) {
        if !self.room.round_ended {
            self.schedule_turn_timer(cx);
        }
        let Some(state) = self.room.state.as_ref() else {
            return;
        };
        let Some(&top) = state.discard.last() else {
            return;
        };
        let msg = CardPlayedMsg {
            player_index: Some(seat as i32),
            card: Some(card_to_dto(top)),
            active_color: Some(color_name(state.active_color)),
            chosen_player: target.filter(|_| top.kind == Kind::Swap).map(|t| t as i32),
            turn: state.current_turn as i32,
            direction: state.direction,
            pending_draw: Some(state.pending_draw as i32),
            has_drawn: Some(state.has_drawn),
            players: self.player_list(),
            turn_deadline: self.turn_deadline_ms(),
            catch_seats: catch_seats(state),
            interrupt_open: Some(state.interrupt_open),
            ..Default::default()
        };
        self.broadcast_all(ServerMsg::CardPlayed(msg));
    }
}
