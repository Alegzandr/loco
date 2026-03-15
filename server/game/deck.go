package game

import "math/rand"

// Deck holds an ordered collection of cards.
type Deck struct {
	Cards []Card
}

// NewDeck creates a 112-card UNO-style deck including Swap and GlobalSwitch cards.
func NewDeck() *Deck {
	cards := make([]Card, 0, 112)

	for _, col := range []Color{Red, Yellow, Green, Blue} {
		// One zero per color
		cards = append(cards, Card{Color: col, Kind: Number, Value: 0})
		// Two of each 1-9
		for v := 1; v <= 9; v++ {
			cards = append(cards, Card{Color: col, Kind: Number, Value: v})
			cards = append(cards, Card{Color: col, Kind: Number, Value: v})
		}
		// Two Skip, Two Reverse, Two DrawTwo per color
		for i := 0; i < 2; i++ {
			cards = append(cards, Card{Color: col, Kind: Skip})
			cards = append(cards, Card{Color: col, Kind: Reverse})
			cards = append(cards, Card{Color: col, Kind: DrawTwo})
		}
	}

	// Four Wild, Four WildDrawFour, Two Swap, Two GlobalSwitch
	for i := 0; i < 4; i++ {
		cards = append(cards, Card{Color: Wild, Kind: WildCard})
		cards = append(cards, Card{Color: Wild, Kind: WildDrawFour})
	}
	for i := 0; i < 2; i++ {
		cards = append(cards, Card{Color: Wild, Kind: Swap})
		cards = append(cards, Card{Color: Wild, Kind: GlobalSwitch})
	}

	return &Deck{Cards: cards}
}

// Shuffle randomizes the deck in place.
func (d *Deck) Shuffle() {
	rand.Shuffle(len(d.Cards), func(i, j int) {
		d.Cards[i], d.Cards[j] = d.Cards[j], d.Cards[i]
	})
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
	d.Shuffle()
}
