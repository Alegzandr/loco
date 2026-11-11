//! The turn clock, and the consecutive timeouts that make a seat away. Port of
//! `server/hub/turntimer.go`.
//!
//! The clock is one deadline under the key `turn`: arming it for a new turn
//! replaces the old one, and the fire re-checks the turn and its start stamp
//! anyway, exactly as Go's did.

use crate::ops::clock;
use crate::table::Table;
use crate::table::actor::{DeadlineKey, TableCtx};
use loco_game::Status;
use loco_protocol::{ErrorMsg, ServerMsg};
use tokio::time::Instant;

impl Table {
    /// Arms the clock for whoever's turn it now is. A bot keeps its own time
    /// and the client draws no bar for it; the gate keeps the clock off
    /// entirely until `match_ready`.
    pub fn schedule_turn_timer(&mut self, _cx: &TableCtx) {
        if self.room.status != Status::Playing || self.is_loading() {
            return;
        }
        let Some(state) = self.room.state.as_ref() else {
            return;
        };
        let turn = state.current_turn;
        if self.is_bot(turn) {
            self.turn_started_at = None;
            self.deadlines.disarm(DeadlineKey::TurnTimeout);
            return;
        }
        let now = Instant::now();
        self.turn_started_at = Some(now);
        // The auto-action fires TurnTimeoutGrace past the deadline the client
        // is shown: the grace is the server's patience and never on the wire.
        let at = now + self.timings.turn_timeout + self.timings.turn_timeout_grace;
        self.deadlines
            .arm(DeadlineKey::TurnTimeout, at, move |t, cx| {
                t.handle_turn_timeout(cx, turn)
            });
    }

    /// The deadline the client is shown, in unix ms, or 0 when no human turn
    /// is being timed.
    pub fn turn_deadline_ms(&self) -> i64 {
        self.turn_started_at
            .map_or(0, |at| clock::ms_of(at + self.timings.turn_timeout))
    }

    /// An action the server took clears the seat's consecutive-timeout count.
    pub fn reset_afk(&mut self, seat: usize) {
        if let Some(s) = self.seats.get_mut(seat) {
            s.afk = 0;
        }
    }

    /// Every turn re-arms the one `DeadlineKey::TurnTimeout` key, so a fire is always the latest
    /// turn's; what can still have moved under it without a re-arm is the
    /// match ending or a fixture rewriting the turn.
    fn still_the_same_turn(&self, seat: usize) -> bool {
        self.room.status == Status::Playing
            && self
                .room
                .state
                .as_ref()
                .is_some_and(|s| s.current_turn == seat)
    }

    pub(crate) fn handle_turn_timeout(&mut self, cx: &TableCtx, seat: usize) {
        if !self.still_the_same_turn(seat) {
            return;
        }
        tracing::info!(player = seat, "turn timeout, auto-acting");
        if self.kick_if_afk(cx, seat) {
            return;
        }
        if !self.auto_draw_on_timeout(cx, seat) {
            return;
        }
        if let Err(e) = self.room.pass_turn(seat, clock::now_ms()) {
            tracing::info!(player = seat, "turn timeout pass error err={e}");
            return;
        }
        self.schedule_turn_timer(cx);
        self.broadcast_turn_changed();
        self.maybe_schedule_bot(cx);
    }

    /// The AFK threshold for this table: a matchmade one is two timeouts, an
    /// ordinary one four.
    pub fn afk_threshold(&self) -> i64 {
        i64::from(if self.is_matchmade() {
            self.timings.matchmaking.afk_threshold
        } else {
            self.timings.afk_kick_threshold
        })
    }

    /// Counts a timeout against the seat. At the threshold a matchmade match is
    /// forfeited; an ordinary table answers the socket and never the turn — the
    /// clock draws and passes for the kicked seat like any empty chair.
    /// Returns whether the match ended here.
    fn kick_if_afk(&mut self, cx: &TableCtx, seat: usize) -> bool {
        if self.is_bot(seat) {
            return false;
        }
        let Some(slot) = self.seats.get_mut(seat) else {
            return false;
        };
        slot.afk += 1;
        let n = slot.afk;
        if n < self.afk_threshold() {
            return false;
        }
        let client = self.client(seat).cloned();
        if self.is_matchmade() {
            if self.room.status != Status::Playing {
                return false;
            }
            tracing::info!(
                player = seat,
                threshold = self.afk_threshold(),
                "AFK forfeit"
            );
            if let Some(c) = &client {
                c.send(ServerMsg::Error(ErrorMsg {
                    error: "afk_forfeit".into(),
                    ..Default::default()
                }));
            }
            self.forfeit_match(cx, seat);
            return true;
        }
        let Some(c) = client else { return false };
        tracing::info!(player = seat, threshold = self.afk_threshold(), "AFK kick");
        c.send(ServerMsg::Error(ErrorMsg {
            error: "afk_kicked".into(),
            ..Default::default()
        }));
        c.force_close();
        false
    }

    /// Draws for a seat that let its clock run out, unless it already drew.
    /// A forced draw re-arms the clock before it broadcasts, so the deadline
    /// on the wire is the new one.
    fn auto_draw_on_timeout(&mut self, cx: &TableCtx, seat: usize) -> bool {
        let Some(state) = self.room.state.as_ref() else {
            return false;
        };
        if state.has_drawn {
            return true;
        }
        let prior = state.hands[seat].cards.len();
        if let Err(e) = self.room.draw_card(seat, clock::now_ms()) {
            tracing::info!(player = seat, "turn timeout draw error err={e}");
            return false;
        }
        self.schedule_turn_timer(cx);
        let drawn = self
            .room
            .state
            .as_ref()
            .map(|s| s.hands[seat].cards[prior..].to_vec())
            .unwrap_or_default();
        self.send_hand_growth(seat, &drawn);
        true
    }
}
