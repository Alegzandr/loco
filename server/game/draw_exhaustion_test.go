package game

import (
	"testing"
	"time"
)

// exhaustPiles leaves exactly keep cards in the deck and a single card on the
// discard, which is the state ensureDeck cannot recover from: there is nothing
// to reshuffle back in once every other card sits in somebody's hand.
func exhaustPiles(r *Room, keep int) {
	top := r.State.Discard[len(r.State.Discard)-1]
	r.State.Discard = []Card{top}
	if keep > len(r.State.Deck.Cards) {
		keep = len(r.State.Deck.Cards)
	}
	r.State.Deck.Cards = r.State.Deck.Cards[:keep]
}

// A draw never fails. The victim of a stack bigger than what is left takes
// whatever the piles can give and then plays normally: the alternative is an
// error returned on an already-mutated state, which evaporates the penalty and
// leaves the seat unable to act.
func TestDrawCard_PendingStackLargerThanTheDeck(t *testing.T) {
	r := startedRoom(t, "Alice", "Bob", "Carol", "Dave")
	turn := r.State.CurrentTurn
	exhaustPiles(r, 3)
	r.State.PendingDraw = 16
	before := r.State.Hands[turn].Size()

	if err := r.DrawCard(turn); err != nil {
		t.Fatalf("DrawCard with 3 cards left: %v, want nil", err)
	}
	if got := r.State.Hands[turn].Size(); got != before+3 {
		t.Errorf("hand = %d, want %d (every remaining card)", got, before+3)
	}
	if r.State.PendingDraw != 0 {
		t.Errorf("PendingDraw = %d, want 0", r.State.PendingDraw)
	}
	if !r.State.HasDrawn {
		t.Error("HasDrawn = false; the seat could neither draw again nor pass")
	}
	if r.State.CurrentTurn != turn {
		t.Error("a forced draw must not cost the turn")
	}
}

// The degenerate end state: every card is in a hand. The draw is a no-op that
// still leaves the seat able to play or pass, rather than an error nobody at
// the table has a legal answer to.
func TestDrawCard_NothingLeftToDraw(t *testing.T) {
	r := startedRoom(t, "Alice", "Bob")
	turn := r.State.CurrentTurn
	exhaustPiles(r, 0)
	before := r.State.Hands[turn].Size()

	if err := r.DrawCard(turn); err != nil {
		t.Fatalf("DrawCard on empty piles: %v, want nil", err)
	}
	if got := r.State.Hands[turn].Size(); got != before {
		t.Errorf("hand = %d, want %d unchanged", got, before)
	}
	if !r.State.HasDrawn {
		t.Fatal("HasDrawn = false after a draw that came up empty")
	}
	if err := r.PassTurn(turn); err != nil {
		t.Fatalf("PassTurn after an empty draw: %v — the round is frozen", err)
	}
}

// The refusal path must leave the state exactly as it found it. Clearing
// PendingDraw and setting HasDrawn before the draw could fail is what made a
// pending stack disappear without anybody drawing it.
func TestDrawCard_RefusalLeavesStateUntouched(t *testing.T) {
	r := startedRoom(t, "Alice", "Bob")
	turn := r.State.CurrentTurn
	if err := r.DrawCard(turn); err != nil {
		t.Fatalf("first DrawCard: %v", err)
	}
	size := r.State.Hands[turn].Size()

	if err := r.DrawCard(turn); err == nil {
		t.Fatal("second DrawCard in one turn was accepted")
	}
	if got := r.State.Hands[turn].Size(); got != size {
		t.Errorf("hand = %d, want %d — a refused draw handed over cards", got, size)
	}
	if !r.State.HasDrawn {
		t.Error("a refused draw cleared HasDrawn")
	}

	// Same for the out-of-turn refusal, which is the one an attacker controls.
	other := (turn + 1) % len(r.State.Hands)
	otherSize := r.State.Hands[other].Size()
	r.State.PendingDraw = 4
	if err := r.DrawCard(other); err == nil {
		t.Fatal("out-of-turn DrawCard was accepted")
	}
	if r.State.PendingDraw != 4 {
		t.Errorf("PendingDraw = %d, want 4 — an out-of-turn draw cleared the stack", r.State.PendingDraw)
	}
	if got := r.State.Hands[other].Size(); got != otherSize {
		t.Errorf("hand = %d, want %d", got, otherSize)
	}
}

// A successful Contre-LOCO! is not cancelled by an empty deck. The penalty
// shrinks; the catch itself stands, exactly like the failed-catch penalty
// right next to it.
func TestCatchUndeclared_EmptyDeckStillCatches(t *testing.T) {
	r := startedRoom(t, "Alice", "Bob")
	r.State.Hands[0] = Hand{Cards: []Card{{Color: Red, Kind: Number, Value: 5}}}
	r.State.openCatchWindow(0)
	exhaustPiles(r, 0)

	if err := r.CatchUndeclared(1, 0, time.Now()); err != nil {
		t.Fatalf("CatchUndeclared on empty piles: %v, want nil", err)
	}
	if !r.State.LastCardDeclared[0] {
		t.Error("the catch did not settle the target's obligation")
	}
	if r.State.Hands[0].Size() != 1 {
		t.Errorf("target hand = %d, want 1 — there was nothing to draw", r.State.Hands[0].Size())
	}
}

func TestCatchUndeclared_PartialPenalty(t *testing.T) {
	r := startedRoom(t, "Alice", "Bob")
	r.State.Hands[0] = Hand{Cards: []Card{{Color: Red, Kind: Number, Value: 5}}}
	r.State.openCatchWindow(0)
	exhaustPiles(r, 1)

	if err := r.CatchUndeclared(1, 0, time.Now()); err != nil {
		t.Fatalf("CatchUndeclared with 1 card left: %v, want nil", err)
	}
	if got := r.State.Hands[0].Size(); got != 2 {
		t.Errorf("target hand = %d, want 2 (1 card + the single card left)", got)
	}
}

func TestDeck_DrawUpTo(t *testing.T) {
	d := NewDeck()
	full := len(d.Cards)

	if got := d.DrawUpTo(8); len(got) != 8 {
		t.Errorf("DrawUpTo(8) returned %d cards, want 8", len(got))
	}
	if len(d.Cards) != full-8 {
		t.Errorf("deck len = %d, want %d", len(d.Cards), full-8)
	}
	if got := d.DrawUpTo(full); len(got) != full-8 {
		t.Errorf("DrawUpTo(%d) returned %d cards, want the %d that were left", full, len(got), full-8)
	}
	if got := d.DrawUpTo(3); got != nil {
		t.Errorf("DrawUpTo on an empty deck returned %v, want nil", got)
	}
	if got := d.DrawUpTo(-1); got != nil {
		t.Errorf("DrawUpTo(-1) returned %v, want nil", got)
	}
}
