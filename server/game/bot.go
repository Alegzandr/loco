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
	// Cards is the batch when the bot plays more than one copy of Card at
	// once, nil for a single card. Same rule as a human's slam (batchForSlam
	// on the client, BotInterrupt here): every copy has to buy something.
	Cards []Card
	// DeclareLoco is the call a hand-emptying batch carries: no window ever
	// opened on it, so the message is the only place the call can be made.
	DeclareLoco bool
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

	// A Swap is only an action card while it pays. It exchanges the whole hand,
	// so a seat that plays it into a fuller hand than its own has drawn every
	// one of those cards in one go; a bot that did that on a 3:1 was the seat
	// everybody wanted at their table. It is played when it buys something and
	// held otherwise, exactly the way a person holds it.
	swapTarget := -1
	if botSwapPays(state, playerIdx) {
		swapTarget = botSwapTarget(state, playerIdx)
	}
	if swapTarget < 0 {
		candidates = withoutKind(candidates, Swap)
		if len(candidates) == 0 {
			candidates = withoutKind(legal, Swap)
		}
		if len(candidates) == 0 {
			// Nothing but a Swap that hurts: a card off the deck is the cheaper
			// of the two.
			return BotAction{Kind: BotDraw, ChosenPlayer: -1}
		}
	}

	pick := candidates[rand.Intn(len(candidates))]
	chosen := activeColor
	chosenPlayer := -1
	if pick.IsWild() {
		chosen = botPreferredColor(hand)
	}
	if pick.Kind == Swap {
		chosenPlayer = swapTarget
	}
	// The copies go together when a copy buys something — a stack raised, a
	// second seat skipped, the ring flipped twice, a shorter hand — which is
	// what a human's tap does without asking. A bot that stacked +2 where a
	// person stacks +4, and that could not take the round on its last two
	// identical cards, played a visibly weaker game than the one it was in.
	batch := botBatchFor(pick, hand)
	return BotAction{
		Kind:         BotPlay,
		Card:         pick,
		ChosenColor:  chosen,
		ChosenPlayer: chosenPlayer,
		Cards:        batch,
		DeclareLoco:  batch != nil && len(batch) == hand.Size(),
	}
}

// botBatchFor is every copy of `card` the bot holds when playing them together
// is worth it, nil otherwise. Mirrors the client's batchForSlam: Swap and
// GlobalSwitch never batch, a plain Wild only when the batch empties the hand.
func botBatchFor(card Card, hand Hand) []Card {
	if card.Kind == Swap || card.Kind == GlobalSwitch {
		return nil
	}
	var copies []Card
	for _, c := range hand.Cards {
		if c == card {
			copies = append(copies, c)
		}
	}
	if len(copies) < 2 {
		return nil
	}
	if card.Kind == WildCard && len(copies) < hand.Size() {
		return nil
	}
	return copies
}

// withoutKind is cards with every card of the given kind removed.
func withoutKind(cards []Card, kind Kind) []Card {
	var out []Card
	for _, c := range cards {
		if c.Kind != kind {
			out = append(out, c)
		}
	}
	return out
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
	// A batch buys something only for the kinds stackBatchEffects has a case
	// for: +2 and +4 raise the stack, Skip steps another seat, Reverse flips the
	// ring again. A plain Wild is on none of them — N of them name one colour —
	// so every copy past the first is the game's most flexible card thrown away
	// for nothing. The one batch worth it is the one that empties the hand.
	if top.Kind == WildCard && len(copies) < state.Hands[playerIdx].Size() {
		action.Cards = copies[:1]
	}
	// Every wild names a colour, GlobalSwitch included.
	if top.IsWild() {
		action.ChosenColor = botPreferredColor(state.Hands[playerIdx])
	}
	if top.Kind == Swap {
		// Same rule as the turn: a Swap that hands the bot a fuller hand is
		// not an interject worth making, however fast it could be made.
		if !botSwapPays(state, playerIdx) {
			return nil
		}
		action.ChosenPlayer = botSwapTarget(state, playerIdx)
		if action.ChosenPlayer < 0 {
			return nil
		}
	}
	return action
}

// botSwapTarget picks the opponent holding the fewest cards, or -1 if there is
// nobody to swap with. A Swap exchanges the whole hand, so the fullest hand at
// the table is the one to stay away from, and a retired seat is excluded: its
// hand went back to the deck, so it is the smallest of all and the domain
// refuses it as a target.
func botSwapTarget(state *GameState, playerIdx int) int {
	bestIdx, bestSize := -1, -1
	for i := range state.Hands {
		if i == playerIdx || state.isRetired(i) {
			continue
		}
		size := state.Hands[i].Size()
		if bestIdx < 0 || size < bestSize {
			bestSize = size
			bestIdx = i
		}
	}
	return bestIdx
}

// botSwapPays says whether playing a Swap now leaves the bot with fewer cards
// than holding it would. The card leaves the hand first, so the comparison is
// against the hand minus one; a Swap that empties the hand takes the round and
// never exchanges anything, so it always pays.
func botSwapPays(state *GameState, playerIdx int) bool {
	own := state.Hands[playerIdx].Size() - 1
	if own <= 0 {
		return true
	}
	target := botSwapTarget(state, playerIdx)
	if target < 0 {
		return false
	}
	return state.Hands[target].Size() < own
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
