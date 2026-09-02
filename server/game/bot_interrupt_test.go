package game

import "testing"

// interruptState builds a two-hand board with an open window and the given top
// discard, so each case states only what it is about.
func interruptState(top Card, active Color, botHand []Card) *GameState {
	return &GameState{
		Hands:         []Hand{{Cards: []Card{top}}, {Cards: botHand}},
		Discard:       []Card{top},
		ActiveColor:   active,
		InterruptOpen: true,
		LastPlayBy:    0,
		CurrentTurn:   1,
	}
}

func TestBotInterrupt_SlamsEveryIdenticalCopy(t *testing.T) {
	top := Card{Color: Red, Kind: Number, Value: 5}
	s := interruptState(top, Red, []Card{top, {Color: Blue, Kind: Number, Value: 9}, top})

	action := BotInterrupt(s, 1)
	if action == nil {
		t.Fatal("BotInterrupt = nil, want both copies")
	}
	if len(action.Cards) != 2 {
		t.Errorf("slammed %d cards, want 2 — an interject takes every copy", len(action.Cards))
	}
	for _, c := range action.Cards {
		if c != top {
			t.Errorf("slammed %v, want %v", c, top)
		}
	}
}

func TestBotInterrupt_NothingWithoutAnExactMatch(t *testing.T) {
	top := Card{Color: Red, Kind: Number, Value: 5}
	cases := map[string]Card{
		"same kind, other colour":  {Color: Blue, Kind: Number, Value: 5},
		"same colour, other value": {Color: Red, Kind: Number, Value: 6},
		"same colour, other kind":  {Color: Red, Kind: Skip},
	}
	for name, held := range cases {
		t.Run(name, func(t *testing.T) {
			if got := BotInterrupt(interruptState(top, Red, []Card{held}), 1); got != nil {
				t.Errorf("BotInterrupt = %v, want nil", got)
			}
		})
	}
}

// The window is what makes it an interject rather than an out-of-turn play.
func TestBotInterrupt_ClosedWindow(t *testing.T) {
	top := Card{Color: Red, Kind: Number, Value: 5}
	s := interruptState(top, Red, []Card{top})
	s.closeInterruptWindow()

	if got := BotInterrupt(s, 1); got != nil {
		t.Errorf("BotInterrupt into a closed window = %v, want nil", got)
	}
}

// The opening discard is the one live window bots stay out of: it is open to
// every human at the table, but a bot slamming it would take the round's first
// turn off the seat the deal handed it, before that player touched anything.
func TestBotInterrupt_LeavesTheOpeningDiscardAlone(t *testing.T) {
	top := Card{Color: Red, Kind: Number, Value: 5}
	s := interruptState(top, Red, []Card{top})
	// What dealRound produces: window open, nobody played the card on the pile.
	s.LastPlayBy = -1

	if !s.InterruptOpen {
		t.Fatal("fixture is wrong: the opening window must be open")
	}
	if got := BotInterrupt(s, 1); got != nil {
		t.Errorf("BotInterrupt on the opening discard = %v, want nil", got)
	}
}

// Under a draw chain only an identical draw card may be interjected. A bot that
// sent anything else would just collect a refusal.
func TestBotInterrupt_DrawChain(t *testing.T) {
	plusTwo := Card{Color: Red, Kind: DrawTwo}
	s := interruptState(plusTwo, Red, []Card{plusTwo})
	s.PendingDraw = 2
	if got := BotInterrupt(s, 1); got == nil {
		t.Error("an identical +2 must extend the chain")
	}

	number := Card{Color: Red, Kind: Number, Value: 5}
	s2 := interruptState(number, Red, []Card{number})
	s2.PendingDraw = 2
	if got := BotInterrupt(s2, 1); got != nil {
		t.Errorf("BotInterrupt = %v under a draw chain, want nil for a number", got)
	}
}

// Every wild names a colour, GlobalSwitch included — and never `Wild`, which
// matches no coloured card and would strand the whole table.
func TestBotInterrupt_WildsNameAColour(t *testing.T) {
	for _, kind := range []Kind{WildCard, WildDrawFour, GlobalSwitch} {
		top := Card{Color: Wild, Kind: kind}
		hand := []Card{top, {Color: Green, Kind: Number, Value: 2}, {Color: Green, Kind: Skip}}
		action := BotInterrupt(interruptState(top, Red, hand), 1)
		if action == nil {
			t.Fatalf("%v: BotInterrupt = nil", kind)
		}
		if action.ChosenColor == Wild {
			t.Errorf("%v: chose Wild, which is not a playable colour", kind)
		}
		if action.ChosenColor != Green {
			t.Errorf("%v: chose %v, want the colour it holds most of (Green)", kind, action.ChosenColor)
		}
	}
}

// Swap and GlobalSwitch cannot be batch-interjected: which target, how many
// rotations? The domain refuses it, so the bot must not offer it.
func TestBotInterrupt_RearrangingCardsStaySingle(t *testing.T) {
	for _, top := range []Card{{Color: Red, Kind: Swap}, {Color: Wild, Kind: GlobalSwitch}} {
		// A third card so the Swap pays (seat 0 holds one): what is under
		// test is the batch size, not whether the exchange is worth it.
		action := BotInterrupt(interruptState(top, Red, []Card{top, top, {Color: Blue, Kind: Number, Value: 1}}), 1)
		if action == nil {
			t.Fatalf("%v: BotInterrupt = nil", top.Kind)
		}
		if len(action.Cards) != 1 {
			t.Errorf("%v: slammed %d cards, want 1", top.Kind, len(action.Cards))
		}
	}
}

func TestBotInterrupt_SwapPicksARealTarget(t *testing.T) {
	top := Card{Color: Red, Kind: Swap}
	blue := func(v int) Card { return Card{Color: Blue, Kind: Number, Value: v} }
	// The bot holds four, seat 0 holds one: the exchange pays, and seat 0 is
	// the only target there is.
	s := interruptState(top, Red, []Card{top, blue(1), blue(2), blue(3)})
	s.Hands[0] = Hand{Cards: []Card{blue(4)}}

	action := BotInterrupt(s, 1)
	if action == nil {
		t.Fatal("BotInterrupt = nil")
	}
	if action.ChosenPlayer != 0 {
		t.Errorf("ChosenPlayer = %d, want 0", action.ChosenPlayer)
	}
}

// A Swap exchanges the whole hand, so slamming one into a fuller hand is a
// forced draw the bot inflicted on itself. The interject is not made.
func TestBotInterrupt_SwapThatHurtsIsNotMade(t *testing.T) {
	top := Card{Color: Red, Kind: Swap}
	blue := func(v int) Card { return Card{Color: Blue, Kind: Number, Value: v} }
	s := interruptState(top, Red, []Card{top, blue(1)})
	s.Hands[0] = Hand{Cards: []Card{blue(2), blue(3), blue(4), blue(5)}}

	if got := BotInterrupt(s, 1); got != nil {
		t.Errorf("BotInterrupt = %v, want nil: the exchange costs three cards", got)
	}
}

func TestBotInterrupt_OutOfRangeSeat(t *testing.T) {
	top := Card{Color: Red, Kind: Number, Value: 5}
	s := interruptState(top, Red, []Card{top})
	if got := BotInterrupt(s, 7); got != nil {
		t.Errorf("BotInterrupt(seat 7) = %v, want nil", got)
	}
	if got := BotInterrupt(nil, 0); got != nil {
		t.Errorf("BotInterrupt(nil state) = %v, want nil", got)
	}
}

// A batch is worth its copies only for the kinds stackBatchEffects has a case
// for. A plain Wild is on none of them — N of them name one colour — so every
// copy past the first leaves the hand for nothing.
func TestBotInterrupt_PlainWildSpendsOneCopy(t *testing.T) {
	top := Card{Color: Wild, Kind: WildCard}
	hand := []Card{top, top, {Color: Green, Kind: Number, Value: 2}}

	action := BotInterrupt(interruptState(top, Red, hand), 1)
	if action == nil {
		t.Fatal("BotInterrupt = nil, want one copy")
	}
	if len(action.Cards) != 1 {
		t.Errorf("slammed %d wilds, want 1 — a second one names the same colour", len(action.Cards))
	}
}

// ...and the one batch it is worth: the copies are the whole hand, so the slam
// takes the round.
func TestBotInterrupt_PlainWildBatchesToWin(t *testing.T) {
	top := Card{Color: Wild, Kind: WildCard}

	action := BotInterrupt(interruptState(top, Red, []Card{top, top}), 1)
	if action == nil {
		t.Fatal("BotInterrupt = nil, want the whole hand")
	}
	if len(action.Cards) != 2 {
		t.Errorf("slammed %d wilds, want 2 — that batch ends the round", len(action.Cards))
	}
}

// A +4 is on the list: each copy raises the stack by four.
func TestBotInterrupt_PlusFourStillBatches(t *testing.T) {
	top := Card{Color: Wild, Kind: WildDrawFour}
	hand := []Card{top, top, {Color: Green, Kind: Number, Value: 2}}

	action := BotInterrupt(interruptState(top, Red, hand), 1)
	if action == nil {
		t.Fatal("BotInterrupt = nil, want both copies")
	}
	if len(action.Cards) != 2 {
		t.Errorf("slammed %d +4s, want 2 — each copy raises the stack", len(action.Cards))
	}
}
