//! The deck (`server/game/deck.go`).

use crate::card::{Card, Color, Kind};
use crate::rng;
use rand_core::RngCore;
use serde::{Deserialize, Serialize};

/// How many cards the game is played with.
pub const DECK_SIZE: usize = 112;
/// The lowest number card. There is no zero.
pub const NUMBER_LOW: i32 = 1;
/// The highest number card.
pub const NUMBER_HIGH: i32 = 9;

/// An ordered collection of cards; the top is the end of the vector.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct Deck {
    #[serde(
        rename = "Cards",
        deserialize_with = "crate::stamp::nullable::deserialize"
    )]
    pub cards: Vec<Card>,
}

impl Deck {
    /// The 112-card deck, unshuffled. (Go: `NewDeck`.)
    ///
    /// Per colour (Red, Yellow, Green, Blue):
    ///   - Numbers 1–9 ×2 (no zero)
    ///   - Skip ×2, Reverse ×2, DrawTwo ×2
    ///   - Swap ×1 (coloured)
    ///
    /// Global (wild):
    ///   - Wild ×4, WildDrawFour ×4, GlobalSwitch ×4
    ///
    /// Per colour = 2*9 + 2 + 2 + 2 + 1 = 25; 4 colours = 100; +12 wild = 112.
    pub fn new() -> Deck {
        let mut cards = Vec::with_capacity(DECK_SIZE);
        for col in [Color::Red, Color::Yellow, Color::Green, Color::Blue] {
            for v in NUMBER_LOW..=NUMBER_HIGH {
                cards.push(Card {
                    color: col,
                    kind: Kind::Number,
                    value: v,
                });
                cards.push(Card {
                    color: col,
                    kind: Kind::Number,
                    value: v,
                });
            }
            for _ in 0..2 {
                cards.push(Card {
                    color: col,
                    kind: Kind::Skip,
                    value: 0,
                });
                cards.push(Card {
                    color: col,
                    kind: Kind::Reverse,
                    value: 0,
                });
                cards.push(Card {
                    color: col,
                    kind: Kind::DrawTwo,
                    value: 0,
                });
            }
            cards.push(Card {
                color: col,
                kind: Kind::Swap,
                value: 0,
            });
        }
        for _ in 0..4 {
            cards.push(Card {
                color: Color::Wild,
                kind: Kind::WildCard,
                value: 0,
            });
            cards.push(Card {
                color: Color::Wild,
                kind: Kind::WildDrawFour,
                value: 0,
            });
            cards.push(Card {
                color: Color::Wild,
                kind: Kind::GlobalSwitch,
                value: 0,
            });
        }
        Deck { cards }
    }

    /// Randomises the deck in place with the given source. There is no global
    /// fallback: every shuffle that decides a hand takes the room's source.
    pub fn shuffle<R: RngCore + ?Sized>(&mut self, rng: &mut R) {
        rng::shuffle(rng, &mut self.cards);
    }

    /// Removes and returns the top card. (Go: `Draw`.)
    pub fn draw(&mut self) -> Option<Card> {
        self.cards.pop()
    }

    /// Removes and returns `n` cards from the top, or nothing at all when fewer
    /// than `n` are left. Dealing is the one caller that wants this: a short
    /// hand is a broken round. Every in-play draw wants [`Deck::draw_up_to`].
    /// (Go: `DrawN`.)
    pub fn draw_n(&mut self, n: usize) -> Option<Vec<Card>> {
        if self.cards.len() < n {
            return None;
        }
        Some((0..n).filter_map(|_| self.draw()).collect())
    }

    /// Removes and returns however many of the `n` requested cards are left,
    /// possibly none. A draw in this game can never fail: once every card sits
    /// in a hand the only sane answer is a smaller penalty. (Go: `DrawUpTo`.)
    pub fn draw_up_to(&mut self, n: usize) -> Vec<Card> {
        let n = n.min(self.cards.len());
        (0..n).filter_map(|_| self.draw()).collect()
    }

    /// Shuffles the discard pile into what is left of the deck, never in place
    /// of it: the replenish runs when the deck is *short*, which is exactly when
    /// it is not empty. The caller keeps the current top card out of `discard`.
    /// The source is the room's, like every other shuffle that decides what
    /// lands in a hand. (Go: `Replenish`.)
    pub fn replenish<R: RngCore + ?Sized>(&mut self, discard: &[Card], rng: &mut R) {
        self.cards.extend_from_slice(discard);
        self.shuffle(rng);
    }
}
