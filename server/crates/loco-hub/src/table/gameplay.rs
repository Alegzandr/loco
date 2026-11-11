//! Play, draw, pass, declare, catch, counter, interrupt. Every handler here
//! runs on its table's task, past
//! the gameplay gate in `dispatch.rs`.

use crate::net::client::Client;
use crate::ops::clock;
use crate::table::Table;
use crate::table::actor::TableCtx;
use crate::table::convert::dto_to_card;
use loco_game::{Card, CatchCharge, Color, ErrorKind, GameError, Kind, Millis};
use loco_protocol::{
    CardColor, CardDTO, CatchLockedMsg, CounterDrawMsg, GameStartedMsg, MatchEndMsg, RoundEndMsg,
    SeatMsg, ServerMsg,
};
use std::sync::Arc;
use std::sync::atomic::Ordering;

impl Table {
    /// The cards a play or an interject names, and the colour it names. A
    /// batch longer than the hand is refused before anything is parsed.
    fn parse_cards(
        &self,
        c: &Arc<Client>,
        card: Option<&CardDTO>,
        play_cards: &[CardDTO],
        chosen: Option<CardColor>,
    ) -> Option<(Vec<Card>, Color)> {
        if !play_cards.is_empty() {
            let hand = self.hand_size(c.player_id());
            if play_cards.len() > hand {
                // Not a domain error: a hub-level refusal, and it
                // counts towards suspicion like any refusal that is not a race.
                let text = format!("batch of {} cards exceeds the hand", play_cards.len());
                c.refuse(crate::table::refusal::Refusal::Other(text.clone()));
                c.note_suspect(&text);
                return None;
            }
            let mut chosen_color = Color::Red;
            let cards = play_cards
                .iter()
                .map(|dto| {
                    let (card, cc) = dto_to_card(dto, chosen);
                    chosen_color = cc;
                    card
                })
                .collect();
            return Some((cards, chosen_color));
        }
        let Some(dto) = card else {
            c.refuse(crate::table::refusal::Refusal::CardRequired);
            return None;
        };
        let (card, cc) = dto_to_card(dto, chosen);
        Some((vec![card], cc))
    }

    /// How many cards `seat` holds, or 0 when there is no such seat.
    pub fn hand_size(&self, seat: usize) -> usize {
        self.room
            .state
            .as_ref()
            .and_then(|s| s.hands.get(seat))
            .map_or(0, |h| h.len())
    }

    pub(crate) fn handle_play_card(
        &mut self,
        cx: &TableCtx,
        c: &Arc<Client>,
        msg: &loco_protocol::PlayCardMsg,
    ) {
        let target = msg.chosen_player.and_then(|n| usize::try_from(n).ok());
        let Some((cards, chosen_color)) =
            self.parse_cards(c, msg.card.as_ref(), &msg.play_cards, msg.chosen_color)
        else {
            return;
        };
        let seat = c.player_id();
        let now = clock::now_ms();
        let res = if cards.len() > 1 {
            self.room
                .play_cards(seat, &cards, chosen_color, target, msg.declare_loco, now)
        } else {
            self.room
                .play_card(seat, cards[0], chosen_color, target, now)
        };
        if let Err(e) = res {
            self.refuse_action(cx, c, &e);
            return;
        }
        self.announce_finishing_loco(seat, &cards);
        let cp = if cards.len() > 1 { None } else { target };
        self.broadcast_card_played(cx, seat, cp);
        if cards.len() == 1 && matches!(cards[0].kind, Kind::Swap | Kind::GlobalSwitch) {
            self.broadcast_personalized_game_state();
        }
        self.maybe_schedule_bot_reactions(cx);
        self.maybe_schedule_bot_interrupt(cx);
        self.handle_round_or_match_end(cx);
    }

    /// A batch that empties the hand carried the call: the table hears it
    /// before the card.
    pub(crate) fn announce_finishing_loco(&self, seat: usize, cards: &[Card]) {
        if cards.len() < 2 || self.hand_size(seat) != 0 || self.room.state.is_none() {
            return;
        }
        self.broadcast_all(ServerMsg::UnoDeclared(SeatMsg {
            player_index: Some(seat as i32),
            ..Default::default()
        }));
    }

    /// After every play: the next bot, or the round's end and the match's.
    pub fn handle_round_or_match_end(&mut self, cx: &TableCtx) {
        if !self.room.round_ended {
            self.maybe_schedule_bot(cx);
            return;
        }
        self.room.round_ended = false;
        let scoreboard = self.build_scoreboard();
        self.broadcast_all(ServerMsg::RoundEnd(RoundEndMsg {
            round_number: self.room.round_number as i32,
            round_winner: self.room.winner.clone(),
            scoreboard: scoreboard.clone(),
            round_history: self.room.round_history.clone(),
            ..Default::default()
        }));

        if self.room.match_over {
            cx.hub
                .metrics()
                .matches_finished
                .fetch_add(1, Ordering::Relaxed);
            tracing::info!(
                winner = %self.room.match_winner,
                round = self.room.round_number,
                of = crate::table::convert::match_format_string(self.room.format).as_str(),
                "match finished"
            );
            self.record_finished_match(clock::system_now());
            self.broadcast_all(ServerMsg::MatchEnd(MatchEndMsg {
                match_winner: self.room.match_winner.clone(),
                scoreboard,
                match_history: self.match_history_dto(),
                ..Default::default()
            }));
            return;
        }

        if let Err(e) = self.room.begin_next_round(clock::now_ms()) {
            tracing::warn!("BeginNextRound failed err={e}");
            return;
        }
        self.schedule_turn_timer(cx);
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
        self.maybe_schedule_bot(cx);
    }

    pub(crate) fn handle_draw_card(&mut self, cx: &TableCtx, c: &Arc<Client>) {
        let seat = c.player_id();
        let prior = self.hand_size(seat);
        if let Err(e) = self.room.draw_card(seat, clock::now_ms()) {
            self.refuse_action(cx, c, &e);
            return;
        }
        // A forced draw does not cost the turn: the clock re-arms on every draw.
        self.schedule_turn_timer(cx);
        let state = self.room.state.as_ref().expect("drawn");
        self.announce_cards_drawn(seat, &state.hands[seat].cards[prior..], true);
        self.maybe_schedule_bot(cx);
    }

    pub(crate) fn handle_pass_turn(&mut self, cx: &TableCtx, c: &Arc<Client>) {
        if let Err(e) = self.room.pass_turn(c.player_id(), clock::now_ms()) {
            self.refuse_action(cx, c, &e);
            return;
        }
        self.schedule_turn_timer(cx);
        self.broadcast_turn_changed();
        self.maybe_schedule_bot(cx);
    }

    pub(crate) fn handle_declare_uno(&mut self, c: &Arc<Client>) {
        let seat = c.player_id();
        if let Err(e) = self.room.declare_last_card(seat, clock::now_ms()) {
            c.note_rejection(&e);
            c.refuse(e);
            return;
        }
        self.broadcast_all(ServerMsg::UnoDeclared(SeatMsg {
            player_index: Some(seat as i32),
            ..Default::default()
        }));
    }

    /// Contre-LOCO!. Answered on the instant it arrives, and losable in both
    /// directions: a press where nothing is offered is answered by nobody and
    /// charged to nobody; a miss on an offer costs one card per offer and a
    /// two-second lockout per press.
    pub(crate) fn handle_catch_uno(&mut self, c: &Arc<Client>, target: Option<i32>) {
        let now = clock::now_ms();
        let Some(state) = self.room.state.as_ref() else {
            return;
        };
        let target_idx: Option<usize> = match target {
            Some(t) => match usize::try_from(t) {
                Ok(t) if t < state.hands.len() => Some(t),
                _ => {
                    c.refuse(GameError::NoCatchWindow);
                    c.note_rejection(&GameError::NoCatchWindow);
                    return;
                }
            },
            None => state.catchable_targets(now).first().copied(),
        };
        let catcher = c.player_id();
        if !self.room.catch_offered(catcher, now) {
            c.refuse_silently();
            return;
        }
        if self.room.catch_locked(catcher, now) {
            self.lock_catch(catcher, now);
            c.refuse_silently();
            return;
        }
        let Some(target) = target_idx else {
            if !self.penalize_failed_catch(catcher, now) {
                c.refuse_silently();
            }
            return;
        };
        let prior = self.hand_size(target);
        if let Err(e) = self.room.catch_undeclared(catcher, target, now) {
            if e.kind() == ErrorKind::MissedCatch || matches!(e, GameError::NoCatchWindow) {
                if !self.penalize_failed_catch(catcher, now) {
                    c.refuse_silently();
                }
            } else if matches!(e, GameError::CatchLocked) {
                self.lock_catch(catcher, now);
                c.refuse_silently();
            } else {
                c.note_rejection(&e);
                c.refuse(e);
            }
            return;
        }
        self.broadcast_all(ServerMsg::UnoCaught(SeatMsg {
            player_index: Some(target as i32),
            ..Default::default()
        }));
        let grown = self
            .room
            .state
            .as_ref()
            .map(|s| s.hands[target].cards[prior..].to_vec())
            .unwrap_or_default();
        self.send_hand_growth(target, &grown);
    }

    /// Charges a miss, once per offer, and arms the lockout. Returns whether a
    /// card was charged and shown to the table.
    pub(crate) fn penalize_failed_catch(&mut self, catcher: usize, now: Millis) -> bool {
        if !self.room.catch_offered(catcher, now) {
            return false;
        }
        let shown =
            if let CatchCharge::Charged { drawn } = self.room.penalize_failed_catch(catcher, now) {
                let msg = ServerMsg::CatchFailed(SeatMsg {
                    player_index: Some(catcher as i32),
                    ..Default::default()
                });
                if drawn.is_empty() {
                    // Charged and drew nothing: the table has nothing to see.
                    if let Some(c) = self.client(catcher) {
                        c.send(msg);
                    }
                    false
                } else {
                    self.broadcast_all(msg);
                    self.send_hand_growth(catcher, &drawn);
                    true
                }
            } else {
                false
            };
        self.lock_catch(catcher, now);
        shown
    }

    /// Arms the lockout and tells the caller, and nobody else, until when.
    pub(crate) fn lock_catch(&mut self, catcher: usize, now: Millis) {
        let Some(until) = self.room.lock_catch(catcher, now) else {
            return;
        };
        if let Some(c) = self.client(catcher) {
            c.send(ServerMsg::CatchLocked(CatchLockedMsg {
                catch_locked_until: until,
                ..Default::default()
            }));
        }
    }

    pub(crate) fn handle_counter_draw(
        &mut self,
        cx: &TableCtx,
        c: &Arc<Client>,
        msg: &CounterDrawMsg,
    ) {
        let Some(dto) = msg.card.as_ref() else {
            c.refuse(crate::table::refusal::Refusal::CardRequired);
            return;
        };
        let (card, chosen) = dto_to_card(dto, msg.chosen_color);
        let seat = c.player_id();
        if let Err(e) = self.room.counter_draw(seat, card, chosen, clock::now_ms()) {
            self.refuse_action(cx, c, &e);
            return;
        }
        self.broadcast_card_played(cx, seat, None);
        self.maybe_schedule_bot_reactions(cx);
        self.maybe_schedule_bot_interrupt(cx);
        self.handle_round_or_match_end(cx);
    }

    pub(crate) fn handle_interrupt_play(
        &mut self,
        cx: &TableCtx,
        c: &Arc<Client>,
        msg: &loco_protocol::InterruptPlayMsg,
    ) {
        let target = msg.chosen_player.and_then(|n| usize::try_from(n).ok());
        let Some((cards, chosen_color)) =
            self.parse_cards(c, msg.card.as_ref(), &msg.play_cards, msg.chosen_color)
        else {
            return;
        };
        let seat = c.player_id();
        if let Err(e) =
            self.room
                .interrupt_play(seat, &cards, chosen_color, target, clock::now_ms())
        {
            self.refuse_action(cx, c, &e);
            return;
        }
        self.broadcast_interrupt(cx, seat, &cards, target);
        self.maybe_schedule_bot_reactions(cx);
        self.maybe_schedule_bot_interrupt(cx);
        self.handle_round_or_match_end(cx);
    }
}
