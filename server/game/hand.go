package game

// Hand represents a player's hand of cards.
type Hand struct {
	Cards []Card
}

// Add appends cards to the hand.
func (h *Hand) Add(cards ...Card) {
	h.Cards = append(h.Cards, cards...)
}

// Remove takes a card out of the hand. Returns an error if not found.
func (h *Hand) Remove(card Card) error {
	for i, c := range h.Cards {
		if c == card {
			h.Cards = append(h.Cards[:i], h.Cards[i+1:]...)
			return nil
		}
	}
	return ErrCardNotInHand
}

// Contains returns true if the hand contains the given card.
func (h *Hand) Contains(card Card) bool {
	for _, c := range h.Cards {
		if c == card {
			return true
		}
	}
	return false
}

// Size returns the number of cards in the hand.
func (h *Hand) Size() int {
	return len(h.Cards)
}
