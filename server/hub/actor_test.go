package hub_test

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"loco/server/hub"
	"loco/server/protocol"
)

// The two things a table owning its own goroutine is supposed to buy, and the
// one it could have cost. Both are through real sockets, because what is being
// claimed is about the server a player is connected to and not about a
// function.

// TestTablePanicCostsOneMessageNotTheTable.
//
// A panic used to be recovered on the goroutine every match shared, so the
// question was whether the *process* survived. It is a different question now,
// and a nastier one: a panic on a table's own goroutine would take that
// goroutine, and a room whose goroutine is gone does not fail, it goes quiet.
// Every message to it would queue behind nothing, for ever, and the players
// would sit at a board that stopped answering with no error to show them.
//
// So the recover in actor.go is load-bearing in a way dispatch's never was, and
// this is what says so: the table answers the failed message and then keeps
// playing.
func TestTablePanicCostsOneMessageNotTheTable(t *testing.T) {
	h := hub.New()
	panicking := true
	h.SetTableProbe(func(string) {
		if panicking {
			panic("audit probe")
		}
	})
	go h.Run()
	defer h.Stop()
	srv := httptest.NewServer(http.HandlerFunc(h.ServeWS))
	defer srv.Close()

	conn := dialWS(t, srv)
	defer conn.Close()
	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Auditeur"})
	readMsgOfType(t, conn, protocol.SMsgRoomCreated)

	// create_room is the hub's; the first message this table handles is the one
	// that panics.
	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgSetMaxPlayers, MaxPlayers: 4})
	if msg := readMsg(t, conn); msg.Type != protocol.SMsgError {
		t.Fatalf("a panicking handler must answer an error, got %q", msg.Type)
	}

	// The table's goroutine survived it: the very next message is served.
	panicking = false
	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgSetMaxPlayers, MaxPlayers: 4})
	if msg := readMsgOfType(t, conn, protocol.SMsgLobbyConfigChanged); msg.MaxPlayers != 4 {
		t.Fatalf("max players is %d after the table recovered, want 4", msg.MaxPlayers)
	}
}

// TestOneSlowTableDoesNotHoldUpAnother is the whole chantier in one assertion.
//
// While the hub's single loop served every room, a handler that took its time
// was every other table's wait: the queue behind it was shared, so a slow pass
// at one table delayed the reaction windows at all of them. It is the reason
// the loop's cost was ever worth measuring.
//
// Here one table is held still inside a handler and another one deals a whole
// match around it. Before the split this test could not pass at all: the hub
// would be sitting in the first table's handler and would not read the second
// table's messages until it came back.
func TestOneSlowTableDoesNotHoldUpAnother(t *testing.T) {
	h := hub.New()
	held := make(chan struct{})
	var slowCode string
	h.SetTableProbe(func(code string) {
		if slowCode != "" && code == slowCode {
			<-held
		}
	})
	go h.Run()
	defer h.Stop()
	srv := httptest.NewServer(http.HandlerFunc(h.ServeWS))
	defer srv.Close()

	// The table that is about to stop answering.
	slow := dialWS(t, srv)
	defer slow.Close()
	sendMsg(t, slow, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Lente"})
	slowCode = readMsgOfType(t, slow, protocol.SMsgRoomCreated).RoomCode

	// The table that must not care. Opened first, so its own create_room is not
	// itself queued behind anything.
	quick := dialWS(t, srv)
	defer quick.Close()
	sendMsg(t, quick, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Rapide"})
	readMsgOfType(t, quick, protocol.SMsgRoomCreated)

	// Wedge the slow table inside a handler and make sure it is really in there
	// before asking anything of the other one.
	sendMsg(t, slow, protocol.ClientMsg{Type: protocol.CMsgSetMaxPlayers, MaxPlayers: 4})
	waitForHeldTable(t, h)

	// A whole match is dealt at the other table meanwhile.
	sendMsg(t, quick, protocol.ClientMsg{Type: protocol.CMsgAddBot})
	readMsgOfType(t, quick, protocol.SMsgPlayerJoined)
	sendMsg(t, quick, protocol.ClientMsg{Type: protocol.CMsgStartGame})
	readMsgOfType(t, quick, protocol.SMsgGameStarted)
	completeMapLoad(t, quick)

	// And the slow table catches up once it is let go, rather than having lost
	// the message.
	close(held)
	if msg := readMsgOfType(t, slow, protocol.SMsgLobbyConfigChanged); msg.MaxPlayers != 4 {
		t.Fatalf("the held table lost its message: max players is %d, want 4", msg.MaxPlayers)
	}
}

// waitForHeldTable waits until a message has actually reached a table and
// stopped there. The hub counts a job when it finishes, so a table sitting
// inside one shows up as a queue that has been fed and a count that has not
// moved; polling the goroutine count is what tells us the job has started
// rather than merely been posted.
func waitForHeldTable(t *testing.T, h *hub.Hub) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	before := h.GetMetrics().LoopEvents
	for time.Now().Before(deadline) {
		// Nothing else is running, so once the hub has stopped counting events
		// for a moment the held handler is the reason.
		time.Sleep(20 * time.Millisecond)
		if h.GetMetrics().LoopEvents == before {
			return
		}
		before = h.GetMetrics().LoopEvents
	}
	t.Fatal("the slow table never settled inside its handler")
}
