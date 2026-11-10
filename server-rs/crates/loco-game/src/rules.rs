//! Legality and card effects (`server/game/rules.go`).

use crate::Seat;
use crate::card::{Card, Color, Kind};
use crate::room::GameState;

/// Whether `card` may be played on `top` given the active colour (relevant
/// after a wild). (Go: `CanPlay`.)
pub fn can_play(card: Card, top: Card, active_color: Color) -> bool {
    if card.is_wild() {
        return true;
    }
    if card.color == active_color {
        return true;
    }
    if card.kind == top.kind {
        if card.kind == Kind::Number {
            return card.value == top.value;
        }
        return true;
    }
    false
}

impl GameState {
    /// Applies the card's effect and returns the next player index; the caller
    /// moves `current_turn` to it. (Go: `ApplyEffect`.)
    pub fn apply_effect(&mut self, card: Card, chosen_color: Color) -> Seat {
        // The seats still in the round, not the seats at the table: at three
        // seats with one retired a Reverse behaves as a Skip, as in a duel.
        let n = self.active_seats();

        match card.kind {
            Kind::WildCard => self.set_active_color(chosen_color),
            Kind::WildDrawFour => {
                self.set_active_color(chosen_color);
                self.pending_draw += 4;
            }
            // A wild like the other two: the player names the colour.
            Kind::GlobalSwitch => self.set_active_color(chosen_color),
            _ => self.set_active_color(card.color),
        }

        match card.kind {
            Kind::Skip => self.next_turn(self.next_turn(self.current_turn)),
            Kind::Reverse => {
                self.direction *= -1;
                if n == 2 {
                    self.next_turn(self.next_turn(self.current_turn))
                } else {
                    self.next_turn(self.current_turn)
                }
            }
            Kind::DrawTwo => {
                self.pending_draw += 2;
                self.next_turn(self.current_turn)
            }
            _ => self.next_turn(self.current_turn),
        }
    }

    /// The next seat in the play direction, stepping over every retired seat.
    /// Bounded by the seat count; falls back to `from` when no seat is active.
    /// (Go: `nextTurn`.)
    pub fn next_turn(&self, from: Seat) -> Seat {
        let n = self.hands.len() as i32;
        if n == 0 {
            return from;
        }
        let mut next = from;
        for _ in 0..n {
            next = ((next + self.direction) % n + n) % n;
            if !self.is_retired(next) {
                return next;
            }
        }
        from
    }

    /// Whether a seat has left the match, bounds-checked because the flags are
    /// sized per deal. (Go: `isRetired`.)
    pub fn is_retired(&self, i: Seat) -> bool {
        i >= 0 && (i as usize) < self.retired.len() && self.retired[i as usize]
    }

    /// The seats still in the round. (Go: `activeSeats`.)
    pub fn active_seats(&self) -> usize {
        (0..self.hands.len())
            .filter(|&i| !self.is_retired(i as Seat))
            .count()
    }

    /// For each seat, the seat its hand comes from when a GlobalSwitch turns the
    /// table one place in `direction`, skipping retired seats. (Go:
    /// `rotateSeats`.)
    pub fn rotate_seats(&self, direction: i32) -> Vec<usize> {
        let active: Vec<usize> = (0..self.hands.len())
            .filter(|&i| !self.is_retired(i as Seat))
            .collect();
        let mut from: Vec<usize> = (0..self.hands.len()).collect();
        if active.len() < 2 {
            return from;
        }
        let len = active.len() as i32;
        for (pos, &seat) in active.iter().enumerate() {
            let src = ((pos as i32 - direction) % len + len) % len;
            from[seat] = active[src as usize];
        }
        from
    }
}
