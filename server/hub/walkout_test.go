package hub_test

import (
	"testing"

	"github.com/gorilla/websocket"
	"loco/server/protocol"
)

// Leaving a match in progress, at a table that can spare the seat.
//
// The refusal is right at two or three seats and wrong at six: the only exit a
// player who has to leave can reach there is the turn clock, which auto-passes
// for them until the AFK threshold — two rounds spoiled for five people rather
// than one player leaving.

// openTable seats `names` at one table and deals. The first is the host.
func openTable(t *testing.T, names ...string) ([]*websocket.Conn, string) {
	t.Helper()
	_, srv := newTestHub(t)
	conns := make([]*websocket.Conn, 0, len(names))

	host := dialWS(t, srv)
	t.Cleanup(func() { host.Close() })
	sendMsg(t, host, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: names[0]})
	code := readMsgOfType(t, host, protocol.SMsgRoomCreated).RoomCode
	conns = append(conns, host)

	for _, name := range names[1:] {
		c := dialWS(t, srv)
		t.Cleanup(func() { c.Close() })
		sendMsg(t, c, protocol.ClientMsg{Type: protocol.CMsgJoinRoom, Nickname: name, RoomCode: code})
		readMsgOfType(t, c, protocol.SMsgRoomJoined)
		for _, seated := range conns {
			readMsgOfType(t, seated, protocol.SMsgPlayerJoined)
		}
		conns = append(conns, c)
	}

	sendMsg(t, host, protocol.ClientMsg{Type: protocol.CMsgStartGame})
	for _, c := range conns {
		readMsgOfType(t, c, protocol.SMsgGameStarted)
	}
	completeMapLoad(t, conns...)
	return conns, code
}

// Four seats: one can go and three are left, which is the floor.
func TestWalkOut_AllowedWhenThreeSeatsAreLeft(t *testing.T) {
	conns, _ := openTable(t, "Alice", "Bob", "Carol", "Dave")
	leaver := conns[3]

	sendMsg(t, leaver, protocol.ClientMsg{Type: protocol.CMsgLeaveRoom})
	readMsgOfType(t, leaver, protocol.SMsgLeftRoom)

	// The table sees an ordinary departure, and the seat rides it: a running
	// match indexes hands by seat, so nothing moved.
	for i, c := range conns[:3] {
		left := readMsgOfType(t, c, protocol.SMsgPlayerLeft)
		if left.Seat() != 3 {
			t.Errorf("client %d: player_left seat = %d, want 3", i, left.Seat())
		}
		if left.Nickname != "Dave" {
			t.Errorf("client %d: player_left nickname = %q, want Dave", i, left.Nickname)
		}
		// And the roster stops reporting them as present.
		for _, p := range left.Players {
			if p.Index == 3 && p.Connected {
				t.Errorf("client %d: seat 3 still reads as connected", i)
			}
		}
	}

	// Everybody is handed the board again: the hand went back to the deck and
	// the turn may have moved.
	for i, c := range conns[:3] {
		gs := readMsgOfType(t, c, protocol.SMsgGameState)
		if gs.State == nil {
			t.Fatalf("client %d: game_state without state", i)
		}
		for _, p := range gs.State.Players {
			if p.Index == 3 && p.HandSize != 0 {
				t.Errorf("client %d: the seat that left still holds %d cards", i, p.HandSize)
			}
		}
	}
}

// Three seats: one leaving would leave two, and this game is not any good at
// two people who did not choose it.
func TestWalkOut_RefusedWhenItWouldTakeTheTableUnderThree(t *testing.T) {
	conns, _ := openTable(t, "Alice", "Bob", "Carol")
	sendMsg(t, conns[2], protocol.ClientMsg{Type: protocol.CMsgLeaveRoom})
	got := readMsgOfType(t, conns[2], protocol.SMsgError)
	if got.Error != "you cannot leave a match in progress" {
		t.Errorf("error = %q, want the mid-match refusal", got.Error)
	}
}

// The floor counts seats that can play, and a bot can play.
func TestWalkOut_CountsBotsAsSeatsThatCanPlay(t *testing.T) {
	_, srv := newTestHub(t)
	host := dialWS(t, srv)
	t.Cleanup(func() { host.Close() })
	sendMsg(t, host, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Alice"})
	code := readMsgOfType(t, host, protocol.SMsgRoomCreated).RoomCode

	guest := dialWS(t, srv)
	t.Cleanup(func() { guest.Close() })
	sendMsg(t, guest, protocol.ClientMsg{Type: protocol.CMsgJoinRoom, Nickname: "Bob", RoomCode: code})
	readMsgOfType(t, guest, protocol.SMsgRoomJoined)
	readMsgOfType(t, host, protocol.SMsgPlayerJoined)

	// Two humans and two bots: Bob can go, and three seats keep playing.
	for i := 0; i < 2; i++ {
		sendMsg(t, host, protocol.ClientMsg{Type: protocol.CMsgAddBot})
		readMsgOfType(t, host, protocol.SMsgPlayerJoined)
		readMsgOfType(t, guest, protocol.SMsgPlayerJoined)
	}

	sendMsg(t, host, protocol.ClientMsg{Type: protocol.CMsgStartGame})
	readMsgOfType(t, host, protocol.SMsgGameStarted)
	readMsgOfType(t, guest, protocol.SMsgGameStarted)
	completeMapLoad(t, host, guest)

	sendMsg(t, guest, protocol.ClientMsg{Type: protocol.CMsgLeaveRoom})
	readMsgOfType(t, guest, protocol.SMsgLeftRoom)
	if left := readMsgOfType(t, host, protocol.SMsgPlayerLeft); left.Seat() != 1 {
		t.Errorf("player_left seat = %d, want 1", left.Seat())
	}
}

// The seat is not reclaimable: the token is spent and the hand is in the deck.
func TestWalkOut_SeatCannotBeTakenBack(t *testing.T) {
	conns, code := openTable(t, "Alice", "Bob", "Carol", "Dave")
	sendMsg(t, conns[3], protocol.ClientMsg{Type: protocol.CMsgLeaveRoom})
	readMsgOfType(t, conns[3], protocol.SMsgLeftRoom)
	for _, c := range conns[:3] {
		readMsgOfType(t, c, protocol.SMsgPlayerLeft)
		readMsgOfType(t, c, protocol.SMsgGameState)
	}

	// The same socket asking for its seat back gets the stranger's answer.
	sendMsg(t, conns[3], protocol.ClientMsg{
		Type: protocol.CMsgJoinRoom, Nickname: "Dave", RoomCode: code, SessionToken: "anything",
	})
	if got := readMsgOfType(t, conns[3], protocol.SMsgError); got.Error != "game already in progress" {
		t.Errorf("rejoin: error = %q, want the one string a stranger gets", got.Error)
	}
}
