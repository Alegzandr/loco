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
		chosenPlayer = botSwapTarget(state, playerIdx)
		if chosenPlayer < 0 {
			// No valid target — skip this card and draw instead
			return BotAction{Kind: BotDraw, ChosenPlayer: -1}
		}
	}
	return BotAction{Kind: BotPlay, Card: pick, ChosenColor: chosen, ChosenPlayer: chosenPlayer}
}

// BotInterruptAction is an interject a bot could make into an open window:
// every identical copy it holds of the current top discard.
type BotInterruptAction struct {
	Cards        []Card
	ChosenColor  Color
	ChosenPlayer int // Swap target, -1 otherwise
}

// BotInterrupt returns what playerIdx could slam onto the top discard right
// now, or nil if it holds nothing that matches.
//
// The interject is the game's signature mechanic and it used to run one way
// only: bots could be interrupted and never interrupted back, so the reaction
// nobody has to defend is the reaction nobody has to think about. This mirrors
// InterruptPlayCards' own rules rather than trusting the caller — an interject
// the domain will refuse is worse than none, since it costs a round trip and
// shows up as a rejection.
//
// It answers the question and schedules nothing: the hub owns whether and when.
func BotInterrupt(state *GameState, playerIdx int) *BotInterruptAction {
	if state == nil || playerIdx < 0 || playerIdx >= len(state.Hands) {
		return nil
	}
	// Nothing to jump into: no card has been *played* onto this pile. That is
	// LastPlayBy and deliberately not InterruptOpen, which is also true of the
	// opening discard — the window on the dealt card belongs to the humans at
	// the table. A bot slamming the card the round opens on would take the first
	// turn of the round off the seat the deal gave it, before that player has
	// touched anything.
	if state.LastPlayBy < 0 || len(state.Discard) == 0 {
		return nil
	}
	top := state.Discard[len(state.Discard)-1]
	// During a draw chain only an identical draw card may be interjected. In a
	// consistent state the equality below already implies it; kept explicit for
	// the same reason the domain keeps it.
	if state.PendingDraw > 0 && top.Kind != DrawTwo && top.Kind != WildDrawFour {
		return nil
	}

	var copies []Card
	for _, c := range state.Hands[playerIdx].Cards {
		if c == top {
			copies = append(copies, c)
		}
	}
	if len(copies) == 0 {
		return nil
	}

	action := &BotInterruptAction{Cards: copies, ChosenColor: state.ActiveColor, ChosenPlayer: -1}
	// Swap and GlobalSwitch cannot be batch-interjected.
	if top.Kind == Swap || top.Kind == GlobalSwitch {
		action.Cards = copies[:1]
	}
	// Every wild names a colour, GlobalSwitch included.
	if top.IsWild() {
		action.ChosenColor = botPreferredColor(state.Hands[playerIdx])
	}
	if top.Kind == Swap {
		action.ChosenPlayer = botSwapTarget(state, playerIdx)
		if action.ChosenPlayer < 0 {
			return nil
		}
	}
	return action
}

// botSwapTarget picks the opponent holding the most cards, or -1 if there is
// nobody to swap with.
func botSwapTarget(state *GameState, playerIdx int) int {
	bestIdx, bestSize := -1, -1
	for i := range state.Hands {
		if i == playerIdx {
			continue
		}
		if state.Hands[i].Size() > bestSize {
			bestSize = state.Hands[i].Size()
			bestIdx = i
		}
	}
	return bestIdx
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
