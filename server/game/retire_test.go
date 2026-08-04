package game

import (
	"testing"
	"time"
)

// Walking out of a match in progress.
//
// The rule the hub enforces is "three seats have to be left able to play"; this
// is what the domain does once it has said yes. What matters is that the table
// keeps playing: a seat that walks out must stop being a turn the clock has to
// auto-pass, which is the whole thing the feature exists to stop.

func retireRoom(t *testing.T, seats int) *Room {
	t.Helper()
	names := []string{"alice", "bob", "carol", "dave", "erin", "frank"}
	r := matchRoom(t, "RET", BO3, names[:seats]...)
	return r
}

func TestRetireSeat_HandGoesBackToTheDeck(t *testing.T) {
	r := retireRoom(t, 4)
	deckBefore := len(r.State.Deck.Cards)
	handSize := r.State.Hands[2].Size()

	if err := r.RetireSeat(2); err != nil {
		t.Fatalf("RetireSeat: %v", err)
	}

	if got := r.State.Hands[2].Size(); got != 0 {
		t.Errorf("hand = %d, want 0", got)
	}
	// Left in a hand nobody holds, those cards would shrink the deck for
	// everybody else every time somebody left.
	if got := len(r.State.Deck.Cards); got != deckBefore+handSize {
		t.Errorf("deck = %d, want %d", got, deckBefore+handSize)
	}
}

func TestRetireSeat_TheTurnStepsOverIt(t *testing.T) {
	r := retireRoom(t, 4)
	r.State.CurrentTurn = 1
	r.State.Direction = 1
	if err := r.RetireSeat(2); err != nil {
		t.Fatalf("RetireSeat: %v", err)
	}
	// It was not seat 2's turn, so nothing moved yet — but the next turn skips.
	if r.State.CurrentTurn != 1 {
		t.Errorf("CurrentTurn = %d, want 1 (nothing to move)", r.State.CurrentTurn)
	}
	if got := r.State.nextTurn(1); got != 3 {
		t.Errorf("nextTurn(1) = %d, want 3 (2 has left)", got)
	}
	if got := r.State.nextTurn(3); got != 0 {
		t.Errorf("nextTurn(3) = %d, want 0", got)
	}
}

// The case the feature is for: the player whose turn it is walks out. Waiting
// for the clock to notice is the two spoiled rounds this replaces.
func TestRetireSeat_MovesTheTurnOnImmediately(t *testing.T) {
	r := retireRoom(t, 4)
	r.State.CurrentTurn = 2
	r.State.Direction = 1
	r.State.PendingDraw = 4
	if err := r.RetireSeat(2); err != nil {
		t.Fatalf("RetireSeat: %v", err)
	}
	if r.State.CurrentTurn != 3 {
		t.Errorf("CurrentTurn = %d, want 3", r.State.CurrentTurn)
	}
	// A stack aimed at a seat that has left is not passed on: it is a penalty
	// the next player never earned.
	if r.State.PendingDraw != 0 {
		t.Errorf("PendingDraw = %d, want 0", r.State.PendingDraw)
	}
}

func TestRetireSeat_ClosesItsCatchWindow(t *testing.T) {
	r := retireRoom(t, 4)
	r.State.Hands[2].Cards = []Card{{Color: Red, Kind: Number, Value: 3}}
	r.State.openCatchWindow(2)
	if len(r.State.CatchableTargets(time.Now())) != 1 {
		t.Fatal("fixture: seat 2 should be catchable")
	}
	if err := r.RetireSeat(2); err != nil {
		t.Fatalf("RetireSeat: %v", err)
	}
	if got := r.State.CatchableTargets(time.Now()); len(got) != 0 {
		t.Errorf("CatchableTargets = %v, want none", got)
	}
}

// The scoreboard is the record of what happened, and walking out did not change
// what happened.
func TestRetireSeat_LeavesTheScoreboardAlone(t *testing.T) {
	r := retireRoom(t, 4)
	r.Scores = []int{40, 10, 90, 0}
	r.RoundsWon = []int{1, 0, 1, 0}
	if err := r.RetireSeat(2); err != nil {
		t.Fatalf("RetireSeat: %v", err)
	}
	if r.Scores[2] != 90 || r.RoundsWon[2] != 1 {
		t.Errorf("score = %d/%d, want 90/1", r.Scores[2], r.RoundsWon[2])
	}
	if r.MatchOver {
		t.Error("leaving must not end the match")
	}
}

func TestRetireSeat_IsDealtNothingInTheNextRound(t *testing.T) {
	r := retireRoom(t, 4)
	if err := r.RetireSeat(2); err != nil {
		t.Fatalf("RetireSeat: %v", err)
	}
	r.RoundEnded = false
	if err := r.BeginNextRound(); err != nil {
		t.Fatalf("BeginNextRound: %v", err)
	}
	if got := r.State.Hands[2].Size(); got != 0 {
		t.Errorf("dealt %d cards to a seat that left, want 0", got)
	}
	for i, h := range r.State.Hands {
		if i == 2 {
			continue
		}
		if h.Size() != initialHandSize {
			t.Errorf("seat %d got %d cards, want %d", i, h.Size(), initialHandSize)
		}
	}
	// And the round cannot open on the empty seat, whatever the points say.
	if r.State.CurrentTurn == 2 {
		t.Error("the round opened on the seat that left")
	}
	if !r.State.isRetired(2) {
		t.Error("the flag did not survive the deal")
	}
}

// Points pick the seat that opens a round, and a seat that walked out has the
// fewest of them from then on.
func TestRetireSeat_NeverOpensTheNextRound(t *testing.T) {
	r := retireRoom(t, 4)
	r.Scores = []int{50, 40, 0, 30}
	if err := r.RetireSeat(2); err != nil {
		t.Fatalf("RetireSeat: %v", err)
	}
	if got := r.biggestLoser(); got == 2 {
		t.Error("biggestLoser picked the seat that left")
	} else if got != 3 {
		t.Errorf("biggestLoser = %d, want 3", got)
	}
}

// A Global Switch turns the seats that are still in the circle. Handing one to a
// seat that has left takes the next player's hand away into a seat nobody can
// play from, and the round stalls.
func TestRetireSeat_GlobalSwitchSkipsIt(t *testing.T) {
	r := retireRoom(t, 4)
	if err := r.RetireSeat(1); err != nil {
		t.Fatalf("RetireSeat: %v", err)
	}
	src := r.State.rotateSeats(1)
	// Seats 0, 2 and 3 are the circle: each takes the previous one's hand.
	if src[0] != 3 || src[2] != 0 || src[3] != 2 {
		t.Errorf("rotation = %v, want 0<-3, 2<-0, 3<-2", src)
	}
	if src[1] != 1 {
		t.Errorf("the seat that left was dealt into the rotation: %v", src)
	}
}

func TestRetireSeat_CannotBeSwappedWith(t *testing.T) {
	r := retireRoom(t, 4)
	if err := r.RetireSeat(2); err != nil {
		t.Fatalf("RetireSeat: %v", err)
	}
	top := r.State.topCard()
	swap := Card{Color: top.Color, Kind: Swap}
	r.State.CurrentTurn = 0
	r.State.PendingDraw = 0
	r.State.ActiveColor = top.Color
	r.State.Hands[0].Cards = []Card{swap, {Color: Blue, Kind: Number, Value: 2}}

	if err := r.PlayCard(0, swap, swap.Color, 2); err == nil {
		t.Error("swapping with a seat that left was allowed")
	}
}

func TestRetireSeat_RefusesASecondDeparture(t *testing.T) {
	r := retireRoom(t, 4)
	if err := r.RetireSeat(2); err != nil {
		t.Fatalf("RetireSeat: %v", err)
	}
	if err := r.RetireSeat(2); err != ErrSeatAlreadyRetired {
		t.Errorf("second departure: err = %v, want ErrSeatAlreadyRetired", err)
	}
}

// Three seats with one gone is a duel, and a Reverse in a duel is a Skip.
func TestRetireSeat_ReverseIsASkipOnceTheTableIsTwo(t *testing.T) {
	r := retireRoom(t, 3)
	if err := r.RetireSeat(2); err != nil {
		t.Fatalf("RetireSeat: %v", err)
	}
	r.State.CurrentTurn = 0
	r.State.Direction = 1
	next := r.State.ApplyEffect(Card{Color: Red, Kind: Reverse}, Red)
	if next != 0 {
		t.Errorf("Reverse at an effective two seats: next = %d, want 0", next)
	}
}
