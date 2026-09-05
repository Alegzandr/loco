package hub_test

import (
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"loco/server/protocol"
)

// A Contre-LOCO! is answered on the instant it arrives, and what keeps the
// button from being mashed is that only the first press against an offer is
// charged. Both halves are here: the press that would once have been held for
// the opening 1.5s of the window now lands straight away, and six presses in a
// row cost exactly one card.

// playDownToOne has the active seat play to a single card without calling it,
// and hands back which socket owes the call, which one can catch, and the
// seats behind each.
func playDownToOne(t *testing.T, srv *httptest.Server) (activeConn, catcherConn *websocket.Conn, activeIdx, catcherIdx int) {
	t.Helper()
	conn1, conn2, _ := setupTwoPlayerGame(t, srv)
	// Whose turn it is decides who plays down to one.
	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgDebugSetState, Debug: &protocol.DebugStateDTO{}})
	gs1 := readMsgOfType(t, conn1, protocol.SMsgGameState)
	gs2 := readMsgOfType(t, conn2, protocol.SMsgGameState)
	activeConn, catcherConn = conn1, conn2
	activeIdx, catcherIdx = gs1.State.YourIndex, gs2.State.YourIndex
	if gs1.State.Turn != gs1.State.YourIndex {
		activeConn, catcherConn = conn2, conn1
		activeIdx, catcherIdx = gs2.State.YourIndex, gs1.State.YourIndex
	}
	zero := 0
	sendMsg(t, activeConn, protocol.ClientMsg{
		Type: protocol.CMsgDebugSetState,
		Debug: &protocol.DebugStateDTO{
			Hand:        []protocol.CardDTO{{Color: "red", Kind: "number", Value: 6}, {Color: "red", Kind: "number", Value: 7}},
			Discard:     &protocol.CardDTO{Color: "red", Kind: "number", Value: 5},
			PendingDraw: &zero,
		},
	})
	readMsgOfType(t, activeConn, protocol.SMsgGameState)
	readMsgOfType(t, catcherConn, protocol.SMsgGameState)
	sendMsg(t, activeConn, protocol.ClientMsg{
		Type: protocol.CMsgPlayCard,
		Card: &protocol.CardDTO{Color: "red", Kind: "number", Value: 7},
	})
	readMsgOfType(t, activeConn, protocol.SMsgCardPlayed)
	readMsgOfType(t, catcherConn, protocol.SMsgCardPlayed)
	return activeConn, catcherConn, activeIdx, catcherIdx
}

// Nothing stands between the press and the verdict. The opening 1.5s of every
// window used to be held for the seat that owed the call: a press made there
// was kept by the hub and resolved when the stretch ended, so the player whose
// reflex had won the race waited more than a second to find out, and could be
// overtaken by the seat they had already caught. A reaction the server delays
// is not a reaction it measures.
func TestCatchUNO_LandsOnTheInstantItArrives(t *testing.T) {
	t.Setenv("LOCO_E2E", "1")
	_, srv := newTestHub(t)
	activeConn, catcherConn, activeIdx, _ := playDownToOne(t, srv)

	pressedAt := time.Now()
	sendMsg(t, catcherConn, protocol.ClientMsg{Type: protocol.CMsgCatchUno, TargetIndex: &activeIdx})

	caught := readMsgOfType(t, activeConn, protocol.SMsgUnoCaught)
	if caught.Seat() != activeIdx {
		t.Errorf("uno_caught PlayerIndex = %d, want %d", caught.Seat(), activeIdx)
	}
	// Generous enough to survive a loaded runner, and far under the 1.5s hold
	// it exists to fail on.
	if waited := time.Since(pressedAt); waited > time.Second {
		t.Errorf("the catch landed %v after the press: something is holding it back", waited)
	}
	if seen := readMsgOfType(t, catcherConn, protocol.SMsgUnoCaught); seen.Seat() != activeIdx {
		t.Errorf("catcher saw uno_caught for seat %d, want %d", seen.Seat(), activeIdx)
	}
}

// And the seat that speaks first still wins. Being early is a wager, not a
// guarantee: the declaration arrived before the press, so the press is a race
// lost, charged once and announced once, and the seat keeps its single card.
func TestCatchUNO_DeclaringFirstBeatsThePress(t *testing.T) {
	t.Setenv("LOCO_E2E", "1")
	_, srv := newTestHub(t)
	activeConn, catcherConn, activeIdx, catcherIdx := playDownToOne(t, srv)

	sendMsg(t, activeConn, protocol.ClientMsg{Type: protocol.CMsgDeclareUno})
	readMsgOfType(t, activeConn, protocol.SMsgUnoDeclared)
	readMsgOfType(t, catcherConn, protocol.SMsgUnoDeclared)
	sendMsg(t, catcherConn, protocol.ClientMsg{Type: protocol.CMsgCatchUno, TargetIndex: &activeIdx})

	failed := readMsgOfType(t, catcherConn, protocol.SMsgCatchFailed)
	if failed.Seat() != catcherIdx {
		t.Errorf("catch_failed PlayerIndex = %d, want the catcher %d", failed.Seat(), catcherIdx)
	}
	readMsgOfType(t, catcherConn, protocol.SMsgCardDrawn)
	if seen := readMsgOfType(t, activeConn, protocol.SMsgCatchFailed); seen.Seat() != catcherIdx {
		t.Errorf("target saw catch_failed for seat %d, want %d", seen.Seat(), catcherIdx)
	}
	// The count of the catcher's penalty card, which every other seat is told.
	readMsgOfType(t, activeConn, protocol.SMsgCardDrawn)
	// And nothing else: no uno_caught, no second card. The negative read ends
	// the test, because a read that times out leaves the connection broken.
	activeConn.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
	if _, _, err := activeConn.ReadMessage(); err == nil {
		t.Error("the declared seat was still caught, or told about a second charge")
	}
}

// Holding the button down is one press, and this is the whole of what stands
// between the mechanic and a mashed button now that nothing delays a press.
// Six presses against one offer cost one card: the second and the tenth change
// nothing, are broadcast to nobody and are answered to nobody, so a spammer
// buys exactly what one honest reflex bought.
func TestCatchUNO_SpamAgainstOneOfferIsOneCard(t *testing.T) {
	t.Setenv("LOCO_E2E", "1")
	_, srv := newTestHub(t)
	activeConn, catcherConn, activeIdx, catcherIdx := playDownToOne(t, srv)

	// The seat speaks first, so every press below is a race already lost.
	sendMsg(t, activeConn, protocol.ClientMsg{Type: protocol.CMsgDeclareUno})
	readMsgOfType(t, activeConn, protocol.SMsgUnoDeclared)
	readMsgOfType(t, catcherConn, protocol.SMsgUnoDeclared)

	for i := 0; i < 6; i++ {
		sendMsg(t, catcherConn, protocol.ClientMsg{Type: protocol.CMsgCatchUno, TargetIndex: &activeIdx})
	}

	if failed := readMsgOfType(t, catcherConn, protocol.SMsgCatchFailed); failed.Seat() != catcherIdx {
		t.Errorf("catch_failed PlayerIndex = %d, want the catcher %d", failed.Seat(), catcherIdx)
	}
	readMsgOfType(t, catcherConn, protocol.SMsgCardDrawn)
	catcherConn.SetReadDeadline(time.Now().Add(400 * time.Millisecond))
	if _, _, err := catcherConn.ReadMessage(); err == nil {
		t.Error("six presses against one offer were charged more than once")
	}
}
