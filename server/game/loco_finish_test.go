package game

import (
	"errors"
	"testing"
)

// The rule these pin: a seat cannot forget LOCO! and still take the round.
//
// It used to be enforceable only through the 5 s catch window, which left two
// ways to win having told the table nothing. The quiet one is a seat that goes
// down to one card, is not caught, and wins a turn later without ever calling.
// The loud one is a hand of two identical cards put down in a single batch —
// 2 → 0, never through one card, so no window ever opened and no call was ever
// possible. Out of turn, by interject, that is a round taken from a hand nobody
// at the table saw coming.

// --- The batch that empties a hand, on the actor's own turn ---

func TestPlayCards_FinishingBatchWithoutTheCallIsRefused(t *testing.T) {
	r := setupThreePlayerGame(t)
	r.State.CurrentTurn = 0
	r.State.ActiveColor = Red
	r.State.PendingDraw = 0
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 3}}

	pair := Card{Color: Red, Kind: Number, Value: 3}
	r.State.Hands[0].Cards = []Card{pair, pair}

	err := r.PlayCards(0, []Card{pair, pair}, Red, -1, false)
	if !errors.Is(err, ErrMustDeclareLoco) {
		t.Fatalf("finishing batch without the call: err = %v, want ErrMustDeclareLoco", err)
	}
	// A refusal mutates nothing: the hand, the pile and the round are untouched.
	if r.State.Hands[0].Size() != 2 {
		t.Errorf("hand size after refusal = %d, want 2", r.State.Hands[0].Size())
	}
	if len(r.State.Discard) != 1 {
		t.Errorf("discard grew on a refused batch: %d entries, want 1", len(r.State.Discard))
	}
	if r.RoundEnded {
		t.Error("a refused batch ended the round")
	}
}

func TestPlayCards_FinishingBatchCarryingTheCallWins(t *testing.T) {
	r := setupThreePlayerGame(t)
	r.State.CurrentTurn = 0
	r.State.ActiveColor = Red
	r.State.PendingDraw = 0
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 3}}

	pair := Card{Color: Red, Kind: Number, Value: 3}
	r.State.Hands[0].Cards = []Card{pair, pair}

	if err := r.PlayCards(0, []Card{pair, pair}, Red, -1, true); err != nil {
		t.Fatalf("finishing batch carrying the call: %v", err)
	}
	if !r.RoundEnded {
		t.Fatal("a batch that empties the hand must end the round")
	}
	if r.Winner != "alice" {
		t.Errorf("round winner = %q, want alice", r.Winner)
	}
	// The call is recorded, not merely accepted: the log and the broadcast both
	// read the state rather than the message that carried it.
	if !r.State.LastCardDeclared[0] {
		t.Error("the call the batch carried was not recorded on the seat")
	}
	if !hasEvent(r, EventUnoDeclared, 0) {
		t.Error("no uno_declared event: the table would take the loss in silence")
	}
}

// The flag only ever answers a finish. A batch that leaves cards behind is an
// ordinary play, and the seat that sends one has made no claim about anything.
func TestPlayCards_NonFinishingBatchIgnoresTheFlag(t *testing.T) {
	r := setupThreePlayerGame(t)
	r.State.CurrentTurn = 0
	r.State.ActiveColor = Red
	r.State.PendingDraw = 0
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 3}}

	pair := Card{Color: Red, Kind: Number, Value: 3}
	r.State.Hands[0].Cards = []Card{pair, pair, {Color: Blue, Kind: Number, Value: 8}}

	if err := r.PlayCards(0, []Card{pair, pair}, Red, -1, false); err != nil {
		t.Fatalf("non-finishing batch without the flag: %v", err)
	}
	if r.State.Hands[0].Size() != 1 {
		t.Fatalf("hand size = %d, want 1", r.State.Hands[0].Size())
	}
	// Down to one card the ordinary way: the seat owes a call and is catchable,
	// which is precisely what the batch rule must not hand out for free.
	if r.State.LastCardDeclared[0] {
		t.Error("a non-finishing batch declared on the seat's behalf")
	}
	if r.State.LastCardAt[0].IsZero() {
		t.Error("no catch window opened on a seat left holding one card")
	}
}

// --- The batch that empties a hand out of turn: the case that opened this ---

func TestInterruptPlayCards_FinishingBatchWithoutTheCallIsRefused(t *testing.T) {
	r := setupThreePlayerGame(t)
	r.State.CurrentTurn = 1 // bob's turn; carol interjects
	r.State.ActiveColor = Red
	r.State.PendingDraw = 0
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 6}}
	armInterrupt(r, 0)

	pair := Card{Color: Red, Kind: Number, Value: 6}
	r.State.Hands[2].Cards = []Card{pair, pair}

	err := r.InterruptPlayCards(2, []Card{pair, pair}, Red, -1, false)
	if !errors.Is(err, ErrMustDeclareLoco) {
		t.Fatalf("finishing interject without the call: err = %v, want ErrMustDeclareLoco", err)
	}
	if r.State.Hands[2].Size() != 2 {
		t.Errorf("hand size after refusal = %d, want 2", r.State.Hands[2].Size())
	}
	if r.RoundEnded {
		t.Error("a refused interject ended the round")
	}
	if r.State.CurrentTurn != 1 {
		t.Errorf("turn moved on a refused interject: %d, want 1", r.State.CurrentTurn)
	}
}

func TestInterruptPlayCards_FinishingBatchCarryingTheCallWins(t *testing.T) {
	r := setupThreePlayerGame(t)
	r.State.CurrentTurn = 1
	r.State.ActiveColor = Red
	r.State.PendingDraw = 0
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 6}}
	armInterrupt(r, 0)

	pair := Card{Color: Red, Kind: Number, Value: 6}
	r.State.Hands[2].Cards = []Card{pair, pair}

	if err := r.InterruptPlayCards(2, []Card{pair, pair}, Red, -1, true); err != nil {
		t.Fatalf("finishing interject carrying the call: %v", err)
	}
	if !r.RoundEnded {
		t.Fatal("an interject that empties the hand must end the round")
	}
	if r.Winner != "carol" {
		t.Errorf("round winner = %q, want carol", r.Winner)
	}
	if !hasEvent(r, EventUnoDeclared, 2) {
		t.Error("the loudest win in the game went out without its call")
	}
}

// --- The quiet way: one card, no call, and a round taken a turn later ---

func TestPlayCard_LastCardWithoutTheCallIsRefused(t *testing.T) {
	r := setupTwoPlayerGame(t)
	r.State.CurrentTurn = 0
	r.State.PendingDraw = 0
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 2}}

	win := Card{Color: Red, Kind: Number, Value: 2}
	r.State.Hands[0].Cards = []Card{win}

	err := r.PlayCard(0, win, Red, -1)
	if !errors.Is(err, ErrMustDeclareLoco) {
		t.Fatalf("last card without the call: err = %v, want ErrMustDeclareLoco", err)
	}
	if r.RoundEnded {
		t.Error("a refused last card ended the round")
	}

	// And the seat is never trapped by it: the call can still be made, late, and
	// the round taken immediately after. Forgetting costs the catch risk and a
	// press, never the game.
	if err := r.DeclareLastCard(0); err != nil {
		t.Fatalf("a late call must still be accepted: %v", err)
	}
	if err := r.PlayCard(0, win, Red, -1); err != nil {
		t.Fatalf("play after the late call: %v", err)
	}
	if !r.RoundEnded {
		t.Error("the round did not end after the call was made")
	}
}

// A counter is the fourth way to empty a hand, and it is not an exemption.
func TestCounterDraw_LastCardWithoutTheCallIsRefused(t *testing.T) {
	r := setupTwoPlayerGame(t)
	r.State.CurrentTurn = 1
	r.State.PendingDraw = 2
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: DrawTwo}}
	r.State.armInterruptWindow(0)

	counter := Card{Color: Red, Kind: DrawTwo}
	r.State.Hands[1].Cards = []Card{counter}

	if err := r.CounterDraw(1, counter, Red); !errors.Is(err, ErrMustDeclareLoco) {
		t.Fatalf("winning counter without the call: err = %v, want ErrMustDeclareLoco", err)
	}
	if r.State.PendingDraw != 2 {
		t.Errorf("a refused counter resolved the stack: pending = %d, want 2", r.State.PendingDraw)
	}

	declareLast(t, r, 1)
	if err := r.CounterDraw(1, counter, Red); err != nil {
		t.Fatalf("counter after the call: %v", err)
	}
	if !r.RoundEnded {
		t.Error("a counter that empties the hand must end the round")
	}
}

// A seat that called for the card it holds keeps the right to win with it: the
// gate asks for the declaration, not for a fresh one on every attempt.
func TestPlayCard_DeclaredSeatFinishesFreely(t *testing.T) {
	r := setupTwoPlayerGame(t)
	r.State.CurrentTurn = 0
	r.State.PendingDraw = 0
	r.State.ActiveColor = Red
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 2}}

	win := Card{Color: Red, Kind: Number, Value: 2}
	r.State.Hands[0].Cards = []Card{win}
	declareLast(t, r, 0)

	if err := r.PlayCard(0, win, Red, -1); err != nil {
		t.Fatalf("a declared seat was refused its own last card: %v", err)
	}
	if !r.RoundEnded {
		t.Error("the round did not end")
	}
}

// The refusal is a player forgetting, not a client lying: it must not feed the
// cheat metric, and it must not trigger a resync — the client's board is right,
// it is the table's ears that are missing something.
func TestMustDeclareLoco_IsALostRaceAndNotAMismatch(t *testing.T) {
	if !IsLostRace(ErrMustDeclareLoco) {
		t.Error("ErrMustDeclareLoco must be a lost race: forgetting is not cheating")
	}
	if IsStateMismatch(ErrMustDeclareLoco) {
		t.Error("ErrMustDeclareLoco must not read as drift: the client's board is correct")
	}
}

// hasEvent reports whether the log carries kind for seat.
func hasEvent(r *Room, kind EventKind, seat int) bool {
	for _, e := range r.State.EventLog {
		if e.Kind == kind && e.PlayerIndex == seat {
			return true
		}
	}
	return false
}
