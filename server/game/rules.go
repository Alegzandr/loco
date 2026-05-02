package game

// CanPlay returns true if card can be legally played on top of topCard
// given the currently active color (relevant after a wild is played).
func CanPlay(card, topCard Card, activeColor Color) bool {
	if card.IsWild() {
		return true
	}
	if card.Color == activeColor {
		return true
	}
	if card.Kind == topCard.Kind {
		if card.Kind == Number {
			return card.Value == topCard.Value
		}
		return true
	}
	return false
}

// ApplyEffect applies the card's effect to state and returns the next player index.
// The caller is responsible for advancing CurrentTurn to the returned value.
func (s *GameState) ApplyEffect(card Card, chosenColor Color) int {
	n := len(s.Hands)

	switch card.Kind {
	case WildCard:
		s.ActiveColor = chosenColor
	case WildDrawFour:
		s.ActiveColor = chosenColor
		s.PendingDraw += 4
	case GlobalSwitch:
		s.ActiveColor = chosenColor
	default:
		// Colored cards (Number, Skip, Reverse, DrawTwo, Swap)
		s.ActiveColor = card.Color
	}

	switch card.Kind {
	case Skip:
		return s.nextTurn(s.nextTurn(s.CurrentTurn))

	case Reverse:
		s.Direction *= -1
		if n == 2 {
			return s.nextTurn(s.nextTurn(s.CurrentTurn))
		}
		return s.nextTurn(s.CurrentTurn)

	case DrawTwo:
		s.PendingDraw += 2
		return s.nextTurn(s.CurrentTurn)

	default:
		return s.nextTurn(s.CurrentTurn)
	}
}

// nextTurn calculates the next player index given direction.
func (s *GameState) nextTurn(from int) int {
	n := len(s.Hands)
	return ((from+s.Direction)%n + n) % n
}
