//! `debug_set_state`: the fixture the Playwright suite deals a table with.
//! Port of `server/hub/debug.go`. Answered only with `LOCO_E2E=1`, which must
//! never be set in production (`debug_mode_active` on `/metrics` says so).

use crate::actor::TableCtx;
use crate::client::Client;
use crate::convert::{color_of, kind_of};
use crate::table::Table;
use loco_game::{Card, Color, Hand, Status};
use loco_protocol::{CardDTO, DebugStateDTO, GameStateMsg, ServerMsg};
use std::sync::Arc;

fn hand_of(cards: &[CardDTO]) -> Hand {
    let mut h = Hand::default();
    let cards: Vec<Card> = cards
        .iter()
        .map(|d| Card {
            color: color_of(d.color),
            kind: kind_of(d.kind),
            value: d.value,
        })
        .collect();
    h.add(&cards);
    h
}

impl Table {
    pub(crate) fn handle_debug_set_state(
        &mut self,
        cx: &TableCtx,
        c: &Arc<Client>,
        d: Option<DebugStateDTO>,
    ) {
        if !cx.hub.config().debug_mode {
            c.refuse(crate::refusal::Refusal::DebugDisabled);
            return;
        }
        if self.room.status != Status::Playing {
            c.refuse(crate::refusal::Refusal::DebugNeedsActiveGame);
            return;
        }
        let d = d.unwrap_or_default();
        let seat = c.player_id();
        let Some(state) = self.room.state.as_mut() else {
            c.refuse(crate::refusal::Refusal::DebugNeedsActiveGame);
            return;
        };
        if !d.hand.is_empty() && seat < state.hands.len() {
            state.hands[seat] = hand_of(&d.hand);
        }
        for o in &d.hands {
            if o.player_index < 0 || o.player_index as usize >= state.hands.len() {
                c.refuse(crate::refusal::Refusal::Other(format!(
                    "debug.hands: invalid player_index {}",
                    o.player_index
                )));
                return;
            }
            state.hands[o.player_index as usize] = hand_of(&o.hand);
        }
        if let Some(top) = d.discard.as_ref() {
            let card = Card {
                color: color_of(top.color),
                kind: kind_of(top.kind),
                value: top.value,
            };
            match state.discard.last_mut() {
                Some(last) => *last = card,
                None => state.discard = vec![card],
            }
            if let Some(active) = d.active_color {
                state.active_color = color_of(active);
            } else if card.color != Color::Wild {
                state.active_color = card.color;
            }
        }
        if let Some(p) = d.pending_draw {
            state.pending_draw = p;
        }
        if let Some(dir) = d.direction {
            if dir != 1 && dir != -1 {
                c.refuse(crate::refusal::Refusal::Other(format!(
                    "debug.direction: must be 1 or -1, got {dir}"
                )));
                return;
            }
            state.direction = dir;
        }
        if let Some(turn) = d.current_turn {
            if turn < 0 || turn as usize >= state.hands.len() {
                c.refuse(crate::refusal::Refusal::Other(format!(
                    "debug.current_turn: invalid index {turn}"
                )));
                return;
            }
            state.current_turn = turn;
            state.has_drawn = false;
        }
        let pl = self.player_list();
        let shared = self.shared_game_state();
        for (i, m) in self.clients() {
            {
                m.send(ServerMsg::GameState(GameStateMsg {
                    state: Some(self.player_game_state_with(i, pl.clone(), &shared)),
                    ..Default::default()
                }));
            }
        }
    }
}
