package hub_test

import (
	"testing"

	"loco/server/protocol"
)

// Whether the pile may still be slammed is the server's word, and it rides
// every message that can open or shut the window. The client kept no copy of it
// and offered the twin for as long as the card was on top, so a slam after the
// seat at turn had drawn was answered "interrupt window closed" and rendered as
// "somebody was faster" on a table where nobody had been.
func TestInterruptOpen_RidesTheWire(t *testing.T) {
	t.Setenv("LOCO_E2E", "1")
	_, srv := newTestHub(t)
	conn1, conn2, _ := setupTwoPlayerGame(t, srv)

	// Alice at turn holding two red numbers on a red top; nothing pending.
	red7 := protocol.CardDTO{Color: "red", Kind: "number", Value: 7}
	red3 := protocol.CardDTO{Color: "red", Kind: "number", Value: 3}
	top := protocol.CardDTO{Color: "red", Kind: "number", Value: 9}
	zero, turn := 0, 0
	sendMsg(t, conn1, protocol.ClientMsg{
		Type: protocol.CMsgDebugSetState,
		Debug: &protocol.DebugStateDTO{
			Hand:        []protocol.CardDTO{red7, red3},
			Discard:     &top,
			PendingDraw: &zero,
			CurrentTurn: &turn,
		},
	})
	snap := readMsgOfType(t, conn1, protocol.SMsgGameState)
	readMsgOfType(t, conn2, protocol.SMsgGameState)
	if snap.State == nil || !snap.State.InterruptOpen {
		t.Fatalf("the snapshot of a fresh deal says the window is shut")
	}

	// A play opens it, and says so.
	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgPlayCard, Card: &red7})
	played := readMsgOfType(t, conn2, protocol.SMsgCardPlayed)
	if played.InterruptOpen == nil || !*played.InterruptOpen {
		t.Fatalf("card_played interrupt_open = %v, want true", played.InterruptOpen)
	}

	// Bob, at turn now, draws: the window shuts and every seat is told.
	sendMsg(t, conn2, protocol.ClientMsg{Type: protocol.CMsgDrawCard})
	drawn := readMsgOfType(t, conn1, protocol.SMsgCardDrawn)
	if drawn.InterruptOpen == nil || *drawn.InterruptOpen {
		t.Fatalf("card_drawn interrupt_open = %v, want false after the seat at turn drew", drawn.InterruptOpen)
	}

	// And the pass that follows carries the same answer.
	sendMsg(t, conn2, protocol.ClientMsg{Type: protocol.CMsgPassTurn})
	changed := readMsgOfType(t, conn1, protocol.SMsgTurnChanged)
	if changed.InterruptOpen == nil || *changed.InterruptOpen {
		t.Fatalf("turn_changed interrupt_open = %v, want false", changed.InterruptOpen)
	}
}
