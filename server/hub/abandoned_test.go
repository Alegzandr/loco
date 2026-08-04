package hub_test

import (
	"net/http/httptest"
	"testing"
	"time"

	"loco/server/protocol"
)

// A match nobody is at any more, and the two ways it used to go on anyway.
//
// The ordinary room's refusal of leave_room mid-match is deliberate: walking out
// is not a move, and the 60s hold exists so a drop is not the end. But the
// refusal assumed there was somebody left to walk out on. Once the other seat's
// hold has expired, nothing at it will ever act again — and the room went on
// auto-drawing and auto-passing for it every 30s until EmptyRoomTimeout, five
// minutes later, while a deploy started in that window waited on it.

// roomGone reports whether a fresh socket is told this code does not exist.
func roomGone(t *testing.T, srv *httptest.Server, code string) bool {
	t.Helper()
	probe := dialWS(t, srv)
	defer probe.Close()
	sendMsg(t, probe, protocol.ClientMsg{Type: protocol.CMsgJoinRoom, Nickname: "Probe", RoomCode: code})
	msg := readMsgOfType(t, probe, protocol.SMsgError)
	return msg.Error == "room not found"
}

// A held seat is somebody who may still come back, so the match is theirs to
// come back to: leaving in front of one is the ordinary 1v1 ending and not the
// abandoned-table one, and the table is still there afterwards.
func TestLeaveMatch_GoesToTheHeldSeatRatherThanClosingTheTable(t *testing.T) {
	shortReconnectHold(t, 10*time.Second)
	_, srv := newTestHub(t)

	conn1, conn2, code := setupTwoPlayerGame(t, srv)
	conn2.Close()
	readMsgOfType(t, conn1, protocol.SMsgPlayerDisconnected)

	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgLeaveRoom})
	readMsgOfType(t, conn1, protocol.SMsgLeftRoom)

	if roomGone(t, srv, code) {
		t.Error("the table closed under a seat that was still inside its hold")
	}
}

// Once the hold has expired there is nobody to refuse on behalf of, and the
// survivor had no in-game action left at all: leaving was refused, the opponent
// could not come back, and closing the tab was the only way out of the game.
func TestLeaveMatch_AllowedOnceNobodyIsLeftToLeaveOn(t *testing.T) {
	shortReconnectHold(t, 120*time.Millisecond)
	_, srv := newTestHub(t)

	conn1, conn2, code := setupTwoPlayerGame(t, srv)
	conn2.Close()
	readMsgOfType(t, conn1, protocol.SMsgPlayerDisconnected)
	readMsgOfType(t, conn1, protocol.SMsgPlayerLeft)

	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgLeaveRoom})
	readMsgOfType(t, conn1, protocol.SMsgLeftRoom)

	// And the table goes with them: there is no one to award the match to, so
	// nothing is left holding a room code.
	waitFor(t, 3*time.Second, func() bool { return roomGone(t, srv, code) },
		"the table outlived the last player leaving it")
}

// The other half of the same state, reached without anybody pressing anything:
// both sockets go and both holds expire. The room used to stay StatusPlaying
// for the whole EmptyRoomTimeout, re-arming a turn clock for empty seats and
// counting as a match in flight against any drain that began in that window.
//
// EmptyRoomTimeout is left at its five minutes on purpose: if it were the thing
// doing this work, this test would take five minutes to fail.
func TestAbandonedMatch_LastExpiryClosesTheTable(t *testing.T) {
	shortReconnectHold(t, 120*time.Millisecond)
	_, srv := newTestHub(t)

	conn1, conn2, code := setupTwoPlayerGame(t, srv)
	conn1.Close()
	conn2.Close()

	waitFor(t, 3*time.Second, func() bool { return roomGone(t, srv, code) },
		"the table outlived both reconnect windows with nobody at it")
}

// waitFor polls until cond holds or the budget runs out.
func waitFor(t *testing.T, budget time.Duration, cond func() bool, msg string) {
	t.Helper()
	deadline := time.Now().Add(budget)
	for {
		if cond() {
			return
		}
		if time.Now().After(deadline) {
			t.Fatal(msg)
		}
		time.Sleep(20 * time.Millisecond)
	}
}
