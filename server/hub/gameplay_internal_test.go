package hub

import (
	"testing"

	"loco/server/game"
)

// A Contre-LOCO! that loses its race costs the caller a card, and the table is
// told whose call it was so the penalty renders. Once both piles are dry there
// is no penalty: the draw comes back empty and the call goes unpunished.
//
// It was announced anyway, and that was the last corner where a catch was free.
// catchGrace closed the one outside the window — refused to its sender, charged
// nothing, broadcast to nobody. This is the one inside it: a client at the rate
// limit could turn its ten messages a second into ten table-wide sends for the
// whole seven seconds a target's window is open, which is the amplification the
// grace period exists to prevent. The caller is still answered; the table is not
// asked to render a penalty nobody paid.
func TestPenalizeFailedCatch_DryPilesTellOnlyTheCaller(t *testing.T) {
	h := New()

	room := game.NewRoom("AAAAAA")
	if err := room.Join("Alice"); err != nil {
		t.Fatalf("Join(Alice): %v", err)
	}
	if err := room.Join("Bob"); err != nil {
		t.Fatalf("Join(Bob): %v", err)
	}
	if err := room.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}

	// Deck empty and nothing under the top discard, so the replenish behind the
	// draw finds nothing either.
	room.State.Deck.Cards = nil
	room.State.Discard = room.State.Discard[len(room.State.Discard)-1:]
	if drawn := len(room.PenalizeFailedCatch(0)); drawn != 0 {
		t.Fatalf("fixture is wrong: the penalty still drew %d cards", drawn)
	}

	tbl := newTable("AAAAAA", room)
	caller := &Client{send: make(chan []byte, 8)}
	bystander := &Client{send: make(chan []byte, 8)}
	tbl.members = []*Client{caller, bystander}

	h.penalizeFailedCatch(tbl, 0)

	if got := len(bystander.send); got != 0 {
		t.Errorf("the rest of the table was sent %d messages for a penalty nobody paid", got)
	}
	if got := len(caller.send); got != 1 {
		t.Errorf("the caller was sent %d messages, want the one answer their own button asked for", got)
	}
}
