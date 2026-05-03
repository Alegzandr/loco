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
		if len(r.State.Hands[p.Index].Cards) != 8 {
			t.Errorf("Player %q hand size = %d, want 8", p.Nickname, len(r.State.Hands[p.Index].Cards))
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

	// Bob plays his only card → 0 cards → round 1 ends.
	// BeginNextRound is now an explicit step (the hub calls it after broadcasting
	// round_end) so the card_played broadcast for the round-winning play sees the
	// pre-deal state instead of the new round's freshly-flipped first card.
	if err := r.PlayCard(1, bobCard, matchColor, -1); err != nil {
		t.Fatalf("bob play: %v", err)
	}
	if !r.RoundEnded {
		t.Fatal("expected RoundEnded after bob empties hand")
	}
	if r.RoundNumber != 1 {
		t.Fatalf("expected RoundNumber to remain 1 until BeginNextRound, got %d", r.RoundNumber)
	}
	if err := r.BeginNextRound(); err != nil {
		t.Fatalf("BeginNextRound: %v", err)
	}
	if r.RoundNumber != 2 {
		t.Fatalf("expected round 2 after BeginNextRound, got %d", r.RoundNumber)
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

	// Give bob a known hand (value = 7 + 20 + 40 = 67 per docs/rules.md §10:
	// Number=face value, Skip=20, Wild=40)
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

	if r.Scores[0] != 67 {
		t.Errorf("alice score = %d, want 67", r.Scores[0])
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

	// Match should NOT be over; round 1 ended but the next round is dealt
	// explicitly by the hub via BeginNextRound (not inside PlayCard).
	if r.MatchOver {
		t.Error("match should not be over after round 1 of BO3")
	}
	if r.RoundNumber != 1 {
		t.Errorf("RoundNumber = %d before BeginNextRound, want 1", r.RoundNumber)
	}
	if r.Status != StatusPlaying {
		t.Errorf("Status = %v, want Playing", r.Status)
	}
	if r.RoundEnded != true {
		t.Error("RoundEnded should be true")
	}
	if err := r.BeginNextRound(); err != nil {
		t.Fatalf("BeginNextRound: %v", err)
	}
	if r.RoundNumber != 2 {
		t.Errorf("RoundNumber after BeginNextRound = %d, want 2", r.RoundNumber)
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
		// Simulate the hub: clear RoundEnded and deal the next round
		// (only if the match isn't already decided).
		r.RoundEnded = false
		if !r.MatchOver {
			if err := r.BeginNextRound(); err != nil {
				t.Fatalf("BeginNextRound: %v", err)
			}
		}
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

	// Round 3: alice wins, bob has WildCard (40 pts per docs/rules.md §10) → match over
	winRound(0, 1, []Card{{Kind: WildCard, Color: Wild}})
	if r.Scores[0] != 50 { // 10 + 40
		t.Errorf("after round 3, alice score = %d, want 50", r.Scores[0])
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

// --- Round-end model: first player to empty hand wins ---

func TestRoom_RoundEndsImmediately_FirstFinisher(t *testing.T) {
	// New ruleset: round ends the moment any player empties their hand.
	r := setupThreePlayerGame(t)
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 1}}
	r.State.PendingDraw = 0
	r.State.Direction = 1

	// alice has 1 matching card; bob has Skip (20pts); carol has WildDrawFour (50pts)
	r.State.Hands[0].Cards = []Card{{Color: Red, Kind: Number, Value: 1}}
	r.State.Hands[1].Cards = []Card{{Color: Red, Kind: Skip}}
	r.State.Hands[2].Cards = []Card{{Kind: WildDrawFour, Color: Wild}}

	if err := r.PlayCard(0, Card{Color: Red, Kind: Number, Value: 1}, Red, -1); err != nil {
		t.Fatalf("alice play: %v", err)
	}
	if !r.RoundEnded {
		t.Error("round must end the moment alice empties her hand")
	}
	if r.Winner != "alice" {
		t.Errorf("round winner = %q, want alice", r.Winner)
	}
	if r.RoundsWon[0] != 1 {
		t.Errorf("alice rounds won = %d, want 1", r.RoundsWon[0])
	}
	// alice scores bob(Skip=20) + carol(W+4=50) = 70
	if r.Scores[0] != 70 {
		t.Errorf("alice score = %d, want 70", r.Scores[0])
	}
	// Other players get 0 this round
	if r.Scores[1] != 0 || r.Scores[2] != 0 {
		t.Errorf("losers scores = %d/%d, want 0/0", r.Scores[1], r.Scores[2])
	}
	// LostHandTotal accumulates losing-round hand values
	if r.LostHandTotal[1] != 20 {
		t.Errorf("bob LostHandTotal = %d, want 20", r.LostHandTotal[1])
	}
	if r.LostHandTotal[2] != 50 {
		t.Errorf("carol LostHandTotal = %d, want 50", r.LostHandTotal[2])
	}
}

func TestRoom_BiggestLoserStartsNextRound(t *testing.T) {
	// After a round ends, the player with the lowest cumulative score starts next round.
	r := NewRoom("BIGL")
	for _, n := range []string{"alice", "bob", "carol"} {
		if err := r.Join(n); err != nil {
			t.Fatal(err)
		}
	}
	r.Format = BO3
	if err := r.Start(); err != nil {
		t.Fatal(err)
	}
	// Force a deterministic round 1 win for bob (so alice has 0 score, bob wins big).
	r.State.CurrentTurn = 1
	r.State.PendingDraw = 0
	r.State.Direction = 1
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 1}}
	r.State.Hands[0].Cards = []Card{{Kind: Number, Value: 5}, {Kind: Number, Value: 5}}
	r.State.Hands[1].Cards = []Card{{Color: Red, Kind: Number, Value: 1}}
	r.State.Hands[2].Cards = []Card{{Kind: Number, Value: 3}}

	if err := r.PlayCard(1, Card{Color: Red, Kind: Number, Value: 1}, Red, -1); err != nil {
		t.Fatalf("bob play: %v", err)
	}
	if !r.RoundEnded {
		t.Fatal("expected RoundEnded after bob finishes")
	}
	r.RoundEnded = false

	if err := r.BeginNextRound(); err != nil {
		t.Fatalf("BeginNextRound: %v", err)
	}
	// alice (0) and carol (2) are tied at 0; deterministic tiebreak picks lowest idx (0).
	if r.State.CurrentTurn != 0 {
		t.Errorf("biggest loser starter = %d, want 0 (alice; lowest score, lowest idx)", r.State.CurrentTurn)
	}
}

func TestRoom_SwapWithSelfRejected(t *testing.T) {
	r := setupTwoPlayerGame(t)
	swap := Card{Color: Red, Kind: Swap}
	r.State.Hands[0].Cards = []Card{swap}
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 3}}
	r.State.ActiveColor = Red
	if err := r.PlayCard(0, swap, Red, 0); err == nil {
		t.Error("swap with self should fail")
	}
}

// --- Swap and GlobalSwitch tests ---

func TestRoom_SwapCard_SwapsHands(t *testing.T) {
	r := setupTwoPlayerGame(t)

	// Swap is now a colored action card (1 per color). Use a Red Swap on a Red top.
	swapCard := Card{Color: Red, Kind: Swap}
	r.State.Hands[0].Cards = []Card{swapCard, {Color: Red, Kind: Number, Value: 1}}
	r.State.Hands[1].Cards = []Card{
		{Color: Blue, Kind: Skip},
		{Color: Green, Kind: Number, Value: 7},
	}

	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 3}}
	r.State.ActiveColor = Red

	err := r.PlayCard(0, swapCard, Red, 1) // swap with bob (index 1)
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
	swapCard := Card{Color: Red, Kind: Swap}
	r.State.Hands[0].Cards = []Card{swapCard}
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 3}}
	r.State.ActiveColor = Red

	if err := r.PlayCard(0, swapCard, Red, 0); err == nil {
		t.Error("swapping with self should return error")
	}
	if err := r.PlayCard(0, swapCard, Red, 99); err == nil {
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

func TestRoom_GlobalSwitch_RotatesByDirection_CounterClockwise(t *testing.T) {
	// GlobalSwitch passes each hand to the next player in the current game direction.
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
	r.State.Direction = -1 // counter-clockwise: each hand passes to (i+1)→(i)

	if err := r.PlayCard(0, gsCard, Wild, -1); err != nil {
		t.Fatalf("PlayCard GlobalSwitch: %v", err)
	}
	// With direction=-1, rotation: newHands[i] = Hands[(i+1)%n]
	// → p0 gets old hand1 (2), p1 gets old hand2 (3), p2 gets old hand0 minus gsCard (1)
	if len(r.State.Hands[0].Cards) != 2 {
		t.Errorf("p0 hand = %d, want 2", len(r.State.Hands[0].Cards))
	}
	if len(r.State.Hands[1].Cards) != 3 {
		t.Errorf("p1 hand = %d, want 3", len(r.State.Hands[1].Cards))
	}
	if len(r.State.Hands[2].Cards) != 1 {
		t.Errorf("p2 hand = %d, want 1", len(r.State.Hands[2].Cards))
	}
}

func TestRoom_SwapCard_NotWild(t *testing.T) {
	// Swap is now a colored card, so it should NOT be playable on a non-matching top.
	swapCard := Card{Color: Red, Kind: Swap}
	top := Card{Color: Blue, Kind: Number, Value: 7}
	if CanPlay(swapCard, top, Blue) {
		t.Error("Red Swap should not be playable on Blue Number")
	}
	// But it IS playable on a matching color or matching kind.
	if !CanPlay(swapCard, Card{Color: Red, Kind: Number, Value: 7}, Red) {
		t.Error("Red Swap should be playable on Red Number")
	}
	if !CanPlay(swapCard, Card{Color: Blue, Kind: Swap}, Blue) {
		t.Error("Red Swap should be playable on Blue Swap (matching kind)")
	}
}

func TestRoom_GlobalSwitch_AlwaysPlayable(t *testing.T) {
	gsCard := Card{Color: Wild, Kind: GlobalSwitch}
	if !CanPlay(gsCard, Card{Color: Green, Kind: Skip}, Green) {
		t.Error("GlobalSwitch is wild; must always be playable")
	}
}

// Per rules.md §11.1: if the actor empties their hand by playing Swap,
// the round ends immediately and the swap is aborted (the actor must not
// receive the opponent's hand and lose the win).
func TestRoom_SwapAsLastCard_EndsRoundWithoutSwapping(t *testing.T) {
	r := setupTwoPlayerGame(t)
	swapCard := Card{Color: Red, Kind: Swap}
	r.State.Hands[0].Cards = []Card{swapCard}
	r.State.Hands[1].Cards = []Card{
		{Color: Blue, Kind: Skip},
		{Color: Green, Kind: Number, Value: 7},
	}
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 3}}
	r.State.ActiveColor = Red

	if err := r.PlayCard(0, swapCard, Red, 1); err != nil {
		t.Fatalf("PlayCard Swap as last card: %v", err)
	}
	if !r.RoundEnded {
		t.Fatal("playing last card (Swap) must end the round")
	}
	if r.Winner != r.Players[0].Nickname {
		t.Errorf("Winner = %q, want %q", r.Winner, r.Players[0].Nickname)
	}
	if got := len(r.State.Hands[0].Cards); got != 0 {
		t.Errorf("actor hand size = %d, want 0 (swap aborted)", got)
	}
	if got := len(r.State.Hands[1].Cards); got != 2 {
		t.Errorf("opponent hand size = %d, want 2 (swap aborted)", got)
	}
}

// Per rules.md §11.1 (analogous to Swap): if the actor empties their hand
// by playing GlobalSwitch, the round ends immediately and the rotation is
// aborted.
func TestRoom_GlobalSwitchAsLastCard_EndsRoundWithoutRotating(t *testing.T) {
	r := setupThreePlayerGame(t)
	gsCard := Card{Color: Wild, Kind: GlobalSwitch}
	r.State.Hands[0].Cards = []Card{gsCard}
	r.State.Hands[1].Cards = []Card{{Color: Green, Kind: Number, Value: 3}}
	r.State.Hands[2].Cards = []Card{
		{Color: Yellow, Kind: Skip},
		{Color: Red, Kind: DrawTwo},
	}
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 9}}
	r.State.ActiveColor = Red
	r.State.Direction = 1

	if err := r.PlayCard(0, gsCard, Wild, -1); err != nil {
		t.Fatalf("PlayCard GlobalSwitch as last card: %v", err)
	}
	if !r.RoundEnded {
		t.Fatal("playing last card (GlobalSwitch) must end the round")
	}
	if r.Winner != r.Players[0].Nickname {
		t.Errorf("Winner = %q, want %q", r.Winner, r.Players[0].Nickname)
	}
	if got := len(r.State.Hands[0].Cards); got != 0 {
		t.Errorf("actor hand size = %d, want 0 (rotation aborted)", got)
	}
	if got := len(r.State.Hands[1].Cards); got != 1 {
		t.Errorf("p1 hand size = %d, want 1 (rotation aborted)", got)
	}
	if got := len(r.State.Hands[2].Cards); got != 2 {
		t.Errorf("p2 hand size = %d, want 2 (rotation aborted)", got)
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

// TestPlayCard_RejectedDuringPendingDraw verifies that normal play_card cannot be
// used to bypass an active draw penalty; the player must counter_draw or draw_card.
func TestPlayCard_RejectedDuringPendingDraw(t *testing.T) {
	r := setupTwoPlayerGame(t)

	// Bob is under a pending +2 penalty.
	r.State.CurrentTurn = 1
	r.State.PendingDraw = 2
	r.State.Discard = []Card{{Color: Red, Kind: DrawTwo}}
	r.State.ActiveColor = Red

	illegal := Card{Color: Red, Kind: Number, Value: 7}
	r.State.Hands[1].Cards = append([]Card{illegal}, r.State.Hands[1].Cards...)
	handBefore := len(r.State.Hands[1].Cards)

	if err := r.PlayCard(1, illegal, Red, -1); err == nil {
		t.Fatal("expected PlayCard to fail during pending draw")
	}
	if r.State.PendingDraw != 2 {
		t.Fatalf("PendingDraw changed after rejected play: got %d want 2", r.State.PendingDraw)
	}
	if len(r.State.Hands[1].Cards) != handBefore {
		t.Fatalf("hand size changed after rejected play: got %d want %d", len(r.State.Hands[1].Cards), handBefore)
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
	armInterrupt(r, 0)

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

// During an active Take2 chain (PendingDraw > 0) only an identical DrawTwo may
// be interjected. A non-DrawTwo "match" (which can only happen in inconsistent
// state) must still be rejected.
func TestRoom_InterruptPlay_NonDrawTwoDuringPendingDrawRejected(t *testing.T) {
	r := setupTwoPlayerGame(t)
	r.State.CurrentTurn = 0
	r.State.PendingDraw = 2
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 5}}
	armInterrupt(r, 0)
	matchCard := Card{Color: Red, Kind: Number, Value: 5}
	r.State.Hands[1].Cards = append([]Card{matchCard}, r.State.Hands[1].Cards...)
	if err := r.InterruptPlay(1, matchCard, -1); err == nil {
		t.Error("non-DrawTwo interrupt during pending draw should be rejected")
	}
}

func TestRoom_InterruptPlay_OwnTurnRejected(t *testing.T) {
	// Set up a valid window (LastPlayBy != current player) so the rejection
	// is specifically about it being the caller's own turn, not a closed window.
	r := setupThreePlayerGame(t)
	r.State.CurrentTurn = 0
	r.State.Direction = 1
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 5}}
	armInterrupt(r, 2) // someone else just played
	matchCard := Card{Color: Red, Kind: Number, Value: 5}
	r.State.Hands[0].Cards = append([]Card{matchCard}, r.State.Hands[0].Cards...)
	if err := r.InterruptPlay(0, matchCard, -1); err == nil {
		t.Error("interrupt on own turn should be rejected (use play_card instead)")
	}
}

func TestRoom_InterruptPlay_EmptiesHand_EndsRound(t *testing.T) {
	// carol(2) interrupts with her last card → round ends immediately, carol wins.
	r := setupThreePlayerGame(t)
	r.State.CurrentTurn = 1 // bob's turn
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 9}}
	r.State.PendingDraw = 0
	armInterrupt(r, 0)

	winCard := Card{Color: Red, Kind: Number, Value: 9}
	r.State.Hands[2].Cards = []Card{winCard}
	r.State.Hands[1].Cards = []Card{{Color: Red, Kind: Skip}} // bob has 1 card (20 pts)

	if err := r.InterruptPlay(2, winCard, -1); err != nil {
		t.Fatalf("InterruptPlay finish: %v", err)
	}
	if !r.RoundEnded {
		t.Error("round must end the moment carol empties her hand via interrupt")
	}
	if r.Winner != "carol" {
		t.Errorf("round winner = %q, want carol", r.Winner)
	}
	if r.Scores[2] == 0 {
		t.Error("carol should have scored points from other players' hands")
	}
	if r.Scores[1] != 0 || r.Scores[0] != 0 {
		t.Error("non-winners must score 0 this round")
	}
}

// Interjecting a Swap must remove the played card from the interjecter's
// hand BEFORE the hand exchange. Previously the swap happened first, after
// which Remove() looked for the card in the swapped-in opponent hand and
// failed (since Swap is one-per-color, no duplicates).
func TestRoom_InterruptPlay_Swap_RemovesBeforeSwapping(t *testing.T) {
	r := setupThreePlayerGame(t)
	r.State.CurrentTurn = 1 // bob's turn
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Swap}}
	r.State.PendingDraw = 0
	armInterrupt(r, 0)

	swap := Card{Color: Red, Kind: Swap}
	// carol(2) has the matching Red Swap plus two other cards.
	carolOther1 := Card{Color: Blue, Kind: Number, Value: 4}
	carolOther2 := Card{Color: Green, Kind: Skip}
	r.State.Hands[2].Cards = []Card{swap, carolOther1, carolOther2}
	// bob (the swap target chosen by carol) has a known hand we can identify post-swap.
	bobHand := []Card{
		{Color: Yellow, Kind: Number, Value: 1},
		{Color: Yellow, Kind: Number, Value: 2},
		{Color: Yellow, Kind: Number, Value: 3},
	}
	r.State.Hands[1].Cards = append([]Card{}, bobHand...)

	if err := r.InterruptPlay(2, swap, 1); err != nil {
		t.Fatalf("InterruptPlay Swap: %v", err)
	}
	// Top discard is the Red Swap.
	top := r.State.Discard[len(r.State.Discard)-1]
	if top != swap {
		t.Errorf("top discard = %+v, want %+v", top, swap)
	}
	// carol now holds bob's original hand (3 cards), NOT including the played Swap.
	if got := len(r.State.Hands[2].Cards); got != len(bobHand) {
		t.Fatalf("carol hand size after interject swap = %d, want %d", got, len(bobHand))
	}
	for i, c := range bobHand {
		if r.State.Hands[2].Cards[i] != c {
			t.Errorf("carol hand[%d] = %+v, want %+v (bob's old hand)", i, r.State.Hands[2].Cards[i], c)
		}
	}
	// bob now holds carol's remaining 2 cards (Swap was removed before swap).
	if got := len(r.State.Hands[1].Cards); got != 2 {
		t.Fatalf("bob hand size after interject swap = %d, want 2", got)
	}
	wantBob := []Card{carolOther1, carolOther2}
	for i, c := range wantBob {
		if r.State.Hands[1].Cards[i] != c {
			t.Errorf("bob hand[%d] = %+v, want %+v (carol's old non-Swap cards)", i, r.State.Hands[1].Cards[i], c)
		}
	}
}

// Interjecting a Swap as the actor's last card must end the round
// (actor wins) and abort the hand exchange — same shape as the Swap
// edge case in PlayCard (rules.md §13).
func TestRoom_InterruptPlay_SwapAsLastCard_EndsRoundWithoutSwapping(t *testing.T) {
	r := setupThreePlayerGame(t)
	r.State.CurrentTurn = 1 // bob's turn
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Swap}}
	r.State.PendingDraw = 0
	armInterrupt(r, 0)

	swap := Card{Color: Red, Kind: Swap}
	r.State.Hands[2].Cards = []Card{swap} // carol's only card
	bobHandBefore := []Card{
		{Color: Yellow, Kind: Number, Value: 1},
		{Color: Yellow, Kind: Number, Value: 2},
	}
	r.State.Hands[1].Cards = append([]Card{}, bobHandBefore...)

	if err := r.InterruptPlay(2, swap, 1); err != nil {
		t.Fatalf("InterruptPlay last-card swap: %v", err)
	}
	if !r.RoundEnded {
		t.Fatal("interjecting Swap as last card must end the round")
	}
	if r.Winner != "carol" {
		t.Errorf("round winner = %q, want carol", r.Winner)
	}
	if got := len(r.State.Hands[2].Cards); got != 0 {
		t.Errorf("carol hand size = %d, want 0 (swap aborted)", got)
	}
	if got := len(r.State.Hands[1].Cards); got != len(bobHandBefore) {
		t.Errorf("bob hand size = %d, want %d (swap aborted)", got, len(bobHandBefore))
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
	armInterrupt(r, 1)    // pretend bob just played

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

// --- Phase B: batch play and identical-card interrupt ---

func TestRoom_PlayCards_StackedDrawTwo(t *testing.T) {
	r := setupThreePlayerGame(t)
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 5}}
	r.State.Direction = 1

	d2 := Card{Color: Red, Kind: DrawTwo}
	r.State.Hands[0].Cards = []Card{d2, d2, d2, {Color: Blue, Kind: Number, Value: 4}}

	if err := r.PlayCards(0, []Card{d2, d2, d2}, Red, -1); err != nil {
		t.Fatalf("PlayCards 3x +2: %v", err)
	}
	if r.State.PendingDraw != 6 {
		t.Errorf("PendingDraw = %d, want 6 (3 × +2)", r.State.PendingDraw)
	}
	if r.State.CurrentTurn != 1 {
		t.Errorf("turn = %d, want 1 (bob)", r.State.CurrentTurn)
	}
	// All 3 +2 cards should be on top of discard.
	if len(r.State.Discard) != 4 {
		t.Errorf("discard size = %d, want 4 (initial + 3 +2s)", len(r.State.Discard))
	}
	// Player 0 hand has only the unrelated card left.
	if r.State.Hands[0].Size() != 1 {
		t.Errorf("alice hand size = %d, want 1", r.State.Hands[0].Size())
	}
}

func TestRoom_PlayCards_StackedSkip_SkipsMultiplePlayers(t *testing.T) {
	// 4 players. Alice plays 2 Skip cards → skips 2 players → carol plays.
	r := NewRoom("BSKP")
	for _, n := range []string{"a", "b", "c", "d"} {
		_ = r.Join(n)
	}
	_ = r.Start()
	r.State.CurrentTurn = 0
	r.State.PendingDraw = 0
	r.State.Direction = 1
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 5}}
	skip := Card{Color: Red, Kind: Skip}
	r.State.Hands[0].Cards = []Card{skip, skip, {Color: Yellow, Kind: Number, Value: 9}}

	if err := r.PlayCards(0, []Card{skip, skip}, Red, -1); err != nil {
		t.Fatalf("PlayCards 2x Skip: %v", err)
	}
	// One Skip alone takes turn from 0 to 2 (skips 1). Two Skips take it to 3.
	if r.State.CurrentTurn != 3 {
		t.Errorf("after 2x Skip from p0, turn = %d, want 3 (d)", r.State.CurrentTurn)
	}
}

func TestRoom_PlayCards_RejectsNonIdentical(t *testing.T) {
	r := setupTwoPlayerGame(t)
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 5}}
	r.State.ActiveColor = Red
	a := Card{Color: Red, Kind: Number, Value: 5}
	b := Card{Color: Red, Kind: Number, Value: 6}
	r.State.Hands[0].Cards = []Card{a, b}
	if err := r.PlayCards(0, []Card{a, b}, Red, -1); err == nil {
		t.Error("non-identical batch should be rejected")
	}
}

func TestRoom_PlayCards_RejectsBatchSwap(t *testing.T) {
	r := setupTwoPlayerGame(t)
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 5}}
	r.State.ActiveColor = Red
	swap := Card{Color: Red, Kind: Swap}
	r.State.Hands[0].Cards = []Card{swap, swap}
	if err := r.PlayCards(0, []Card{swap, swap}, Red, 1); err == nil {
		t.Error("batch Swap must be rejected")
	}
}

// Per docs/rules.md §6, interjection is only allowed with an *exactly identical*
// card (same color + kind + value). A non-matching DrawTwo must be rejected.
func TestRoom_InterruptPlay_NonIdenticalDrawTwo_Rejected(t *testing.T) {
	r := setupThreePlayerGame(t)
	r.State.CurrentTurn = 0
	r.State.ActiveColor = Yellow
	r.State.Discard = []Card{{Color: Yellow, Kind: Number, Value: 7}}
	r.State.PendingDraw = 0
	armInterrupt(r, 2)

	bob2 := Card{Color: Blue, Kind: DrawTwo} // not identical to Yellow-7 top
	r.State.Hands[1].Cards = []Card{bob2, {Color: Red, Kind: Number, Value: 1}}

	if err := r.InterruptPlay(1, bob2, -1); err == nil {
		t.Fatal("non-identical DrawTwo interrupt should be rejected")
	}
	// State must be untouched.
	if r.State.PendingDraw != 0 {
		t.Errorf("PendingDraw = %d, want 0 (interrupt rejected, no mutation)", r.State.PendingDraw)
	}
	if len(r.State.Discard) != 1 {
		t.Errorf("discard size = %d, want 1 (no mutation)", len(r.State.Discard))
	}
	if r.State.Hands[1].Size() != 2 {
		t.Errorf("bob hand size = %d, want 2 (no mutation)", r.State.Hands[1].Size())
	}
}

// Non-identical DrawTwo (color mismatch) during a Take2 chain must still be
// rejected — only an *exactly* identical DrawTwo may extend the chain.
func TestRoom_InterruptPlay_NonIdenticalDrawTwoDuringChain(t *testing.T) {
	r := setupThreePlayerGame(t)
	r.State.CurrentTurn = 1
	r.State.PendingDraw = 2
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: DrawTwo}}
	armInterrupt(r, 0)
	bob2 := Card{Color: Blue, Kind: DrawTwo} // wrong color
	r.State.Hands[2].Cards = []Card{bob2}
	if err := r.InterruptPlay(2, bob2, -1); err == nil {
		t.Error("color-mismatched DrawTwo during pending draw must be rejected")
	}
}

// Per rules: an identical DrawTwo may interject an active Take2 chain. The
// chain continues from the interjecter's seat — the next player after the
// interjecter becomes the new victim with the accumulated total.
func TestRoom_InterruptPlay_IdenticalDrawTwoExtendsChain(t *testing.T) {
	r := setupThreePlayerGame(t)
	r.State.CurrentTurn = 1 // bob is the current victim
	r.State.PendingDraw = 2
	r.State.ActiveColor = Red
	r.State.Direction = 1
	r.State.Discard = []Card{{Color: Red, Kind: DrawTwo}}
	armInterrupt(r, 0) // alice played the original DrawTwo

	carolD2 := Card{Color: Red, Kind: DrawTwo}
	r.State.Hands[2].Cards = []Card{carolD2, {Color: Blue, Kind: Number, Value: 1}}

	if err := r.InterruptPlay(2, carolD2, -1); err != nil {
		t.Fatalf("identical DrawTwo interrupt during chain: %v", err)
	}
	if r.State.PendingDraw != 4 {
		t.Errorf("PendingDraw = %d, want 4 (chain extended)", r.State.PendingDraw)
	}
	// Next player after carol(2) clockwise is alice(0): she is now the victim.
	if r.State.CurrentTurn != 0 {
		t.Errorf("after carol's DrawTwo interject, turn = %d, want 0 (alice)", r.State.CurrentTurn)
	}
}

// --- Phase C: explicit interrupt window + batch interrupt ---

// armInterrupt sets the explicit interrupt-window fields so the test simulates
// a "card was just played by playerIndex" state without going through PlayCard.
func armInterrupt(r *Room, playerIndex int) {
	r.State.LastPlayBy = playerIndex
	r.State.LastPlayAt = time.Now()
	r.State.InterruptDeadline = time.Now().Add(InterruptWindow)
}

func TestRoom_InterruptPlay_OutsideWindowRejected(t *testing.T) {
	r := setupThreePlayerGame(t)
	r.State.CurrentTurn = 1
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 7}}
	r.State.PendingDraw = 0
	armInterrupt(r, 0)
	// Force the deadline into the past.
	r.State.InterruptDeadline = time.Now().Add(-50 * time.Millisecond)

	carolCard := Card{Color: Red, Kind: Number, Value: 7}
	r.State.Hands[2].Cards = append([]Card{carolCard}, r.State.Hands[2].Cards...)

	if err := r.InterruptPlay(2, carolCard, -1); err == nil {
		t.Error("interrupt outside window must be rejected")
	}
}

func TestRoom_InterruptPlay_PlayerWhoJustPlayedCannotInterrupt(t *testing.T) {
	// Even though it is no longer their current turn, the player who just played
	// must not be able to "interrupt themselves" within the window.
	r := setupThreePlayerGame(t)
	r.State.CurrentTurn = 1
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 7}}
	r.State.PendingDraw = 0
	armInterrupt(r, 0) // alice just played

	dup := Card{Color: Red, Kind: Number, Value: 7}
	r.State.Hands[0].Cards = append([]Card{dup}, r.State.Hands[0].Cards...)

	if err := r.InterruptPlay(0, dup, -1); err == nil {
		t.Error("the player who just played must not be able to interrupt themselves")
	}
}

func TestRoom_InterruptPlay_FastestSerializedWins(t *testing.T) {
	// Two non-current players hold an identical Red-7 and both attempt to
	// interrupt. The first call wins (turn transfers to that player). The
	// second call runs against post-first state — it is a chain interrupt
	// against the same identical card on top, also valid, transferring lead onward.
	r := NewRoom("FAST")
	for _, nick := range []string{"alice", "bob", "carol", "dave"} {
		if err := r.Join(nick); err != nil {
			t.Fatal(err)
		}
	}
	if err := r.Start(); err != nil {
		t.Fatal(err)
	}
	r.State.CurrentTurn = 1 // bob's turn (alice just played)
	r.State.Direction = 1
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 7}}
	r.State.PendingDraw = 0
	armInterrupt(r, 0) // alice just played

	match := Card{Color: Red, Kind: Number, Value: 7}
	// carol(2) and dave(3) both hold the identical card.
	r.State.Hands[2].Cards = append([]Card{match}, r.State.Hands[2].Cards...)
	r.State.Hands[3].Cards = append([]Card{match}, r.State.Hands[3].Cards...)

	if err := r.InterruptPlay(2, match, -1); err != nil {
		t.Fatalf("first interrupt by carol: %v", err)
	}
	if r.State.LastPlayBy != 2 {
		t.Errorf("LastPlayBy after first interrupt = %d, want 2 (carol)", r.State.LastPlayBy)
	}
	// After carol's interject CurrentTurn = dave(3).

	// Second arrival: dave is now the current player and cannot interrupt.
	if err := r.InterruptPlay(3, match, -1); err == nil {
		t.Error("dave is the current player and must not interrupt his own turn")
	}
}

func TestRoom_InterruptPlayCards_BatchSucceeds(t *testing.T) {
	// carol holds three Red-3 and interrupts with all three at once.
	r := setupThreePlayerGame(t)
	r.State.CurrentTurn = 1
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 3}}
	r.State.PendingDraw = 0
	armInterrupt(r, 0)

	match := Card{Color: Red, Kind: Number, Value: 3}
	r.State.Hands[2].Cards = []Card{match, match, match, {Color: Blue, Kind: Number, Value: 5}}

	if err := r.InterruptPlayCards(2, []Card{match, match, match}, -1); err != nil {
		t.Fatalf("InterruptPlayCards: %v", err)
	}
	// All three cards should be on top of discard (initial + 3 = 4 entries).
	if len(r.State.Discard) != 4 {
		t.Errorf("discard size = %d, want 4 (initial + 3 batch)", len(r.State.Discard))
	}
	// Carol's hand: 4 cards before, 3 played, 1 remains.
	if r.State.Hands[2].Size() != 1 {
		t.Errorf("carol hand size = %d, want 1", r.State.Hands[2].Size())
	}
	if r.State.LastPlayBy != 2 {
		t.Errorf("LastPlayBy after batch interrupt = %d, want 2 (carol)", r.State.LastPlayBy)
	}
}

func TestRoom_InterruptPlayCards_NotInHand_DoesNotMutate(t *testing.T) {
	// Player claims to play 2 copies but only holds 1. Reject and leave state untouched.
	r := setupThreePlayerGame(t)
	r.State.CurrentTurn = 1
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 4}}
	r.State.PendingDraw = 0
	armInterrupt(r, 0)

	match := Card{Color: Red, Kind: Number, Value: 4}
	r.State.Hands[2].Cards = []Card{match, {Color: Blue, Kind: Number, Value: 9}}
	discardLen := len(r.State.Discard)
	handLen := r.State.Hands[2].Size()
	turnBefore := r.State.CurrentTurn

	if err := r.InterruptPlayCards(2, []Card{match, match}, -1); err == nil {
		t.Fatal("batch interrupt with insufficient copies must be rejected")
	}
	if len(r.State.Discard) != discardLen {
		t.Errorf("discard mutated after rejection: size = %d, want %d", len(r.State.Discard), discardLen)
	}
	if r.State.Hands[2].Size() != handLen {
		t.Errorf("hand mutated after rejection: size = %d, want %d", r.State.Hands[2].Size(), handLen)
	}
	if r.State.CurrentTurn != turnBefore {
		t.Errorf("turn mutated after rejection: turn = %d, want %d", r.State.CurrentTurn, turnBefore)
	}
}

func TestRoom_InterruptPlayCards_RejectsNonIdentical(t *testing.T) {
	r := setupThreePlayerGame(t)
	r.State.CurrentTurn = 1
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 5}}
	armInterrupt(r, 0)

	a := Card{Color: Red, Kind: Number, Value: 5}
	b := Card{Color: Red, Kind: Number, Value: 6}
	r.State.Hands[2].Cards = []Card{a, b}
	if err := r.InterruptPlayCards(2, []Card{a, b}, -1); err == nil {
		t.Error("non-identical batch interrupt must be rejected")
	}
}

func TestRoom_PlayCard_OpensInterruptWindow(t *testing.T) {
	r := setupTwoPlayerGame(t)
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 5}}
	play := Card{Color: Red, Kind: Number, Value: 5}
	r.State.Hands[0].Cards = []Card{play, {Color: Blue, Kind: Number, Value: 9}}
	if err := r.PlayCard(0, play, Red, -1); err != nil {
		t.Fatalf("PlayCard: %v", err)
	}
	if r.State.LastPlayBy != 0 {
		t.Errorf("LastPlayBy = %d, want 0", r.State.LastPlayBy)
	}
	if !time.Now().Before(r.State.InterruptDeadline) {
		t.Error("InterruptDeadline must be in the future after a play")
	}
}

func TestRoom_DrawCard_ClosesInterruptWindow(t *testing.T) {
	r := setupTwoPlayerGame(t)
	armInterrupt(r, 1)
	if err := r.DrawCard(0); err != nil {
		t.Fatalf("DrawCard: %v", err)
	}
	if r.State.LastPlayBy != -1 {
		t.Errorf("after DrawCard, LastPlayBy = %d, want -1 (window closed)", r.State.LastPlayBy)
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

// --- BeginNextRound edge cases ---

func TestRoom_BeginNextRound_RejectsAfterMatchOver(t *testing.T) {
	r := NewRoom("BNRM")
	_ = r.Join("alice")
	_ = r.Join("bob")
	r.Format = BO1
	_ = r.Start()
	r.State.CurrentTurn = 0
	r.State.PendingDraw = 0

	// Force alice to win round 1 → BO1 → MatchOver = true.
	top := r.State.Discard[len(r.State.Discard)-1]
	winCard := Card{Color: top.Color, Kind: Number, Value: top.Value}
	r.State.Hands[0].Cards = []Card{winCard}
	r.State.Hands[1].Cards = []Card{{Kind: Number, Value: 5}}
	if err := r.PlayCard(0, winCard, winCard.Color, -1); err != nil {
		t.Fatalf("PlayCard: %v", err)
	}
	if !r.MatchOver {
		t.Fatal("expected MatchOver=true after BO1 win")
	}
	if err := r.BeginNextRound(); err == nil {
		t.Error("BeginNextRound after MatchOver should return error")
	}
}

func TestRoom_BeginNextRound_RejectsInLobby(t *testing.T) {
	r := NewRoom("BNRL")
	_ = r.Join("alice")
	_ = r.Join("bob")
	// Game not started; Status == StatusLobby.
	if err := r.BeginNextRound(); err == nil {
		t.Error("BeginNextRound in lobby should return error")
	}
}

// --- RemoveLobbyPlayer re-indexing ---

func TestRoom_RemoveLobbyPlayer_ReindexesPlayerIndices(t *testing.T) {
	r := NewRoom("RMVI")
	for _, n := range []string{"alice", "bob", "carol"} {
		if err := r.Join(n); err != nil {
			t.Fatal(err)
		}
	}
	// Verify initial indices.
	for i, p := range r.Players {
		if p.Index != i {
			t.Errorf("initial Players[%d].Index = %d, want %d", i, p.Index, i)
		}
	}

	// Remove the middle player (bob, index 1).
	wasHost, err := r.RemoveLobbyPlayer(1)
	if err != nil {
		t.Fatalf("RemoveLobbyPlayer: %v", err)
	}
	if wasHost {
		t.Error("removing index 1 should not report wasHost")
	}
	if len(r.Players) != 2 {
		t.Fatalf("Players after remove = %d, want 2", len(r.Players))
	}
	if r.Players[0].Nickname != "alice" || r.Players[0].Index != 0 {
		t.Errorf("Players[0] = %+v, want {alice, 0}", r.Players[0])
	}
	if r.Players[1].Nickname != "carol" || r.Players[1].Index != 1 {
		t.Errorf("Players[1] = %+v, want {carol, 1} after re-index", r.Players[1])
	}
}

func TestRoom_RemoveLobbyPlayer_HostFlag(t *testing.T) {
	r := NewRoom("RMVH")
	_ = r.Join("alice")
	_ = r.Join("bob")
	wasHost, err := r.RemoveLobbyPlayer(0)
	if err != nil {
		t.Fatalf("RemoveLobbyPlayer: %v", err)
	}
	if !wasHost {
		t.Error("removing index 0 should report wasHost=true")
	}
	if r.Players[0].Nickname != "bob" || r.Players[0].Index != 0 {
		t.Errorf("after host removal, new host = %+v, want {bob, 0}", r.Players[0])
	}
}

func TestRoom_RemoveLobbyPlayer_RejectedAfterStart(t *testing.T) {
	r := NewRoom("RMVA")
	_ = r.Join("alice")
	_ = r.Join("bob")
	_ = r.Start()
	if _, err := r.RemoveLobbyPlayer(0); err == nil {
		t.Error("RemoveLobbyPlayer after game start should return error")
	}
}

func TestRoom_RemoveLobbyPlayer_BoundsCheck(t *testing.T) {
	r := NewRoom("RMVB")
	_ = r.Join("alice")
	if _, err := r.RemoveLobbyPlayer(-1); err == nil {
		t.Error("negative index should return error")
	}
	if _, err := r.RemoveLobbyPlayer(99); err == nil {
		t.Error("out-of-range index should return error")
	}
}

// --- CatchUndeclared edge case (regression: catch attempt before someone played to 1 card) ---

func TestRoom_CatchUndeclared_NoTargetYet(t *testing.T) {
	r := setupTwoPlayerGame(t)
	// LastCardPlayer defaults to 0 and Hands[0] starts at 7 cards, so a catch
	// attempt at the start of the game must be rejected (target not at 1 card).
	if err := r.CatchUndeclared(1, 0, time.Now()); err == nil {
		t.Error("catch at game start should fail (no one played to 1 card yet)")
	}
}

// --- Additional Zwischenwerfen / out-of-turn play rule coverage ---

// An interjected Reverse flips the play direction, and the next-player
// resolution starts from the interjecter's seat under the new direction.
func TestRoom_InterruptPlay_ReverseFlipsDirection(t *testing.T) {
	r := setupThreePlayerGame(t)
	r.State.CurrentTurn = 1 // bob's turn
	r.State.Direction = 1   // clockwise
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Reverse}}
	r.State.PendingDraw = 0
	armInterrupt(r, 0)

	carolReverse := Card{Color: Red, Kind: Reverse}
	r.State.Hands[2].Cards = append([]Card{carolReverse}, r.State.Hands[2].Cards...)

	if err := r.InterruptPlay(2, carolReverse, -1); err != nil {
		t.Fatalf("InterruptPlay Reverse: %v", err)
	}
	if r.State.Direction != -1 {
		t.Errorf("Direction = %d, want -1 after Reverse interject", r.State.Direction)
	}
	// New direction is CCW. Next player after carol(2) CCW is bob(1).
	if r.State.CurrentTurn != 1 {
		t.Errorf("after Reverse interject, turn = %d, want 1 (bob via CCW)", r.State.CurrentTurn)
	}
}

// Direction must be respected: in counter-clockwise play, the player after the
// interjecter is computed by walking against the seat order.
func TestRoom_InterruptPlay_CounterClockwise(t *testing.T) {
	r := setupThreePlayerGame(t)
	r.State.CurrentTurn = 0 // alice's turn
	r.State.Direction = -1  // counter-clockwise: 0 -> 2 -> 1 -> 0
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 4}}
	r.State.PendingDraw = 0
	armInterrupt(r, 1) // bob just played

	carolCard := Card{Color: Red, Kind: Number, Value: 4}
	r.State.Hands[2].Cards = append([]Card{carolCard}, r.State.Hands[2].Cards...)

	if err := r.InterruptPlay(2, carolCard, -1); err != nil {
		t.Fatalf("InterruptPlay CCW: %v", err)
	}
	// CCW from carol(2): next is bob(1).
	if r.State.CurrentTurn != 1 {
		t.Errorf("after CCW interject, turn = %d, want 1 (bob)", r.State.CurrentTurn)
	}
}

// When an interjecter goes from 2 -> 1 cards, the LOCO! catch window must open
// for them — the obligation to declare applies on out-of-turn plays too.
func TestRoom_InterruptPlay_OpensCatchWindow(t *testing.T) {
	r := setupThreePlayerGame(t)
	r.State.CurrentTurn = 1
	r.State.Direction = 1
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 6}}
	r.State.PendingDraw = 0
	armInterrupt(r, 0)
	r.State.LastCardDeclared = true // simulate a previous declaration we expect to be cleared

	match := Card{Color: Red, Kind: Number, Value: 6}
	// carol holds exactly 2 cards; after the interject she will have 1.
	r.State.Hands[2].Cards = []Card{match, {Color: Blue, Kind: Number, Value: 1}}

	before := time.Now()
	if err := r.InterruptPlay(2, match, -1); err != nil {
		t.Fatalf("InterruptPlay: %v", err)
	}
	if r.State.LastCardDeclared {
		t.Error("LastCardDeclared must be reset after a fresh play to 1 card")
	}
	if r.State.LastCardPlayer != 2 {
		t.Errorf("LastCardPlayer = %d, want 2 (carol)", r.State.LastCardPlayer)
	}
	if r.State.LastCardTime.Before(before) {
		t.Error("LastCardTime should be updated to the moment of the interject")
	}

	// And alice (idx 0) can catch carol if she didn't declare in time.
	if err := r.CatchUndeclared(0, 2, time.Now()); err != nil {
		t.Errorf("catch on undeclared interject must succeed: %v", err)
	}
}
