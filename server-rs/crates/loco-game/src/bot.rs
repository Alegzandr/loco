//! Bot decisions (`server/game/bot.go`). The domain decides, the hub
//! schedules; a bot plays through the same domain calls as a human.
//!
//! Go read the process-global `math/rand`. Here every decision that draws
//! takes its source as a parameter, so a test can pin it and the hub can hand
//! it whatever non-secret source it likes: nothing a bot chooses is hidden
//! state.

use crate::Seat;
use crate::card::{COLORS, Card, Color, Kind};
use crate::hand::Hand;
use crate::rng;
use crate::room::GameState;
use crate::rules::can_play;
use rand_core::RngCore;

/// What a bot decided to do on its turn.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum BotActionKind {
    #[default]
    Play,
    Draw,
    Counter,
}

/// The result of a bot thinking about its turn.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct BotAction {
    pub kind: BotActionKind,
    pub card: Card,
    /// For wild cards.
    pub chosen_color: Color,
    /// For Swap cards; -1 = no target.
    pub chosen_player: Seat,
    /// The batch when the bot plays more than one copy of `card` at once;
    /// empty for a single card (Go: nil).
    pub cards: Vec<Card>,
    /// The call a hand-emptying batch carries.
    pub declare_loco: bool,
}

/// Decides a bot's turn. Prefers playing to drawing, picks a random legal card
/// weighted towards action cards, holds a Swap or an idle Wild that would not
/// pay, and batches the copies that buy something. (Go: `BotThink`.)
pub fn bot_think<R: RngCore + ?Sized>(state: &GameState, player: Seat, rng: &mut R) -> BotAction {
    let hand = &state.hands[player as usize];
    let top = state.top_card();
    let active = state.active_color;

    // Under a pending draw, counter ~70% of the time, else draw.
    if state.pending_draw > 0 {
        if rng::chance(rng, 70) {
            for &c in &hand.cards {
                // A counter is the same card: same kind and same colour.
                if c.kind == top.kind
                    && c.color == top.color
                    && matches!(c.kind, Kind::DrawTwo | Kind::WildDrawFour)
                {
                    let chosen = if c.is_wild() {
                        bot_preferred_color(hand, active)
                    } else {
                        active
                    };
                    return BotAction {
                        kind: BotActionKind::Counter,
                        card: c,
                        chosen_color: chosen,
                        ..BotAction::default()
                    };
                }
            }
        }
        return BotAction {
            kind: BotActionKind::Draw,
            ..BotAction::default()
        };
    }

    let legal: Vec<Card> = hand
        .cards
        .iter()
        .copied()
        .filter(|&c| can_play(c, top, active))
        .collect();
    if legal.is_empty() {
        return BotAction {
            kind: BotActionKind::Draw,
            ..BotAction::default()
        };
    }

    let preferred: Vec<Card> = legal
        .iter()
        .copied()
        .filter(|c| c.is_action() || c.is_wild())
        .collect();
    let mut candidates = if preferred.is_empty() {
        legal.clone()
    } else {
        preferred
    };

    // A Swap is only played while it pays.
    let mut swap_target = -1;
    if bot_swap_pays(state, player) {
        swap_target = bot_swap_target(state, player);
    }
    let mut fallback = legal.clone();
    if swap_target < 0 {
        fallback = without_kind(&legal, Kind::Swap);
        candidates = without_kind(&candidates, Kind::Swap);
        if candidates.is_empty() {
            candidates = fallback.clone();
        }
        if candidates.is_empty() {
            // Nothing but a Swap that hurts: a card off the deck is cheaper.
            return BotAction {
                kind: BotActionKind::Draw,
                chosen_player: -1,
                ..BotAction::default()
            };
        }
    }

    // A plain Wild naming the colour already active is held while anything
    // else is playable.
    if bot_wild_is_idle(hand, active) {
        let mut trimmed = without_kind(&candidates, Kind::WildCard);
        if trimmed.is_empty() {
            trimmed = without_kind(&fallback, Kind::WildCard);
        }
        if !trimmed.is_empty() {
            candidates = trimmed;
        }
    }

    let pick = candidates[rng::below(rng, candidates.len())];
    let chosen = if pick.is_wild() {
        bot_preferred_color(hand, active)
    } else {
        active
    };
    let chosen_player = if pick.kind == Kind::Swap {
        swap_target
    } else {
        -1
    };
    let batch = bot_batch_for(pick, hand);
    let declare_loco = !batch.is_empty() && batch.len() == hand.size();
    BotAction {
        kind: BotActionKind::Play,
        card: pick,
        chosen_color: chosen,
        chosen_player,
        cards: batch,
        declare_loco,
    }
}

/// Every copy of `card` the bot holds when playing them together is worth it,
/// empty otherwise. Swap and GlobalSwitch never batch; a plain Wild only when
/// the batch empties the hand. (Go: `botBatchFor`.)
pub(crate) fn bot_batch_for(card: Card, hand: &Hand) -> Vec<Card> {
    if matches!(card.kind, Kind::Swap | Kind::GlobalSwitch) {
        return Vec::new();
    }
    let copies: Vec<Card> = hand.cards.iter().copied().filter(|c| *c == card).collect();
    if copies.len() < 2 {
        return Vec::new();
    }
    if card.kind == Kind::WildCard && copies.len() < hand.size() {
        return Vec::new();
    }
    copies
}

/// `cards` without every card of `kind`. (Go: `withoutKind`.)
pub(crate) fn without_kind(cards: &[Card], kind: Kind) -> Vec<Card> {
    cards.iter().copied().filter(|c| c.kind != kind).collect()
}

/// An interject a bot could make into an open window: one copy of the top
/// discard. A list because the domain entry point takes one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BotInterruptAction {
    pub cards: Vec<Card>,
    pub chosen_color: Color,
    /// Swap target, -1 otherwise.
    pub chosen_player: Seat,
}

/// What `player` could slam onto the top discard right now, or `None`. Gated on
/// `last_play_by` and not on the window, so a bot never slams the opening
/// discard. Mirrors `interrupt_play_cards`' own rules. (Go: `BotInterrupt`.)
pub fn bot_interrupt(state: &GameState, player: Seat) -> Option<BotInterruptAction> {
    if player < 0 || player as usize >= state.hands.len() {
        return None;
    }
    if state.last_play_by < 0 || state.discard.is_empty() {
        return None;
    }
    let top = state.top_card();
    if state.pending_draw > 0 && top.kind != Kind::DrawTwo && top.kind != Kind::WildDrawFour {
        return None;
    }
    let hand = &state.hands[player as usize];
    if !hand.contains(top) {
        return None;
    }
    // One card, however many copies the bot holds.
    let mut action = BotInterruptAction {
        cards: vec![top],
        chosen_color: state.active_color,
        chosen_player: -1,
    };
    if top.is_wild() {
        action.chosen_color = bot_preferred_color(hand, state.active_color);
    }
    if top.kind == Kind::Swap {
        if !bot_swap_pays(state, player) {
            return None;
        }
        action.chosen_player = bot_swap_target(state, player);
        if action.chosen_player < 0 {
            return None;
        }
    }
    Some(action)
}

/// The opponent holding the fewest cards, never a retired seat; -1 if nobody.
/// (Go: `botSwapTarget`.)
pub(crate) fn bot_swap_target(state: &GameState, player: Seat) -> Seat {
    let mut best: Option<(usize, usize)> = None;
    for (i, h) in state.hands.iter().enumerate() {
        if i as Seat == player || state.is_retired(i as Seat) {
            continue;
        }
        if best.is_none_or(|(_, size)| h.size() < size) {
            best = Some((i, h.size()));
        }
    }
    best.map_or(-1, |(i, _)| i as Seat)
}

/// Whether a Swap now leaves the bot with fewer cards than holding it would.
/// A Swap that empties the hand always pays. (Go: `botSwapPays`.)
pub(crate) fn bot_swap_pays(state: &GameState, player: Seat) -> bool {
    let own = state.hands[player as usize].size() as i64 - 1;
    if own <= 0 {
        return true;
    }
    let target = bot_swap_target(state, player);
    if target < 0 {
        return false;
    }
    (state.hands[target as usize].size() as i64) < own
}

/// The colour the bot holds most of; a tie is broken towards a colour that is
/// not already active, never bought with a colour held less. (Go:
/// `botPreferredColor`.)
pub(crate) fn bot_preferred_color(hand: &Hand, active: Color) -> Color {
    let count = |col: Color| {
        hand.cards
            .iter()
            .filter(|c| !c.is_wild() && c.color == col)
            .count() as i64
    };
    let mut best = Color::Red;
    let mut best_n = -1;
    for col in COLORS {
        let n = count(col);
        if n > best_n || (n == best_n && best == active && col != active) {
            best_n = n;
            best = col;
        }
    }
    best
}

/// Whether a plain Wild would move nothing: it would name the colour already
/// active. (Go: `botWildIsIdle`.)
pub(crate) fn bot_wild_is_idle(hand: &Hand, active: Color) -> bool {
    bot_preferred_color(hand, active) == active
}
