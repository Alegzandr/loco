//! Legality and card effects (`server/game/rules.go`).

use crate::Seat;
use crate::card::{Card, Color, Kind};
use crate::state::GameState;

/// Whether `card` may be played on `top` given the active colour (relevant
/// after a wild). (Go: `CanPlay`.)
pub fn can_play(card: Card, top: Card, active_color: Color) -> bool {
    if card.is_wild() || card.color == active_color {
        return true;
    }
    card.kind == top.kind && (card.kind != Kind::Number || card.value == top.value)
}

impl GameState {
    /// Applies the card's effect and returns the seat to play next; the caller
    /// moves `current_turn` to it. (Go: `ApplyEffect`.)
    pub fn apply_effect(&mut self, card: Card, chosen_color: Color) -> Seat {
        // The seats still in the round, not the seats at the table: at three
        // seats with one retired a Reverse behaves as a Skip, as in a duel.
        let active = self.active_seats();

        match card.kind {
            Kind::WildCard | Kind::GlobalSwitch => self.set_active_color(chosen_color),
            Kind::WildDrawFour => {
                self.set_active_color(chosen_color);
                self.pending_draw += 4;
            }
            _ => self.set_active_color(card.color),
        }

        let after = self.next_turn(self.current_turn);
        match card.kind {
            Kind::Skip => self.next_turn(after),
            Kind::Reverse => {
                self.direction = -self.direction;
                if active == 2 {
                    // In a duel a Reverse is a Skip: the player goes again.
                    self.next_turn(self.next_turn(self.current_turn))
                } else {
                    self.next_turn(self.current_turn)
                }
            }
            Kind::DrawTwo => {
                self.pending_draw += 2;
                after
            }
            _ => after,
        }
    }

    /// The next seat in the play direction, stepping over every retired seat;
    /// `from` itself when no other seat can play. (Go: `nextTurn`.)
    pub fn next_turn(&self, from: Seat) -> Seat {
        let n = self.hands.len();
        if n == 0 {
            return from;
        }
        let step = if self.direction < 0 { n - 1 } else { 1 };
        let mut next = from;
        for _ in 0..n {
            next = (next + step) % n;
            if !self.is_retired(next) {
                return next;
            }
        }
        from
    }

    /// Whether a seat has left the match. Bounds-checked: a hand-built state
    /// may carry fewer seat records than hands. (Go: `isRetired`.)
    pub fn is_retired(&self, i: Seat) -> bool {
        self.seats.get(i).is_some_and(|s| s.retired)
    }

    /// The seats still in the round. (Go: `activeSeats`.)
    pub fn active_seats(&self) -> usize {
        (0..self.hands.len())
            .filter(|&i| !self.is_retired(i))
            .count()
    }

    /// For each seat, the seat its hand comes from when a GlobalSwitch turns the
    /// table one place in the play direction, skipping retired seats. (Go:
    /// `rotateSeats`.)
    pub fn rotate_seats(&self) -> Vec<Seat> {
        let active: Vec<Seat> = (0..self.hands.len())
            .filter(|&i| !self.is_retired(i))
            .collect();
        let mut from: Vec<Seat> = (0..self.hands.len()).collect();
        let len = active.len();
        if len < 2 {
            return from;
        }
        // Each hand goes one active place on, so each seat receives from the
        // one active place back.
        let back = if self.direction < 0 { 1 } else { len - 1 };
        for (pos, &seat) in active.iter().enumerate() {
            from[seat] = active[(pos + back) % len];
        }
        from
    }
}
