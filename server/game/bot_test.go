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

	action := BotThink(state, 0)
	if action.Kind != BotCounter {
		t.Errorf("expected BotCounter, got %v", action.Kind)
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
