package hub_test

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"loco/server/hub"
	"loco/server/protocol"
)

// The audit these tests come out of asked one question of every message a
// client can send: what does it cost, and who else pays for it. Four answers
// were wrong, and each of them was wrong in the same direction — a message the
// server refused was cheaper than a message it took.

// A gameplay message proves a socket is alive. It does not prove anybody is
// playing, and the AFK threshold is the only thing between a stranger and an
// opponent who has walked away.
//
// resetAFK used to run at the dispatch boundary before the handler, on every
// gameplay message whatever became of it, so one refused declare_uno per turn
// bought permanent immunity: the seat timed out for ever and was never once
// counted away.
func TestAFK_RefusedActionDoesNotClearTheCounter(t *testing.T) {
	restoreTimeout, restoreThreshold := hub.TurnTimeout, hub.AFKKickThreshold
	hub.TurnTimeout = 300 * time.Millisecond
	hub.AFKKickThreshold = 2
	t.Cleanup(func() { hub.TurnTimeout, hub.AFKKickThreshold = restoreTimeout, restoreThreshold })

	_, srv := newTestHub(t)
	conn1, conn2, _ := setupTwoPlayerGame(t, srv)

	// Both seats hold eight cards, so declare_uno is refused every time
	// ("can only declare with exactly 1 card in hand"). Neither player ever
	// plays; both let every turn expire while keeping the socket busy.
	// A kick is an afk_kicked frame and then a close, and the two race: the
	// notice is queued on the send buffer and the socket is shut in the next
	// statement, so the frame is often lost. The socket going away is therefore
	// the observable, exactly as TestAFK_KicksAfterConsecutiveTimeouts reads it.
	kicked := make(chan int, 2)
	for i, conn := range []*websocket.Conn{conn1, conn2} {
		go func(seat int, c *websocket.Conn) {
			for {
				c.SetReadDeadline(time.Now().Add(4 * time.Second))
				msg := readServerMsg(c)
				if msg == nil {
					kicked <- seat
					return
				}
				if msg.Type == protocol.SMsgError && msg.Error == "afk_kicked" {
					kicked <- seat
					return
				}
			}
		}(i, conn)
	}

	deadline := time.After(3 * time.Second)
	tick := time.NewTicker(150 * time.Millisecond)
	defer tick.Stop()
	for {
		select {
		case <-kicked:
			return // the counter survived the noise, which is the whole assertion
		case <-deadline:
			t.Fatal("a seat that never played was never counted away: a refused message cleared its AFK counter")
		case <-tick.C:
			// Deliberately under the token bucket's 10/s.
			sendQuietly(conn1, protocol.ClientMsg{Type: protocol.CMsgDeclareUno})
			sendQuietly(conn2, protocol.ClientMsg{Type: protocol.CMsgDeclareUno})
		}
	}
}

// An accepted action still clears it, or the fix above would have turned the
// threshold into a timer nobody can stop.
func TestAFK_AcceptedActionStillClearsTheCounter(t *testing.T) {
	_, srv := newTestHub(t)
	conn1, conn2, _ := setupTwoPlayerGame(t, srv)

	// draw_card from whichever seat holds the turn is accepted; from the other
	// it is refused with "not your turn". Either way nothing here asserts on the
	// answer: what is asserted is that neither socket is closed, i.e. no seat was
	// counted away by a message the server took.
	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgDrawCard})
	sendMsg(t, conn2, protocol.ClientMsg{Type: protocol.CMsgDrawCard})

	for i, conn := range []*websocket.Conn{conn1, conn2} {
		conn.SetReadDeadline(time.Now().Add(time.Second))
		if _, _, err := conn.ReadMessage(); err != nil {
			t.Fatalf("client %d: socket died on an ordinary draw: %v", i, err)
		}
	}
}

// A Contre-LOCO! on a seat that is not on the hook is not a lost race. It used
// to be charged like one, which meant it also announced itself: catch_failed to
// every seat at the table, at the rate limit, and free the moment the piles ran
// dry and the penalty draw came back empty.
func TestCatch_ForgedTargetTellsNobody(t *testing.T) {
	_, srv := newTestHub(t)
	conn1, conn2, _ := setupTwoPlayerGame(t, srv)

	seven := 7
	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgCatchUno, TargetIndex: &seven})
	msg := readMsgOfType(t, conn1, protocol.SMsgError)
	if msg.Error == "" {
		t.Fatal("a seat number the table does not have must be refused")
	}

	// And the refusal stays between the server and whoever sent it. The negative
	// read ends this test: a read that times out leaves the connection broken.
	conn2.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
	if _, _, err := conn2.ReadMessage(); err == nil {
		t.Error("a forged catch reached the rest of the table")
	}
}

// One step in from a forged seat: seat 1 exists and holds eight cards. No
// honest screen has the button live against that table, so the press is a
// board that moved under a thumb or a client this game did not write — and
// either way it is not a wager. Nothing is charged, and nothing is answered:
// an answer would be the one thing a dead button could still make the server
// say, and a charge would be the farm this rule closed, reopened to anybody
// willing to forge the message.
func TestCatch_WithNobodyNearTheFinishIsSilent(t *testing.T) {
	_, srv := newTestHub(t)
	conn1, conn2, _ := setupTwoPlayerGame(t, srv)

	one := 1
	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgCatchUno, TargetIndex: &one})
	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgCatchUno})

	// The negative reads end this test: a read that times out leaves the
	// connection broken.
	conn2.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
	if _, _, err := conn2.ReadMessage(); err == nil {
		t.Error("a Contre-LOCO! against a table nobody is near the finish at reached the table")
	}
	conn1.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
	if _, _, err := conn1.ReadMessage(); err == nil {
		t.Error("the caller was answered for a press that was not a wager")
	}
}

// nearTheFinish puts the seat behind conn one play from the finish, which is
// what makes a Contre-LOCO! from the other chair a wager: the button is live
// from two cards out, and a press against that table is the ordinary misread
// that costs a card, in public. Both sockets are drained of the snapshot the
// fixture answers with.
func nearTheFinish(t *testing.T, conn, other *websocket.Conn) {
	t.Helper()
	sendMsg(t, conn, protocol.ClientMsg{
		Type: protocol.CMsgDebugSetState,
		Debug: &protocol.DebugStateDTO{
			Hand: []protocol.CardDTO{{Color: "red", Kind: "number", Value: 6}, {Color: "red", Kind: "number", Value: 7}},
		},
	})
	readMsgOfType(t, conn, protocol.SMsgGameState)
	readMsgOfType(t, other, protocol.SMsgGameState)
}

// The wager itself, and its ration. Seat 1 is on two cards, so the button is
// live on seat 0's screen and a press there is a read of the table; it finds
// nobody on the hook and costs a card. What it may not cost is a card per
// press: the charge is rationed by the offer — the near-finish picture the
// button is live for — which is what stops one socket at the rate limit from
// turning a live button into ten table-wide sends a second, and what stops a
// player collecting a card per press for a Swap to hand on.
func TestCatch_OnAnOfferIsChargedOncePerOffer(t *testing.T) {
	t.Setenv("LOCO_E2E", "1")
	_, srv := newTestHub(t)
	conn1, conn2, _ := setupTwoPlayerGame(t, srv)
	nearTheFinish(t, conn2, conn1)

	one := 1
	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgCatchUno, TargetIndex: &one})
	if msg := readMsgOfType(t, conn2, protocol.SMsgCatchFailed); msg.Seat() != 0 {
		t.Fatalf("catch_failed named seat %d, want the caller's seat 0", msg.Seat())
	}
	// The card that went with it, so the socket is quiet before the loop below
	// asserts that it stays quiet.
	readMsgOfType(t, conn2, protocol.SMsgCardDrawn)

	for i := 0; i < 4; i++ {
		sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgCatchUno, TargetIndex: &one})
	}
	// The negative read ends this test: a read that times out leaves the
	// connection broken.
	conn2.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
	if _, _, err := conn2.ReadMessage(); err == nil {
		t.Error("a second Contre-LOCO! against an unchanged offer reached the table")
	}
}

// The shape the live button actually produces: no seat named at all, because
// the client could not see one. It is the same wager and the same card — a
// press that names nobody must not be the cheap way to press the button.
func TestCatch_WithNoSeatNamedIsChargedLikeAnyOtherMiss(t *testing.T) {
	t.Setenv("LOCO_E2E", "1")
	_, srv := newTestHub(t)
	conn1, conn2, _ := setupTwoPlayerGame(t, srv)
	nearTheFinish(t, conn2, conn1)

	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgCatchUno})
	if msg := readMsgOfType(t, conn2, protocol.SMsgCatchFailed); msg.Seat() != 0 {
		t.Fatalf("catch_failed named seat %d, want the caller's seat 0", msg.Seat())
	}
}

// A snapshot answers a client whose board has drifted, and one is enough: the
// drift is corrected by the first, and everything the client sends in the
// millisecond after it was composed against the old board. Without a floor, a
// client offering the same stale card at the rate limit pulled the most
// expensive message this server sends ten times a second.
func TestResync_IsThrottledToOnePerSecond(t *testing.T) {
	_, srv := newTestHub(t)
	conn1, _, _ := setupTwoPlayerGame(t, srv)

	// A card no deck ships — the numbers run 1 to 9, there is no red zero — so
	// this is refused as "card not in hand" or, from the seat that does not hold
	// the turn, as "not your turn". Both are state mismatches, and a state
	// mismatch is the refusal that carries a correction with it.
	bogus := protocol.CardDTO{Color: protocol.ColorRed, Kind: protocol.KindNumber, Value: 0}
	for i := 0; i < 4; i++ {
		sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgPlayCard, Card: &bogus})
	}

	states := 0
	errs := 0
	for errs < 4 {
		conn1.SetReadDeadline(time.Now().Add(time.Second))
		msg := readServerMsg(conn1)
		if msg == nil {
			break
		}
		switch msg.Type {
		case protocol.SMsgError:
			errs++
		case protocol.SMsgGameState:
			states++
		}
	}
	if errs != 4 {
		t.Fatalf("expected 4 refusals, got %d", errs)
	}
	if states != 1 {
		t.Fatalf("got %d corrections for 4 refusals in the same instant, want 1", states)
	}
}

// An ask is a set membership, so asking twice changes nothing. It used to be
// republished anyway, which turned one socket at the rate limit into ten
// broadcasts a second to every seat at the table.
func TestRematch_ReAskingPublishesNothing(t *testing.T) {
	conn1, conn2, _ := winBO1(t)

	sendMsg(t, conn2, protocol.ClientMsg{Type: protocol.CMsgRematch})
	readMsgOfType(t, conn1, protocol.SMsgRematchOffered)
	readMsgOfType(t, conn2, protocol.SMsgRematchOffered)

	sendMsg(t, conn2, protocol.ClientMsg{Type: protocol.CMsgRematch})

	conn1.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
	if _, _, err := conn1.ReadMessage(); err == nil {
		t.Error("a repeated ask was republished to the table")
	}
}

// --- helpers ---

// readServerMsg reads one message, or returns nil on any error. Used by the
// loops above, which are counting message types rather than asserting on the
// next one and must not fail the test on the read that ends them.
func readServerMsg(conn *websocket.Conn) *protocol.ServerMsg {
	_, data, err := conn.ReadMessage()
	if err != nil {
		return nil
	}
	var msg protocol.ServerMsg
	if err := json.Unmarshal(data, &msg); err != nil {
		return nil
	}
	return &msg
}

// sendQuietly writes a message and ignores a closed socket: the loops above go
// on sending to both seats after the server has kicked one of them.
func sendQuietly(conn *websocket.Conn, msg protocol.ClientMsg) {
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}
	_ = conn.WriteMessage(websocket.TextMessage, data)
}
