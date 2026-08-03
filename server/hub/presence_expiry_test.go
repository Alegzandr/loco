package hub_test

import (
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"loco/server/hub"
	"loco/server/protocol"
)

// What a departure looks like from the other side of the table, once the seat
// stops being held. Two things used to go unsaid there, and both of them said
// "that player is fine" to a table watching an empty chair.

// shortReconnectHold squeezes the hold so an expiry is a test and not a minute.
func shortReconnectHold(t *testing.T, d time.Duration) {
	t.Helper()
	prev := hub.ReconnectTimeout
	hub.ReconnectTimeout = d
	t.Cleanup(func() { hub.ReconnectTimeout = prev })
}

// seatConnected finds a seat in a roster and reports its flag. The second
// return is false when the seat is not in the list at all.
func seatConnected(players []protocol.PlayerDTO, seat int) (connected, present bool) {
	for _, p := range players {
		if p.Index == seat {
			return p.Connected, true
		}
	}
	return false, false
}

// A seat whose reconnect window closes mid-match cannot be removed — the hands,
// the scores and the turn order are all indexed by it until the round ends — so
// it stays in the roster. It used to stay in it as *connected*: awayAt is what
// made it absent, and handleExpireReconnect deletes that entry one line before
// it announces the departure. The player_left saying Bob is gone therefore
// carried a roster saying Bob is here, and it stayed that way for the rest of
// the match while the turn clock auto-passed for him every 30 seconds.
func TestReconnectExpiry_SeatStopsBeingReportedConnected(t *testing.T) {
	shortReconnectHold(t, 120*time.Millisecond)
	_, srv := newTestHub(t)

	conn1, conn2, _ := setupTwoPlayerGame(t, srv)
	conn2.Close()

	readMsgOfType(t, conn1, protocol.SMsgPlayerDisconnected)

	left := readMsgOfType(t, conn1, protocol.SMsgPlayerLeft)
	if left.Nickname != "Bob" {
		t.Fatalf("player_left nickname = %q, want Bob", left.Nickname)
	}
	connected, present := seatConnected(left.Players, 1)
	if !present {
		t.Fatalf("seat 1 missing from the roster; a running match indexes hands by it")
	}
	if connected {
		t.Errorf("seat 1 reported connected in the message announcing it left")
	}
}

// winBO1WithTokens is winBO1 plus the session tokens, which is what a reclaim
// at the game-over screen has to produce.
func winBO1WithTokens(t *testing.T) (h *hub.Hub, conn1, conn2 *websocket.Conn, code string, tokens [2]string, s *httptest.Server) {
	t.Helper()
	h, s = newTestHub(t)

	conn1 = dialWS(t, s)
	t.Cleanup(func() { conn1.Close() })
	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Alice"})
	created := readMsgOfType(t, conn1, protocol.SMsgRoomCreated)
	code = created.RoomCode
	tokens[0] = created.SessionToken

	conn2 = dialWS(t, s)
	t.Cleanup(func() { conn2.Close() })
	sendMsg(t, conn2, protocol.ClientMsg{Type: protocol.CMsgJoinRoom, Nickname: "Bob", RoomCode: code})
	joined := readMsgOfType(t, conn2, protocol.SMsgRoomJoined)
	tokens[1] = joined.SessionToken
	readMsgOfType(t, conn1, protocol.SMsgPlayerJoined)

	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgStartGame})
	readMsgOfType(t, conn1, protocol.SMsgGameStarted)
	readMsgOfType(t, conn2, protocol.SMsgGameStarted)
	completeMapLoad(t, conn1, conn2)

	winMatchFromHostTurn(t, conn1, conn2)
	return h, conn1, conn2, code, tokens, s
}

// The match is over and the rematch is not. A socket that drops on the
// game-over screen used to lose its seat outright, so a wifi hiccup between the
// last card and the rematch button was answered "not in a room" by the only
// control that screen has. The seat is held now, and reclaimed with its token
// like any other.
func TestGameOverDisconnect_SeatIsHeldAndReclaimable(t *testing.T) {
	shortReconnectHold(t, 5*time.Second)
	_, conn1, conn2, code, tokens, srv := winBO1WithTokens(t)

	conn2.Close()

	// Held, not released: a departure would be player_left.
	away := readMsgOfType(t, conn1, protocol.SMsgPlayerDisconnected)
	if away.Seat() != 1 {
		t.Fatalf("player_disconnected seat = %d, want 1", away.Seat())
	}
	if len(away.Players) != 2 {
		t.Fatalf("roster = %d seats, want the seat held rather than removed", len(away.Players))
	}

	back := dialWS(t, srv)
	defer back.Close()
	sendMsg(t, back, protocol.ClientMsg{
		Type:         protocol.CMsgJoinRoom,
		Nickname:     "Bob",
		RoomCode:     code,
		SessionToken: tokens[1],
	})

	msg := readMsgOfType(t, back, protocol.SMsgPlayerReconnected)
	if msg.OwnSeat() != 1 {
		t.Errorf("reclaimed seat = %d, want 1", msg.OwnSeat())
	}
	// A finished table has no board to rebuild, and sending a snapshot built
	// from a nil State would put the client back at an empty one.
	if msg.State != nil {
		t.Errorf("player_reconnected carried a game state at a finished table")
	}
	if msg.SessionToken == "" || msg.SessionToken == tokens[1] {
		t.Errorf("reclaim did not spend and reissue the token")
	}

	// A seat that comes back is handed the whole offer state, not an increment:
	// the agreement may have moved on while it was away.
	readMsgOfType(t, back, protocol.SMsgRematchOffered)

	// And the button works, which is the whole point of holding the seat.
	sendMsg(t, back, protocol.ClientMsg{Type: protocol.CMsgRematch})
	offered := readMsgOfType(t, back, protocol.SMsgRematchOffered)
	if offered.RematchOffers == nil || len(*offered.RematchOffers) != 1 || (*offered.RematchOffers)[0] != 1 {
		t.Errorf("rematch_offers = %v, want the reclaimed seat's ask", offered.RematchOffers)
	}
}

// The hold is a hold, not a reprieve. When it expires at a finished table the
// seat is removed for real — a phantom there is worse than a stale flag,
// because the next match would deal a hand to nobody — and whoever is left is
// no longer waiting on it.
func TestGameOverDisconnect_ExpiryRemovesTheSeat(t *testing.T) {
	shortReconnectHold(t, 120*time.Millisecond)
	_, conn1, conn2, _, _, _ := winBO1WithTokens(t)

	conn2.Close()
	readMsgOfType(t, conn1, protocol.SMsgPlayerDisconnected)

	left := readMsgOfType(t, conn1, protocol.SMsgPlayerLeft)
	if len(left.Players) != 1 {
		t.Fatalf("roster = %d seats after the hold expired, want 1", len(left.Players))
	}
	if _, present := seatConnected(left.Players, 1); present {
		t.Errorf("seat 1 still in the roster of a finished table")
	}
}
