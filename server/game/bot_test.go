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
	hand.Add(Card{Color: Blue, Kind: DrawTwo})

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
