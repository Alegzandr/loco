package game

import "testing"

// interruptState builds a two-hand board with an open window and the given top
// discard, so each case states only what it is about.
func interruptState(top Card, active Color, botHand []Card) *GameState {
	return &GameState{
		Hands:       []Hand{{Cards: []Card{top}}, {Cards: botHand}},
		Discard:     []Card{top},
		ActiveColor: active,
		LastPlayBy:  0,
		CurrentTurn: 1,
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
	s.LastPlayBy = -1

	if got := BotInterrupt(s, 1); got != nil {
		t.Errorf("BotInterrupt into a closed window = %v, want nil", got)
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
		action := BotInterrupt(interruptState(top, Red, []Card{top, top}), 1)
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
	s := interruptState(top, Red, []Card{top})
	// Give seat 0 the bigger hand so the choice is unambiguous.
	s.Hands[0] = Hand{Cards: []Card{top, {Color: Blue, Kind: Number, Value: 1}, {Color: Blue, Kind: Number, Value: 2}}}

	action := BotInterrupt(s, 1)
	if action == nil {
		t.Fatal("BotInterrupt = nil")
	}
	if action.ChosenPlayer != 0 {
		t.Errorf("ChosenPlayer = %d, want 0 (the fullest hand)", action.ChosenPlayer)
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
