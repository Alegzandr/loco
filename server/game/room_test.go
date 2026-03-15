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
	err := r.PlayCard(1, card, Red, -1)
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

	err := r.PlayCard(0, Card{Color: Blue, Kind: Number, Value: 3}, Red, -1)
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

	err := r.PlayCard(0, matchCard, matchCard.Color, -1)
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
	err := r.PlayCard(0, fakeCard, Red, -1)
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

func TestRoom_DrawCard_FinishedPlayer(t *testing.T) {
	r := setupTwoPlayerGame(t)
	// Manually mark alice as finished (simulates having already played out all cards)
	r.State.Finished[0] = true
	err := r.DrawCard(0)
	if err == nil {
		t.Error("DrawCard by finished player should return error")
	}
}

func TestRoom_PassTurn_FinishedPlayer(t *testing.T) {
	r := setupTwoPlayerGame(t)
	r.State.Finished[0] = true
	r.State.HasDrawn = true // would normally allow PassTurn
	err := r.PassTurn(0)
	if err == nil {
		t.Error("PassTurn by finished player should return error")
	}
}

func TestRoom_DrawCard_OncePerTurn(t *testing.T) {
	r := setupTwoPlayerGame(t)
	r.State.PendingDraw = 0

	// First draw should succeed and set HasDrawn
	if err := r.DrawCard(0); err != nil {
		t.Fatalf("first DrawCard error: %v", err)
	}
	if !r.State.HasDrawn {
		t.Error("HasDrawn should be true after drawing")
	}

	// Second draw in the same turn should fail
	if err := r.DrawCard(0); err == nil {
		t.Error("second DrawCard in same turn should return error")
	}
}

func TestRoom_PassTurn_RequiresDraw(t *testing.T) {
	r := setupTwoPlayerGame(t)
	r.State.PendingDraw = 0

	// PassTurn without drawing should fail
	if err := r.PassTurn(0); err == nil {
		t.Error("PassTurn without drawing should return error")
	}
}

func TestRoom_DrawThenPass_ResetsHasDrawn(t *testing.T) {
	r := setupTwoPlayerGame(t)
	r.State.PendingDraw = 0

	// Alice draws then passes
	if err := r.DrawCard(0); err != nil {
		t.Fatalf("DrawCard error: %v", err)
	}
	if err := r.PassTurn(0); err != nil {
		t.Fatalf("PassTurn error: %v", err)
	}
	if r.State.HasDrawn {
		t.Error("HasDrawn should be false after PassTurn")
	}
	// Now Bob (index 1) should be able to draw
	r.State.PendingDraw = 0
	if err := r.DrawCard(1); err != nil {
		t.Fatalf("Bob DrawCard after turn change error: %v", err)
	}
}

func TestRoom_PlayCard_ResetsHasDrawn(t *testing.T) {
	r := setupTwoPlayerGame(t)
	// Give alice a card matching the top
	top := r.State.Discard[len(r.State.Discard)-1]
	matchCard := Card{Color: top.Color, Kind: Number, Value: 0}
	r.State.Hands[0].Cards = append([]Card{matchCard}, r.State.Hands[0].Cards...)
	r.State.HasDrawn = true // simulate having drawn

	if err := r.PlayCard(0, matchCard, matchCard.Color, -1); err != nil {
		t.Fatalf("PlayCard error: %v", err)
	}
	if r.State.HasDrawn {
		t.Error("HasDrawn should be false after playing a card")
	}
}

func TestRoom_WinDetection(t *testing.T) {
	r := setupTwoPlayerGame(t)
	// Give alice exactly 1 card that matches top
	top := r.State.Discard[len(r.State.Discard)-1]
	winCard := Card{Color: top.Color, Kind: Number, Value: 1}
	r.State.Hands[0].Cards = []Card{winCard}
	r.State.LastCardDeclared = true // alice has declared

	err := r.PlayCard(0, winCard, winCard.Color, -1)
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
	err := r.PlayCard(0, secondCard, secondCard.Color, -1)
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

// TestRoom_CatchUndeclared_WindowExpired verifies that a catch attempt is rejected
// if more than catchWindow (5 s) has elapsed since the last card was played.
func TestRoom_CatchUndeclared_WindowExpired(t *testing.T) {
	r := setupTwoPlayerGame(t)
	top := r.State.Discard[len(r.State.Discard)-1]
	playCard := Card{Color: top.Color, Kind: Number, Value: 1}
	leaveCard := Card{Color: top.Color, Kind: Number, Value: 2}
	r.State.Hands[0].Cards = []Card{leaveCard, playCard}

	// Alice plays leaveCard → now at 1 card (playCard remains), catch window opens
	if err := r.PlayCard(0, leaveCard, leaveCard.Color, -1); err != nil {
		t.Fatalf("PlayCard: %v", err)
	}
	if r.State.LastCardTime.IsZero() {
		t.Fatal("expected LastCardTime to be set after playing to 1 card")
	}

	// Simulate 6 seconds later — window is expired
	future := time.Now().Add(6 * time.Second)
	err := r.CatchUndeclared(1, 0, future)
	if err == nil {
		t.Fatal("expected error for expired catch window, got nil")
	}
	if err.Error() != "catch window expired" {
		t.Errorf("got error %q, want %q", err.Error(), "catch window expired")
	}
}

// TestRoom_CatchUndeclared_AfterDeclared verifies that once a player declares UNO,
// no other player can catch them.
func TestRoom_CatchUndeclared_AfterDeclared(t *testing.T) {
	r := setupTwoPlayerGame(t)
	top := r.State.Discard[len(r.State.Discard)-1]
	playCard := Card{Color: top.Color, Kind: Number, Value: 1}
	leaveCard := Card{Color: top.Color, Kind: Number, Value: 2}
	r.State.Hands[0].Cards = []Card{leaveCard, playCard}

	if err := r.PlayCard(0, leaveCard, leaveCard.Color, -1); err != nil {
		t.Fatalf("PlayCard: %v", err)
	}
	if err := r.DeclareLastCard(0); err != nil {
		t.Fatalf("DeclareLastCard: %v", err)
	}
	if !r.State.LastCardDeclared {
		t.Fatal("expected LastCardDeclared = true after declaration")
	}

	// Bob tries to catch — must fail
	err := r.CatchUndeclared(1, 0, time.Now())
	if err == nil {
		t.Fatal("expected error catching after declaration, got nil")
	}
	if err.Error() != "player already declared" {
		t.Errorf("got error %q, want %q", err.Error(), "player already declared")
	}
}

// TestRoom_UNOStateCleanOnNewRound verifies that all UNO-tracking fields (LastCardDeclared,
// LastCardTime, LastCardPlayer) are properly reset to zero values when a new round starts.
// Specifically, stale catch attempts on the new round must fail the catch window check
// (zero LastCardTime is always outside the 5-second window).
func TestRoom_UNOStateCleanOnNewRound(t *testing.T) {
	r := setupTwoPlayerGame(t)
	r.Format = BO3 // multi-round match so ending round 1 starts round 2

	top := r.State.Discard[len(r.State.Discard)-1]
	matchColor := top.Color

	// Alice: 2 cards (both playable); Bob: 1 card (playable off Alice's play)
	aliceCard1 := Card{Color: matchColor, Kind: Number, Value: 2}
	aliceCard2 := Card{Color: matchColor, Kind: Number, Value: 3}
	bobCard := Card{Color: matchColor, Kind: Number, Value: 4}
	r.State.Hands[0].Cards = []Card{aliceCard1, aliceCard2}
	r.State.Hands[1].Cards = []Card{bobCard}

	// Alice plays aliceCard1 → drops to 1 card. Catch window opens.
	if err := r.PlayCard(0, aliceCard1, matchColor, -1); err != nil {
		t.Fatalf("alice play: %v", err)
	}
	if r.State.LastCardTime.IsZero() {
		t.Fatal("round 1: expected LastCardTime set after alice plays to 1 card")
	}
	if r.State.LastCardDeclared {
		t.Fatal("round 1: expected LastCardDeclared = false (no declaration)")
	}

	// Bob plays his only card → 0 cards → round 1 ends, round 2 starts
	if err := r.PlayCard(1, bobCard, matchColor, -1); err != nil {
		t.Fatalf("bob play: %v", err)
	}
	if r.RoundNumber != 2 {
		t.Fatalf("expected round 2 after bob empties hand, got %d", r.RoundNumber)
	}

	// New round must have clean UNO state
	if r.State.LastCardDeclared {
		t.Error("round 2: LastCardDeclared should be false (zero value from dealRound)")
	}
	if !r.State.LastCardTime.IsZero() {
		t.Errorf("round 2: LastCardTime should be zero (fresh deal), got %v", r.State.LastCardTime)
	}

	// Any catch attempt must fail: zero LastCardTime → window is always expired
	err := r.CatchUndeclared(0, 1, time.Now())
	if err == nil {
		t.Fatal("catch at round-2 start must fail (zero LastCardTime means window expired)")
	}
}

func TestRoom_CounterDrawTwo(t *testing.T) {
	r := setupTwoPlayerGame(t)
	// Give alice a Draw Two matching top
	top := r.State.Discard[len(r.State.Discard)-1]
	drawCard := Card{Color: top.Color, Kind: DrawTwo}
	r.State.Hands[0].Cards = append([]Card{drawCard}, r.State.Hands[0].Cards...)

	err := r.PlayCard(0, drawCard, drawCard.Color, -1)
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

	err := r.PlayCard(0, winCard, winCard.Color, -1)
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

	if err := r.PlayCard(0, winCard, winCard.Color, -1); err != nil {
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

	if err := r.PlayCard(0, winCard, winCard.Color, -1); err != nil {
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
		if err := r.PlayCard(winnerIdx, winCard, winCard.Color, -1); err != nil {
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

// --- Placement and multi-player round model tests ---

func TestRoom_PlacementFlow_ThreePlayers(t *testing.T) {
	r := setupThreePlayerGame(t)

	// Force a known state: Red-1 on top
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 1}}
	r.State.PendingDraw = 0
	r.State.Direction = 1 // ensure clockwise so turn 0→1→2

	// alice has 1 matching card; bob has Skip (20pts); carol has Wild (50pts)
	r.State.Hands[0].Cards = []Card{{Color: Red, Kind: Number, Value: 1}}
	r.State.Hands[1].Cards = []Card{{Kind: Skip}}
	r.State.Hands[2].Cards = []Card{{Kind: WildCard, Color: Wild}}

	// Alice plays her last card
	if err := r.PlayCard(0, Card{Color: Red, Kind: Number, Value: 1}, Red, -1); err != nil {
		t.Fatalf("alice play: %v", err)
	}

	// Alice finished; round should NOT end (2 active players remain)
	if !r.State.Finished[0] {
		t.Error("alice should be marked finished")
	}
	if r.RoundEnded {
		t.Error("round should not end with 2 players remaining")
	}
	// alice scores bob(20) + carol(50) = 70
	if r.Scores[0] != 70 {
		t.Errorf("alice score = %d, want 70", r.Scores[0])
	}
	if r.Winner != "alice" {
		t.Errorf("round winner = %q, want alice", r.Winner)
	}
	if r.RoundsWon[0] != 1 {
		t.Errorf("alice rounds won = %d, want 1", r.RoundsWon[0])
	}
	// Turn should advance to bob (index 1)
	if r.State.CurrentTurn != 1 {
		t.Errorf("current turn = %d, want 1 (bob)", r.State.CurrentTurn)
	}

	// Bob's turn: give him a card matching a new top
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 2}}
	r.State.Hands[1].Cards = []Card{{Color: Red, Kind: Number, Value: 2}}

	if err := r.PlayCard(1, Card{Color: Red, Kind: Number, Value: 2}, Red, -1); err != nil {
		t.Fatalf("bob play: %v", err)
	}

	// Bob finished; round should end (only carol remains)
	if !r.State.Finished[1] {
		t.Error("bob should be marked finished")
	}
	if !r.RoundEnded {
		t.Error("round should end when only carol remains")
	}
	// bob scores carol's Wild (50)
	if r.Scores[1] != 50 {
		t.Errorf("bob score = %d, want 50", r.Scores[1])
	}
	// carol scores 0 (last remaining)
	if r.Scores[2] != 0 {
		t.Errorf("carol score = %d, want 0", r.Scores[2])
	}
	if r.RoundsWon[1] != 0 {
		t.Errorf("bob rounds won = %d, want 0", r.RoundsWon[1])
	}
	// carol's hand value is added to LostHandTotal
	if r.LostHandTotal[2] != 50 {
		t.Errorf("carol LostHandTotal = %d, want 50", r.LostHandTotal[2])
	}
}

func TestRoom_PlacementScoring_EachPlacementScoredCorrectly(t *testing.T) {
	// 4 players: p0 finishes 1st (scores p1+p2+p3),
	//            p1 finishes 2nd (scores p2+p3),
	//            p2 finishes 3rd (scores p3),
	//            p3 scores 0 and is last
	r := NewRoom("PSCO")
	for _, nick := range []string{"p0", "p1", "p2", "p3"} {
		if err := r.Join(nick); err != nil {
			t.Fatal(err)
		}
	}
	if err := r.Start(); err != nil {
		t.Fatal(err)
	}
	r.State.CurrentTurn = 0
	r.State.PendingDraw = 0
	r.State.Direction = 1 // clockwise: 0→1→2→3

	// p0: 1 card worth 1; p1: 1 card worth 2; p2: 1 card worth 3; p3: 1 card worth 5
	playCard := func(playerIdx int, cardVal int) {
		t.Helper()
		c := Card{Color: Red, Kind: Number, Value: cardVal}
		r.State.ActiveColor = Red
		r.State.Discard = []Card{c}
		r.State.Hands[playerIdx].Cards = []Card{c}
		if err := r.PlayCard(playerIdx, c, Red, -1); err != nil {
			t.Fatalf("player %d play: %v", playerIdx, err)
		}
	}

	// Initial hands for non-current players (values matter for scoring)
	r.State.Hands[1].Cards = []Card{{Kind: Number, Value: 2}}
	r.State.Hands[2].Cards = []Card{{Kind: Number, Value: 3}}
	r.State.Hands[3].Cards = []Card{{Kind: Number, Value: 5}}
	playCard(0, 1)
	// p0 scores: p1(2)+p2(3)+p3(5) = 10
	if r.Scores[0] != 10 {
		t.Errorf("p0 score after 1st place = %d, want 10", r.Scores[0])
	}
	if r.RoundEnded {
		t.Error("round should not end after p0 finishes")
	}

	// p1 finishes 2nd (p2 and p3 still active)
	r.State.Hands[2].Cards = []Card{{Kind: Number, Value: 3}}
	r.State.Hands[3].Cards = []Card{{Kind: Number, Value: 5}}
	playCard(1, 2)
	// p1 scores: p2(3)+p3(5) = 8
	if r.Scores[1] != 8 {
		t.Errorf("p1 score after 2nd place = %d, want 8", r.Scores[1])
	}
	if r.RoundEnded {
		t.Error("round should not end after p1 finishes")
	}

	// p2 finishes 3rd (only p3 remains)
	r.State.Hands[3].Cards = []Card{{Kind: Number, Value: 5}}
	playCard(2, 3)
	// p2 scores: p3(5) = 5
	if r.Scores[2] != 5 {
		t.Errorf("p2 score after 3rd place = %d, want 5", r.Scores[2])
	}
	// Round ends now (only p3 was left)
	if !r.RoundEnded {
		t.Error("round should end when only p3 remains")
	}
	// p3 scores 0
	if r.Scores[3] != 0 {
		t.Errorf("p3 score = %d, want 0", r.Scores[3])
	}
	// p3's hand value goes to LostHandTotal
	if r.LostHandTotal[3] != 5 {
		t.Errorf("p3 LostHandTotal = %d, want 5", r.LostHandTotal[3])
	}
	// p0 is round winner
	if r.Winner != "p0" {
		t.Errorf("round winner = %q, want p0", r.Winner)
	}
	if r.RoundsWon[0] != 1 {
		t.Errorf("p0 rounds won = %d, want 1", r.RoundsWon[0])
	}
}

func TestRoom_RoundEnd_LastPlayerRemaining(t *testing.T) {
	// Round ends when exactly 1 player remains with cards.
	r := setupThreePlayerGame(t)
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 1}}
	r.State.PendingDraw = 0
	r.State.Direction = 1 // clockwise: 0→1→2
	r.State.Hands[0].Cards = []Card{{Color: Red, Kind: Number, Value: 1}}
	r.State.Hands[1].Cards = []Card{{Kind: Number, Value: 5}}
	r.State.Hands[2].Cards = []Card{{Kind: Number, Value: 3}}

	// alice finishes
	if err := r.PlayCard(0, Card{Color: Red, Kind: Number, Value: 1}, Red, -1); err != nil {
		t.Fatalf("alice play: %v", err)
	}
	if r.RoundEnded {
		t.Error("round should not end after alice finishes (2 remain)")
	}

	// bob finishes
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 5}}
	r.State.ActiveColor = Red
	r.State.Hands[1].Cards = []Card{{Color: Red, Kind: Number, Value: 5}}
	if err := r.PlayCard(1, Card{Color: Red, Kind: Number, Value: 5}, Red, -1); err != nil {
		t.Fatalf("bob play: %v", err)
	}

	// Round should now be over (only carol remains)
	if !r.RoundEnded {
		t.Error("round should end when only carol remains")
	}
	// carol's card value (3) should be in LostHandTotal
	if r.LostHandTotal[2] != 3 {
		t.Errorf("carol LostHandTotal = %d, want 3", r.LostHandTotal[2])
	}
	// Placements: alice(0), bob(1), carol(2)
	if len(r.State.Placements) != 3 {
		t.Errorf("placements length = %d, want 3", len(r.State.Placements))
	}
	if r.State.Placements[0] != 0 || r.State.Placements[1] != 1 || r.State.Placements[2] != 2 {
		t.Errorf("placements = %v, want [0 1 2]", r.State.Placements)
	}
}

func TestRoom_TurnSkipsFinishedPlayers(t *testing.T) {
	// In a 3-player game, when alice (0) finishes, turn should skip her.
	r := setupThreePlayerGame(t)
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 1}}
	r.State.CurrentTurn = 0
	r.State.PendingDraw = 0
	r.State.Direction = 1 // clockwise: alice(0)→bob(1)→carol(2)
	r.State.Hands[0].Cards = []Card{{Color: Red, Kind: Number, Value: 1}}
	r.State.Hands[1].Cards = []Card{{Kind: Number, Value: 5}}
	r.State.Hands[2].Cards = []Card{{Kind: Number, Value: 3}}

	// alice finishes → turn should go to bob (1), not alice (0) or carol (2)
	if err := r.PlayCard(0, Card{Color: Red, Kind: Number, Value: 1}, Red, -1); err != nil {
		t.Fatalf("alice play: %v", err)
	}
	if r.State.CurrentTurn != 1 {
		t.Errorf("after alice finishes, turn = %d, want 1 (bob)", r.State.CurrentTurn)
	}
}

func TestRoom_FinishedPlayerCannotAct(t *testing.T) {
	// A finished player cannot catch (finished players cannot act).
	r := setupThreePlayerGame(t)
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 1}}
	r.State.CurrentTurn = 0
	r.State.PendingDraw = 0
	r.State.Direction = 1
	r.State.Hands[0].Cards = []Card{{Color: Red, Kind: Number, Value: 1}}
	r.State.Hands[1].Cards = []Card{{Kind: Number, Value: 5}}
	r.State.Hands[2].Cards = []Card{{Kind: Number, Value: 3}}

	// alice finishes
	_ = r.PlayCard(0, Card{Color: Red, Kind: Number, Value: 1}, Red, -1)

	// alice tries to catch — should fail
	if err := r.CatchUndeclared(0, 1, time.Now()); err == nil {
		t.Error("finished player should not be able to catch")
	}
}

// --- Swap and GlobalSwitch tests ---

func TestRoom_SwapCard_SwapsHands(t *testing.T) {
	r := setupTwoPlayerGame(t)

	// Give alice a Swap card and some extras; give bob a known hand
	swapCard := Card{Color: Wild, Kind: Swap}
	r.State.Hands[0].Cards = []Card{swapCard, {Color: Red, Kind: Number, Value: 1}}
	r.State.Hands[1].Cards = []Card{
		{Color: Blue, Kind: Skip},
		{Color: Green, Kind: Number, Value: 7},
	}

	// Set up a discard that allows any card (red number on top; swap is wild → always legal)
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 3}}
	r.State.ActiveColor = Red

	err := r.PlayCard(0, swapCard, Wild, 1) // swap with bob (index 1)
	if err != nil {
		t.Fatalf("PlayCard Swap error: %v", err)
	}

	// Alice should now have bob's original 2 cards; bob should have alice's remaining 1 card
	if len(r.State.Hands[0].Cards) != 2 {
		t.Errorf("after swap, alice hand size = %d, want 2", len(r.State.Hands[0].Cards))
	}
	if len(r.State.Hands[1].Cards) != 1 {
		t.Errorf("after swap, bob hand size = %d, want 1", len(r.State.Hands[1].Cards))
	}
	// Alice's new hand should be bob's original cards
	if r.State.Hands[0].Cards[0].Kind != Skip {
		t.Errorf("after swap, alice card[0] kind = %v, want Skip", r.State.Hands[0].Cards[0].Kind)
	}
	// Turn should advance to bob (index 1)
	if r.State.CurrentTurn != 1 {
		t.Errorf("after swap, CurrentTurn = %d, want 1", r.State.CurrentTurn)
	}
}

func TestRoom_SwapCard_InvalidTarget(t *testing.T) {
	r := setupTwoPlayerGame(t)
	swapCard := Card{Color: Wild, Kind: Swap}
	r.State.Hands[0].Cards = []Card{swapCard}
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 3}}
	r.State.ActiveColor = Red

	// Self-swap should fail
	if err := r.PlayCard(0, swapCard, Wild, 0); err == nil {
		t.Error("swapping with self should return error")
	}
	// Out-of-range index should fail
	if err := r.PlayCard(0, swapCard, Wild, 99); err == nil {
		t.Error("swap with out-of-range index should return error")
	}
}

func TestRoom_GlobalSwitch_RotatesHands_Clockwise(t *testing.T) {
	r := setupThreePlayerGame(t)

	gsCard := Card{Color: Wild, Kind: GlobalSwitch}
	hand0 := []Card{{Color: Red, Kind: Number, Value: 1}, {Color: Blue, Kind: Number, Value: 2}}
	hand1 := []Card{{Color: Green, Kind: Number, Value: 3}}
	hand2 := []Card{{Color: Yellow, Kind: Skip}, {Color: Red, Kind: DrawTwo}, {Color: Blue, Kind: Reverse}}

	r.State.Hands[0].Cards = append([]Card{gsCard}, hand0...)
	r.State.Hands[1].Cards = hand1
	r.State.Hands[2].Cards = hand2
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 9}}
	r.State.ActiveColor = Red
	r.State.Direction = 1 // clockwise: 0→1→2

	err := r.PlayCard(0, gsCard, Wild, -1)
	if err != nil {
		t.Fatalf("PlayCard GlobalSwitch error: %v", err)
	}

	// With direction=1 (clockwise), rotation means each player gets the hand of
	// the previous player: player[i] gets old hand[(i-1+n)%n]
	// player0 gets old hand2 (3 cards), player1 gets old hand0 minus gsCard (2 cards),
	// player2 gets old hand1 (1 card)
	if len(r.State.Hands[0].Cards) != 3 {
		t.Errorf("after GlobalSwitch, player0 hand size = %d, want 3", len(r.State.Hands[0].Cards))
	}
	if len(r.State.Hands[1].Cards) != 2 {
		t.Errorf("after GlobalSwitch, player1 hand size = %d, want 2", len(r.State.Hands[1].Cards))
	}
	if len(r.State.Hands[2].Cards) != 1 {
		t.Errorf("after GlobalSwitch, player2 hand size = %d, want 1", len(r.State.Hands[2].Cards))
	}
}

func TestRoom_GlobalSwitch_AlwaysClockwiseEvenWhenGameDirectionReversed(t *testing.T) {
	// GlobalSwitch always rotates clockwise regardless of current game direction.
	r := setupThreePlayerGame(t)

	gsCard := Card{Color: Wild, Kind: GlobalSwitch}
	hand0 := []Card{{Color: Red, Kind: Number, Value: 1}}
	hand1 := []Card{{Color: Green, Kind: Number, Value: 3}, {Color: Blue, Kind: Number, Value: 4}}
	hand2 := []Card{{Color: Yellow, Kind: Skip}, {Color: Red, Kind: DrawTwo}, {Color: Blue, Kind: Reverse}}

	r.State.Hands[0].Cards = append([]Card{gsCard}, hand0...)
	r.State.Hands[1].Cards = hand1
	r.State.Hands[2].Cards = hand2
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 9}}
	r.State.ActiveColor = Red
	r.State.Direction = -1 // game is counter-clockwise, but GlobalSwitch must still rotate clockwise

	err := r.PlayCard(0, gsCard, Wild, -1)
	if err != nil {
		t.Fatalf("PlayCard GlobalSwitch with reversed direction error: %v", err)
	}

	// Clockwise rotation always: newHands[i] = Hands[(i-1+n)%n]
	// player0 gets old hand2 (3 cards), player1 gets old hand0 minus gsCard (1 card),
	// player2 gets old hand1 (2 cards)
	if len(r.State.Hands[0].Cards) != 3 {
		t.Errorf("GlobalSwitch with direction=-1: player0 hand size = %d, want 3", len(r.State.Hands[0].Cards))
	}
	if len(r.State.Hands[1].Cards) != 1 {
		t.Errorf("GlobalSwitch with direction=-1: player1 hand size = %d, want 1", len(r.State.Hands[1].Cards))
	}
	if len(r.State.Hands[2].Cards) != 2 {
		t.Errorf("GlobalSwitch with direction=-1: player2 hand size = %d, want 2", len(r.State.Hands[2].Cards))
	}
}

func TestRoom_SwapCard_AlwaysPlayable(t *testing.T) {
	// Swap is wild, so it should always be playable (mirrors WildCard behavior)
	r := setupTwoPlayerGame(t)
	swapCard := Card{Color: Wild, Kind: Swap}
	r.State.Hands[0].Cards = []Card{swapCard}
	r.State.Discard = []Card{{Color: Blue, Kind: Number, Value: 7}}
	r.State.ActiveColor = Blue

	top := r.State.Discard[len(r.State.Discard)-1]
	if !CanPlay(swapCard, top, r.State.ActiveColor) {
		t.Error("Swap card should always be playable (is wild)")
	}
}

func TestRoom_GlobalSwitch_AlwaysPlayable(t *testing.T) {
	r := setupTwoPlayerGame(t)
	gsCard := Card{Color: Wild, Kind: GlobalSwitch}
	r.State.Discard = []Card{{Color: Green, Kind: Skip}}
	r.State.ActiveColor = Green

	top := r.State.Discard[len(r.State.Discard)-1]
	if !CanPlay(gsCard, top, r.State.ActiveColor) {
		t.Error("GlobalSwitch card should always be playable (is wild)")
	}
}

// --- Draw stack regression tests ---

// TestPenaltyDraw_ConsumesStack verifies that DrawCard when PendingDraw > 0
// draws exactly PendingDraw cards and resets PendingDraw to 0.
func TestPenaltyDraw_ConsumesStack(t *testing.T) {
	r := setupTwoPlayerGame(t)

	// Simulate alice playing a +2: bob is now facing a penalty of 2.
	r.State.CurrentTurn = 1 // bob's turn
	r.State.PendingDraw = 2

	bobHandBefore := len(r.State.Hands[1].Cards)
	if err := r.DrawCard(1); err != nil {
		t.Fatalf("DrawCard error: %v", err)
	}

	if r.State.PendingDraw != 0 {
		t.Errorf("PendingDraw = %d after penalty draw, want 0", r.State.PendingDraw)
	}
	if len(r.State.Hands[1].Cards) != bobHandBefore+2 {
		t.Errorf("bob hand size = %d, want %d", len(r.State.Hands[1].Cards), bobHandBefore+2)
	}
}

// TestPenaltyDraw_EndsTurn verifies that a penalty draw advances the turn
// immediately, without requiring a separate PassTurn call.
func TestPenaltyDraw_EndsTurn(t *testing.T) {
	r := setupTwoPlayerGame(t)

	// Bob faces a +4 penalty stack.
	r.State.CurrentTurn = 1
	r.State.PendingDraw = 4

	if err := r.DrawCard(1); err != nil {
		t.Fatalf("DrawCard error: %v", err)
	}

	// Turn must have advanced to alice (player 0), not stayed on bob.
	if r.State.CurrentTurn == 1 {
		t.Error("turn did not advance after penalty draw — game would be stuck")
	}
	if r.State.CurrentTurn != 0 {
		t.Errorf("CurrentTurn = %d after penalty draw, want 0 (alice)", r.State.CurrentTurn)
	}
	// HasDrawn must be false so alice's normal draw mechanic is unaffected.
	if r.State.HasDrawn {
		t.Error("HasDrawn should be false after penalty draw advances the turn")
	}
	// PassTurn on bob must now fail (it's not bob's turn).
	if err := r.PassTurn(1); err == nil {
		t.Error("PassTurn should fail after penalty draw advanced the turn")
	}
}

// TestCounterDraw_StackContinues verifies that CounterDraw accumulates the
// penalty and passes it to the next player, keeping PendingDraw non-zero.
func TestCounterDraw_StackContinues(t *testing.T) {
	r := setupThreePlayerGame(t)
	// alice(0) → bob(1) → carol(2)

	// alice plays +2; bob faces a 2-card penalty.
	top := r.State.Discard[len(r.State.Discard)-1]
	aliceDrawTwo := Card{Color: top.Color, Kind: DrawTwo}
	r.State.Hands[0].Cards = append([]Card{aliceDrawTwo}, r.State.Hands[0].Cards...)
	if err := r.PlayCard(0, aliceDrawTwo, aliceDrawTwo.Color, -1); err != nil {
		t.Fatalf("alice PlayCard DrawTwo: %v", err)
	}
	if r.State.PendingDraw != 2 {
		t.Fatalf("PendingDraw = %d after +2, want 2", r.State.PendingDraw)
	}
	if r.State.CurrentTurn != 1 {
		t.Fatalf("turn = %d, want 1 (bob)", r.State.CurrentTurn)
	}

	// bob counters with another +2; carol now faces a 4-card penalty.
	bobCounter := Card{Color: aliceDrawTwo.Color, Kind: DrawTwo}
	r.State.Hands[1].Cards = append([]Card{bobCounter}, r.State.Hands[1].Cards...)
	if err := r.CounterDraw(1, bobCounter, bobCounter.Color); err != nil {
		t.Fatalf("bob CounterDraw: %v", err)
	}
	if r.State.PendingDraw != 4 {
		t.Errorf("PendingDraw = %d after stack +2+2, want 4", r.State.PendingDraw)
	}
	if r.State.CurrentTurn != 2 {
		t.Errorf("turn = %d, want 2 (carol)", r.State.CurrentTurn)
	}

	// carol draws; must consume all 4 and advance back to alice.
	carolHandBefore := len(r.State.Hands[2].Cards)
	if err := r.DrawCard(2); err != nil {
		t.Fatalf("carol DrawCard: %v", err)
	}
	if r.State.PendingDraw != 0 {
		t.Errorf("PendingDraw = %d after carol draws, want 0", r.State.PendingDraw)
	}
	if len(r.State.Hands[2].Cards) != carolHandBefore+4 {
		t.Errorf("carol hand size = %d, want %d", len(r.State.Hands[2].Cards), carolHandBefore+4)
	}
	if r.State.CurrentTurn != 0 {
		t.Errorf("turn = %d after carol draws, want 0 (alice)", r.State.CurrentTurn)
	}
}

// --- Card effect end-to-end tests ---

func TestRoom_Skip_EndToEnd(t *testing.T) {
	r := setupThreePlayerGame(t)
	// alice(0) → bob(1) → carol(2); alice plays a Skip → bob is skipped → carol's turn.
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 5}}
	r.State.Direction = 1

	skipCard := Card{Color: Red, Kind: Skip}
	r.State.Hands[0].Cards = append([]Card{skipCard}, r.State.Hands[0].Cards...)

	if err := r.PlayCard(0, skipCard, Red, -1); err != nil {
		t.Fatalf("PlayCard Skip: %v", err)
	}
	if r.State.CurrentTurn != 2 {
		t.Errorf("after Skip, CurrentTurn = %d, want 2 (carol)", r.State.CurrentTurn)
	}
}

func TestRoom_Reverse_FlipsDirection(t *testing.T) {
	r := setupThreePlayerGame(t)
	// alice(0) plays a Reverse → direction becomes -1 → next turn is carol(2).
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 5}}
	r.State.Direction = 1

	revCard := Card{Color: Red, Kind: Reverse}
	r.State.Hands[0].Cards = append([]Card{revCard}, r.State.Hands[0].Cards...)

	if err := r.PlayCard(0, revCard, Red, -1); err != nil {
		t.Fatalf("PlayCard Reverse: %v", err)
	}
	if r.State.Direction != -1 {
		t.Errorf("Direction = %d after Reverse, want -1", r.State.Direction)
	}
	if r.State.CurrentTurn != 2 {
		t.Errorf("after Reverse (3p), CurrentTurn = %d, want 2 (carol)", r.State.CurrentTurn)
	}
}

func TestRoom_Reverse_TwoPlayers_ActsAsSkip(t *testing.T) {
	r := setupTwoPlayerGame(t)
	// With 2 players, Reverse acts as Skip — alice plays again.
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 5}}
	r.State.Direction = 1

	revCard := Card{Color: Red, Kind: Reverse}
	r.State.Hands[0].Cards = append([]Card{revCard}, r.State.Hands[0].Cards...)

	if err := r.PlayCard(0, revCard, Red, -1); err != nil {
		t.Fatalf("PlayCard Reverse 2-player: %v", err)
	}
	// Direction flips then alice gets another turn (2-player skip behaviour).
	if r.State.CurrentTurn != 0 {
		t.Errorf("after Reverse 2p, CurrentTurn = %d, want 0 (alice again)", r.State.CurrentTurn)
	}
}

func TestRoom_Wild_SetsActiveColor(t *testing.T) {
	r := setupTwoPlayerGame(t)
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 5}}

	wildCard := Card{Color: Wild, Kind: WildCard}
	r.State.Hands[0].Cards = append([]Card{wildCard}, r.State.Hands[0].Cards...)

	if err := r.PlayCard(0, wildCard, Green, -1); err != nil {
		t.Fatalf("PlayCard Wild: %v", err)
	}
	if r.State.ActiveColor != Green {
		t.Errorf("after Wild, ActiveColor = %v, want Green", r.State.ActiveColor)
	}
	if r.State.CurrentTurn != 1 {
		t.Errorf("after Wild, turn = %d, want 1 (bob)", r.State.CurrentTurn)
	}
}

func TestRoom_WildDrawFour_SetsPendingAndColor(t *testing.T) {
	r := setupTwoPlayerGame(t)
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 5}}

	wdf := Card{Color: Wild, Kind: WildDrawFour}
	r.State.Hands[0].Cards = append([]Card{wdf}, r.State.Hands[0].Cards...)

	if err := r.PlayCard(0, wdf, Blue, -1); err != nil {
		t.Fatalf("PlayCard WildDrawFour: %v", err)
	}
	if r.State.ActiveColor != Blue {
		t.Errorf("ActiveColor = %v, want Blue", r.State.ActiveColor)
	}
	if r.State.PendingDraw != 4 {
		t.Errorf("PendingDraw = %d, want 4", r.State.PendingDraw)
	}
	if r.State.CurrentTurn != 1 {
		t.Errorf("CurrentTurn = %d, want 1 (bob)", r.State.CurrentTurn)
	}
}

func TestRoom_DrawStack_DrawTwoPlusWildDrawFour(t *testing.T) {
	// alice plays +2 → bob counters with +4 (different kind, should be rejected by CounterDraw).
	// Actually the counter rule requires matching kind, so bob can't counter.
	// Instead: alice plays +2, bob faces 2; bob then plays another +2 → stack = 4.
	r := setupThreePlayerGame(t)
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 5}}
	r.State.Direction = 1

	alice2 := Card{Color: Red, Kind: DrawTwo}
	r.State.Hands[0].Cards = append([]Card{alice2}, r.State.Hands[0].Cards...)
	if err := r.PlayCard(0, alice2, Red, -1); err != nil {
		t.Fatalf("alice +2: %v", err)
	}
	if r.State.PendingDraw != 2 {
		t.Fatalf("PendingDraw = %d after +2, want 2", r.State.PendingDraw)
	}
	if r.State.CurrentTurn != 1 {
		t.Fatalf("turn = %d, want 1", r.State.CurrentTurn)
	}

	bob2 := Card{Color: Red, Kind: DrawTwo}
	r.State.Hands[1].Cards = append([]Card{bob2}, r.State.Hands[1].Cards...)
	if err := r.CounterDraw(1, bob2, Red); err != nil {
		t.Fatalf("bob counter +2: %v", err)
	}
	if r.State.PendingDraw != 4 {
		t.Errorf("after counter, PendingDraw = %d, want 4", r.State.PendingDraw)
	}
	if r.State.CurrentTurn != 2 {
		t.Errorf("after counter, turn = %d, want 2 (carol)", r.State.CurrentTurn)
	}
	// Carol draws and takes all 4.
	carolBefore := len(r.State.Hands[2].Cards)
	if err := r.DrawCard(2); err != nil {
		t.Fatalf("carol draw: %v", err)
	}
	if len(r.State.Hands[2].Cards) != carolBefore+4 {
		t.Errorf("carol hand = %d, want %d", len(r.State.Hands[2].Cards), carolBefore+4)
	}
	if r.State.PendingDraw != 0 {
		t.Errorf("PendingDraw = %d after draw, want 0", r.State.PendingDraw)
	}
}

func TestRoom_CounterDraw_WildDrawFour(t *testing.T) {
	r := setupTwoPlayerGame(t)
	// alice plays +4 → bob faces 4 → bob counters with another +4 → alice faces 8.
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 5}}

	wdf1 := Card{Color: Wild, Kind: WildDrawFour}
	r.State.Hands[0].Cards = append([]Card{wdf1}, r.State.Hands[0].Cards...)
	if err := r.PlayCard(0, wdf1, Green, -1); err != nil {
		t.Fatalf("alice +4: %v", err)
	}
	if r.State.PendingDraw != 4 {
		t.Fatalf("PendingDraw = %d, want 4", r.State.PendingDraw)
	}

	wdf2 := Card{Color: Wild, Kind: WildDrawFour}
	r.State.Hands[1].Cards = append([]Card{wdf2}, r.State.Hands[1].Cards...)
	if err := r.CounterDraw(1, wdf2, Blue); err != nil {
		t.Fatalf("bob counter +4: %v", err)
	}
	if r.State.PendingDraw != 8 {
		t.Errorf("after counter, PendingDraw = %d, want 8", r.State.PendingDraw)
	}
	if r.State.CurrentTurn != 0 {
		t.Errorf("after counter, turn = %d, want 0 (alice)", r.State.CurrentTurn)
	}
	// Alice draws 8 penalty cards.
	aliceBefore := len(r.State.Hands[0].Cards)
	if err := r.DrawCard(0); err != nil {
		t.Fatalf("alice draw 8: %v", err)
	}
	if len(r.State.Hands[0].Cards) != aliceBefore+8 {
		t.Errorf("alice hand = %d, want %d", len(r.State.Hands[0].Cards), aliceBefore+8)
	}
}

// --- Interrupt play tests ---

func TestRoom_InterruptPlay_Valid(t *testing.T) {
	r := setupThreePlayerGame(t)
	// alice(0) has just played Red-7; top discard is Red-7; it is now bob(1)'s turn.
	// carol(2) holds a Red-7 and interrupts.
	r.State.CurrentTurn = 1 // bob's turn
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 7}}
	r.State.PendingDraw = 0

	carolCard := Card{Color: Red, Kind: Number, Value: 7}
	r.State.Hands[2].Cards = append([]Card{carolCard}, r.State.Hands[2].Cards...)
	carolHandBefore := len(r.State.Hands[2].Cards)

	if err := r.InterruptPlay(2, carolCard, -1); err != nil {
		t.Fatalf("InterruptPlay error: %v", err)
	}
	// carol's hand shrank by 1
	if len(r.State.Hands[2].Cards) != carolHandBefore-1 {
		t.Errorf("carol hand = %d, want %d", len(r.State.Hands[2].Cards), carolHandBefore-1)
	}
	// Top discard is now carol's card
	top := r.State.Discard[len(r.State.Discard)-1]
	if top.Color != Red || top.Kind != Number || top.Value != 7 {
		t.Errorf("top card = %v, want Red-7-Number", top)
	}
	// Turn should have advanced from carol (2) clockwise to alice (0) — skipping no one.
	if r.State.CurrentTurn != 0 {
		t.Errorf("after interrupt by carol, turn = %d, want 0 (alice)", r.State.CurrentTurn)
	}
}

func TestRoom_InterruptPlay_WildCardRejected(t *testing.T) {
	r := setupTwoPlayerGame(t)
	r.State.CurrentTurn = 0
	wild := Card{Color: Wild, Kind: WildCard}
	r.State.Hands[1].Cards = append([]Card{wild}, r.State.Hands[1].Cards...)
	if err := r.InterruptPlay(1, wild, -1); err == nil {
		t.Error("wild card interrupt should be rejected")
	}
}

func TestRoom_InterruptPlay_NonMatchingCardRejected(t *testing.T) {
	r := setupTwoPlayerGame(t)
	r.State.CurrentTurn = 0
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 5}}

	mismatch := Card{Color: Blue, Kind: Number, Value: 5} // same value, wrong color
	r.State.Hands[1].Cards = append([]Card{mismatch}, r.State.Hands[1].Cards...)
	if err := r.InterruptPlay(1, mismatch, -1); err == nil {
		t.Error("color-mismatched interrupt should be rejected")
	}
}

func TestRoom_InterruptPlay_ValueMismatchRejected(t *testing.T) {
	r := setupTwoPlayerGame(t)
	r.State.CurrentTurn = 0
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 5}}

	mismatch := Card{Color: Red, Kind: Number, Value: 3} // same color, wrong value
	r.State.Hands[1].Cards = append([]Card{mismatch}, r.State.Hands[1].Cards...)
	if err := r.InterruptPlay(1, mismatch, -1); err == nil {
		t.Error("value-mismatched interrupt should be rejected")
	}
}

func TestRoom_InterruptPlay_FinishedPlayerRejected(t *testing.T) {
	r := setupThreePlayerGame(t)
	r.State.Finished[2] = true
	r.State.CurrentTurn = 0
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 5}}
	matchCard := Card{Color: Red, Kind: Number, Value: 5}
	r.State.Hands[2].Cards = append([]Card{matchCard}, r.State.Hands[2].Cards...)
	if err := r.InterruptPlay(2, matchCard, -1); err == nil {
		t.Error("finished player interrupt should be rejected")
	}
}

func TestRoom_InterruptPlay_PendingDrawRejected(t *testing.T) {
	r := setupTwoPlayerGame(t)
	r.State.CurrentTurn = 0
	r.State.PendingDraw = 2
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 5}}
	matchCard := Card{Color: Red, Kind: Number, Value: 5}
	r.State.Hands[1].Cards = append([]Card{matchCard}, r.State.Hands[1].Cards...)
	if err := r.InterruptPlay(1, matchCard, -1); err == nil {
		t.Error("interrupt with pending draw should be rejected")
	}
}

func TestRoom_InterruptPlay_OwnTurnRejected(t *testing.T) {
	r := setupTwoPlayerGame(t)
	r.State.CurrentTurn = 0
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 5}}
	matchCard := Card{Color: Red, Kind: Number, Value: 5}
	r.State.Hands[0].Cards = append([]Card{matchCard}, r.State.Hands[0].Cards...)
	if err := r.InterruptPlay(0, matchCard, -1); err == nil {
		t.Error("interrupt on own turn should be rejected (use play_card instead)")
	}
}

func TestRoom_InterruptPlay_EmptiesHand_Finishes(t *testing.T) {
	r := setupThreePlayerGame(t)
	// carol(2) has exactly one card that matches the top; she interrupts to finish.
	r.State.CurrentTurn = 1 // bob's turn
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 9}}
	r.State.PendingDraw = 0

	winCard := Card{Color: Red, Kind: Number, Value: 9}
	r.State.Hands[2].Cards = []Card{winCard}
	r.State.Hands[1].Cards = []Card{{Kind: Skip}} // bob has 1 card (20 pts)

	if err := r.InterruptPlay(2, winCard, -1); err != nil {
		t.Fatalf("InterruptPlay finish: %v", err)
	}
	if !r.State.Finished[2] {
		t.Error("carol should be marked finished")
	}
	// alice and bob are still playing; round should not be over yet
	if r.RoundEnded {
		t.Error("round should not end — alice and bob remain")
	}
	// carol's score = sum of unfinished players' hands (bob has Skip=20, alice has 7 cards)
	// We just check carol scored something positive.
	if r.Scores[2] == 0 {
		t.Error("carol should have scored points from other players' hands")
	}
}

func TestRoom_InterruptPlay_SkipEffect(t *testing.T) {
	// carol(2) interrupts with a Red-Skip; the Skip should apply from carol's position,
	// so the player after carol (alice, 0) is skipped and the new turn is bob (1).
	r := setupThreePlayerGame(t)
	r.State.CurrentTurn = 0 // alice's turn
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Skip}}
	r.State.PendingDraw = 0
	r.State.Direction = 1 // clockwise: alice(0)→bob(1)→carol(2)

	// carol has a Red-Skip (exact match of top)
	carolSkip := Card{Color: Red, Kind: Skip}
	r.State.Hands[2].Cards = append([]Card{carolSkip}, r.State.Hands[2].Cards...)

	if err := r.InterruptPlay(2, carolSkip, -1); err != nil {
		t.Fatalf("InterruptPlay Skip: %v", err)
	}
	// Skip from carol (2): skip the next player after carol.
	// Clockwise from carol(2): next is alice(0), then bob(1).
	// Skip means alice(0) is skipped → turn is bob(1).
	if r.State.CurrentTurn != 1 {
		t.Errorf("after carol Skip interrupt, turn = %d, want 1 (bob)", r.State.CurrentTurn)
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
	r.State.Direction = 1   // reset direction; Reverse as first card can flip it
	return r
}

// setupThreePlayerGame starts a 3-player game for alice, bob, and carol.
func setupThreePlayerGame(t *testing.T) *Room {
	t.Helper()
	r := NewRoom("3PLY")
	for _, nick := range []string{"alice", "bob", "carol"} {
		if err := r.Join(nick); err != nil {
			t.Fatal(err)
		}
	}
	if err := r.Start(); err != nil {
		t.Fatal(err)
	}
	r.State.CurrentTurn = 0
	r.State.PendingDraw = 0
	r.State.Direction = 1 // reset direction; Reverse as first card can flip it
	return r
}
