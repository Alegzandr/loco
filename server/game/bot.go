package game

import "math/rand"

// BotAction represents a decision made by a bot.
type BotActionKind int

const (
	BotPlay BotActionKind = iota
	BotDraw
	BotCounter
)

// BotAction is the result of a bot thinking about its turn.
type BotAction struct {
	Kind         BotActionKind
	Card         Card
	ChosenColor  Color // for wild cards
	ChosenPlayer int   // for Swap cards (-1 = no target)
}

// BotThink decides the best action for a bot player.
// It prefers playing a card over drawing; picks a random legal card
// weighted toward action cards. For wilds, picks the color most
// represented in hand.
func BotThink(state *GameState, playerIdx int) BotAction {
	hand := state.Hands[playerIdx]
	topCard := state.Discard[len(state.Discard)-1]
	activeColor := state.ActiveColor

	// If there is a pending draw, try to counter first.
	// Bots counter only ~70% of the time to feel less robotic.
	if state.PendingDraw > 0 {
		if rand.Float32() < 0.70 {
			for _, c := range hand.Cards {
				// A counter is the same card: same kind AND same colour. Sending
				// an off-colour +2 here is refused by CounterDraw, and the bot
				// then sits out its turn until the timeout fires.
				if c.Kind == topCard.Kind && c.Color == topCard.Color &&
					(c.Kind == DrawTwo || c.Kind == WildDrawFour) {
					chosen := activeColor
					if c.IsWild() {
						chosen = botPreferredColor(hand)
					}
					return BotAction{Kind: BotCounter, Card: c, ChosenColor: chosen}
				}
			}
		}
		// Can't counter (or chose not to) — draw
		return BotAction{Kind: BotDraw}
	}

	// Collect playable cards
	var legal []Card
	for _, c := range hand.Cards {
		if CanPlay(c, topCard, activeColor) {
			legal = append(legal, c)
		}
	}

	if len(legal) == 0 {
		return BotAction{Kind: BotDraw}
	}

	// Prefer action / wild cards to put pressure on opponents
	var preferred []Card
	for _, c := range legal {
		if c.IsAction() || c.IsWild() {
			preferred = append(preferred, c)
		}
	}
	candidates := legal
	if len(preferred) > 0 {
		candidates = preferred
	}

	pick := candidates[rand.Intn(len(candidates))]
	chosen := activeColor
	chosenPlayer := -1
	if pick.IsWild() {
		chosen = botPreferredColor(hand)
	}
	if pick.Kind == Swap {
		// Pick a random opponent (prefer the one with most cards).
		n := len(state.Hands)
		bestIdx := -1
		bestSize := -1
		for i := 0; i < n; i++ {
			if i == playerIdx {
				continue
			}
			if state.Hands[i].Size() > bestSize {
				bestSize = state.Hands[i].Size()
				bestIdx = i
			}
		}
		chosenPlayer = bestIdx
		if chosenPlayer < 0 {
			// No valid target — skip this card and draw instead
			return BotAction{Kind: BotDraw, ChosenPlayer: -1}
		}
	}
	return BotAction{Kind: BotPlay, Card: pick, ChosenColor: chosen, ChosenPlayer: chosenPlayer}
}

// botPreferredColor returns the color most frequent in the bot's hand, or Red if tie.
func botPreferredColor(hand Hand) Color {
	counts := map[Color]int{}
	for _, c := range hand.Cards {
		if !c.IsWild() {
			counts[c.Color]++
		}
	}
	best := Red
	bestN := -1
	for _, col := range []Color{Red, Yellow, Green, Blue} {
		if counts[col] > bestN {
			bestN = counts[col]
			best = col
		}
	}
	return best
}
