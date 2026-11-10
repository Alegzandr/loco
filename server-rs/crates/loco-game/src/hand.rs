//! A player's hand (`server/game/hand.go`).

use crate::card::Card;
use crate::error::GameError;
use serde::{Deserialize, Serialize};

/// A player's hand of cards.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct Hand {
    #[serde(
        rename = "Cards",
        deserialize_with = "crate::stamp::nullable::deserialize"
    )]
    pub cards: Vec<Card>,
}

impl Hand {
    /// A hand holding exactly these cards.
    pub fn of(cards: impl Into<Vec<Card>>) -> Hand {
        Hand {
            cards: cards.into(),
        }
    }

    /// Appends cards to the hand. (Go: `Add`.)
    pub fn add(&mut self, cards: &[Card]) {
        self.cards.extend_from_slice(cards);
    }

    /// Takes one copy of a card out of the hand. (Go: `Remove`.)
    pub fn remove(&mut self, card: Card) -> Result<(), GameError> {
        match self.cards.iter().position(|c| *c == card) {
            Some(i) => {
                self.cards.remove(i);
                Ok(())
            }
            None => Err(GameError::CardNotInHand),
        }
    }

    /// True if the hand holds the card. (Go: `Contains`.)
    pub fn contains(&self, card: Card) -> bool {
        self.cards.contains(&card)
    }

    /// The number of cards in the hand. (Go: `Size`.)
    pub fn size(&self) -> usize {
        self.cards.len()
    }
}
