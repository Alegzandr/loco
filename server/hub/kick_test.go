package hub_test

import (
	"net/http/httptest"
	"testing"

	"github.com/gorilla/websocket"
	"loco/server/protocol"
)

// setupLobby opens a table with Alice as host and seats the named guests at it.
// Returns the host connection, the guest connections in seat order, and the
// code. Nothing is dealt: kick_player only ever applies before that.
func setupLobby(t *testing.T, srv *httptest.Server, guests ...string) (*websocket.Conn, []*websocket.Conn, string) {
	t.Helper()
	host := dialWS(t, srv)
	t.Cleanup(func() { host.Close() })
	sendMsg(t, host, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Alice"})
	code := readMsgOfType(t, host, protocol.SMsgRoomCreated).RoomCode

	conns := make([]*websocket.Conn, 0, len(guests))
	for _, name := range guests {
		c := dialWS(t, srv)
		t.Cleanup(func() { c.Close() })
		sendMsg(t, c, protocol.ClientMsg{Type: protocol.CMsgJoinRoom, Nickname: name, RoomCode: code})
		readMsgOfType(t, c, protocol.SMsgRoomJoined)
		readMsgOfType(t, host, protocol.SMsgPlayerJoined)
		for _, prev := range conns {
			readMsgOfType(t, prev, protocol.SMsgPlayerJoined)
		}
		conns = append(conns, c)
	}
	return host, conns, code
}

// A kick is a departure like any other from the table's point of view: the
// roster shrinks, the seats above it move down, and everybody still there is
// told. What is different is the removed player, who chose none of it and gets
// told so on their own socket.
func TestKickPlayer_FreesTheSeatAndRebasesTheOnesAbove(t *testing.T) {
	_, srv := newTestHub(t)
	host, guests, _ := setupLobby(t, srv, "Bob", "Carol")
	bob, carol := guests[0], guests[1]

	sendMsg(t, host, protocol.ClientMsg{Type: protocol.CMsgKickPlayer, TargetIndex: intPtrTest(1)})

	if got := readMsgOfType(t, bob, protocol.SMsgKicked); got.Type != protocol.SMsgKicked {
		t.Fatalf("Bob was not told: %q", got.Type)
	}
	left := readMsgOfType(t, host, protocol.SMsgPlayerLeft)
	if left.Nickname != "Bob" {
		t.Errorf("player_left nickname = %q, want Bob", left.Nickname)
	}
	if len(left.Players) != 2 {
		t.Fatalf("roster = %d players, want 2", len(left.Players))
	}
	if left.Players[1].Nickname != "Carol" || left.Players[1].Index != 1 {
		t.Errorf("Carol is at %d/%q, want seat 1", left.Players[1].Index, left.Players[1].Nickname)
	}
	readMsgOfType(t, carol, protocol.SMsgPlayerLeft)

	// The seat Carol was re-based to has to be the seat she is dealt into: a
	// roster that says 1 while the hub still files her at 2 hands her somebody
	// else's cards.
	sendMsg(t, host, protocol.ClientMsg{Type: protocol.CMsgStartGame})
	started := readMsgOfType(t, carol, protocol.SMsgGameStarted)
	if started.State == nil {
		t.Fatal("game_started carried no state")
	}
	if started.State.YourIndex != 1 {
		t.Errorf("Carol was dealt seat %d, want 1", started.State.YourIndex)
	}
}

// It is the host's table, and only the host's.
func TestKickPlayer_RefusedForAGuest(t *testing.T) {
	_, srv := newTestHub(t)
	_, guests, _ := setupLobby(t, srv, "Bob", "Carol")

	sendMsg(t, guests[0], protocol.ClientMsg{Type: protocol.CMsgKickPlayer, TargetIndex: intPtrTest(2)})
	if got := readMsgOfType(t, guests[0], protocol.SMsgError); got.Error != "only the room owner can remove players" {
		t.Errorf("error = %q, want the host-only refusal", got.Error)
	}
}

// Seat 0 is the host's own. Letting a kick take it would hand the table to
// whoever sat in seat 1, through a button that says nothing of the sort; the
// way out of your own seat is leave_room.
func TestKickPlayer_RefusedOnTheHostsOwnSeat(t *testing.T) {
	_, srv := newTestHub(t)
	host, _, _ := setupLobby(t, srv, "Bob")

	for _, seat := range []int{0, 5, -1} {
		sendMsg(t, host, protocol.ClientMsg{Type: protocol.CMsgKickPlayer, TargetIndex: intPtrTest(seat)})
		if got := readMsgOfType(t, host, protocol.SMsgError); got.Error != "invalid player index" {
			t.Errorf("seat %d: error = %q, want the invalid-seat refusal", seat, got.Error)
		}
	}
	sendMsg(t, host, protocol.ClientMsg{Type: protocol.CMsgKickPlayer})
	if got := readMsgOfType(t, host, protocol.SMsgError); got.Error != "invalid player index" {
		t.Errorf("no target: error = %q, want the invalid-seat refusal", got.Error)
	}
}

// Once the cards are out a seat belongs to a match rather than to the roster,
// and the only thing that ends one early is a forfeit.
func TestKickPlayer_RefusedOnceTheCardsAreOut(t *testing.T) {
	_, srv := newTestHub(t)
	conn1, _, _ := setupTwoPlayerGame(t, srv)

	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgKickPlayer, TargetIndex: intPtrTest(1)})
	if got := readMsgOfType(t, conn1, protocol.SMsgError); got.Error != "can only remove players in the lobby" {
		t.Errorf("error = %q, want the lobby-only refusal", got.Error)
	}
}

// A bot is a seat like any other here, and this is the only way to take one
// back. The slot behind it has no socket, so it goes through its own removal
// path — which still has to re-base everything the human path re-bases.
func TestKickPlayer_TakesABotSeatBack(t *testing.T) {
	h, srv := newTestHub(t)
	host, guests, _ := setupLobby(t, srv, "Bob")
	bob := guests[0]

	sendMsg(t, host, protocol.ClientMsg{Type: protocol.CMsgAddBot})
	readMsgOfType(t, host, protocol.SMsgPlayerJoined)
	readMsgOfType(t, bob, protocol.SMsgPlayerJoined)

	// Bot1 took seat 2; removing it must leave Alice and Bob exactly where they were.
	sendMsg(t, host, protocol.ClientMsg{Type: protocol.CMsgKickPlayer, TargetIndex: intPtrTest(2)})
	left := readMsgOfType(t, host, protocol.SMsgPlayerLeft)
	if left.Nickname != "Bot1" {
		t.Errorf("player_left nickname = %q, want Bot1", left.Nickname)
	}
	if len(left.Players) != 2 {
		t.Fatalf("roster = %d players, want 2", len(left.Players))
	}
	readMsgOfType(t, bob, protocol.SMsgPlayerLeft)

	if bots := h.GetMetrics().BotsActive; bots != 0 {
		t.Errorf("bots_active = %d after the bot was removed, want 0", bots)
	}

	sendMsg(t, host, protocol.ClientMsg{Type: protocol.CMsgStartGame})
	started := readMsgOfType(t, bob, protocol.SMsgGameStarted)
	if started.State == nil || started.State.YourIndex != 1 {
		t.Error("Bob did not keep seat 1 across the bot's removal")
	}
}

// A kick is not a ban: the table code is already in the kicked player's hands
// and there is no identity in this game to refuse them by. The socket is simply
// seatless again, which is the same state leave_room leaves it in.
func TestKickPlayer_LeavesTheSocketFreeToSitDownAgain(t *testing.T) {
	_, srv := newTestHub(t)
	host, guests, code := setupLobby(t, srv, "Bob")
	bob := guests[0]

	sendMsg(t, host, protocol.ClientMsg{Type: protocol.CMsgKickPlayer, TargetIndex: intPtrTest(1)})
	readMsgOfType(t, bob, protocol.SMsgKicked)
	readMsgOfType(t, host, protocol.SMsgPlayerLeft)

	sendMsg(t, bob, protocol.ClientMsg{Type: protocol.CMsgJoinRoom, Nickname: "Bob", RoomCode: code})
	joined := readMsgOfType(t, bob, protocol.SMsgRoomJoined)
	if joined.OwnSeat() != 1 {
		t.Errorf("rejoined at seat %d, want 1", joined.OwnSeat())
	}
}
