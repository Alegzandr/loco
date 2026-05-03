package game

import "math/rand"

// Deck holds an ordered collection of cards.
type Deck struct {
	Cards []Card
}

// NewDeck creates a 112-card deck.
//
// Per color (Red, Yellow, Green, Blue):
//   - Numbers 1–9 ×2 (no zero)
//   - Skip ×2, Reverse ×2, DrawTwo ×2
//   - Swap ×1 (colored)
//
// Global (wild):
//   - Wild ×4, WildDrawFour ×4, GlobalSwitch ×4
//
// Per color = 2*9 + 2 + 2 + 2 + 1 = 25; 4 colors = 100; +12 wild = 112.
func NewDeck() *Deck {
	cards := make([]Card, 0, 112)

	for _, col := range []Color{Red, Yellow, Green, Blue} {
		for v := 1; v <= 9; v++ {
			cards = append(cards, Card{Color: col, Kind: Number, Value: v})
			cards = append(cards, Card{Color: col, Kind: Number, Value: v})
		}
		for i := 0; i < 2; i++ {
			cards = append(cards, Card{Color: col, Kind: Skip})
			cards = append(cards, Card{Color: col, Kind: Reverse})
			cards = append(cards, Card{Color: col, Kind: DrawTwo})
		}
		cards = append(cards, Card{Color: col, Kind: Swap})
	}

	for i := 0; i < 4; i++ {
		cards = append(cards, Card{Color: Wild, Kind: WildCard})
		cards = append(cards, Card{Color: Wild, Kind: WildDrawFour})
		cards = append(cards, Card{Color: Wild, Kind: GlobalSwitch})
	}

	return &Deck{Cards: cards}
}

// Shuffle randomizes the deck in place using the provided rng. A nil rng falls
// back to the global package source — convenient for callers that don't need
// determinism (e.g. Replenish).
func (d *Deck) Shuffle(rng *rand.Rand) {
	swap := func(i, j int) { d.Cards[i], d.Cards[j] = d.Cards[j], d.Cards[i] }
	if rng != nil {
		rng.Shuffle(len(d.Cards), swap)
		return
	}
	rand.Shuffle(len(d.Cards), swap)
}

// Draw removes and returns the top card of the deck.
func (d *Deck) Draw() (Card, bool) {
	if len(d.Cards) == 0 {
		return Card{}, false
	}
	top := d.Cards[len(d.Cards)-1]
	d.Cards = d.Cards[:len(d.Cards)-1]
	return top, true
}

// DrawN removes and returns n cards from the top of the deck.
func (d *Deck) DrawN(n int) ([]Card, bool) {
	if len(d.Cards) < n {
		return nil, false
	}
	drawn := make([]Card, n)
	for i := 0; i < n; i++ {
		drawn[i], _ = d.Draw()
	}
	return drawn, true
}

// Replenish replaces the deck with the shuffled discard pile.
// topCard is kept separate as the current top of the discard pile.
func (d *Deck) Replenish(discard []Card, topCard Card) {
	d.Cards = make([]Card, len(discard))
	copy(d.Cards, discard)
	d.Shuffle(nil)
}
