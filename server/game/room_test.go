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

// --- Scoring and match system tests ---

func TestRoom_CardValueScoring(t *testing.T) {
	// Verify scoring: winner gets sum of losers' card values
	r := NewRoom("SCOR")
	_ = r.Join("alice")
	_ = r.Join("bob")
	_ = r.Start()
	r.State.CurrentTurn = 0
	r.State.PendingDraw = 0

	// Give bob a known hand (value = 7 + 20 + 50 = 77)
	r.State.Hands[1].Cards = []Card{
		{Kind: Number, Value: 7},
		{Kind: Skip},
		{Kind: WildCard, Color: Wild},
	}

	// Give alice exactly 1 card that matches the top
	top := r.State.Discard[len(r.State.Discard)-1]
	winCard := Card{Color: top.Color, Kind: Number, Value: top.Value}
	r.State.Hands[0].Cards = []Card{winCard}

	err := r.PlayCard(0, winCard, winCard.Color)
	if err != nil {
		t.Fatalf("PlayCard error: %v", err)
	}

	if r.Scores[0] != 77 {
		t.Errorf("alice score = %d, want 77", r.Scores[0])
	}
	if r.Scores[1] != 0 {
		t.Errorf("bob score = %d, want 0", r.Scores[1])
	}
	if r.RoundsWon[0] != 1 {
		t.Errorf("alice rounds won = %d, want 1", r.RoundsWon[0])
	}
}

func TestRoom_RoundEnd_MatchNotOver_BO3(t *testing.T) {
	r := NewRoom("BO3T")
	_ = r.Join("alice")
	_ = r.Join("bob")
	r.Format = BO3
	_ = r.Start()
	r.State.CurrentTurn = 0
	r.State.PendingDraw = 0

	// Play round 1: alice wins
	top := r.State.Discard[len(r.State.Discard)-1]
	winCard := Card{Color: top.Color, Kind: Number, Value: top.Value}
	r.State.Hands[0].Cards = []Card{winCard}
	r.State.Hands[1].Cards = []Card{{Kind: Number, Value: 5}}

	if err := r.PlayCard(0, winCard, winCard.Color); err != nil {
		t.Fatalf("round 1 PlayCard error: %v", err)
	}

	// Match should NOT be over; new round should have started
	if r.MatchOver {
		t.Error("match should not be over after round 1 of BO3")
	}
	if r.RoundNumber != 2 {
		t.Errorf("RoundNumber = %d, want 2", r.RoundNumber)
	}
	if r.Status != StatusPlaying {
		t.Errorf("Status = %v, want Playing (new round started)", r.Status)
	}
	if r.RoundEnded != true {
		t.Error("RoundEnded should be true")
	}
}

func TestRoom_BO1_MatchOver(t *testing.T) {
	r := NewRoom("BO1T")
	_ = r.Join("alice")
	_ = r.Join("bob")
	r.Format = BO1
	_ = r.Start()
	r.State.CurrentTurn = 0
	r.State.PendingDraw = 0

	top := r.State.Discard[len(r.State.Discard)-1]
	winCard := Card{Color: top.Color, Kind: Number, Value: top.Value}
	r.State.Hands[0].Cards = []Card{winCard}
	r.State.Hands[1].Cards = []Card{{Kind: Skip}}

	if err := r.PlayCard(0, winCard, winCard.Color); err != nil {
		t.Fatalf("PlayCard error: %v", err)
	}

	if !r.MatchOver {
		t.Error("match should be over after BO1")
	}
	if r.MatchWinner != "alice" {
		t.Errorf("MatchWinner = %q, want %q", r.MatchWinner, "alice")
	}
	if r.Status != StatusFinished {
		t.Errorf("Status = %v, want Finished", r.Status)
	}
}

func TestRoom_MatchScoreAccumulation(t *testing.T) {
	// Play 3 rounds and verify scores accumulate
	r := NewRoom("ACC")
	_ = r.Join("alice")
	_ = r.Join("bob")
	r.Format = BO3
	_ = r.Start()

	winRound := func(winnerIdx, loserIdx int, loserCards []Card) {
		t.Helper()
		r.State.CurrentTurn = winnerIdx
		r.State.PendingDraw = 0
		r.State.ActiveColor = Red
		top := Card{Color: Red, Kind: Number, Value: 1}
		r.State.Discard = []Card{top}
		winCard := Card{Color: Red, Kind: Number, Value: 1}
		r.State.Hands[winnerIdx].Cards = []Card{winCard}
		r.State.Hands[loserIdx].Cards = loserCards
		if err := r.PlayCard(winnerIdx, winCard, winCard.Color); err != nil {
			t.Fatalf("PlayCard error: %v", err)
		}
		r.RoundEnded = false // simulate hub clearing the flag
	}

	// Round 1: alice wins, bob has 10 points worth
	winRound(0, 1, []Card{{Kind: Number, Value: 10}})
	if r.Scores[0] != 10 {
		t.Errorf("after round 1, alice score = %d, want 10", r.Scores[0])
	}

	// Round 2: bob wins, alice has 20 points worth
	winRound(1, 0, []Card{{Kind: Skip}})
	if r.Scores[1] != 20 {
		t.Errorf("after round 2, bob score = %d, want 20", r.Scores[1])
	}

	// Round 3: alice wins, bob has 50 points worth → match over
	winRound(0, 1, []Card{{Kind: WildCard, Color: Wild}})
	if r.Scores[0] != 60 { // 10 + 50
		t.Errorf("after round 3, alice score = %d, want 60", r.Scores[0])
	}
	if !r.MatchOver {
		t.Error("match should be over after 3 rounds of BO3")
	}
	if r.MatchWinner != "alice" {
		t.Errorf("MatchWinner = %q, want %q", r.MatchWinner, "alice")
	}
}

func TestRoom_TiebreakerRoundsWon(t *testing.T) {
	// Same score, tiebreak by rounds won
	r := NewRoom("TIE1")
	_ = r.Join("alice")
	_ = r.Join("bob")
	r.Format = BO3
	_ = r.Start()

	// Manually set state to simulate after 2 rounds:
	// alice: 50 pts, 1 win; bob: 50 pts, 1 win (same score, same wins before round 3)
	r.RoundNumber = 2
	r.Scores = []int{50, 50}
	r.RoundsWon = []int{1, 1}
	r.LostHandTotal = []int{50, 50}

	// Round 3: alice wins with score = 0 (bob has no cards — shouldn't happen normally,
	// but for tiebreaker test: give both players different rounds-won so we can test)
	// Instead test determineMatchWinner directly with different rounds won
	r2 := NewRoom("TIE2")
	_ = r2.Join("alice")
	_ = r2.Join("bob")
	r2.Format = BO3
	r2.Scores = []int{50, 50}
	r2.RoundsWon = []int{2, 1}
	r2.LostHandTotal = []int{25, 60}
	winner := r2.determineMatchWinner()
	if winner != "alice" {
		t.Errorf("tiebreaker by rounds won: winner = %q, want %q", winner, "alice")
	}
}

func TestRoom_TiebreakerLostHandTotal(t *testing.T) {
	r := NewRoom("TIE3")
	_ = r.Join("alice")
	_ = r.Join("bob")
	r.Format = BO3
	// Same score, same rounds won → tiebreak by lowest lost hand total
	r.Scores = []int{50, 50}
	r.RoundsWon = []int{1, 1}
	r.LostHandTotal = []int{10, 30} // alice has lower loss total
	winner := r.determineMatchWinner()
	if winner != "alice" {
		t.Errorf("tiebreaker by lost hand total: winner = %q, want %q", winner, "alice")
	}
}

func TestRoom_SuddenDeath(t *testing.T) {
	r := NewRoom("TIE4")
	_ = r.Join("alice")
	_ = r.Join("bob")
	r.Format = BO1
	// All tiebreakers exhausted: sudden death
	r.Scores = []int{50, 50}
	r.RoundsWon = []int{1, 1}
	r.LostHandTotal = []int{10, 10}
	winner := r.determineMatchWinner()
	if winner != "" {
		t.Errorf("perfectly tied: determineMatchWinner() = %q, want %q", winner, "")
	}
}

func TestRoom_SetFormat(t *testing.T) {
	r := NewRoom("FMT")
	_ = r.Join("alice")
	_ = r.Join("bob")
	if err := r.SetFormat(BO5); err != nil {
		t.Fatalf("SetFormat(BO5) error: %v", err)
	}
	if r.Format != BO5 {
		t.Errorf("Format = %v, want BO5", r.Format)
	}
	_ = r.Start()
	if err := r.SetFormat(BO3); err == nil {
		t.Error("SetFormat after game start should return error")
	}
}

func TestRoom_SetMaxPlayers(t *testing.T) {
	r := NewRoom("MAX")
	_ = r.Join("alice")
	_ = r.Join("bob")
	if err := r.SetMaxPlayers(5); err != nil {
		t.Fatalf("SetMaxPlayers(5) error: %v", err)
	}
	if r.MaxPlayers != 5 {
		t.Errorf("MaxPlayers = %d, want 5", r.MaxPlayers)
	}
	// Cannot set below current player count
	if err := r.SetMaxPlayers(1); err == nil {
		t.Error("SetMaxPlayers below current count should return error")
	}
	// Cannot exceed server max
	if err := r.SetMaxPlayers(11); err == nil {
		t.Error("SetMaxPlayers above server max should return error")
	}
}

func TestRoom_RoomCodeCollision(t *testing.T) {
	// Room codes must be unique — the hub retries generation on collision.
	// At the game layer, two rooms can have the same code (code uniqueness is hub's job).
	// This test verifies NewRoom accepts any code string.
	r1 := NewRoom("AABBCC")
	r2 := NewRoom("AABBCC")
	if r1.Code != r2.Code {
		t.Error("code mismatch")
	}
	// Both rooms are independent objects
	_ = r1.Join("alice")
	if len(r2.Players) != 0 {
		t.Error("rooms should be independent")
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
	r.State.PendingDraw = 0 // reset any effect from the starting action card
	return r
}
