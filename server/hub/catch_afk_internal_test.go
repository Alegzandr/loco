package hub

import (
	"testing"
	"time"

	"loco/server/game"
	"loco/server/protocol"
)

// A Contre-LOCO! the server deliberately does not answer is still a refusal.
// Nothing offered, inside the caller's own lockout, or against an offer already
// paid for: all three say nothing to anybody, so none of them reached sendError,
// and the dispatch boundary read every one as accepted and cleared the AFK
// counter. One press per turn into a table where nobody is near the finish kept
// an absent seat from ever being counted away: the declare_uno loophole of
// TestAFK_RefusedActionDoesNotClearTheCounter, back through another message.
func TestCatchUno_SilentRefusalsAreCountedAsRefusals(t *testing.T) {
	h := New()
	room := game.NewRoom("AAAAAA")
	for _, n := range []string{"Alice", "Bob"} {
		if err := room.Join(n); err != nil {
			t.Fatalf("Join(%s): %v", n, err)
		}
	}
	if err := room.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	tbl := newTable("AAAAAA", room)
	caller := &Client{send: make(chan []byte, 32)}
	caller.sitAt("AAAAAA", 0)
	tbl.members = []*Client{caller, {send: make(chan []byte, 32)}}

	press := func(label string, wantRefused bool) {
		t.Helper()
		before := caller.refusals.Load()
		h.handleCatchUno(tbl, caller, protocol.ClientMsg{Type: protocol.CMsgCatchUno})
		if refused := caller.refusals.Load() != before; refused != wantRefused {
			t.Errorf("%s: counted as refused = %v, want %v", label, refused, wantRefused)
		}
	}

	// Both seats on eight cards: nothing is offered.
	press("a press where nothing is offered", true)

	// Bob two cards from the finish: an offer. The first miss is a charged
	// wager the table hears, so it is not a refusal.
	room.State.Hands[1] = game.Hand{Cards: []game.Card{
		{Color: game.Red, Kind: game.Number, Value: 1},
		{Color: game.Red, Kind: game.Number, Value: 2},
	}}
	press("the first miss against an offer", false)

	// The miss armed the lockout: every press inside it wins and costs nothing.
	press("a press inside the lockout", true)

	// Lockout over, same offer, already paid for: charged nothing, said nothing.
	room.State.CatchLockedUntil[0] = time.Time{}
	press("a second miss against an offer already paid for", true)
}
