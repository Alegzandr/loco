package hub_test

import (
	"testing"

	"github.com/gorilla/websocket"
	"loco/server/protocol"
)

// Leaving a match in progress, which every table allows.
//
// The exit is never refused: a player who has to go has only one other way out,
// the turn clock auto-passing for an empty chair until the AFK threshold — two
// rounds spoiled for everybody else rather than one player leaving. What the
// table size decides is what happens next: above the floor the round carries on
// without the seat, at or below it the match ends and goes to whoever stayed.

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

// Three seats: one leaving leaves two, which is still a match, so the round goes
// on without the seat rather than ending for the two who stayed.
func TestWalkOut_ATableOfThreeKeepsPlayingWithTwo(t *testing.T) {
	conns, _ := openTable(t, "Alice", "Bob", "Carol")
	sendMsg(t, conns[2], protocol.ClientMsg{Type: protocol.CMsgLeaveRoom})
	readMsgOfType(t, conns[2], protocol.SMsgLeftRoom)

	for i, c := range conns[:2] {
		if left := readMsgOfType(t, c, protocol.SMsgPlayerLeft); left.Seat() != 2 {
			t.Errorf("client %d: player_left seat = %d, want 2", i, left.Seat())
		}
		// The board again, and no match_end behind it: the match is not over.
		gs := readMsgOfType(t, c, protocol.SMsgGameState)
		if gs.State == nil {
			t.Fatalf("client %d: game_state without state", i)
		}
	}
}

// Two seats: there is no match left to carry on, so it ends where it stands and
// goes to the seat that stayed. Everything a 1v1 does, at a table that only
// became one.
func TestWalkOut_ATableOfTwoEndsTheMatch(t *testing.T) {
	conns, _ := openTable(t, "Alice", "Bob")
	sendMsg(t, conns[1], protocol.ClientMsg{Type: protocol.CMsgLeaveRoom})
	readMsgOfType(t, conns[1], protocol.SMsgLeftRoom)

	end := readMsgOfType(t, conns[0], protocol.SMsgMatchEnd)
	if !end.Forfeit || end.MatchWinner != "Alice" {
		t.Errorf("match_end: forfeit=%t winner=%q, want true and Alice", end.Forfeit, end.MatchWinner)
	}
	if end.Seat() != 1 {
		t.Errorf("match_end: player_index = %d, want 1, the seat that left", end.Seat())
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
