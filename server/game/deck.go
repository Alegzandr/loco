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
// back to the global package source, which is for tests and nothing else: every
// shuffle that decides a hand takes the room's crypto-seeded source, Replenish
// included.
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

// DrawN removes and returns n cards from the top of the deck, or nothing at all
// when fewer than n are left. Dealing is the one caller that wants this: a short
// hand is a broken round, so it is better to know before any card moves.
//
// Every in-play draw wants DrawUpTo instead.
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

// DrawUpTo removes and returns however many of the n requested cards are left,
// possibly none.
//
// A draw in this game can never fail. Once every card sits in a hand there is
// nothing to reshuffle and nothing to hand over, and the only sane answer is a
// smaller penalty: an error at this point would have to be returned to a player
// who has no other legal action, which freezes the round for the whole table.
// The caller decides what "nothing came out" means for the turn.
func (d *Deck) DrawUpTo(n int) []Card {
	if n > len(d.Cards) {
		n = len(d.Cards)
	}
	if n <= 0 {
		return nil
	}
	drawn := make([]Card, n)
	for i := 0; i < n; i++ {
		drawn[i], _ = d.Draw()
	}
	return drawn
}

// Replenish replaces the deck with the shuffled discard pile. The caller keeps
// the current top card out of `discard` — it stays on the pile so the round
// still has something to match against.
//
// The rng is the room's, like every other shuffle that decides what lands in a
// hand. It used to be the global source, on the argument that only the deal was
// reconstructible; but the pile going back into the deck is the second half of
// a long round, every card in it has been seen by the table, and an attacker who
// can predict its order knows the rest of the round outright. A shuffle nobody
// may predict has no business being convenient.
func (d *Deck) Replenish(discard []Card, rng *rand.Rand) {
	d.Cards = make([]Card, len(discard))
	copy(d.Cards, discard)
	d.Shuffle(rng)
}
