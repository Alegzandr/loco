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
	// The seats still in the round, not the seats at the table. A retired seat
	// (see Room.RetireSeat) is skipped by the turn order, so at three seats with
	// one retired a Reverse has nobody to go around and behaves as a Skip —
	// exactly as it does in a real duel.
	n := s.activeSeats()

	switch card.Kind {
	case WildCard:
		s.setActiveColor(chosenColor)
	case WildDrawFour:
		s.setActiveColor(chosenColor)
		s.PendingDraw += 4
	case GlobalSwitch:
		// A wild like the other two: the player names the colour that becomes
		// active, and the rotation happens on top of that choice.
		s.setActiveColor(chosenColor)
	default:
		// Colored cards (Number, Skip, Reverse, DrawTwo, Swap)
		s.setActiveColor(card.Color)
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

// nextTurn calculates the next player index given direction, stepping over any
// seat that has left the match.
//
// A retired seat is not a player who is merely absent: it holds no cards and can
// never act again, so a turn handed to it would be a turn the clock has to
// auto-pass — which is the whole thing walking out is supposed to stop doing to
// the table. The loop is bounded by the seat count and falls back to the caller,
// because a state with no active seat at all has no next turn to name and a
// spin here would be worse than the wrong answer.
func (s *GameState) nextTurn(from int) int {
	n := len(s.Hands)
	if n == 0 {
		return from
	}
	next := from
	for i := 0; i < n; i++ {
		next = ((next+s.Direction)%n + n) % n
		if !s.isRetired(next) {
			return next
		}
	}
	return from
}

// isRetired reports whether a seat has left the match. Bounds-checked because
// the flags are sized per deal and a caller may hold an older index.
func (s *GameState) isRetired(i int) bool {
	return i >= 0 && i < len(s.Retired) && s.Retired[i]
}

// activeSeats counts the seats still in the round.
func (s *GameState) activeSeats() int {
	n := 0
	for i := range s.Hands {
		if !s.isRetired(i) {
			n++
		}
	}
	return n
}

// rotateSeats returns the seat each hand comes from when a GlobalSwitch turns
// the table one place in that direction, skipping the seats that have left.
//
// Written out rather than left as the modular step it used to be, because that
// step hands a retired seat a hand and takes the next player's away: the cards
// go somewhere nobody can play them from, which is the round ending in a stall
// rather than in a win.
func (s *GameState) rotateSeats(direction int) []int {
	active := make([]int, 0, len(s.Hands))
	for i := range s.Hands {
		if !s.isRetired(i) {
			active = append(active, i)
		}
	}
	from := make([]int, len(s.Hands))
	for i := range from {
		from[i] = i
	}
	if len(active) < 2 {
		return from
	}
	for pos, seat := range active {
		src := ((pos-direction)%len(active) + len(active)) % len(active)
		from[seat] = active[src]
	}
	return from
}
