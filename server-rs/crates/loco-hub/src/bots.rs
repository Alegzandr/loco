//! Every bot delay and every bot decision's scheduling. Port of
//! `server/hub/bots.go`.
//!
//! The decisions are the domain's (`loco_game::bot_think`, `bot_interrupt`);
//! this file decides *when*, through the same domain calls and broadcasts a
//! human's message goes through. Every delay but think and jitter is a
//! reaction window somebody is meant to be able to win.

use crate::actor::{DeadlineKey, TableCtx};
use crate::clock;
use crate::config::BotTimings;
use crate::convert::card_dtos;
use crate::table::Table;
use loco_game::{
    BotAction, BotActionKind, BotInterruptAction, GameState, Kind, Millis, Room, Status,
};
use loco_protocol::{CardDrawnMsg, InterruptSuccessMsg, PlayerJoinedMsg, SeatMsg, ServerMsg};
use std::sync::atomic::Ordering;
use std::time::Duration;

const SALT_UNO: u64 = 1;
const SALT_FINISH: u64 = 2;

fn fnv1a64(b: &[u8]) -> u64 {
    let mut sum: u64 = 14695981039346656037;
    for &c in b {
        sum ^= u64::from(c);
        sum = sum.wrapping_mul(1099511628211);
    }
    sum
}

fn nanos(ms: Millis) -> u64 {
    (ms as u64).wrapping_mul(1_000_000)
}

/// A delay drawn from the moment and the seat, not from a random source: the
/// same moment always yields the same instant, which is what lets a fire and
/// a re-arm agree without remembering anything.
fn moment_jitter(seat: usize, at: Millis, salt: u64, max: Duration) -> Duration {
    let ms = max.as_millis() as u64;
    if ms == 0 {
        return Duration::ZERO;
    }
    let mut buf = [0u8; 24];
    buf[0..8].copy_from_slice(&nanos(at).to_le_bytes());
    buf[8..16].copy_from_slice(&(seat as u64).to_le_bytes());
    buf[16..24].copy_from_slice(&salt.to_le_bytes());
    Duration::from_millis((fnv1a64(&buf) >> 1) % (ms + 1))
}

fn add(at: Millis, d: Duration) -> Millis {
    at + d.as_millis() as i64
}

/// The one instant a bot declares in a given one-card window.
pub fn bot_uno_at(b: &BotTimings, seat: usize, window_at: Millis) -> Millis {
    add(
        window_at,
        b.uno_delay + moment_jitter(seat, window_at, SALT_UNO, b.uno_jitter_max),
    )
}

/// Whether `action` would take the round for `seat`.
pub fn bot_finishes(state: &GameState, seat: usize, action: &BotAction) -> bool {
    let size = state.hands[seat].size();
    match action.kind {
        BotActionKind::Play if action.cards.len() > 1 => action.cards.len() == size,
        BotActionKind::Play | BotActionKind::Counter => size == 1,
        BotActionKind::Draw => false,
    }
}

/// When a finishing move becomes due: `finish_delay` after it became possible,
/// and never before the bot's own declaration while its last card is
/// undeclared, or the call it makes on the way out shuts the window early.
pub fn bot_finish_due(b: &BotTimings, state: &GameState, seat: usize, since: Millis) -> Millis {
    let mut due = add(
        since,
        b.finish_delay + moment_jitter(seat, since, SALT_FINISH, b.finish_jitter_max),
    );
    if state.hands[seat].size() == 1
        && !state.last_card_declared[seat]
        && let Some(window_at) = state.last_card_at[seat]
    {
        due = due.max(bot_uno_at(b, seat, window_at));
    }
    due
}

/// Whether a bot tries to catch in this window, and how late: one attempt per
/// window, derived from the seat and the window, however many bots sit there.
pub fn bot_catch_attempt(b: &BotTimings, seat: usize, window_at: Millis) -> (Duration, bool) {
    let mut buf = [0u8; 16];
    buf[0..8].copy_from_slice(&nanos(window_at).to_le_bytes());
    buf[8..16].copy_from_slice(&(seat as u64).to_le_bytes());
    let sum = fnv1a64(&buf);
    let mut delay = b.catch_delay;
    let jm = b.catch_jitter_max.as_millis() as u64;
    if jm > 0 {
        delay += Duration::from_millis((sum >> 32) % (jm + 1));
    }
    let threshold = (f64::from(b.catch_prob) * (1u64 << 32) as f64) as u64;
    (delay, u64::from(sum as u32) < threshold)
}

/// `Bot1`, `Bot2`… the first free one.
pub fn next_bot_name(room: &Room) -> String {
    (1..)
        .map(|n| format!("Bot{n}"))
        .find(|name| room.players.iter().all(|p| &p.nickname != name))
        .expect("an unbounded range")
}

fn random_below(n: u64) -> u64 {
    if n == 0 { 0 } else { rand::random_range(0..n) }
}

/// What the bot's next move is armed with.
#[derive(Clone, Copy, Debug)]
pub(crate) struct BotMove {
    seat: usize,
    /// When the turn came to this seat: a held finish keeps it, so its instant
    /// does not slide each time it is asked.
    armed_at: Millis,
    /// The pile a held finish was held against; a card landing meanwhile
    /// re-armed the seat, and this one is stale.
    board_at: Option<Option<Millis>>,
}

impl Table {
    pub(crate) fn handle_add_bot(&mut self, cx: &TableCtx, c: &crate::Client) {
        if self.refuse_without_host(c) {
            return;
        }
        if c.player_id() != 0 {
            c.send_error("only the room owner can add bots");
            return;
        }
        if self.room.status != Status::Lobby {
            c.send_error("can only add bots in the lobby");
            return;
        }
        let nickname = next_bot_name(&self.room);
        if let Err(e) = self.room.join(&nickname) {
            c.send_error(&e.to_string());
            return;
        }
        let bot = self.room.players.len() - 1;
        self.bots.insert(bot);
        cx.hub.metrics().bots_active.fetch_add(1, Ordering::Relaxed);
        self.add_empty_seat();
        self.broadcast_all(ServerMsg::PlayerJoined(PlayerJoinedMsg {
            nickname,
            players: self.player_list(),
            ..Default::default()
        }));
    }

    /// The host is seat 0, so a bot never sits there: while anybody is seated
    /// and seat 0 is a bot, that bot is moved to the end of the roster.
    pub fn keep_host_human(&mut self, cx: &TableCtx) {
        if self.room.status != Status::Lobby {
            return;
        }
        while self.connected() > 0 && !self.room.players.is_empty() && self.is_bot(0) {
            let name = self.room.players[0].nickname.clone();
            if let Err(e) = self.room.remove_lobby_player(0) {
                tracing::warn!(code = %self.code, "host promotion failed err={e}");
                return;
            }
            self.drop_seat(0);
            if let Err(e) = self.room.join(&name) {
                cx.hub.metrics().bots_active.fetch_sub(1, Ordering::Relaxed);
                tracing::warn!(code = %self.code, nickname = %name, "bot reseat failed err={e}");
                return;
            }
            self.bots.insert(self.room.players.len() - 1);
            self.add_empty_seat();
        }
    }

    fn schedule_bot_move(&mut self, seat: usize) {
        let b = &self.timings.bots;
        let jitter = Duration::from_millis(random_below(b.jitter_max.as_millis() as u64));
        let wait = b.think + jitter;
        let bm = BotMove {
            seat,
            armed_at: clock::now_ms(),
            board_at: None,
        };
        self.post_bot_move_after(bm, wait);
    }

    fn post_bot_move_after(&mut self, bm: BotMove, wait: Duration) {
        let at = tokio::time::Instant::now() + wait;
        self.deadlines
            .arm(DeadlineKey::seat("bot_move", bm.seat), at, move |t, cx| {
                t.execute_bot_move(cx, bm)
            });
    }

    /// Arms the bot whose turn it is, if it is a bot's.
    pub fn maybe_schedule_bot(&mut self, _cx: &TableCtx) {
        if self.room.status != Status::Playing || self.is_loading() {
            return;
        }
        let Some(turn) = self.room.state.as_ref().map(|s| s.current_turn) else {
            return;
        };
        if turn >= 0 && self.is_bot(turn as usize) {
            self.schedule_bot_move(turn as usize);
        }
    }

    fn schedule_bot_uno_announce(&mut self, seat: usize, last_card_time: Millis) {
        let at = clock::instant_of(bot_uno_at(&self.timings.bots, seat, last_card_time));
        self.deadlines
            .arm(DeadlineKey::seat("bot_uno", seat), at, move |t, _cx| {
                t.handle_uno_announce(seat, last_card_time)
            });
    }

    fn handle_uno_announce(&mut self, seat: usize, last_card_time: Millis) {
        if self.room.status != Status::Playing {
            return;
        }
        let Some(state) = self.room.state.as_ref() else {
            return;
        };
        if seat >= state.hands.len() || state.last_card_at[seat] != Some(last_card_time) {
            return; // pruned, or a different one-card moment
        }
        if self
            .room
            .declare_last_card(seat as i32, clock::now_ms())
            .is_err()
        {
            return; // caught, or no longer on one card
        }
        self.broadcast_all(ServerMsg::UnoDeclared(SeatMsg {
            player_index: Some(seat as i32),
            ..Default::default()
        }));
    }

    /// A bot about to play its last card makes the call first, like a player.
    fn bot_declare_before_finish(&mut self, seat: usize) {
        let Some(state) = self.room.state.as_ref() else {
            return;
        };
        if seat >= state.hands.len()
            || state.hands[seat].size() != 1
            || state.last_card_declared[seat]
        {
            return;
        }
        if self
            .room
            .declare_last_card(seat as i32, clock::now_ms())
            .is_err()
        {
            return;
        }
        self.broadcast_all(ServerMsg::UnoDeclared(SeatMsg {
            player_index: Some(seat as i32),
            ..Default::default()
        }));
    }

    fn schedule_bot_catch(&mut self, target: usize) {
        if !self.bots.iter().any(|&b| b != target) {
            return;
        }
        let Some(state) = self.room.state.as_ref() else {
            return;
        };
        let Some(window_at) = state.last_card_at[target] else {
            return;
        };
        let (delay, attempt) = bot_catch_attempt(&self.timings.bots, target, window_at);
        if !attempt {
            return;
        }
        let fire_at = add(window_at, delay);
        let Some(end) = state.catch_window_end(target as i32) else {
            return;
        };
        if fire_at >= end {
            return; // past the deadline: a call nobody could win
        }
        self.deadlines.arm(
            DeadlineKey::seat("bot_catch", target),
            clock::instant_of(fire_at),
            move |t, cx| t.handle_bot_catch(cx, target, window_at),
        );
    }

    /// After every play, a bot holding a copy of the top card may slam it.
    pub fn maybe_schedule_bot_interrupt(&mut self, _cx: &TableCtx) {
        if self.room.status != Status::Playing || self.room.round_ended || self.bots.is_empty() {
            return;
        }
        let Some(state) = self.room.state.as_ref() else {
            return;
        };
        if state.last_play_by < 0 {
            return;
        }
        let b = &self.timings.bots;
        let jitter = Duration::from_millis(random_below(b.interrupt_jitter_max.as_millis() as u64));
        let at = tokio::time::Instant::now() + b.interrupt_delay + jitter;
        let last_play_at = state.last_play_at;
        self.deadlines
            .arm(DeadlineKey::table("bot_interrupt"), at, move |t, cx| {
                t.handle_bot_interrupt(cx, last_play_at, None)
            });
    }

    fn handle_bot_interrupt(
        &mut self,
        cx: &TableCtx,
        last_play_at: Option<Millis>,
        committed: Option<usize>,
    ) {
        if self.room.status != Status::Playing || self.room.round_ended {
            return;
        }
        let Some(state) = self.room.state.as_ref() else {
            return;
        };
        if state.last_play_at != last_play_at || self.bots.is_empty() {
            return;
        }
        if let Some(seat) = committed {
            if !self.is_bot(seat) {
                return;
            }
            let Some(action) = loco_game::bot_interrupt(state, seat as i32) else {
                return;
            };
            if state.hands[seat].size() != 1 {
                return;
            }
            self.bot_interject(cx, seat, action);
            return;
        }
        if rand::random::<f32>() >= self.timings.bots.interrupt_prob {
            return;
        }
        let candidates: Vec<(usize, BotInterruptAction)> = self
            .bots
            .iter()
            .filter(|&&b| b as i32 != state.last_play_by)
            .filter_map(|&b| loco_game::bot_interrupt(state, b as i32).map(|a| (b, a)))
            .collect();
        if candidates.is_empty() {
            return;
        }
        let (seat, action) = candidates[random_below(candidates.len() as u64) as usize].clone();
        if state.hands[seat].size() == 1 {
            let since = last_play_at.unwrap_or_else(clock::now_ms);
            let due = bot_finish_due(&self.timings.bots, state, seat, since);
            if clock::now_ms() < due {
                self.deadlines.arm(
                    DeadlineKey::table("bot_interrupt_held"),
                    clock::instant_of(due),
                    move |t, cx| t.handle_bot_interrupt(cx, last_play_at, Some(seat)),
                );
                return;
            }
        }
        self.bot_interject(cx, seat, action);
    }

    fn bot_interject(&mut self, cx: &TableCtx, seat: usize, action: BotInterruptAction) {
        self.bot_declare_before_finish(seat);
        if let Err(e) = self.room.interrupt_play_cards(
            seat as i32,
            &action.cards,
            action.chosen_color,
            action.chosen_player,
            clock::now_ms(),
        ) {
            tracing::info!(code = %self.code, player = seat, "bot interrupt refused err={e}");
            return;
        }
        self.broadcast_interrupt(cx, seat, &action.cards, action.chosen_player);
        self.maybe_schedule_bot_reactions(cx);
        self.handle_round_or_match_end(cx);
    }

    /// Interrupt success, then the card as played, then the hands a Swap or a
    /// Global Switch moved.
    pub fn broadcast_interrupt(
        &mut self,
        cx: &TableCtx,
        seat: usize,
        cards: &[loco_game::Card],
        chosen_player: i32,
    ) {
        self.broadcast_all(ServerMsg::InterruptSuccess(InterruptSuccessMsg {
            player_index: Some(seat as i32),
            cards: card_dtos(cards),
            ..Default::default()
        }));
        self.broadcast_card_played(cx, seat, chosen_player);
        if cards.len() == 1 && matches!(cards[0].kind, Kind::Swap | Kind::GlobalSwitch) {
            self.broadcast_personalized_game_state();
        }
    }

    fn handle_bot_catch(&mut self, _cx: &TableCtx, target: usize, last_card_time: Millis) {
        if self.room.status != Status::Playing {
            return;
        }
        let now = clock::now_ms();
        let Some(state) = self.room.state.as_ref() else {
            return;
        };
        if target >= state.hands.len()
            || state.last_card_at[target] != Some(last_card_time)
            || state.last_card_declared[target]
            || state.hands[target].size() != 1
            || state
                .catch_window_end(target as i32)
                .is_none_or(|end| now >= end)
        {
            return;
        }
        let eligible: Vec<usize> = self.bots.iter().copied().filter(|&b| b != target).collect();
        if eligible.is_empty() {
            return;
        }
        let catcher = eligible[random_below(eligible.len() as u64) as usize];
        let prior = state.hands[target].cards.len();
        if let Err(e) = self
            .room
            .catch_undeclared(catcher as i32, target as i32, now)
        {
            if e.is_missed_catch() {
                self.penalize_failed_catch(catcher, now);
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

    pub(crate) fn execute_bot_move(&mut self, cx: &TableCtx, mut bm: BotMove) {
        if self.room.status != Status::Playing {
            tracing::info!(code = %self.code, player = bm.seat, "bot move skipped, room not playing");
            return;
        }
        let Some(state) = self.room.state.as_ref() else {
            return;
        };
        if state.current_turn != bm.seat as i32 || self.is_loading() {
            return;
        }
        if !self.is_bot(bm.seat) {
            tracing::info!(code = %self.code, player = bm.seat, "bot move skipped, not a bot slot");
            return;
        }
        if let Some(board) = bm.board_at
            && state.last_play_at != board
        {
            return; // a card landed while the finish was held; that play re-armed the seat
        }
        let action = loco_game::bot_think(state, bm.seat as i32, &mut rand::rng());
        if bot_finishes(state, bm.seat, &action) {
            let due = bot_finish_due(&self.timings.bots, state, bm.seat, bm.armed_at);
            let now = clock::now_ms();
            if now < due {
                bm.board_at = Some(state.last_play_at);
                self.post_bot_move_after(bm, Duration::from_millis((due - now) as u64));
                return;
            }
        }
        match action.kind {
            BotActionKind::Play => {
                self.bot_play(cx, bm.seat, action);
                return;
            }
            BotActionKind::Counter => {
                self.bot_counter(cx, bm.seat, action);
                return;
            }
            BotActionKind::Draw => {
                if self.bot_draw(cx, bm.seat) {
                    return; // self-rescheduled to play the drawn card
                }
            }
        }
        self.maybe_schedule_bot(cx);
    }

    fn bot_play(&mut self, cx: &TableCtx, seat: usize, action: BotAction) {
        self.bot_declare_before_finish(seat);
        let now = clock::now_ms();
        let res = if action.cards.len() > 1 {
            self.room.play_cards(
                seat as i32,
                &action.cards,
                action.chosen_color,
                -1,
                action.declare_loco,
                now,
            )
        } else {
            self.room.play_card(
                seat as i32,
                action.card,
                action.chosen_color,
                action.chosen_player,
                now,
            )
        };
        if let Err(e) = res {
            tracing::info!(code = %self.code, player = seat, "bot play error: {e}");
            self.bot_recover(cx, seat);
            return;
        }
        self.announce_finishing_loco(seat, &action.cards);
        self.broadcast_card_played(cx, seat, action.chosen_player);
        if matches!(action.card.kind, Kind::Swap | Kind::GlobalSwitch) {
            self.broadcast_personalized_game_state();
        }
        self.maybe_schedule_bot_reactions(cx);
        self.handle_round_or_match_end(cx);
    }

    fn bot_counter(&mut self, cx: &TableCtx, seat: usize, action: BotAction) {
        self.bot_declare_before_finish(seat);
        if let Err(e) = self.room.counter_draw(
            seat as i32,
            action.card,
            action.chosen_color,
            clock::now_ms(),
        ) {
            tracing::info!(code = %self.code, player = seat, "bot counter error: {e}");
            self.bot_recover(cx, seat);
            return;
        }
        self.broadcast_card_played(cx, seat, -1);
        self.maybe_schedule_bot_reactions(cx);
        self.handle_round_or_match_end(cx);
    }

    /// Draws for the bot, then plays the drawn card (rescheduled) or passes.
    /// Returns whether it rescheduled itself.
    fn bot_draw(&mut self, cx: &TableCtx, seat: usize) -> bool {
        let Some(prior) = self.room.state.as_ref().map(|s| s.hands[seat].cards.len()) else {
            return false;
        };
        if let Err(e) = self.room.draw_card(seat as i32, clock::now_ms()) {
            tracing::info!(code = %self.code, player = seat, "bot draw error: {e}");
            return false;
        }
        let state = self.room.state.as_ref().expect("drawn");
        self.broadcast_all(ServerMsg::CardDrawn(CardDrawnMsg {
            player_index: Some(seat as i32),
            drawn_count: (state.hands[seat].cards.len() - prior) as i32,
            turn: state.current_turn,
            pending_draw: Some(state.pending_draw),
            has_drawn: Some(state.has_drawn),
            interrupt_open: Some(state.interrupt_open),
            ..Default::default()
        }));
        // bot_think, not can_play: the bot plays the drawn card only when it
        // would choose to.
        if loco_game::bot_think(state, seat as i32, &mut rand::rng()).kind != BotActionKind::Draw {
            self.schedule_bot_move(seat);
            return true;
        }
        if self.room.pass_turn(seat as i32, clock::now_ms()).is_ok() {
            self.schedule_turn_timer(cx);
            self.broadcast_turn_changed();
        }
        false
    }

    /// Arms the declarations and the catches every action can open: after
    /// **every** action, human or bot.
    pub fn maybe_schedule_bot_reactions(&mut self, _cx: &TableCtx) {
        if self.room.status != Status::Playing || self.room.round_ended || self.bots.is_empty() {
            return;
        }
        let Some(state) = self.room.state.as_ref() else {
            return;
        };
        let targets: Vec<(usize, Option<Millis>)> = state
            .catchable_targets(clock::now_ms())
            .into_iter()
            .map(|s| (s as usize, state.last_card_at[s as usize]))
            .collect();
        for (seat, at) in targets {
            if self.is_bot(seat)
                && let Some(at) = at
            {
                self.schedule_bot_uno_announce(seat, at);
            }
            self.schedule_bot_catch(seat);
        }
    }

    /// A refused bot move gives the turn up, never the table.
    fn bot_recover(&mut self, cx: &TableCtx, seat: usize) {
        if self.room.status != Status::Playing {
            return;
        }
        let Some(state) = self.room.state.as_ref() else {
            return;
        };
        if state.current_turn != seat as i32 {
            return;
        }
        if !state.has_drawn {
            if self.bot_draw(cx, seat) {
                return;
            }
            if self
                .room
                .state
                .as_ref()
                .is_none_or(|s| s.current_turn != seat as i32)
            {
                return;
            }
        }
        if let Err(e) = self.room.pass_turn(seat as i32, clock::now_ms()) {
            tracing::info!(code = %self.code, player = seat, "bot recover pass error err={e}");
            return;
        }
        self.schedule_turn_timer(cx);
        self.broadcast_turn_changed();
        self.maybe_schedule_bot(cx);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Port of bottiming_internal_test.go / botcatch_internal_test.go's pure
    // halves: the instants are functions of the moment, and the odds hold.

    #[test]
    fn the_declaration_has_one_instant_per_window() {
        let b = BotTimings::default();
        let at = 1_794_000_000_000;
        assert_eq!(bot_uno_at(&b, 1, at), bot_uno_at(&b, 1, at));
        let d = bot_uno_at(&b, 1, at) - at;
        assert!((1600..=2800).contains(&d), "{d}");
    }

    #[test]
    fn a_catch_is_late_single_and_inside_the_window() {
        let b = BotTimings::default();
        let mut attempts = 0;
        for i in 0..1000 {
            let (delay, attempt) = bot_catch_attempt(&b, 1, 1_794_000_000_000 + i * 7919);
            assert!(delay >= Duration::from_millis(3200) && delay <= Duration::from_millis(4400));
            assert!(delay < Duration::from_secs(5), "past the 5s window");
            attempts += usize::from(attempt);
        }
        assert!(
            (700..=900).contains(&attempts),
            "attempt rate {attempts}/1000 is not ~0.8"
        );
    }

    #[test]
    fn bot_names_take_the_first_free_number() {
        let mut room = Room::from_u64_seed("AAAAAA", 1);
        room.join("Bot1").unwrap();
        room.join("Alice").unwrap();
        assert_eq!(next_bot_name(&room), "Bot2");
    }
}
