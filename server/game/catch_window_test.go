package game

import (
	"errors"
	"testing"
	"time"
)

// A Contre-LOCO! costs the caller a card whenever it loses a race, which is
// what makes the wager honest. These tests own the line between a race and a
// call on a seat that was never on the hook: everything on the wrong side of it
// used to be charged, announced to the whole table, and — once the piles ran
// dry and the penalty draw came back empty — free.

// twoSeatRoom deals a room and hands back its state, with every seat holding
// the number of cards the caller asked for.
func twoSeatRoom(t *testing.T, sizes ...int) *Room {
	t.Helper()
	r := NewRoom("TEST01")
	for i := range sizes {
		if err := r.Join(string(rune('A' + i))); err != nil {
			t.Fatalf("join %d: %v", i, err)
		}
	}
	if err := r.Start(); err != nil {
		t.Fatalf("start: %v", err)
	}
	for i, n := range sizes {
		hand := Hand{}
		for j := 0; j < n; j++ {
			hand.Add(Card{Color: Red, Kind: Number, Value: 1 + j%9})
		}
		r.State.Hands[i] = hand
	}
	return r
}

func TestCatchUndeclared_SeatThatWasNeverOnTheHook(t *testing.T) {
	r := twoSeatRoom(t, 3, 5)
	// Seat 1 holds five cards and has never played down to one: its LastCardAt
	// is the zero value, so nothing about it was ever catchable.
	err := r.CatchUndeclared(0, 1, time.Now())
	if !errors.Is(err, ErrNoCatchWindow) {
		t.Fatalf("want ErrNoCatchWindow, got %v", err)
	}
	if IsMissedCatch(err) {
		t.Fatal("a call on a seat that was never on the hook must not be charged as a lost race")
	}
	if IsLostRace(err) {
		t.Fatal("and it must not be excused as one either: nothing a correct client sends reaches here")
	}
}

func TestCatchUndeclared_LongClosedWindowIsNotARace(t *testing.T) {
	r := twoSeatRoom(t, 3, 1)
	// The window opened, nobody called it, and it shut a long time ago. Every
	// client stopped drawing the button when it did.
	r.State.LastCardAt[1] = time.Now().Add(-time.Minute)

	err := r.CatchUndeclared(0, 1, time.Now())
	if !errors.Is(err, ErrNoCatchWindow) {
		t.Fatalf("want ErrNoCatchWindow, got %v", err)
	}
	if got := r.State.Hands[0].Size(); got != 3 {
		t.Fatalf("caller was charged for a window nobody could still see: hand %d", got)
	}
}

func TestCatchUndeclared_JustMissedIsStillARace(t *testing.T) {
	r := twoSeatRoom(t, 3, 1)
	// Shut a moment ago: the button was live when it was pressed and the
	// message lost the trip. That is the wager, and it is charged.
	r.State.LastCardAt[1] = time.Now().Add(-(catchWindow + 500*time.Millisecond))

	err := r.CatchUndeclared(0, 1, time.Now())
	if !errors.Is(err, ErrCatchWindowExpired) {
		t.Fatalf("want ErrCatchWindowExpired, got %v", err)
	}
	if !IsMissedCatch(err) {
		t.Fatal("a window that shut inside the grace is a lost race and must still cost a card")
	}
}

func TestCatchUndeclared_OpenWindowStillCatches(t *testing.T) {
	r := twoSeatRoom(t, 3, 1)
	r.State.openCatchWindow(1)

	if err := r.CatchUndeclared(0, 1, time.Now()); err != nil {
		t.Fatalf("an open window must still be catchable: %v", err)
	}
	if got := r.State.Hands[1].Size(); got != 1+undeclaredPenalty {
		t.Fatalf("penalty not applied: hand %d", got)
	}
}

func TestCatchUndeclared_DeclaredInsideTheWindowIsStillARace(t *testing.T) {
	r := twoSeatRoom(t, 3, 1)
	r.State.openCatchWindow(1)
	if err := r.DeclareLastCard(1); err != nil {
		t.Fatalf("declare: %v", err)
	}

	err := r.CatchUndeclared(0, 1, time.Now())
	if !errors.Is(err, ErrAlreadyDeclared) {
		t.Fatalf("want ErrAlreadyDeclared, got %v", err)
	}
	if !IsMissedCatch(err) {
		t.Fatal("beaten to the declaration is the race this mechanic is made of")
	}
}

func TestCatchUndeclared_CatcherOutOfRange(t *testing.T) {
	r := twoSeatRoom(t, 3, 1)
	r.State.openCatchWindow(1)

	if err := r.CatchUndeclared(9, 1, time.Now()); err == nil {
		t.Fatal("a catcher this deal has no hand for must be refused, not indexed")
	}
}
