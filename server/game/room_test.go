package game

import (
	"errors"
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
	r.State.LastCardDeclared[0] = true // alice has declared

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
	if !r.State.LastCardDeclared[0] {
		t.Error("LastCardDeclared[0] should be true")
	}
}

// TestRoom_LastCardDeclaration_OnlyOnce pins that a declaration is spent: the
// same single card cannot be announced twice. Repeating it re-broadcast
// uno_declared and re-logged the event, so a player could spam the banner (and
// the sting that goes with it) for as long as they held that card.
func TestRoom_LastCardDeclaration_OnlyOnce(t *testing.T) {
	r := setupTwoPlayerGame(t)
	r.State.Hands[0].Cards = r.State.Hands[0].Cards[:1]
	if err := r.DeclareLastCard(0); err != nil {
		t.Fatalf("DeclareLastCard: %v", err)
	}
	err := r.DeclareLastCard(0)
	if err == nil {
		t.Fatal("expected error declaring twice, got nil")
	}
	if err.Error() != "player already declared" {
		t.Errorf("got error %q, want %q", err.Error(), "player already declared")
	}
}

// TestRoom_LastCardDeclaration_AgainAfterRearrange verifies the flip side: a
// Swap or a GlobalSwitch hands the seat a *different* single card, which nobody
// at the table has heard announced, so the seat owes a fresh declaration.
func TestRoom_LastCardDeclaration_AgainAfterRearrange(t *testing.T) {
	r := setupTwoPlayerGame(t)
	r.State.Hands[0].Cards = r.State.Hands[0].Cards[:1]
	if err := r.DeclareLastCard(0); err != nil {
		t.Fatalf("DeclareLastCard: %v", err)
	}
	r.State.openCatchWindowsAfterRearrange()
	if err := r.DeclareLastCard(0); err != nil {
		t.Fatalf("DeclareLastCard after rearrange: %v", err)
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
	if r.State.LastCardAt[0].IsZero() {
		t.Fatal("expected LastCardAt to be set after playing to 1 card")
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
	if !r.State.LastCardDeclared[0] {
		t.Fatal("expected LastCardDeclared[0] = true after declaration")
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

// TestRoom_CatchUndeclared_NotReopenedByLaterPlay pins the regression where a
// declaration was silently voided by the *next* play from anyone: LastCardDeclared
// was reset unconditionally, so a player who had declared became catchable again
// as soon as somebody else discarded inside their 5 s window. With interjections
// that happens on almost every hand.
func TestRoom_CatchUndeclared_NotReopenedByLaterPlay(t *testing.T) {
	r := setupThreePlayerGame(t)
	r.State.CurrentTurn = 0
	r.State.Direction = 1
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 5}}

	alicePlay := Card{Color: Red, Kind: Number, Value: 3}
	r.State.Hands[0].Cards = []Card{alicePlay, {Color: Blue, Kind: Number, Value: 9}}
	if err := r.PlayCard(0, alicePlay, Red, -1); err != nil {
		t.Fatalf("alice PlayCard: %v", err)
	}
	if err := r.DeclareLastCard(0); err != nil {
		t.Fatalf("DeclareLastCard: %v", err)
	}

	// Bob plays immediately after — this must not void alice's declaration.
	bobPlay := Card{Color: Red, Kind: Number, Value: 6}
	r.State.Hands[1].Cards = append([]Card{bobPlay}, r.State.Hands[1].Cards...)
	if err := r.PlayCard(1, bobPlay, Red, -1); err != nil {
		t.Fatalf("bob PlayCard: %v", err)
	}

	if err := r.CatchUndeclared(2, 0, time.Now()); err == nil {
		t.Error("alice declared; a later play by bob must not make her catchable again")
	}
	if len(r.State.Hands[0].Cards) != 1 {
		t.Errorf("alice hand = %d, want 1 (no penalty)", len(r.State.Hands[0].Cards))
	}
}

// TestRoom_UNOStateCleanOnNewRound verifies that the per-seat UNO-tracking slices
// (LastCardDeclared, LastCardAt) are reallocated clean when a new round starts.
// Specifically, stale catch attempts on the new round must fail the catch window
// check (a zero LastCardAt is always outside the 5-second window).
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
	if r.State.LastCardAt[0].IsZero() {
		t.Fatal("round 1: expected LastCardAt set after alice plays to 1 card")
	}
	if r.State.LastCardDeclared[0] {
		t.Fatal("round 1: expected LastCardDeclared[0] = false (no declaration)")
	}

	// Bob plays his only card → 0 cards → round 1 ends.
	// BeginNextRound is now an explicit step (the hub calls it after broadcasting
	// round_end) so the card_played broadcast for the round-winning play sees the
	// pre-deal state instead of the new round's freshly-flipped first card.
	declareLast(t, r, 1)
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
	if r.State.LastCardDeclared[0] {
		t.Error("round 2: LastCardDeclared[0] should be false (fresh slice from dealRound)")
	}
	if !r.State.LastCardAt[0].IsZero() {
		t.Errorf("round 2: LastCardAt should be zero (fresh deal), got %v", r.State.LastCardAt[0])
	}

	// Any catch attempt must fail: zero LastCardAt → window is always expired
	err := r.CatchUndeclared(0, 1, time.Now())
	if err == nil {
		t.Fatal("catch at round-2 start must fail (zero LastCardAt means window expired)")
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

	declareLast(t, r, 0)
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

// The in-game score table shows one column per round played, so every finished
// round must leave its own row behind: cumulative Scores cannot be broken back
// down once the same player wins twice.
func TestRoom_RoundHistory_OneRowPerRound(t *testing.T) {
	r := NewRoom("HIST")
	_ = r.Join("alice")
	_ = r.Join("bob")
	r.Format = BO3
	_ = r.Start()

	if len(r.RoundHistory) != 0 {
		t.Fatalf("fresh match RoundHistory = %v, want empty", r.RoundHistory)
	}

	// Round 1: alice finishes holding nothing, bob holds 7 + Skip(20) = 27.
	r.State.Hands[0].Cards = nil
	r.State.Hands[1].Cards = []Card{{Kind: Number, Value: 7}, {Kind: Skip}}
	r.endRound(0)

	if err := r.BeginNextRound(); err != nil {
		t.Fatalf("BeginNextRound: %v", err)
	}

	// Round 2: bob finishes, alice holds a Wild (40).
	r.State.Hands[1].Cards = nil
	r.State.Hands[0].Cards = []Card{{Kind: WildCard, Color: Wild}}
	r.endRound(1)

	want := [][]int{{27, 0}, {0, 40}}
	if len(r.RoundHistory) != len(want) {
		t.Fatalf("RoundHistory = %v, want %v", r.RoundHistory, want)
	}
	for round, row := range want {
		for idx, points := range row {
			if r.RoundHistory[round][idx] != points {
				t.Errorf("round %d player %d = %d, want %d",
					round+1, idx, r.RoundHistory[round][idx], points)
			}
		}
	}
	// The rows must add up to the cumulative scores the scoreboard shows.
	if r.Scores[0] != 27 || r.Scores[1] != 40 {
		t.Errorf("Scores = %v, want [27 40]", r.Scores)
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

	declareLast(t, r, 0)
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

	declareLast(t, r, 0)
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
		declareLast(t, r, winnerIdx)
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

	declareLast(t, r, 0)
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

	declareLast(t, r, 1)
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

	err := r.PlayCard(0, gsCard, Blue, -1)
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

	if err := r.PlayCard(0, gsCard, Blue, -1); err != nil {
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

func TestRoom_GlobalSwitch_SetsChosenColorPlayable(t *testing.T) {
	// A GlobalSwitch names a colour like any other wild, and that colour must be
	// a real one so the next player can answer with an ordinary coloured card.
	// If ActiveColor became Wild the only legal cards at the table would be wilds
	// and everybody would be stuck drawing.
	r := setupThreePlayerGame(t)
	gsCard := Card{Color: Wild, Kind: GlobalSwitch}
	// Hands rotate one seat, so the card the next player will hold is the one
	// left in seat 0 after the play.
	r.State.Hands[0].Cards = []Card{gsCard, {Color: Red, Kind: Number, Value: 2}}
	r.State.Hands[1].Cards = []Card{{Color: Blue, Kind: Number, Value: 3}}
	r.State.Hands[2].Cards = []Card{{Color: Green, Kind: Number, Value: 4}}
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 9}}
	r.State.ActiveColor = Red
	r.State.Direction = 1

	if err := r.PlayCard(0, gsCard, Red, -1); err != nil {
		t.Fatalf("PlayCard GlobalSwitch: %v", err)
	}
	if r.State.ActiveColor != Red {
		t.Fatalf("ActiveColor = %v, want Red (chosen)", r.State.ActiveColor)
	}
	next := r.State.CurrentTurn
	var playable bool
	for _, c := range r.State.Hands[next].Cards {
		if CanPlay(c, r.State.topCard(), r.State.ActiveColor) {
			playable = true
		}
	}
	if !playable {
		t.Errorf("player %d holds %v — no legal card after GlobalSwitch", next, r.State.Hands[next].Cards)
	}
}

func TestRoom_InterruptPlay_GlobalSwitch_SetsChosenColor(t *testing.T) {
	r := setupThreePlayerGame(t)
	r.State.CurrentTurn = 1
	r.State.Direction = 1
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Wild, Kind: GlobalSwitch}}
	armInterrupt(r, 0)

	gs := Card{Color: Wild, Kind: GlobalSwitch}
	r.State.Hands[0].Cards = []Card{{Color: Red, Kind: Number, Value: 1}}
	r.State.Hands[1].Cards = []Card{{Color: Red, Kind: Number, Value: 2}}
	r.State.Hands[2].Cards = []Card{gs, {Color: Red, Kind: Number, Value: 3}}

	if err := r.InterruptPlay(2, gs, Green, -1); err != nil {
		t.Fatalf("GlobalSwitch interject: %v", err)
	}
	if r.State.ActiveColor != Green {
		t.Errorf("ActiveColor = %v, want Green (chosen by the interjecter)", r.State.ActiveColor)
	}
}

// A GlobalSwitch is a wild: it must name the colour that becomes active, on a
// normal play and on an interject alike. Letting a colourless one through would
// hand the table a rotation whose colour nobody chose.
func TestRoom_GlobalSwitch_RequiresChosenColor(t *testing.T) {
	r := setupThreePlayerGame(t)
	gs := Card{Color: Wild, Kind: GlobalSwitch}
	r.State.Hands[0].Cards = []Card{gs, {Color: Red, Kind: Number, Value: 1}}
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 9}}
	r.State.ActiveColor = Red

	if err := r.PlayCard(0, gs, Wild, -1); err == nil {
		t.Error("a GlobalSwitch play must name a real colour")
	}
	if len(r.State.Discard) != 1 {
		t.Error("a rejected GlobalSwitch must not touch the discard pile")
	}
}

func TestRoom_InterruptPlay_GlobalSwitch_RequiresChosenColor(t *testing.T) {
	r := setupThreePlayerGame(t)
	r.State.CurrentTurn = 1
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Wild, Kind: GlobalSwitch}}
	armInterrupt(r, 0)

	gs := Card{Color: Wild, Kind: GlobalSwitch}
	r.State.Hands[2].Cards = []Card{gs, {Color: Red, Kind: Number, Value: 3}}

	if err := r.InterruptPlay(2, gs, Wild, -1); err == nil {
		t.Error("a GlobalSwitch interject must name a real colour")
	}
	if len(r.State.Discard) != 1 {
		t.Error("a rejected GlobalSwitch must not touch the discard pile")
	}
}

func TestRoom_GlobalSwitchAsLastCard_DoesNotLeaveWildActive(t *testing.T) {
	r := setupThreePlayerGame(t)
	gsCard := Card{Color: Wild, Kind: GlobalSwitch}
	r.State.Hands[0].Cards = []Card{gsCard}
	r.State.Hands[1].Cards = []Card{{Color: Green, Kind: Number, Value: 3}}
	r.State.Hands[2].Cards = []Card{{Color: Yellow, Kind: Skip}}
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 9}}
	r.State.ActiveColor = Red

	declareLast(t, r, 0)
	if err := r.PlayCard(0, gsCard, Green, -1); err != nil {
		t.Fatalf("PlayCard GlobalSwitch as last card: %v", err)
	}
	if r.State.ActiveColor == Wild {
		t.Error("ActiveColor must never be Wild — the round summary would show a colourless ring")
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

	declareLast(t, r, 0)
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

	declareLast(t, r, 0)
	if err := r.PlayCard(0, gsCard, Green, -1); err != nil {
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

// TestPenaltyDraw_KeepsTurn verifies rules.md §14.5: a forced draw costs cards,
// not the turn. The victim takes the whole stack and then plays normally — or
// passes, which is the only thing that moves the turn on from there.
func TestPenaltyDraw_KeepsTurn(t *testing.T) {
	r := setupTwoPlayerGame(t)

	// Bob faces a +4 penalty stack.
	r.State.CurrentTurn = 1
	r.State.PendingDraw = 4

	if err := r.DrawCard(1); err != nil {
		t.Fatalf("DrawCard error: %v", err)
	}

	if r.State.CurrentTurn != 1 {
		t.Errorf("CurrentTurn = %d after penalty draw, want 1 (bob keeps the turn)", r.State.CurrentTurn)
	}
	// HasDrawn gates the second draw and unlocks PassTurn.
	if !r.State.HasDrawn {
		t.Error("HasDrawn should be true after a penalty draw")
	}
	if err := r.DrawCard(1); err == nil {
		t.Error("a second draw in the same turn must be refused")
	}
	if err := r.PassTurn(1); err != nil {
		t.Fatalf("PassTurn after a penalty draw: %v", err)
	}
	if r.State.CurrentTurn != 0 {
		t.Errorf("CurrentTurn = %d after passing, want 0 (alice)", r.State.CurrentTurn)
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

	// carol draws; must consume all 4 and keep the turn (§14.5) until she passes.
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
	if r.State.CurrentTurn != 2 {
		t.Errorf("turn = %d after carol draws, want 2 (carol keeps the turn)", r.State.CurrentTurn)
	}
	if err := r.PassTurn(2); err != nil {
		t.Fatalf("carol PassTurn: %v", err)
	}
	if r.State.CurrentTurn != 0 {
		t.Errorf("turn = %d after carol passes, want 0 (alice)", r.State.CurrentTurn)
	}
}

// A counter that empties the hand wins the round, and a round that is over has
// no interrupt window. CounterDraw used to carry its own copy of the win path
// and that copy left the window armed: nothing could be interjected into it,
// but only because of the order the hub runs its checks in. This asserts the
// state rather than the caller.
func TestCounterDraw_WinClosesTheInterruptWindow(t *testing.T) {
	r := setupTwoPlayerGame(t)

	// Bob is under a red +2, holds exactly the red +2 that answers it, and the
	// window is open from the play that put him there.
	r.State.CurrentTurn = 1
	r.State.PendingDraw = 2
	r.State.Discard = []Card{{Color: Red, Kind: DrawTwo}}
	r.State.ActiveColor = Red
	r.State.armInterruptWindow(0)
	counter := Card{Color: Red, Kind: DrawTwo}
	r.State.Hands[1].Cards = []Card{counter}

	declareLast(t, r, 1)
	if err := r.CounterDraw(1, counter, Red); err != nil {
		t.Fatalf("CounterDraw: %v", err)
	}
	if !r.RoundEnded {
		t.Fatalf("emptying the hand with a counter did not end the round")
	}
	if r.State.LastPlayBy >= 0 {
		t.Errorf("LastPlayBy = %d after a round-winning counter, want the window closed", r.State.LastPlayBy)
	}
}

// TestCounterDraw_RequiresSameColor verifies that a counter is the same card:
// a red +2 is answered by a red +2 only. The off-colour +2 is not lost — the
// forced draw keeps the turn (§14.5), so the victim takes the stack and then
// plays it as an ordinary kind-match on the very same discard.
func TestCounterDraw_RequiresSameColor(t *testing.T) {
	r := setupTwoPlayerGame(t)

	// Bob is under a red +2 and holds a blue one.
	r.State.CurrentTurn = 1
	r.State.PendingDraw = 2
	r.State.Discard = []Card{{Color: Red, Kind: DrawTwo}}
	r.State.ActiveColor = Red
	blueDrawTwo := Card{Color: Blue, Kind: DrawTwo}
	r.State.Hands[1].Cards = append([]Card{blueDrawTwo}, r.State.Hands[1].Cards...)

	if err := r.CounterDraw(1, blueDrawTwo, Blue); err == nil {
		t.Fatal("CounterDraw with a differently-coloured +2 should be refused")
	}
	if r.State.PendingDraw != 2 {
		t.Errorf("PendingDraw = %d after refused counter, want 2", r.State.PendingDraw)
	}

	// Take the penalty: the turn stays with bob, and the blue +2 is now legal.
	if err := r.DrawCard(1); err != nil {
		t.Fatalf("bob DrawCard: %v", err)
	}
	if r.State.CurrentTurn != 1 {
		t.Fatalf("turn = %d after forced draw, want 1 (bob keeps the turn)", r.State.CurrentTurn)
	}
	if err := r.PlayCard(1, blueDrawTwo, Blue, -1); err != nil {
		t.Fatalf("blue +2 on a red +2 after the forced draw: %v", err)
	}
	if r.State.PendingDraw != 2 {
		t.Errorf("PendingDraw = %d, want 2 (the newly played +2)", r.State.PendingDraw)
	}
	if r.State.ActiveColor != Blue {
		t.Errorf("ActiveColor = %v, want blue", r.State.ActiveColor)
	}
}

// TestCounterDraw_WildChainIgnoresColorTest verifies the colour check never
// blocks a +4 chain: every WildDrawFour is Wild-coloured, so same-colour holds
// by construction whatever colour was chosen.
func TestCounterDraw_WildChainIgnoresColorTest(t *testing.T) {
	r := setupTwoPlayerGame(t)

	r.State.CurrentTurn = 1
	r.State.PendingDraw = 4
	r.State.Discard = []Card{{Color: Wild, Kind: WildDrawFour}}
	r.State.ActiveColor = Red
	wd4 := Card{Color: Wild, Kind: WildDrawFour}
	r.State.Hands[1].Cards = append([]Card{wd4}, r.State.Hands[1].Cards...)

	if err := r.CounterDraw(1, wd4, Green); err != nil {
		t.Fatalf("CounterDraw +4 on +4: %v", err)
	}
	if r.State.PendingDraw != 8 {
		t.Errorf("PendingDraw = %d, want 8", r.State.PendingDraw)
	}
	if r.State.ActiveColor != Green {
		t.Errorf("ActiveColor = %v, want green (the counter's chosen colour)", r.State.ActiveColor)
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

	if err := r.InterruptPlay(2, carolCard, carolCard.Color, -1); err != nil {
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

// Every card can take the lead, wilds included — "identical to the top" is the
// only rule. A wild on a wild is identical (they share the wild colour), and the
// interjecter picks the new active colour just like a normal wild play.
func TestRoom_InterruptPlay_WildOnWildAllowed(t *testing.T) {
	r := setupThreePlayerGame(t)
	r.State.CurrentTurn = 1
	r.State.Direction = 1
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Wild, Kind: WildCard}}
	armInterrupt(r, 0)

	wild := Card{Color: Wild, Kind: WildCard}
	r.State.Hands[2].Cards = append([]Card{wild}, r.State.Hands[2].Cards...)

	if err := r.InterruptPlay(2, wild, Green, -1); err != nil {
		t.Fatalf("wild-on-wild interrupt must be accepted, got %v", err)
	}
	if r.State.ActiveColor != Green {
		t.Errorf("ActiveColor = %v, want Green (interjecter's choice)", r.State.ActiveColor)
	}
	if r.State.CurrentTurn != 0 {
		t.Errorf("turn = %d, want 0 (seat after carol)", r.State.CurrentTurn)
	}
}

func TestRoom_InterruptPlay_WildDrawFourExtendsChain(t *testing.T) {
	r := setupThreePlayerGame(t)
	r.State.CurrentTurn = 1
	r.State.Direction = 1
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Wild, Kind: WildDrawFour}}
	r.State.PendingDraw = 4
	armInterrupt(r, 0)

	wd4 := Card{Color: Wild, Kind: WildDrawFour}
	r.State.Hands[2].Cards = append([]Card{wd4}, r.State.Hands[2].Cards...)

	if err := r.InterruptPlay(2, wd4, Blue, -1); err != nil {
		t.Fatalf("WildDrawFour interject must be accepted, got %v", err)
	}
	if r.State.PendingDraw != 8 {
		t.Errorf("PendingDraw = %d, want 8 (chain extended)", r.State.PendingDraw)
	}
	if r.State.CurrentTurn != 0 {
		t.Errorf("turn = %d, want 0 (victim is the seat after carol)", r.State.CurrentTurn)
	}
}

func TestRoom_InterruptPlay_GlobalSwitchRotatesHands(t *testing.T) {
	r := setupThreePlayerGame(t)
	r.State.CurrentTurn = 1
	r.State.Direction = 1
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Wild, Kind: GlobalSwitch}}
	armInterrupt(r, 0)

	gs := Card{Color: Wild, Kind: GlobalSwitch}
	r.State.Hands[0].Cards = []Card{{Color: Red, Kind: Number, Value: 1}}
	r.State.Hands[1].Cards = []Card{{Color: Red, Kind: Number, Value: 2}}
	r.State.Hands[2].Cards = []Card{gs, {Color: Red, Kind: Number, Value: 3}}

	if err := r.InterruptPlay(2, gs, Yellow, -1); err != nil {
		t.Fatalf("GlobalSwitch interject must be accepted, got %v", err)
	}
	// Hands rotate one seat in the play direction: seat i receives seat i-1's hand.
	if got := r.State.Hands[0].Cards[0].Value; got != 3 {
		t.Errorf("alice received card %d, want 3 (carol's hand)", got)
	}
	if got := r.State.Hands[1].Cards[0].Value; got != 1 {
		t.Errorf("bob received card %d, want 1 (alice's hand)", got)
	}
	if got := r.State.Hands[2].Cards[0].Value; got != 2 {
		t.Errorf("carol received card %d, want 2 (bob's hand)", got)
	}
}

func TestRoom_InterruptPlay_WildWithoutColorRejected(t *testing.T) {
	r := setupThreePlayerGame(t)
	r.State.CurrentTurn = 1
	r.State.Discard = []Card{{Color: Wild, Kind: WildCard}}
	armInterrupt(r, 0)

	wild := Card{Color: Wild, Kind: WildCard}
	r.State.Hands[2].Cards = append([]Card{wild}, r.State.Hands[2].Cards...)

	if err := r.InterruptPlay(2, wild, Wild, -1); err == nil {
		t.Error("a wild interject must name a real colour")
	}
	if len(r.State.Discard) != 1 {
		t.Error("a rejected interject must not touch the discard pile")
	}
}

func TestRoom_InterruptPlay_NonMatchingCardRejected(t *testing.T) {
	r := setupTwoPlayerGame(t)
	r.State.CurrentTurn = 0
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 5}}

	mismatch := Card{Color: Blue, Kind: Number, Value: 5} // same value, wrong color
	r.State.Hands[1].Cards = append([]Card{mismatch}, r.State.Hands[1].Cards...)
	if err := r.InterruptPlay(1, mismatch, mismatch.Color, -1); err == nil {
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
	if err := r.InterruptPlay(1, mismatch, mismatch.Color, -1); err == nil {
		t.Error("value-mismatched interrupt should be rejected")
	}
}

// During an active draw chain (PendingDraw > 0) only an identical draw card may
// be interjected — in a consistent state that is implied by the identical-to-top
// rule, but a non-draw "match" (only reachable from inconsistent state) must
// still be rejected rather than silently swallowing the pending penalty.
func TestRoom_InterruptPlay_NonDrawCardDuringPendingDrawRejected(t *testing.T) {
	r := setupTwoPlayerGame(t)
	r.State.CurrentTurn = 0
	r.State.PendingDraw = 2
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 5}}
	armInterrupt(r, 0)
	matchCard := Card{Color: Red, Kind: Number, Value: 5}
	r.State.Hands[1].Cards = append([]Card{matchCard}, r.State.Hands[1].Cards...)
	if err := r.InterruptPlay(1, matchCard, matchCard.Color, -1); err == nil {
		t.Error("non-DrawTwo interrupt during pending draw should be rejected")
	}
}

func TestRoom_InterruptPlay_OwnTurnAllowed(t *testing.T) {
	// Slamming an identical card is available to everyone, including whoever
	// currently holds the turn — the client may route the tap either way.
	r := setupThreePlayerGame(t)
	r.State.CurrentTurn = 0
	r.State.Direction = 1
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 5}}
	armInterrupt(r, 2) // someone else just played
	matchCard := Card{Color: Red, Kind: Number, Value: 5}
	r.State.Hands[0].Cards = append([]Card{matchCard}, r.State.Hands[0].Cards...)
	if err := r.InterruptPlay(0, matchCard, matchCard.Color, -1); err != nil {
		t.Fatalf("interrupt on own turn must be accepted, got %v", err)
	}
	if r.State.CurrentTurn != 1 {
		t.Errorf("after alice's slam, turn = %d, want 1 (bob)", r.State.CurrentTurn)
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

	declareLast(t, r, 2)
	if err := r.InterruptPlay(2, winCard, winCard.Color, -1); err != nil {
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

	if err := r.InterruptPlay(2, swap, swap.Color, 1); err != nil {
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

	declareLast(t, r, 2)
	if err := r.InterruptPlay(2, swap, swap.Color, 1); err != nil {
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

	if err := r.InterruptPlay(2, carolSkip, carolSkip.Color, -1); err != nil {
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

	if err := r.PlayCards(0, []Card{d2, d2, d2}, Red, -1, false); err != nil {
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

	if err := r.PlayCards(0, []Card{skip, skip}, Red, -1, false); err != nil {
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
	if err := r.PlayCards(0, []Card{a, b}, Red, -1, false); err == nil {
		t.Error("non-identical batch should be rejected")
	}
}

func TestRoom_PlayCards_RejectsBatchSwap(t *testing.T) {
	r := setupTwoPlayerGame(t)
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 5}}
	r.State.ActiveColor = Red
	swap := Card{Color: Red, Kind: Swap}
	r.State.Hands[0].Cards = []Card{swap, swap}
	if err := r.PlayCards(0, []Card{swap, swap}, Red, 1, false); err == nil {
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

	if err := r.InterruptPlay(1, bob2, bob2.Color, -1); err == nil {
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
	if err := r.InterruptPlay(2, bob2, bob2.Color, -1); err == nil {
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

	if err := r.InterruptPlay(2, carolD2, carolD2.Color, -1); err != nil {
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
// It goes through armInterruptWindow rather than writing a field: the window and
// its author are two facts now, and a test that set only one of them would be
// arming a board the game cannot produce.
func armInterrupt(r *Room, playerIndex int) {
	r.State.armInterruptWindow(playerIndex)
}

func TestRoom_InterruptPlay_ClosedWindowRejected(t *testing.T) {
	// The window is closed by a draw / pass / round end, not by elapsed time.
	r := setupThreePlayerGame(t)
	r.State.CurrentTurn = 1
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 7}}
	r.State.PendingDraw = 0
	r.State.closeInterruptWindow()

	carolCard := Card{Color: Red, Kind: Number, Value: 7}
	r.State.Hands[2].Cards = append([]Card{carolCard}, r.State.Hands[2].Cards...)

	if err := r.InterruptPlay(2, carolCard, carolCard.Color, -1); err == nil {
		t.Error("interrupt on a closed window must be rejected")
	}
}

// The opening discard is a card on the pile like any other, so the seat dealt
// its twin may slam it before the round's first turn is taken. This used to be
// refused with ErrInterruptWindowClosed — which the client renders as "somebody
// was faster" — on a table where nobody had played at all. Nothing is armed by
// hand here: the point is the state dealRound leaves behind.
func TestRoom_InterruptPlay_OpeningDiscardIsInterceptable(t *testing.T) {
	r := setupThreePlayerGame(t)

	if !r.State.InterruptOpen {
		t.Fatal("the deal must leave the interrupt window open on the opening discard")
	}
	if r.State.LastPlayBy != -1 {
		t.Errorf("LastPlayBy = %d after the deal, want -1: nobody played that card", r.State.LastPlayBy)
	}

	top := r.State.topCard()
	if top.Kind != Number {
		t.Fatalf("opening discard = %v, want a Number", top)
	}
	// Carol is neither the current player nor the one who put the card there.
	r.State.Hands[2].Cards = append([]Card{top}, r.State.Hands[2].Cards...)
	before := len(r.State.Hands[2].Cards)

	if err := r.InterruptPlay(2, top, top.Color, -1); err != nil {
		t.Fatalf("interrupt on the opening discard must be accepted, got %v", err)
	}
	if r.State.LastPlayBy != 2 {
		t.Errorf("LastPlayBy = %d, want 2 (carol took the lead)", r.State.LastPlayBy)
	}
	if got := len(r.State.Hands[2].Cards); got != before-1 {
		t.Errorf("carol holds %d cards, want %d: the slammed copy left her hand", got, before-1)
	}
}

// The window the deal opens closes the same way every other one does.
func TestRoom_InterruptPlay_OpeningWindowClosesOnADraw(t *testing.T) {
	r := setupThreePlayerGame(t)
	top := r.State.topCard()
	r.State.Hands[2].Cards = append([]Card{top}, r.State.Hands[2].Cards...)

	if err := r.DrawCard(r.State.CurrentTurn); err != nil {
		t.Fatalf("voluntary draw: %v", err)
	}
	if r.State.InterruptOpen {
		t.Error("a draw must close the window the deal opened")
	}
	if err := r.InterruptPlay(2, top, top.Color, -1); !errors.Is(err, ErrInterruptWindowClosed) {
		t.Errorf("interrupt after the draw = %v, want ErrInterruptWindowClosed", err)
	}
}

func TestRoom_InterruptPlay_NoTimeLimit(t *testing.T) {
	// Taking the lead has no deadline: as long as the matching card is still on
	// top and nobody has drawn / passed, the jump-in stays available.
	r := setupThreePlayerGame(t)
	r.State.CurrentTurn = 1
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 7}}
	r.State.PendingDraw = 0
	armInterrupt(r, 0)
	// Simulate a long think from the current player.
	r.State.LastPlayAt = time.Now().Add(-30 * time.Second)

	carolCard := Card{Color: Red, Kind: Number, Value: 7}
	r.State.Hands[2].Cards = append([]Card{carolCard}, r.State.Hands[2].Cards...)

	if err := r.InterruptPlay(2, carolCard, carolCard.Color, -1); err != nil {
		t.Errorf("interrupt long after the play must still be accepted, got %v", err)
	}
	if r.State.LastPlayBy != 2 {
		t.Errorf("LastPlayBy = %d, want 2 (carol took the lead)", r.State.LastPlayBy)
	}
}

func TestRoom_InterruptPlay_SelfInterruptAllowed(t *testing.T) {
	// The player who just played may slam a second identical card and take the
	// lead back — this is the core of the game's speed.
	r := setupThreePlayerGame(t)
	r.State.CurrentTurn = 1
	r.State.Direction = 1
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 7}}
	r.State.PendingDraw = 0
	armInterrupt(r, 0) // alice just played

	dup := Card{Color: Red, Kind: Number, Value: 7}
	r.State.Hands[0].Cards = append([]Card{dup}, r.State.Hands[0].Cards...)

	if err := r.InterruptPlay(0, dup, dup.Color, -1); err != nil {
		t.Fatalf("self-interrupt must be accepted, got %v", err)
	}
	// Lead transfers back to alice, so the next seat clockwise plays: bob(1).
	if r.State.CurrentTurn != 1 {
		t.Errorf("after alice's self-interrupt, turn = %d, want 1 (bob)", r.State.CurrentTurn)
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

	if err := r.InterruptPlay(2, match, match.Color, -1); err != nil {
		t.Fatalf("first interrupt by carol: %v", err)
	}
	if r.State.LastPlayBy != 2 {
		t.Errorf("LastPlayBy after first interrupt = %d, want 2 (carol)", r.State.LastPlayBy)
	}
	// After carol's interject CurrentTurn = dave(3).

	// Second arrival: dave slams the same identical card. Being the current
	// player is no longer a reason to refuse — he simply takes the lead in turn,
	// and the seat after him plays next.
	if err := r.InterruptPlay(3, match, match.Color, -1); err != nil {
		t.Fatalf("second interrupt by dave: %v", err)
	}
	if r.State.LastPlayBy != 3 {
		t.Errorf("LastPlayBy after second interrupt = %d, want 3 (dave)", r.State.LastPlayBy)
	}
	if r.State.CurrentTurn != 0 {
		t.Errorf("after dave's interject, turn = %d, want 0 (alice)", r.State.CurrentTurn)
	}
}

func TestRoom_InterruptPlayCards_BatchIsRefused(t *testing.T) {
	// carol holds three Red-3 and tries to slam all three at once. An interject
	// is one card: the copies are three presses into three windows, not one.
	r := setupThreePlayerGame(t)
	r.State.CurrentTurn = 1
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 3}}
	r.State.PendingDraw = 0
	armInterrupt(r, 0)

	match := Card{Color: Red, Kind: Number, Value: 3}
	r.State.Hands[2].Cards = []Card{match, match, match, {Color: Blue, Kind: Number, Value: 5}}
	discardLen := len(r.State.Discard)

	if err := r.InterruptPlayCards(2, []Card{match, match, match}, match.Color, -1); !errors.Is(err, ErrInterruptBatch) {
		t.Fatalf("batch interject: err = %v, want ErrInterruptBatch", err)
	}
	if len(r.State.Discard) != discardLen {
		t.Errorf("discard mutated after rejection: size = %d, want %d", len(r.State.Discard), discardLen)
	}
	if r.State.Hands[2].Size() != 4 {
		t.Errorf("carol hand size = %d, want 4", r.State.Hands[2].Size())
	}
	if r.State.CurrentTurn != 1 {
		t.Errorf("turn moved on a refused interject: %d, want 1", r.State.CurrentTurn)
	}

	// One press, one card, and the lead is taken exactly as before.
	if err := r.InterruptPlayCards(2, []Card{match}, match.Color, -1); err != nil {
		t.Fatalf("single interject: %v", err)
	}
	if len(r.State.Discard) != discardLen+1 {
		t.Errorf("discard size = %d, want %d (initial + 1)", len(r.State.Discard), discardLen+1)
	}
	if r.State.Hands[2].Size() != 3 {
		t.Errorf("carol hand size = %d, want 3 (two copies left to press)", r.State.Hands[2].Size())
	}
	if r.State.LastPlayBy != 2 {
		t.Errorf("LastPlayBy after interrupt = %d, want 2 (carol)", r.State.LastPlayBy)
	}
}

func TestRoom_InterruptPlayCards_NotInHand_DoesNotMutate(t *testing.T) {
	// Player slams a card matching the top that they do not hold. Reject and
	// leave state untouched.
	r := setupThreePlayerGame(t)
	r.State.CurrentTurn = 1
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 4}}
	r.State.PendingDraw = 0
	armInterrupt(r, 0)

	match := Card{Color: Red, Kind: Number, Value: 4}
	r.State.Hands[2].Cards = []Card{{Color: Blue, Kind: Number, Value: 9}}
	discardLen := len(r.State.Discard)
	handLen := r.State.Hands[2].Size()
	turnBefore := r.State.CurrentTurn

	if err := r.InterruptPlayCards(2, []Card{match}, match.Color, -1); !errors.Is(err, ErrCardNotInHand) {
		t.Fatalf("interject of a card not held: err = %v, want ErrCardNotInHand", err)
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
	if r.State.LastPlayAt.IsZero() {
		t.Error("LastPlayAt must be stamped after a play")
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
	declareLast(t, r, 0)
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
	// Every seat starts with a full hand and a zero LastCardAt, so a catch
	// attempt at the start of the game must be rejected (target not at 1 card).
	if err := r.CatchUndeclared(1, 0, time.Now()); err == nil {
		t.Error("catch at game start should fail (no one played to 1 card yet)")
	}
}

// --- Receiving a single card owes the table a declaration (§11.1) ---

// Swap hands the target the actor's leftovers. If that is a single card the
// target must call LOCO! like anybody else: what the rule protects is the
// table's right to know somebody is one card from winning, and how the hand
// got there changes nothing.
func TestRoom_Swap_ReceiverOwesDeclaration(t *testing.T) {
	r := setupThreePlayerGame(t)
	r.State.CurrentTurn = 0
	r.State.Direction = 1
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 5}}

	swap := Card{Color: Red, Kind: Swap}
	// Alice: swap + one leftover. Bob: three cards. After the swap Alice holds
	// three and Bob holds the single leftover.
	r.State.Hands[0].Cards = []Card{swap, {Color: Blue, Kind: Number, Value: 2}}
	r.State.Hands[1].Cards = []Card{
		{Color: Green, Kind: Number, Value: 3},
		{Color: Green, Kind: Number, Value: 4},
		{Color: Green, Kind: Number, Value: 6},
	}
	r.State.Hands[2].Cards = []Card{{Color: Yellow, Kind: Number, Value: 7}}

	if err := r.PlayCard(0, swap, Red, 1); err != nil {
		t.Fatalf("PlayCard swap: %v", err)
	}
	if got := r.State.Hands[1].Size(); got != 1 {
		t.Fatalf("bob hand = %d, want 1 (received alice's leftover)", got)
	}
	if err := r.CatchUndeclared(2, 1, time.Now()); err != nil {
		t.Fatalf("bob received a single card and never declared, so he must be catchable: %v", err)
	}
	if got := r.State.Hands[1].Size(); got != 3 {
		t.Errorf("bob hand after penalty = %d, want 3", got)
	}
}

// Declaring closes the window for a receiver exactly as for a player who played
// down to one card.
func TestRoom_Swap_ReceiverCanDeclare(t *testing.T) {
	r := setupThreePlayerGame(t)
	r.State.CurrentTurn = 0
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 5}}

	swap := Card{Color: Red, Kind: Swap}
	r.State.Hands[0].Cards = []Card{swap, {Color: Blue, Kind: Number, Value: 2}}
	r.State.Hands[1].Cards = []Card{
		{Color: Green, Kind: Number, Value: 3},
		{Color: Green, Kind: Number, Value: 4},
	}
	r.State.Hands[2].Cards = []Card{{Color: Yellow, Kind: Number, Value: 7}}

	if err := r.PlayCard(0, swap, Red, 1); err != nil {
		t.Fatalf("PlayCard swap: %v", err)
	}
	if err := r.DeclareLastCard(1); err != nil {
		t.Fatalf("bob must be able to declare the card he received: %v", err)
	}
	if err := r.CatchUndeclared(2, 1, time.Now()); err == nil {
		t.Error("bob declared; catching him must fail")
	}
}

// A GlobalSwitch can put several seats on one card in the same instant, and each
// of them owes a declaration. A single tracked target would let all but one walk.
func TestRoom_GlobalSwitch_EverySingleCardSeatIsCatchable(t *testing.T) {
	r := setupThreePlayerGame(t)
	r.State.CurrentTurn = 0
	r.State.Direction = 1
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 5}}

	gs := Card{Color: Wild, Kind: GlobalSwitch}
	// After the play: seat 0 ← seat 2's hand (1 card), seat 1 ← alice's leftover
	// (1 card), seat 2 ← seat 1's hand (2 cards).
	r.State.Hands[0].Cards = []Card{gs, {Color: Blue, Kind: Number, Value: 2}}
	r.State.Hands[1].Cards = []Card{
		{Color: Green, Kind: Number, Value: 3},
		{Color: Green, Kind: Number, Value: 4},
	}
	r.State.Hands[2].Cards = []Card{{Color: Yellow, Kind: Number, Value: 7}}

	if err := r.PlayCard(0, gs, Green, -1); err != nil {
		t.Fatalf("PlayCard global switch: %v", err)
	}
	open := r.State.CatchableTargets(time.Now())
	if len(open) != 2 || open[0] == open[1] {
		t.Fatalf("CatchableTargets = %v, want the two seats left holding one card", open)
	}
	for _, seat := range []int{0, 1} {
		if r.State.Hands[seat].Size() != 1 {
			t.Fatalf("seat %d holds %d cards, fixture is wrong", seat, r.State.Hands[seat].Size())
		}
	}
	// Both are catchable, independently.
	if err := r.CatchUndeclared(2, 0, time.Now()); err != nil {
		t.Errorf("seat 0 must be catchable: %v", err)
	}
	if err := r.CatchUndeclared(2, 1, time.Now()); err != nil {
		t.Errorf("seat 1 must be catchable too, one slot cannot hold two debts: %v", err)
	}
}

// Catching yourself would be a free pass: you would take a 2-card penalty at a
// moment of your choosing and close the window nobody else got to use.
func TestRoom_CatchUndeclared_CannotCatchYourself(t *testing.T) {
	r := setupThreePlayerGame(t)
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 5}}
	r.State.Hands[0].Cards = []Card{
		{Color: Red, Kind: Number, Value: 2},
		{Color: Red, Kind: Number, Value: 3},
	}
	if err := r.PlayCard(0, Card{Color: Red, Kind: Number, Value: 2}, Red, -1); err != nil {
		t.Fatalf("PlayCard: %v", err)
	}
	if err := r.CatchUndeclared(0, 0, time.Now()); err == nil {
		t.Error("a player must not be able to catch themselves")
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

	if err := r.InterruptPlay(2, carolReverse, carolReverse.Color, -1); err != nil {
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

	if err := r.InterruptPlay(2, carolCard, carolCard.Color, -1); err != nil {
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
	r.State.LastCardDeclared[2] = true // simulate a previous declaration we expect to be cleared

	match := Card{Color: Red, Kind: Number, Value: 6}
	// carol holds exactly 2 cards; after the interject she will have 1.
	r.State.Hands[2].Cards = []Card{match, {Color: Blue, Kind: Number, Value: 1}}

	before := time.Now()
	if err := r.InterruptPlay(2, match, match.Color, -1); err != nil {
		t.Fatalf("InterruptPlay: %v", err)
	}
	if r.State.LastCardDeclared[2] {
		t.Error("LastCardDeclared[2] must be reset after a fresh play to 1 card")
	}
	if r.State.LastCardAt[2].IsZero() {
		t.Error("carol's catch window must be open after she interjects to 1 card")
	}
	if r.State.LastCardAt[2].Before(before) {
		t.Error("LastCardAt should be updated to the moment of the interject")
	}

	// And alice (idx 0) can catch carol if she didn't declare in time.
	if err := r.CatchUndeclared(0, 2, time.Now()); err != nil {
		t.Errorf("catch on undeclared interject must succeed: %v", err)
	}
}

// --- Rematch -------------------------------------------------------------

// finishMatch drives a BO1 room to a completed match so rematch paths can be
// exercised without replaying a full round of plays.
func finishMatch(t *testing.T, nicknames ...string) *Room {
	t.Helper()
	r := NewRoom("TEST")
	for _, n := range nicknames {
		if err := r.Join(n); err != nil {
			t.Fatalf("Join(%q): %v", n, err)
		}
	}
	if err := r.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	// Empty player 0's hand and end the round from their seat.
	r.State.Hands[0].Cards = nil
	r.endRound(0)
	if !r.MatchOver {
		t.Fatalf("setup: expected MatchOver after BO1 round")
	}
	return r
}

func TestRoom_ResetForRematch(t *testing.T) {
	r := finishMatch(t, "alice", "bob")
	r.Format = BO3
	r.MaxPlayers = 4
	prevPlayers := append([]*Player(nil), r.Players...)

	if err := r.ResetForRematch(); err != nil {
		t.Fatalf("ResetForRematch: %v", err)
	}

	if r.Status != StatusLobby {
		t.Errorf("Status = %v, want lobby", r.Status)
	}
	if r.State != nil {
		t.Error("State must be cleared so no stale hands leak into the new match")
	}
	if r.MatchOver || r.MatchWinner != "" || r.RoundEnded || r.Winner != "" {
		t.Errorf("match signals not cleared: over=%v winner=%q roundEnded=%v roundWinner=%q",
			r.MatchOver, r.MatchWinner, r.RoundEnded, r.Winner)
	}
	if r.RoundNumber != 0 {
		t.Errorf("RoundNumber = %d, want 0 (Start sets it to 1)", r.RoundNumber)
	}
	if r.Scores != nil || r.RoundsWon != nil || r.LostHandTotal != nil {
		t.Error("cumulative match tallies must be cleared")
	}
	if r.RoundHistory != nil {
		t.Error("RoundHistory must be cleared, the new match starts at round 1")
	}
	// Roster and lobby config survive — the whole point is "same room, same people".
	if len(r.Players) != len(prevPlayers) {
		t.Fatalf("Players = %d, want %d", len(r.Players), len(prevPlayers))
	}
	for i, p := range r.Players {
		if p != prevPlayers[i] {
			t.Errorf("player %d changed identity", i)
		}
		if p.Index != i {
			t.Errorf("player %d Index = %d, want %d", i, p.Index, i)
		}
	}
	if r.Format != BO3 {
		t.Errorf("Format = %v, want BO3 (preserved)", r.Format)
	}
	if r.MaxPlayers != 4 {
		t.Errorf("MaxPlayers = %d, want 4 (preserved)", r.MaxPlayers)
	}
}

func TestRoom_ResetForRematch_ThenStartAgain(t *testing.T) {
	r := finishMatch(t, "alice", "bob")
	if err := r.ResetForRematch(); err != nil {
		t.Fatalf("ResetForRematch: %v", err)
	}
	if err := r.Start(); err != nil {
		t.Fatalf("Start after rematch reset: %v", err)
	}
	if r.Status != StatusPlaying {
		t.Errorf("Status = %v, want playing", r.Status)
	}
	if r.RoundNumber != 1 {
		t.Errorf("RoundNumber = %d, want 1", r.RoundNumber)
	}
	for i := range r.Players {
		if got := len(r.State.Hands[i].Cards); got != initialHandSize {
			t.Errorf("player %d hand = %d cards, want %d", i, got, initialHandSize)
		}
	}
	if r.Scores[0] != 0 || r.Scores[1] != 0 {
		t.Errorf("scores not reset: %v", r.Scores)
	}
}

func TestRoom_ResetForRematch_RejectedMidMatch(t *testing.T) {
	r := NewRoom("TEST")
	_ = r.Join("alice")
	_ = r.Join("bob")
	if err := r.ResetForRematch(); err == nil {
		t.Error("rematch from lobby must be rejected")
	}
	if err := r.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	if err := r.ResetForRematch(); err == nil {
		t.Error("rematch mid-match must be rejected")
	}
}

// A rematch must also be allowed after the lobby shrank — the new match is
// dealt for whoever is still in the room.
func TestRoom_ResetForRematch_AllowsRosterChangeBeforeStart(t *testing.T) {
	r := finishMatch(t, "alice", "bob", "carol")
	if err := r.ResetForRematch(); err != nil {
		t.Fatalf("ResetForRematch: %v", err)
	}
	if _, err := r.RemoveLobbyPlayer(1); err != nil {
		t.Fatalf("RemoveLobbyPlayer: %v", err)
	}
	if err := r.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	if len(r.Scores) != 2 {
		t.Errorf("Scores len = %d, want 2 (sized to the new roster)", len(r.Scores))
	}
}

// --- Failed catch penalty -------------------------------------------------

// A Contre-LOCO! that arrives after the target's declaration is a race lost on
// the wire, not a protocol violation: the domain must say so explicitly so the
// hub can charge the caller a card instead of treating them as a cheat.
func TestRoom_CatchUndeclared_MissedByDeclaration(t *testing.T) {
	r := setupThreePlayerGame(t)
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 5}}
	r.State.Hands[0].Cards = []Card{
		{Color: Red, Kind: Number, Value: 2},
		{Color: Red, Kind: Number, Value: 3},
	}
	if err := r.PlayCard(0, Card{Color: Red, Kind: Number, Value: 2}, Red, -1); err != nil {
		t.Fatalf("PlayCard: %v", err)
	}
	if err := r.DeclareLastCard(0); err != nil {
		t.Fatalf("DeclareLastCard: %v", err)
	}
	err := r.CatchUndeclared(1, 0, time.Now())
	if err == nil {
		t.Fatal("catching a declared player must fail")
	}
	if !IsMissedCatch(err) {
		t.Errorf("IsMissedCatch(%v) = false, want true", err)
	}
	if err.Error() != "player already declared" {
		t.Errorf("error text = %q, want the unchanged wire string", err.Error())
	}
}

// Same for a window that closed before the message landed.
func TestRoom_CatchUndeclared_MissedByExpiry(t *testing.T) {
	r := setupThreePlayerGame(t)
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 5}}
	r.State.Hands[0].Cards = []Card{
		{Color: Red, Kind: Number, Value: 2},
		{Color: Red, Kind: Number, Value: 3},
	}
	if err := r.PlayCard(0, Card{Color: Red, Kind: Number, Value: 2}, Red, -1); err != nil {
		t.Fatalf("PlayCard: %v", err)
	}
	err := r.CatchUndeclared(1, 0, time.Now().Add(catchWindow+time.Second))
	if err == nil {
		t.Fatal("catching after the window must fail")
	}
	if !IsMissedCatch(err) {
		t.Errorf("IsMissedCatch(%v) = false, want true", err)
	}
}

// A malformed target is a client bug or an attack, never a lost race — it must
// not be charged a card, and the hub still counts it as suspect.
func TestRoom_CatchUndeclared_InvalidTargetIsNotAMiss(t *testing.T) {
	r := setupThreePlayerGame(t)
	if err := r.CatchUndeclared(1, 99, time.Now()); err == nil || IsMissedCatch(err) {
		t.Errorf("CatchUndeclared(1, 99) = %v, want a non-miss error", err)
	}
	if err := r.CatchUndeclared(0, 0, time.Now()); err == nil || IsMissedCatch(err) {
		t.Errorf("self-catch = %v, want a non-miss error", err)
	}
}

// nearSeat puts seat i one ordinary play from the finish, which is what makes
// a Contre-LOCO! from any other chair a wager (CatchOffered) rather than a
// message no honest client sends.
func nearSeat(r *Room, i int) {
	r.State.Hands[i] = Hand{Cards: []Card{
		{Color: Red, Kind: Number, Value: 1},
		{Color: Red, Kind: Number, Value: 2},
	}}
}

// The wager: a miss costs the caller exactly one card, and nothing else about
// the round moves — not the turn, not the target's hand, not the draw flag.
func TestRoom_PenalizeFailedCatch(t *testing.T) {
	r := setupThreePlayerGame(t)
	nearSeat(r, 0)
	before := r.State.Hands[1].Size()
	turn, hasDrawn := r.State.CurrentTurn, r.State.HasDrawn
	targetBefore := r.State.Hands[0].Size()

	cards, charged := r.PenalizeFailedCatch(1, time.Now())
	if !charged {
		t.Fatal("the first failed catch on an offer must be charged")
	}
	if len(cards) != failedCatchPenalty {
		t.Fatalf("PenalizeFailedCatch drew %d cards, want %d", len(cards), failedCatchPenalty)
	}
	if got := r.State.Hands[1].Size(); got != before+failedCatchPenalty {
		t.Errorf("catcher hand = %d, want %d", got, before+failedCatchPenalty)
	}
	if r.State.CurrentTurn != turn || r.State.HasDrawn != hasDrawn {
		t.Error("a failed catch must not touch the turn state")
	}
	if r.State.Hands[0].Size() != targetBefore {
		t.Error("a failed catch must not touch the target's hand")
	}
}

// A penalty is a draw, and a draw never fails: with every card in a hand the
// caller simply gets away with it rather than the round freezing.
func TestRoom_PenalizeFailedCatch_EmptyDeck(t *testing.T) {
	r := setupThreePlayerGame(t)
	nearSeat(r, 0)
	r.State.Deck.Cards = nil
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 5}}
	before := r.State.Hands[1].Size()
	cards, charged := r.PenalizeFailedCatch(1, time.Now())
	if len(cards) != 0 {
		t.Fatalf("PenalizeFailedCatch on an exhausted deck drew %d cards, want 0", len(cards))
	}
	// Charged all the same: the wager was taken, the table simply had no card
	// left to take it with. Otherwise a dry deck would refund every press.
	if !charged {
		t.Error("a call against dry piles is still the seat's one charge for this offer")
	}
	if got := r.State.Hands[1].Size(); got != before {
		t.Errorf("catcher hand = %d, want %d unchanged", got, before)
	}
}

// The anti-spam rule, and the reason the button can afford to be live for most
// of an endgame: a seat pays for one misread per offer, not per press. Anything
// else would tax the reflex the whole mechanic is asking for.
func TestRoom_PenalizeFailedCatch_ChargesOncePerOffer(t *testing.T) {
	r := setupThreePlayerGame(t)
	nearSeat(r, 0)
	if _, charged := r.PenalizeFailedCatch(1, time.Now()); !charged {
		t.Fatal("the first press must be charged")
	}
	before := r.State.Hands[1].Size()

	for i := 0; i < 5; i++ {
		cards, charged := r.PenalizeFailedCatch(1, time.Now())
		if charged || len(cards) != 0 {
			t.Fatalf("press %d on an unchanged offer charged again", i+2)
		}
	}
	if got := r.State.Hands[1].Size(); got != before {
		t.Errorf("catcher hand = %d, want %d — spamming the button must cost nothing more", got, before)
	}
}

// A press against a table where nobody is near the finish is not a wager: no
// honest screen has the button live, so there is nothing to misread and
// nothing to charge. This is also what closes the farm to a client this game
// did not write — the price can only ever be paid where the offer is.
func TestRoom_PenalizeFailedCatch_NothingOfferedChargesNothing(t *testing.T) {
	r := setupThreePlayerGame(t)
	before := r.State.Hands[1].Size()
	if cards, charged := r.PenalizeFailedCatch(1, time.Now()); charged || len(cards) != 0 {
		t.Fatal("eight-card hands all round: nothing was offered, so nothing may be charged")
	}
	// A seat on one card whose window shut long ago is the same table: the
	// button went dark when the window did.
	r.State.Hands[0] = Hand{Cards: []Card{{Color: Red, Kind: Number, Value: 1}}}
	r.State.LastCardAt[0] = time.Now().Add(-time.Minute)
	if _, charged := r.PenalizeFailedCatch(1, time.Now()); charged {
		t.Fatal("a seat stuck on one card past its window is not an offer")
	}
	// Three cards out is not one either — the client's threshold, pinned here.
	r.State.Hands[0] = Hand{Cards: []Card{
		{Color: Red, Kind: Number, Value: 1},
		{Color: Red, Kind: Number, Value: 2},
		{Color: Red, Kind: Number, Value: 3},
	}}
	if _, charged := r.PenalizeFailedCatch(1, time.Now()); charged {
		t.Fatal("three cards out is one too many to be an offer")
	}
	if got := r.State.Hands[1].Size(); got != before {
		t.Errorf("catcher hand = %d, want %d untouched", got, before)
	}
}

// The other half of the ration, and the farm it closes: the catcher's own play
// is not a new offer. Charged per card played, a press before and a press
// after one's own play bought two cards a turn off a seat sitting on two —
// faster than the voluntary draw, and exactly the hand a Swap is fed with.
func TestRoom_PenalizeFailedCatch_OwnPlayIsNotANewOffer(t *testing.T) {
	r := setupThreePlayerGame(t)
	nearSeat(r, 0)
	if _, charged := r.PenalizeFailedCatch(1, time.Now()); !charged {
		t.Fatal("the first press must be charged")
	}

	// The catcher plays a card, through the real path.
	top := r.State.topCard()
	card := Card{Color: r.State.ActiveColor, Kind: Number, Value: top.Value}
	r.State.Hands[1].Add(card)
	r.State.CurrentTurn = 1
	if err := r.PlayCard(1, card, 0, -1); err != nil {
		t.Fatalf("PlayCard: %v", err)
	}

	if _, charged := r.PenalizeFailedCatch(1, time.Now()); charged {
		t.Error("the seat on two has not moved, so the second press is the same misread")
	}
}

// And what IS a new offer: the near seat playing down to its last card. The
// anticipation miss and the race miss are two reads of two boards.
func TestRoom_PenalizeFailedCatch_ChargesAgainOnANewOffer(t *testing.T) {
	r := setupThreePlayerGame(t)
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 5}}
	nearSeat(r, 0)
	if _, charged := r.PenalizeFailedCatch(1, time.Now()); !charged {
		t.Fatal("the first press must be charged")
	}
	r.State.CurrentTurn = 0
	if err := r.PlayCard(0, Card{Color: Red, Kind: Number, Value: 2}, Red, -1); err != nil {
		t.Fatalf("PlayCard: %v", err)
	}
	if _, charged := r.PenalizeFailedCatch(1, time.Now()); !charged {
		t.Error("the seat is on its last card now: a new offer, a new wager, a new card")
	}
	// A second window on the same seat is a second offer too: the card it is
	// down to is not the card it was down to.
	r.State.Hands[0].Add(Card{Color: Red, Kind: Number, Value: 3})
	r.State.Hands[0].Cards = r.State.Hands[0].Cards[1:]
	r.State.openCatchWindow(0)
	// Distinct from the first window whatever the clock's resolution.
	r.State.LastCardAt[0] = r.State.LastCardAt[0].Add(time.Millisecond)
	if _, charged := r.PenalizeFailedCatch(1, time.Now()); !charged {
		t.Error("a reopened window is a fresh offer")
	}
}

// The server owns how long a catch window lasts, and now says so on the wire
// (protocol.CatchSeatDTO.EndsAt). The client no longer holds a copy of the
// duration, so this is the only place it is written down.
func TestGameState_CatchWindowEnd(t *testing.T) {
	r := NewRoom("TEST")
	if err := r.Join("Alice"); err != nil {
		t.Fatalf("join: %v", err)
	}
	if err := r.Join("Bob"); err != nil {
		t.Fatalf("join: %v", err)
	}
	if err := r.Start(); err != nil {
		t.Fatalf("start: %v", err)
	}
	r.State.openCatchWindow(1)
	opened := r.State.LastCardAt[1]
	if got, want := r.State.CatchWindowEnd(1), opened.Add(catchWindow); !got.Equal(want) {
		t.Errorf("CatchWindowEnd = %v, want %v", got, want)
	}
	if !r.State.catchWindowOpen(1, opened.Add(catchWindow-time.Millisecond)) {
		t.Error("the window must still be open a millisecond before its end")
	}
}

// declareLast makes the call a seat owes before it plays the card that takes the
// round. Every fixture that ends a round goes through it, because the domain now
// refuses a finish from a seat that never called LOCO! (ErrMustDeclareLoco) —
// which is the rule, and the reason so many of these fixtures grew a line.
func declareLast(t *testing.T, r *Room, seat int) {
	t.Helper()
	if err := r.DeclareLastCard(seat); err != nil {
		t.Fatalf("DeclareLastCard(%d): %v", seat, err)
	}
}
