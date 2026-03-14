package game

// CanPlay returns true if card can be legally played on top of topCard
// given the currently active color (relevant after a wild is played).
func CanPlay(card, topCard Card, activeColor Color) bool {
	if card.IsWild() {
		return true
	}
	// Match active color (used after wild sets a color)
	if card.Color == activeColor {
		return true
	}
	// Match kind (e.g., Skip on Skip)
	if card.Kind == topCard.Kind {
		// For number cards, also require matching value
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
	case WildCard, WildDrawFour:
		s.ActiveColor = chosenColor
		if card.Kind == WildDrawFour {
			s.PendingDraw += 4
		}
	default:
		s.ActiveColor = card.Color
	}

	switch card.Kind {
	case Skip:
		// Skip the next player
		return s.nextTurn(s.nextTurn(s.CurrentTurn))

	case Reverse:
		s.Direction *= -1
		// Count active (unfinished) players to determine if Reverse acts as Skip.
		activeCount := n
		if len(s.Finished) > 0 {
			activeCount = 0
			for _, f := range s.Finished {
				if !f {
					activeCount++
				}
			}
		}
		if activeCount == 2 {
			// With only 2 active players, Reverse acts as Skip
			return s.nextTurn(s.nextTurn(s.CurrentTurn))
		}
		return s.nextTurn(s.CurrentTurn)

	case DrawTwo:
		s.PendingDraw += 2
		return s.nextTurn(s.CurrentTurn)

	case WildDrawFour:
		return s.nextTurn(s.CurrentTurn)

	default:
		return s.nextTurn(s.CurrentTurn)
	}
}

// nextTurn calculates the next player index given direction, skipping finished players.
func (s *GameState) nextTurn(from int) int {
	n := len(s.Hands)
	next := ((from + s.Direction) % n + n) % n
	if len(s.Finished) > 0 {
		for i := 0; i < n; i++ {
			if !s.Finished[next] {
				return next
			}
			next = ((next + s.Direction) % n + n) % n
		}
	}
	return next
}
