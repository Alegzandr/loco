package hub_test

import (
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"loco/server/protocol"
)

// What a hold running out does to the table it ran out at.
//
// Two things used to go wrong there, and neither was a crash. In a running
// ordinary match the seat stayed in the round with its cards, and the clock
// auto-drew and auto-passed for it every thirty seconds for the rest of the
// match, because the AFK threshold only ever acts on a seat with a socket. At a
// finished table the seats are held rather than removed, and dropping the first
// one whose hold ran out re-based the members without re-basing the holds: the
// second hold kept its old key, so its player read as connected, could not
// reclaim, and was removed from the wrong index or not at all.

// Above the floor the seat is retired, exactly as leave_room retires it: the
// table sees the departure by seat, then the board again with that seat holding
// nothing, and the match goes on.
func TestReconnectExpiry_ATableOfThreeRetiresTheSeat(t *testing.T) {
	shortReconnectHold(t, 150*time.Millisecond)
	conns, _ := openTable(t, "Alice", "Bob", "Carol")
	conns[2].Close()

	for i, c := range conns[:2] {
		readMsgOfType(t, c, protocol.SMsgPlayerDisconnected)
		left := readMsgOfType(t, c, protocol.SMsgPlayerLeft)
		if left.Seat() != 2 || left.Nickname != "Carol" {
			t.Errorf("client %d: player_left seat=%d nickname=%q, want 2 Carol", i, left.Seat(), left.Nickname)
		}
		if connected, _ := seatConnected(left.Players, 2); connected {
			t.Errorf("client %d: seat 2 still reads as connected", i)
		}
		gs := readMsgOfType(t, c, protocol.SMsgGameState)
		if gs.State == nil {
			t.Fatalf("client %d: game_state without state", i)
		}
		for _, p := range gs.State.Players {
			if p.Index == 2 && p.HandSize != 0 {
				t.Errorf("client %d: the expired seat still holds %d cards", i, p.HandSize)
			}
		}
	}
	if drainUntil(conns[0], protocol.SMsgMatchEnd, 400*time.Millisecond) {
		t.Errorf("the match ended at a table of two that could carry on")
	}
}

// At the floor there is no match left without the seat, so it ends and goes to
// the player who stayed, announced as the forfeit it is.
func TestReconnectExpiry_ATableOfTwoForfeitsToTheSeatThatStayed(t *testing.T) {
	shortReconnectHold(t, 150*time.Millisecond)
	_, srv := newTestHub(t)
	conn1, conn2, _ := setupTwoPlayerGame(t, srv)
	conn2.Close()

	readMsgOfType(t, conn1, protocol.SMsgPlayerDisconnected)
	if left := readMsgOfType(t, conn1, protocol.SMsgPlayerLeft); left.Seat() != 1 {
		t.Fatalf("player_left seat = %d, want 1", left.Seat())
	}
	end := readMsgOfType(t, conn1, protocol.SMsgMatchEnd)
	if !end.Forfeit || end.MatchWinner != "Alice" || end.Seat() != 1 {
		t.Errorf("match_end: forfeit=%t winner=%q seat=%d, want a forfeit to Alice naming seat 1",
			end.Forfeit, end.MatchWinner, end.Seat())
	}
}

// finishedTableOfThree deals Alice, Bob and Carol in and has Alice win, and
// hands back the sockets, the code and every session token.
func finishedTableOfThree(t *testing.T) (conns []*websocket.Conn, code string, tokens []string, srv *httptest.Server) {
	t.Helper()
	_, srv = newTestHub(t)

	host := dialWS(t, srv)
	t.Cleanup(func() { host.Close() })
	sendMsg(t, host, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Alice"})
	created := readMsgOfType(t, host, protocol.SMsgRoomCreated)
	code = created.RoomCode
	conns = append(conns, host)
	tokens = append(tokens, created.SessionToken)

	for _, name := range []string{"Bob", "Carol"} {
		c := dialWS(t, srv)
		t.Cleanup(func() { c.Close() })
		sendMsg(t, c, protocol.ClientMsg{Type: protocol.CMsgJoinRoom, Nickname: name, RoomCode: code})
		joined := readMsgOfType(t, c, protocol.SMsgRoomJoined)
		tokens = append(tokens, joined.SessionToken)
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
	winMatchFromHostTurn(t, host, conns[1], conns[2])
	return conns, code, tokens, srv
}

// Two holds at a finished table, and the lower one runs out first. The seat
// above it moves down a key, and its hold has to move with it: the roster still
// says that player is away, their token still opens the seat they now sit at,
// and it is their own hold that ends when it ends — not somebody else's seat.
func TestGameOverDisconnect_TwoHoldsRebaseTogether(t *testing.T) {
	shortReconnectHold(t, time.Second)
	conns, code, tokens, srv := finishedTableOfThree(t)
	alice := conns[0]

	conns[1].Close() // Bob, seat 1
	readMsgOfType(t, alice, protocol.SMsgPlayerDisconnected)
	time.Sleep(300 * time.Millisecond)
	conns[2].Close() // Carol, seat 2
	readMsgOfType(t, alice, protocol.SMsgPlayerDisconnected)

	// Bob's hold runs out first and his seat goes; Carol slides into 1.
	left := readMsgOfType(t, alice, protocol.SMsgPlayerLeft)
	if left.Nickname != "Bob" || len(left.Players) != 2 {
		t.Fatalf("player_left = %q over %d seats, want Bob and a roster of two", left.Nickname, len(left.Players))
	}
	if connected, present := seatConnected(left.Players, 1); !present || connected {
		t.Fatalf("Carol at seat 1: present=%t connected=%t, want present and away", present, connected)
	}

	// Her token opens the seat she now sits at.
	back := dialWS(t, srv)
	defer back.Close()
	sendMsg(t, back, protocol.ClientMsg{
		Type:         protocol.CMsgJoinRoom,
		Nickname:     "Carol",
		RoomCode:     code,
		SessionToken: tokens[2],
	})
	rejoined := readMsgOfType(t, back, protocol.SMsgPlayerReconnected)
	if rejoined.OwnSeat() != 1 {
		t.Errorf("Carol reclaimed seat %d, want 1", rejoined.OwnSeat())
	}
	readMsgOfType(t, alice, protocol.SMsgPlayerReconnected)

	// And the timer armed for her old seat finds her hold gone and does nothing:
	// the roster is still two seats and both are here.
	if drainUntil(alice, protocol.SMsgPlayerLeft, 1200*time.Millisecond) {
		t.Errorf("a stale expiry removed a seat somebody was sitting at")
	}
}

// Same start, nobody comes back: the second hold has to end too, on its own
// timer, and take its own seat with it rather than leaving a phantom the next
// match would deal a hand to.
func TestGameOverDisconnect_TheSecondHoldStillExpiresAfterARebase(t *testing.T) {
	shortReconnectHold(t, 400*time.Millisecond)
	conns, _, _, _ := finishedTableOfThree(t)
	alice := conns[0]

	conns[1].Close()
	readMsgOfType(t, alice, protocol.SMsgPlayerDisconnected)
	time.Sleep(150 * time.Millisecond)
	conns[2].Close()
	readMsgOfType(t, alice, protocol.SMsgPlayerDisconnected)

	first := readMsgOfType(t, alice, protocol.SMsgPlayerLeft)
	second := readMsgOfType(t, alice, protocol.SMsgPlayerLeft)
	if first.Nickname != "Bob" || second.Nickname != "Carol" {
		t.Errorf("departures = %q then %q, want Bob then Carol", first.Nickname, second.Nickname)
	}
	if len(second.Players) != 1 {
		t.Errorf("roster = %d seats after both holds ran out, want Alice alone", len(second.Players))
	}
}

// A finished table both players have dropped from, with both holds gone, is a
// table nobody can come back to: joinAtTable accepts nothing there but a token
// reclaim, and a reclaim needs a hold. It closes on the spot rather than on the
// empty-room timer.
func TestGameOverDisconnect_BothHoldsExpiringClosesTheTable(t *testing.T) {
	shortReconnectHold(t, 120*time.Millisecond)
	_, conn1, conn2, code, _, srv := winBO1WithTokens(t)
	conn1.Close()
	conn2.Close()
	waitFor(t, 3*time.Second, func() bool { return roomGone(t, srv, code) },
		"the finished table outlived both holds with nobody at it")
}

// Every message carries the server's clock, which is what the client reads
// every deadline against.
func TestServerMsg_CarriesServerNow(t *testing.T) {
	_, srv := newTestHub(t)
	conn := dialWS(t, srv)
	defer conn.Close()
	before := time.Now().UnixMilli()
	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Alice"})
	created := readMsgOfType(t, conn, protocol.SMsgRoomCreated)
	if created.ServerNow < before || created.ServerNow > time.Now().UnixMilli() {
		t.Errorf("server_now = %d, want the server's clock at send time", created.ServerNow)
	}
}
