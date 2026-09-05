package hub_test

import (
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"loco/server/protocol"
)

// A Contre-LOCO! is answered on the instant it arrives, and two rations keep
// the button from being mashed: the card is charged once per offer, and the
// lockout is armed once per press. All of it is here — the press that would
// once have been held for the opening 1.5s of the window now lands straight
// away, six presses in a row cost exactly one card, and a thumb that never
// lets go is never live when a window opens.

// playDownToOne has the active seat play to a single card without calling it,
// and hands back which socket owes the call, which one can catch, and the
// seats behind each.
func playDownToOne(t *testing.T, srv *httptest.Server) (activeConn, catcherConn *websocket.Conn, activeIdx, catcherIdx int) {
	t.Helper()
	activeConn, catcherConn, activeIdx, catcherIdx = seatOneCardAway(t, srv)
	sendMsg(t, activeConn, protocol.ClientMsg{
		Type: protocol.CMsgPlayCard,
		Card: &protocol.CardDTO{Color: "red", Kind: "number", Value: 7},
	})
	readMsgOfType(t, activeConn, protocol.SMsgCardPlayed)
	readMsgOfType(t, catcherConn, protocol.SMsgCardPlayed)
	return activeConn, catcherConn, activeIdx, catcherIdx
}

// seatOneCardAway stops one play short of that: the seat at turn holds exactly
// catchNearHand cards, so a Contre-LOCO! from the other chair is offered — the
// button is live — and there is nothing yet to catch. It is the board a wager
// is lost on, and the one a masher is sitting on when the window opens.
func seatOneCardAway(t *testing.T, srv *httptest.Server) (activeConn, catcherConn *websocket.Conn, activeIdx, catcherIdx int) {
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

// Holding the button down is one press as far as the card is concerned: six
// presses against one offer cost exactly one, and every later one is broadcast
// to nobody. What each of them *does* buy is another two seconds of lockout,
// answered to its sender alone — the whole of what a mashed button pays now.
func TestCatchUNO_SpamAgainstOneOfferIsOneCard(t *testing.T) {
	t.Setenv("LOCO_E2E", "1")
	_, srv := newTestHub(t)
	activeConn, catcherConn, activeIdx, catcherIdx := playDownToOne(t, srv)

	// The seat speaks first, so every press below is a race already lost.
	sendMsg(t, activeConn, protocol.ClientMsg{Type: protocol.CMsgDeclareUno})
	readMsgOfType(t, activeConn, protocol.SMsgUnoDeclared)
	readMsgOfType(t, catcherConn, protocol.SMsgUnoDeclared)

	const presses = 6
	for i := 0; i < presses; i++ {
		sendMsg(t, catcherConn, protocol.ClientMsg{Type: protocol.CMsgCatchUno, TargetIndex: &activeIdx})
	}

	// Everything the six presses produced, drained until the socket goes quiet.
	// The card is charged once; the rest is the lockout, and nothing else may
	// be in there at all.
	var failed, drawn, locked int
	catcherConn.SetReadDeadline(time.Now().Add(600 * time.Millisecond))
	for {
		var msg protocol.ServerMsg
		if err := catcherConn.ReadJSON(&msg); err != nil {
			break
		}
		switch msg.Type {
		case protocol.SMsgCatchFailed:
			failed++
			if msg.Seat() != catcherIdx {
				t.Errorf("catch_failed PlayerIndex = %d, want the catcher %d", msg.Seat(), catcherIdx)
			}
		case protocol.SMsgCardDrawn:
			drawn++
		case protocol.SMsgCatchLocked:
			locked++
			if msg.CatchLockedUntil <= 0 {
				t.Error("catch_locked carried no instant to count down to")
			}
		default:
			t.Errorf("a mashed button produced a %q", msg.Type)
		}
	}
	if failed != 1 || drawn != 1 {
		t.Errorf("six presses against one offer: %d charges and %d cards, want 1 and 1", failed, drawn)
	}
	// One per press, and that is the point: a held thumb keeps pushing its own
	// deadline out, so it is never live at the instant a window opens.
	if locked != presses {
		t.Errorf("the caller was told about %d lockouts, want one per press (%d)", locked, presses)
	}
}

// The exploit the lockout closes, played out end to end. A catcher mashes the
// button while a seat sits one card from the finish: the first press costs a
// card, and every later one used to be free and silent — so the one that landed
// on the frame the window opened took the catch for nothing, because a catch
// that lands spends no offer. Mashing bought every window at the table for one
// card.
//
// Now each of those free presses re-arms a two-second lockout, so the press
// that arrives with the window is refused: the seat that owed the call gets to
// make it, which is the reaction this whole mechanic exists to measure.
func TestCatchUNO_MashingCannotTakeTheWindowItOpensOn(t *testing.T) {
	t.Setenv("LOCO_E2E", "1")
	_, srv := newTestHub(t)
	activeConn, catcherConn, activeIdx, _ := seatOneCardAway(t, srv)

	// The masher's first press: the seat is one play from the finish, so the
	// button is live and the wager is real, and it finds nobody. One card, and
	// the lockout that is the point of this test.
	sendMsg(t, catcherConn, protocol.ClientMsg{Type: protocol.CMsgCatchUno, TargetIndex: &activeIdx})
	readMsgOfType(t, catcherConn, protocol.SMsgCatchFailed)
	locked := readMsgOfType(t, catcherConn, protocol.SMsgCatchLocked)
	if locked.CatchLockedUntil <= 0 {
		t.Fatal("catch_locked carried no instant to count down to")
	}

	// The seat plays down to its last card without calling it. This is the
	// window a mashed button used to collect for free: the press below lands
	// milliseconds after it opens, long before any human could have declared.
	sendMsg(t, activeConn, protocol.ClientMsg{
		Type: protocol.CMsgPlayCard,
		Card: &protocol.CardDTO{Color: "red", Kind: "number", Value: 7},
	})
	readMsgOfType(t, catcherConn, protocol.SMsgCardPlayed)

	sendMsg(t, catcherConn, protocol.ClientMsg{Type: protocol.CMsgCatchUno, TargetIndex: &activeIdx})

	// Refused, and told so: the lock is re-stated and nothing is caught. The
	// seat that owed the call still owes it, which is the reaction this mechanic
	// exists to measure.
	if again := readMsgOfType(t, catcherConn, protocol.SMsgCatchLocked); again.CatchLockedUntil < locked.CatchLockedUntil {
		t.Error("a press inside the lockout moved the deadline backwards")
	}
	catcherConn.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
	for {
		var msg protocol.ServerMsg
		if err := catcherConn.ReadJSON(&msg); err != nil {
			break
		}
		if msg.Type == protocol.SMsgUnoCaught {
			t.Fatal("a press made inside the lockout still took the catch")
		}
	}
}
