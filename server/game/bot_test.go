package game

import (
	"testing"
)

func TestBotThink_PlaysLegalCard(t *testing.T) {
	// Setup: bot has a red 5 and blue skip; top card is red 3
	hand := Hand{}
	hand.Add(Card{Color: Red, Kind: Number, Value: 5})
	hand.Add(Card{Color: Blue, Kind: Skip})

	state := &GameState{
		Hands:       []Hand{hand},
		Discard:     []Card{{Color: Red, Kind: Number, Value: 3}},
		ActiveColor: Red,
		CurrentTurn: 0,
		Direction:   1,
	}

	action := BotThink(state, 0)
	if action.Kind != BotPlay {
		t.Fatalf("expected BotPlay, got %v", action.Kind)
	}
	if !CanPlay(action.Card, state.Discard[0], state.ActiveColor) {
		t.Errorf("bot chose illegal card %v", action.Card)
	}
}

func TestBotThink_DrawsWhenNoLegalCard(t *testing.T) {
	hand := Hand{}
	hand.Add(Card{Color: Blue, Kind: Number, Value: 7})

	state := &GameState{
		Hands:       []Hand{hand},
		Discard:     []Card{{Color: Red, Kind: Number, Value: 3}},
		ActiveColor: Red,
		CurrentTurn: 0,
		Direction:   1,
	}

	action := BotThink(state, 0)
	if action.Kind != BotDraw {
		t.Errorf("expected BotDraw, got %v", action.Kind)
	}
}

// TestBotThink_CountersDraw verifies the bot can produce BotCounter when it has a matching
// draw card. The bot counters ~70% of the time (probabilistic), so we run enough iterations
// to confirm it both counters and draws across trials, proving both paths are reachable.
func TestBotThink_CountersDraw(t *testing.T) {
	hand := Hand{}
	// Same colour as the top card: a counter is the same card, so a blue +2
	// would not be a legal answer to a red one here.
	hand.Add(Card{Color: Red, Kind: DrawTwo})

	state := &GameState{
		Hands:       []Hand{hand},
		Discard:     []Card{{Color: Red, Kind: DrawTwo}},
		ActiveColor: Red,
		CurrentTurn: 0,
		Direction:   1,
		PendingDraw: 2,
	}

	sawCounter := false
	sawDraw := false
	for i := 0; i < 200; i++ {
		action := BotThink(state, 0)
		switch action.Kind {
		case BotCounter:
			sawCounter = true
		case BotDraw:
			sawDraw = true
		default:
			t.Fatalf("unexpected action kind %v", action.Kind)
		}
		if sawCounter && sawDraw {
			break
		}
	}
	if !sawCounter {
		t.Error("bot never countered across 200 trials; counter path appears broken")
	}
	if !sawDraw {
		t.Error("bot always countered across 200 trials; draw path appears broken")
	}
}

func TestBotThink_DrawsWhenCannotCounter(t *testing.T) {
	hand := Hand{}
	hand.Add(Card{Color: Blue, Kind: Number, Value: 5})

	state := &GameState{
		Hands:       []Hand{hand},
		Discard:     []Card{{Color: Red, Kind: DrawTwo}},
		ActiveColor: Red,
		CurrentTurn: 0,
		Direction:   1,
		PendingDraw: 2,
	}

	action := BotThink(state, 0)
	if action.Kind != BotDraw {
		t.Errorf("expected BotDraw, got %v", action.Kind)
	}
}

func TestBotThink_PrefersWildColorFromHand(t *testing.T) {
	hand := Hand{}
	hand.Add(Card{Color: Wild, Kind: WildCard})
	hand.Add(Card{Color: Green, Kind: Number, Value: 1})
	hand.Add(Card{Color: Green, Kind: Number, Value: 2})

	state := &GameState{
		Hands:       []Hand{hand},
		Discard:     []Card{{Color: Red, Kind: Number, Value: 3}},
		ActiveColor: Red,
		CurrentTurn: 0,
		Direction:   1,
	}

	action := BotThink(state, 0)
	if action.Kind != BotPlay {
		t.Fatalf("expected BotPlay")
	}
	if action.Card.IsWild() && action.ChosenColor != Green {
		t.Errorf("expected bot to choose Green (most in hand), got %v", action.ChosenColor)
	}
}

// A Swap is the one card whose value depends on the table: it exchanges hands,
// so the target is the seat with the fewest cards and never the fullest one.
func TestBotThink_SwapTargetsTheSmallestHand(t *testing.T) {
	blue := func(v int) Card { return Card{Color: Blue, Kind: Number, Value: v} }
	state := &GameState{
		Hands: []Hand{
			{Cards: []Card{{Color: Red, Kind: Swap}, blue(1), blue(2), blue(3), blue(4)}},
			{Cards: []Card{blue(5), blue(6), blue(7), blue(8), blue(9)}},
			{Cards: []Card{blue(0)}},
		},
		Discard:     []Card{{Color: Red, Kind: Number, Value: 3}},
		ActiveColor: Red,
		CurrentTurn: 0,
		Direction:   1,
	}
	action := BotThink(state, 0)
	if action.Kind != BotPlay || action.Card.Kind != Swap {
		t.Fatalf("action = %+v, want the Swap played", action)
	}
	if action.ChosenPlayer != 2 {
		t.Errorf("ChosenPlayer = %d, want 2 (the one-card hand)", action.ChosenPlayer)
	}
}

// A retired seat's hand went back to the deck, so it is the smallest at the
// table and the one target the domain refuses. It is never chosen.
func TestBotThink_SwapSkipsARetiredSeat(t *testing.T) {
	blue := func(v int) Card { return Card{Color: Blue, Kind: Number, Value: v} }
	state := &GameState{
		Hands: []Hand{
			{Cards: []Card{{Color: Red, Kind: Swap}, blue(1), blue(2), blue(3), blue(4)}},
			{Cards: []Card{blue(5), blue(6)}},
			{},
		},
		Retired:     []bool{false, false, true},
		Discard:     []Card{{Color: Red, Kind: Number, Value: 3}},
		ActiveColor: Red,
		CurrentTurn: 0,
		Direction:   1,
	}
	action := BotThink(state, 0)
	if action.Kind != BotPlay || action.Card.Kind != Swap {
		t.Fatalf("action = %+v, want the Swap played", action)
	}
	if action.ChosenPlayer != 1 {
		t.Errorf("ChosenPlayer = %d, want 1, never the retired seat", action.ChosenPlayer)
	}
}

// When every opponent holds more than the bot would after the play, the Swap
// is a self-inflicted draw: the bot plays something else, and with nothing
// else legal it draws one card rather than take a whole hand.
func TestBotThink_HoldsASwapThatHurts(t *testing.T) {
	blue := func(v int) Card { return Card{Color: Blue, Kind: Number, Value: v} }
	full := Hand{Cards: []Card{blue(5), blue(6), blue(7), blue(8), blue(9)}}
	swap := Card{Color: Red, Kind: Swap}

	withAlternative := &GameState{
		Hands:       []Hand{{Cards: []Card{swap, {Color: Red, Kind: Number, Value: 7}}}, full},
		Discard:     []Card{{Color: Red, Kind: Number, Value: 3}},
		ActiveColor: Red,
		CurrentTurn: 0,
		Direction:   1,
	}
	for i := 0; i < 50; i++ {
		action := BotThink(withAlternative, 0)
		if action.Kind != BotPlay || action.Card.Kind == Swap {
			t.Fatalf("action = %+v, want the red 7 played instead of the Swap", action)
		}
	}

	onlySwap := &GameState{
		Hands:       []Hand{{Cards: []Card{swap, blue(1)}}, full},
		Discard:     []Card{{Color: Red, Kind: Number, Value: 3}},
		ActiveColor: Red,
		CurrentTurn: 0,
		Direction:   1,
	}
	if action := BotThink(onlySwap, 0); action.Kind != BotDraw {
		t.Errorf("action = %+v, want a draw over a Swap into five cards", action)
	}

	// A Swap that empties the hand takes the round before any exchange.
	lastCard := &GameState{
		Hands:       []Hand{{Cards: []Card{swap}}, full},
		Discard:     []Card{{Color: Red, Kind: Number, Value: 3}},
		ActiveColor: Red,
		CurrentTurn: 0,
		Direction:   1,
	}
	if action := BotThink(lastCard, 0); action.Kind != BotPlay || action.Card.Kind != Swap {
		t.Errorf("action = %+v, want the Swap played as the last card", action)
	}
}

// A bot plays its identical copies together when a copy buys something, the
// way a human's tap does: two +2s are a +4, and two identical last cards take
// the round with the call on the message.
func TestBotThink_BatchesCopiesThatBuySomething(t *testing.T) {
	plus2 := Card{Color: Red, Kind: DrawTwo}
	state := &GameState{
		Hands: []Hand{
			{Cards: []Card{plus2, plus2, {Color: Blue, Kind: Number, Value: 4}}},
			{Cards: []Card{{Color: Blue, Kind: Number, Value: 5}}},
		},
		Discard:     []Card{{Color: Red, Kind: Number, Value: 3}},
		ActiveColor: Red,
		CurrentTurn: 0,
		Direction:   1,
	}
	action := BotThink(state, 0)
	if action.Kind != BotPlay || action.Card.Kind != DrawTwo {
		t.Fatalf("action = %+v, want the +2 played", action)
	}
	if len(action.Cards) != 2 {
		t.Errorf("Cards = %v, want both copies", action.Cards)
	}
	if action.DeclareLoco {
		t.Error("DeclareLoco = true on a batch that leaves a card")
	}

	last := &GameState{
		Hands: []Hand{
			{Cards: []Card{plus2, plus2}},
			{Cards: []Card{{Color: Blue, Kind: Number, Value: 5}}},
		},
		Discard:     []Card{{Color: Red, Kind: Number, Value: 3}},
		ActiveColor: Red,
		CurrentTurn: 0,
		Direction:   1,
	}
	action = BotThink(last, 0)
	if len(action.Cards) != 2 || !action.DeclareLoco {
		t.Errorf("action = %+v, want both copies with the call", action)
	}

	// A plain wild buys nothing with its second copy: one at a time.
	wild := Card{Color: Wild, Kind: WildCard}
	wilds := &GameState{
		Hands: []Hand{
			{Cards: []Card{wild, wild, {Color: Blue, Kind: Number, Value: 4}}},
			{Cards: []Card{{Color: Blue, Kind: Number, Value: 5}}},
		},
		Discard:     []Card{{Color: Red, Kind: Number, Value: 3}},
		ActiveColor: Red,
		CurrentTurn: 0,
		Direction:   1,
	}
	action = BotThink(wilds, 0)
	if action.Card.Kind == WildCard && action.Cards != nil {
		t.Errorf("Cards = %v, want a single wild", action.Cards)
	}
}
