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

// A press lands on the instant it arrives, however early in the window that
// is. The opening 1.5s of every window used to be held for the seat that owed
// the call, so a Contre-LOCO! that beat their LOCO! to the server by being
// faster was made to wait and could be overtaken by the seat it had already
// caught. The reflex is what the button measures; nothing may stand between
// the press and the verdict.
func TestCatchUndeclared_LandsOnTheInstantTheWindowOpens(t *testing.T) {
	r := twoSeatRoom(t, 3, 1)
	r.State.openCatchWindow(1)

	if err := r.CatchUndeclared(0, 1, time.Now()); err != nil {
		t.Fatalf("a press on the opening frame of the window must land: %v", err)
	}
	if got := r.State.Hands[1].Size(); got != 1+undeclaredPenalty {
		t.Fatalf("penalty not applied: hand %d", got)
	}
}

// And the seat that spoke first still wins: being early is a wager, not a
// guarantee. This is the losing half of the same press.
func TestCatchUndeclared_DeclaredFirstIsARaceLost(t *testing.T) {
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
		t.Fatal("losing that race is a miss, and a miss costs a card")
	}
}

// The late half of the mistake, and the one the interface used to make
// impossible. A seat leaves the near-finish picture without anybody playing a
// card — it draws, it swallows a stack of four, a catch lands on it — and read
// off the hand alone the offer vanished on that frame: the press already on its
// way down was answered by nobody and charged to nobody. The window is what a
// press is aimed at, so it outlives the hand it opened on.
func TestCatchOffered_SurvivesTheHandGrowingOutOfReach(t *testing.T) {
	r := twoSeatRoom(t, 3, 1)
	r.State.openCatchWindow(1)
	// Seat 1 takes a stack of four the instant after the window opened.
	r.State.Hands[1].Add(Card{Color: Red, Kind: Number, Value: 4},
		Card{Color: Red, Kind: Number, Value: 5},
		Card{Color: Red, Kind: Number, Value: 6},
		Card{Color: Red, Kind: Number, Value: 7})

	if !r.CatchOffered(0, time.Now()) {
		t.Fatal("the window is still running: a press aimed at it is still a wager")
	}
	if _, charged := r.PenalizeFailedCatch(0, time.Now()); !charged {
		t.Fatal("a press that missed because the hand grew must cost its card")
	}
}

// The same on the clock: past the window but inside catchGrace, a call is late
// rather than imaginary, and late is a mistake a player is allowed to make.
func TestCatchOffered_CoversTheGraceAfterTheWindow(t *testing.T) {
	r := twoSeatRoom(t, 3, 1)
	r.State.openCatchWindow(1)
	late := r.State.LastCardAt[1].Add(catchWindow).Add(catchGrace / 2)

	if !r.CatchOffered(0, late) {
		t.Fatal("a press inside the grace is a wager that came too late")
	}
	if _, charged := r.PenalizeFailedCatch(0, late); !charged {
		t.Fatal("too late costs the same card as too early")
	}
	// And out the other side of the grace it is nothing at all: no honest
	// screen still has the button live, so there is nobody to charge.
	past := r.State.LastCardAt[1].Add(catchWindow).Add(catchGrace).Add(time.Second)
	if r.CatchOffered(0, past) {
		t.Fatal("past the grace the offer is gone")
	}
}

// One press per offer, whatever the hand does inside the window. The ration is
// the whole of what stops the button being mashed now that nothing delays a
// press, so it has to survive the board moving underneath it: keyed on the hand
// size, a seat drawing between two presses read as a fresh offer and charged
// the same misread twice.
func TestPenalizeFailedCatch_OneCardPerWindowThroughAGrowingHand(t *testing.T) {
	r := twoSeatRoom(t, 3, 1)
	r.State.openCatchWindow(1)

	if _, charged := r.PenalizeFailedCatch(0, time.Now()); !charged {
		t.Fatal("the first press against an offer is charged")
	}
	r.State.Hands[1].Add(Card{Color: Blue, Kind: Number, Value: 2})
	if _, charged := r.PenalizeFailedCatch(0, time.Now()); charged {
		t.Fatal("the same misread, a beat later, is not a second one")
	}
	if got := r.State.Hands[0].Size(); got != 3+failedCatchPenalty {
		t.Fatalf("catcher paid more than once: hand %d", got)
	}
}

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
