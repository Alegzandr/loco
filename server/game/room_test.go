package game

import (
	"testing"
	"time"
)

func TestRoom_Create(t *testing.T) {
	r := NewRoom("ABCD")
	if r.Code != "ABCD" {
		t.Errorf("Room code = %q, want %q", r.Code, "ABCD")
	}
	if r.Status != StatusLobby {
		t.Errorf("Initial status = %v, want Lobby", r.Status)
	}
	if len(r.Players) != 0 {
		t.Errorf("Initial players = %d, want 0", len(r.Players))
	}
}

func TestRoom_Join(t *testing.T) {
	r := NewRoom("TEST")
	err := r.Join("alice")
	if err != nil {
		t.Fatalf("Join() error: %v", err)
	}
	if len(r.Players) != 1 {
		t.Errorf("Players after join = %d, want 1", len(r.Players))
	}
	if r.Players[0].Nickname != "alice" {
		t.Errorf("Player nickname = %q, want %q", r.Players[0].Nickname, "alice")
	}
}

func TestRoom_Join_DuplicateNickname(t *testing.T) {
	r := NewRoom("TEST")
	_ = r.Join("alice")
	err := r.Join("alice")
	if err == nil {
		t.Error("Duplicate nickname should return error")
	}
}

func TestRoom_Join_Full(t *testing.T) {
	r := NewRoom("TEST")
	for i := 0; i < 10; i++ {
		_ = r.Join(string(rune('a' + i)))
	}
	err := r.Join("overflow")
	if err == nil {
		t.Error("Joining a full room should return error")
	}
}

func TestRoom_Join_InProgress(t *testing.T) {
	r := NewRoom("TEST")
	_ = r.Join("alice")
	_ = r.Join("bob")
	_ = r.Start()
	err := r.Join("charlie")
	if err == nil {
		t.Error("Joining an in-progress game should return error")
	}
}

func TestRoom_Start_MinimumPlayers(t *testing.T) {
	r := NewRoom("TEST")
	_ = r.Join("solo")
	err := r.Start()
	if err == nil {
		t.Error("Start with 1 player should return error")
	}
}

func TestRoom_Start_Success(t *testing.T) {
	r := NewRoom("TEST")
	_ = r.Join("alice")
	_ = r.Join("bob")
	err := r.Start()
	if err != nil {
		t.Fatalf("Start() error: %v", err)
	}
	if r.Status != StatusPlaying {
		t.Errorf("Status after start = %v, want Playing", r.Status)
	}
}

func TestRoom_Start_DealsCards(t *testing.T) {
	r := NewRoom("TEST")
	_ = r.Join("alice")
	_ = r.Join("bob")
	_ = r.Start()
	for _, p := range r.Players {
		if len(r.State.Hands[p.Index].Cards) != 7 {
			t.Errorf("Player %q hand size = %d, want 7", p.Nickname, len(r.State.Hands[p.Index].Cards))
		}
	}
}

func TestRoom_PlayCard_NotYourTurn(t *testing.T) {
	r := setupTwoPlayerGame(t)
	// bob (index 1) tries to play on alice's turn (index 0)
	card := r.State.Hands[1].Cards[0]
	err := r.PlayCard(1, card, Red)
	if err == nil {
		t.Error("Playing out of turn should return error")
	}
}

func TestRoom_PlayCard_IllegalCard(t *testing.T) {
	r := setupTwoPlayerGame(t)
	// Force alice's hand to have only a card that doesn't match top
	r.State.Hands[0].Cards = []Card{{Color: Blue, Kind: Number, Value: 3}}
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 5}}
	r.State.ActiveColor = Red

	err := r.PlayCard(0, Card{Color: Blue, Kind: Number, Value: 3}, Red)
	if err == nil {
		t.Error("Playing an illegal card should return error")
	}
}

func TestRoom_PlayCard_Success(t *testing.T) {
	r := setupTwoPlayerGame(t)
	// Give alice a card matching the top
	top := r.State.Discard[len(r.State.Discard)-1]
	matchCard := Card{Color: top.Color, Kind: Number, Value: 0}
	r.State.Hands[0].Cards = append([]Card{matchCard}, r.State.Hands[0].Cards...)

	err := r.PlayCard(0, matchCard, matchCard.Color)
	if err != nil {
		t.Fatalf("PlayCard() error: %v", err)
	}
	// Turn should advance to bob (index 1)
	if r.State.CurrentTurn != 1 {
		t.Errorf("After play, CurrentTurn = %d, want 1", r.State.CurrentTurn)
	}
}

func TestRoom_PlayCard_NotInHand(t *testing.T) {
	r := setupTwoPlayerGame(t)
	fakeCard := Card{Color: Red, Kind: Number, Value: 9}
	// Make sure it's not in hand
	r.State.Hands[0].Cards = []Card{{Color: Red, Kind: Number, Value: 1}}
	err := r.PlayCard(0, fakeCard, Red)
	if err == nil {
		t.Error("Playing a card not in hand should return error")
	}
}

func TestRoom_DrawCard(t *testing.T) {
	r := setupTwoPlayerGame(t)
	r.State.PendingDraw = 0 // ensure no pending draw from first card effect
	handSizeBefore := len(r.State.Hands[0].Cards)
	err := r.DrawCard(0)
	if err != nil {
		t.Fatalf("DrawCard() error: %v", err)
	}
	if len(r.State.Hands[0].Cards) != handSizeBefore+1 {
		t.Errorf("After DrawCard, hand size = %d, want %d", len(r.State.Hands[0].Cards), handSizeBefore+1)
	}
}

func TestRoom_DrawCard_NotYourTurn(t *testing.T) {
	r := setupTwoPlayerGame(t)
	err := r.DrawCard(1) // bob's not the current turn
	if err == nil {
		t.Error("DrawCard out of turn should return error")
	}
}

func TestRoom_WinDetection(t *testing.T) {
	r := setupTwoPlayerGame(t)
	// Give alice exactly 1 card that matches top
	top := r.State.Discard[len(r.State.Discard)-1]
	winCard := Card{Color: top.Color, Kind: Number, Value: 1}
	r.State.Hands[0].Cards = []Card{winCard}
	r.State.LastCardDeclared = true // alice has declared

	err := r.PlayCard(0, winCard, winCard.Color)
	if err != nil {
		t.Fatalf("PlayCard() error: %v", err)
	}
	if r.Status != StatusFinished {
		t.Errorf("Game should be finished, status = %v", r.Status)
	}
	if r.Winner != "alice" {
		t.Errorf("Winner = %q, want %q", r.Winner, "alice")
	}
}

func TestRoom_LastCardDeclaration(t *testing.T) {
	r := setupTwoPlayerGame(t)
	// Give alice exactly 1 card
	r.State.Hands[0].Cards = r.State.Hands[0].Cards[:1]
	err := r.DeclareLastCard(0)
	if err != nil {
		t.Fatalf("DeclareLastCard() error: %v", err)
	}
	if !r.State.LastCardDeclared {
		t.Error("LastCardDeclared should be true")
	}
}

func TestRoom_LastCardDeclaration_PenaltyIfForgot(t *testing.T) {
	r := setupTwoPlayerGame(t)
	top := r.State.Discard[len(r.State.Discard)-1]
	winCard := Card{Color: top.Color, Kind: Number, Value: 1}
	secondCard := Card{Color: top.Color, Kind: Number, Value: 2}
	r.State.Hands[0].Cards = []Card{winCard, secondCard}

	// Play one card leaving 1 in hand, but don't declare
	err := r.PlayCard(0, secondCard, secondCard.Color)
	if err != nil {
		t.Fatalf("PlayCard() error: %v", err)
	}

	// Bob catches alice for not declaring
	err = r.CatchUndeclared(1, 0, time.Now())
	if err != nil {
		t.Fatalf("CatchUndeclared() error: %v", err)
	}
	// Alice should have drawn 2 penalty cards
	if len(r.State.Hands[0].Cards) != 3 { // 1 remaining + 2 penalty
		t.Errorf("After catch, alice's hand size = %d, want 3", len(r.State.Hands[0].Cards))
	}
}

func TestRoom_CounterDrawTwo(t *testing.T) {
	r := setupTwoPlayerGame(t)
	// Give alice a Draw Two matching top
	top := r.State.Discard[len(r.State.Discard)-1]
	drawCard := Card{Color: top.Color, Kind: DrawTwo}
	r.State.Hands[0].Cards = append([]Card{drawCard}, r.State.Hands[0].Cards...)

	err := r.PlayCard(0, drawCard, drawCard.Color)
	if err != nil {
		t.Fatalf("PlayCard with DrawTwo error: %v", err)
	}
	if r.State.PendingDraw != 2 {
		t.Errorf("PendingDraw = %d, want 2", r.State.PendingDraw)
	}

	// Bob counters with another DrawTwo
	counterCard := Card{Color: drawCard.Color, Kind: DrawTwo}
	r.State.Hands[1].Cards = append([]Card{counterCard}, r.State.Hands[1].Cards...)
	err = r.CounterDraw(1, counterCard, counterCard.Color)
	if err != nil {
		t.Fatalf("CounterDraw error: %v", err)
	}
	if r.State.PendingDraw != 4 {
		t.Errorf("After counter, PendingDraw = %d, want 4", r.State.PendingDraw)
	}
}

// setupTwoPlayerGame starts a 2-player game for alice and bob.
func setupTwoPlayerGame(t *testing.T) *Room {
	t.Helper()
	r := NewRoom("GAME")
	if err := r.Join("alice"); err != nil {
		t.Fatal(err)
	}
	if err := r.Join("bob"); err != nil {
		t.Fatal(err)
	}
	if err := r.Start(); err != nil {
		t.Fatal(err)
	}
	r.State.CurrentTurn = 0
	return r
}
