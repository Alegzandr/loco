package game

import "testing"

// canPlay tests

func TestCanPlay_MatchColor(t *testing.T) {
	top := Card{Color: Red, Kind: Number, Value: 5}
	card := Card{Color: Red, Kind: Number, Value: 3}
	if !CanPlay(card, top, Red) {
		t.Error("should be able to play same-color card")
	}
}

func TestCanPlay_MatchNumber(t *testing.T) {
	top := Card{Color: Red, Kind: Number, Value: 5}
	card := Card{Color: Blue, Kind: Number, Value: 5}
	if !CanPlay(card, top, Red) {
		t.Error("should be able to play same-number card")
	}
}

func TestCanPlay_MatchKind(t *testing.T) {
	top := Card{Color: Red, Kind: Skip}
	card := Card{Color: Blue, Kind: Skip}
	if !CanPlay(card, top, Red) {
		t.Error("should be able to play same-kind action card")
	}
}

func TestCanPlay_Wild(t *testing.T) {
	top := Card{Color: Red, Kind: Number, Value: 7}
	card := Card{Color: Wild, Kind: WildCard}
	if !CanPlay(card, top, Red) {
		t.Error("Wild can always be played")
	}
}

func TestCanPlay_WildDrawFour(t *testing.T) {
	top := Card{Color: Green, Kind: Number, Value: 2}
	card := Card{Color: Wild, Kind: WildDrawFour}
	if !CanPlay(card, top, Green) {
		t.Error("WildDrawFour can always be played")
	}
}

func TestCanPlay_Mismatch(t *testing.T) {
	top := Card{Color: Red, Kind: Number, Value: 5}
	card := Card{Color: Blue, Kind: Number, Value: 3}
	if CanPlay(card, top, Red) {
		t.Error("mismatched color and number should not be playable")
	}
}

func TestCanPlay_AfterWild_UsesChosenColor(t *testing.T) {
	// Top card is a wild; active color is Blue
	top := Card{Color: Wild, Kind: WildCard}
	card := Card{Color: Blue, Kind: Number, Value: 4}
	if !CanPlay(card, top, Blue) {
		t.Error("should match the chosen wild color")
	}
}

func TestCanPlay_AfterWild_WrongColor(t *testing.T) {
	top := Card{Color: Wild, Kind: WildCard}
	card := Card{Color: Red, Kind: Number, Value: 4}
	if CanPlay(card, top, Blue) {
		t.Error("should not match wrong color after wild")
	}
}

// ApplyEffect tests

func TestApplyEffect_Skip(t *testing.T) {
	state := newTestState(4, 0)
	card := Card{Color: Red, Kind: Skip}
	next := state.ApplyEffect(card, Red)
	// Current turn is 0; skip means player 1 is skipped → next is player 2
	if next != 2 {
		t.Errorf("Skip: next turn = %d, want 2", next)
	}
}

func TestApplyEffect_Reverse_MoreThan2Players(t *testing.T) {
	state := newTestState(4, 0)
	card := Card{Color: Red, Kind: Reverse}
	state.ApplyEffect(card, Red)
	if state.Direction != -1 {
		t.Error("Reverse should change direction to -1")
	}
}

func TestApplyEffect_Reverse_2Players(t *testing.T) {
	// With 2 players, Reverse acts like Skip
	state := newTestState(2, 0)
	card := Card{Color: Red, Kind: Reverse}
	next := state.ApplyEffect(card, Red)
	// Direction flips then current player gets another turn
	if next != 0 {
		t.Errorf("Reverse with 2 players: next = %d, want 0", next)
	}
}

func TestApplyEffect_DrawTwo_PenalizesNext(t *testing.T) {
	state := newTestState(4, 0)
	card := Card{Color: Red, Kind: DrawTwo}
	state.ApplyEffect(card, Red)
	if state.PendingDraw != 2 {
		t.Errorf("DrawTwo: PendingDraw = %d, want 2", state.PendingDraw)
	}
}

func TestApplyEffect_WildDrawFour_PenalizesNext(t *testing.T) {
	state := newTestState(4, 0)
	card := Card{Color: Wild, Kind: WildDrawFour}
	state.ApplyEffect(card, Blue)
	if state.PendingDraw != 4 {
		t.Errorf("WildDrawFour: PendingDraw = %d, want 4", state.PendingDraw)
	}
	if state.ActiveColor != Blue {
		t.Errorf("WildDrawFour: ActiveColor = %v, want Blue", state.ActiveColor)
	}
}

func TestApplyEffect_Wild_SetsColor(t *testing.T) {
	state := newTestState(4, 0)
	card := Card{Color: Wild, Kind: WildCard}
	state.ApplyEffect(card, Green)
	if state.ActiveColor != Green {
		t.Errorf("Wild: ActiveColor = %v, want Green", state.ActiveColor)
	}
}

func TestApplyEffect_GlobalSwitch_SetsChosenColor(t *testing.T) {
	// GlobalSwitch is a wild like the other two: the player names the colour.
	state := newTestState(4, 0)
	state.ActiveColor = Red
	state.ApplyEffect(Card{Color: Wild, Kind: GlobalSwitch}, Yellow)
	if state.ActiveColor != Yellow {
		t.Errorf("GlobalSwitch: ActiveColor = %v, want Yellow (chosen)", state.ActiveColor)
	}
}

func TestApplyEffect_GlobalSwitch_NeverSetsWildAsActiveColor(t *testing.T) {
	// Last line of defence: Wild matches no coloured card, so it would leave the
	// whole table holding wilds as its only legal play. The callers reject a
	// colourless GlobalSwitch outright; if one slips through, the colour in play
	// carries over rather than becoming Wild.
	state := newTestState(4, 0)
	state.ActiveColor = Green
	state.ApplyEffect(Card{Color: Wild, Kind: GlobalSwitch}, Wild)
	if state.ActiveColor != Green {
		t.Errorf("GlobalSwitch: ActiveColor = %v, want Green (carried over)", state.ActiveColor)
	}
}

func TestApplyEffect_Wild_NeverSetsWildAsActiveColor(t *testing.T) {
	state := newTestState(4, 0)
	state.ActiveColor = Blue
	state.ApplyEffect(Card{Color: Wild, Kind: WildCard}, Wild)
	if state.ActiveColor != Blue {
		t.Errorf("ActiveColor = %v, want Blue — Wild must never become the active colour", state.ActiveColor)
	}
}

// helper to build a minimal game state for rule testing
func newTestState(players, currentTurn int) *GameState {
	hands := make([]Hand, players)
	return &GameState{
		Hands:       hands,
		CurrentTurn: currentTurn,
		Direction:   1,
		ActiveColor: Red,
	}
}
