package hub_test

import (
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"loco/server/game"
	"loco/server/protocol"
)

// The head start. A catcher holding the button down used to land the catch on
// the millisecond the card touched the pile, before the seat's own LOCO! could
// possibly have crossed the wire, which made spamming Contre-LOCO! the way to
// deny every declaration at the table. The seat that owes the call now gets the
// opening stretch of its own window (game.CatchHeadStart), and a press made
// inside it is held rather than refused: it lands the instant the head start
// ends if the seat has said nothing, and costs its card if the seat spoke.

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

func TestCatchUNO_PressInsideTheHeadStartLandsWhenItEnds(t *testing.T) {
	t.Setenv("LOCO_E2E", "1")
	_, srv := newTestHub(t)
	activeConn, catcherConn, activeIdx, _ := playDownToOne(t, srv)

	pressedAt := time.Now()
	sendMsg(t, catcherConn, protocol.ClientMsg{Type: protocol.CMsgCatchUno, TargetIndex: &activeIdx})

	caught := readMsgOfType(t, activeConn, protocol.SMsgUnoCaught)
	if caught.Seat() != activeIdx {
		t.Errorf("uno_caught PlayerIndex = %d, want %d", caught.Seat(), activeIdx)
	}
	// Not before the head start ends, with a margin for the card_played's
	// own trip: the press was made inside the seat's opening stretch and had
	// to wait it out.
	if waited := time.Since(pressedAt); waited < game.CatchHeadStart-200*time.Millisecond {
		t.Errorf("the catch landed %v after the press; a press inside the head start waits until it ends (%v)", waited, game.CatchHeadStart)
	}
	if seen := readMsgOfType(t, catcherConn, protocol.SMsgUnoCaught); seen.Seat() != activeIdx {
		t.Errorf("catcher saw uno_caught for seat %d, want %d", seen.Seat(), activeIdx)
	}
}

// The head start protects the declaration, not the wager. A seat that speaks
// inside it turns the held press into a lost race: charged once, announced
// once, and the seat keeps its single card.
func TestCatchUNO_DeclarationInsideTheHeadStartBeatsTheHeldPress(t *testing.T) {
	t.Setenv("LOCO_E2E", "1")
	_, srv := newTestHub(t)
	activeConn, catcherConn, activeIdx, catcherIdx := playDownToOne(t, srv)

	sendMsg(t, catcherConn, protocol.ClientMsg{Type: protocol.CMsgCatchUno, TargetIndex: &activeIdx})
	// Well inside the head start, and after the press: the order the abuse
	// depended on.
	time.Sleep(150 * time.Millisecond)
	sendMsg(t, activeConn, protocol.ClientMsg{Type: protocol.CMsgDeclareUno})
	readMsgOfType(t, activeConn, protocol.SMsgUnoDeclared)
	readMsgOfType(t, catcherConn, protocol.SMsgUnoDeclared)

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

// Holding the button down inside the head start is one press. The second and
// the tenth are dropped where they arrive, so a spammer buys exactly what a
// single honest reflex bought: one held press, resolved once.
func TestCatchUNO_SpamInsideTheHeadStartIsOnePress(t *testing.T) {
	t.Setenv("LOCO_E2E", "1")
	_, srv := newTestHub(t)
	activeConn, catcherConn, activeIdx, catcherIdx := playDownToOne(t, srv)

	for i := 0; i < 6; i++ {
		sendMsg(t, catcherConn, protocol.ClientMsg{Type: protocol.CMsgCatchUno, TargetIndex: &activeIdx})
	}
	time.Sleep(150 * time.Millisecond)
	sendMsg(t, activeConn, protocol.ClientMsg{Type: protocol.CMsgDeclareUno})
	readMsgOfType(t, activeConn, protocol.SMsgUnoDeclared)
	readMsgOfType(t, catcherConn, protocol.SMsgUnoDeclared)

	if failed := readMsgOfType(t, catcherConn, protocol.SMsgCatchFailed); failed.Seat() != catcherIdx {
		t.Errorf("catch_failed PlayerIndex = %d, want the catcher %d", failed.Seat(), catcherIdx)
	}
	readMsgOfType(t, catcherConn, protocol.SMsgCardDrawn)
	catcherConn.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
	if _, _, err := catcherConn.ReadMessage(); err == nil {
		t.Error("six presses inside one head start were answered more than once")
	}
}
