//! A player's hand.

use crate::card::Card;
use crate::error::GameError;
use serde::{Deserialize, Serialize};

/// A player's hand of cards.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct Hand {
    #[serde(default)]
    pub cards: Vec<Card>,
}

impl Hand {
    /// A hand holding exactly these cards.
    pub fn of(cards: impl Into<Vec<Card>>) -> Hand {
        Hand {
            cards: cards.into(),
        }
    }

    /// Appends cards to the hand.
    pub fn add(&mut self, cards: &[Card]) {
        self.cards.extend_from_slice(cards);
    }

    /// Takes one copy of a card out of the hand.
    pub fn remove(&mut self, card: Card) -> Result<(), GameError> {
        match self.cards.iter().position(|c| *c == card) {
            Some(i) => {
                self.cards.remove(i);
                Ok(())
            }
            None => Err(GameError::CardNotInHand),
        }
    }

    /// True if the hand holds the card.
    pub fn contains(&self, card: Card) -> bool {
        self.cards.contains(&card)
    }

    /// The number of cards in the hand.
    pub fn len(&self) -> usize {
        self.cards.len()
    }

    /// Whether the hand is empty: the round has been won from it.
    pub fn is_empty(&self) -> bool {
        self.cards.is_empty()
    }
}
