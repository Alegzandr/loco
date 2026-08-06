package hub_test

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"loco/server/hub"
	"loco/server/protocol"
)

// readPlayersOnline waits for the next players_online and returns its count.
func readPlayersOnline(t *testing.T, conn *websocket.Conn) int {
	t.Helper()
	for i := 0; i < 20; i++ {
		msg := readRaw(t, conn)
		if msg.Type != protocol.SMsgPlayersOnline {
			continue
		}
		if msg.PlayersOnline == nil {
			t.Fatalf("players_online carried no count")
		}
		return *msg.PlayersOnline
	}
	t.Fatalf("no players_online within 20 messages")
	return 0
}

// shortenOnlinePeriod makes the tick fast enough for a test and puts the
// production value back afterwards.
func shortenOnlinePeriod(t *testing.T) {
	t.Helper()
	prev := hub.PlayersOnlineBroadcastPeriod
	hub.PlayersOnlineBroadcastPeriod = 20 * time.Millisecond
	t.Cleanup(func() { hub.PlayersOnlineBroadcastPeriod = prev })
}

// A socket is told the count as soon as it registers: the home screen has
// nothing else to draw it from, and waiting for the next tick would leave the
// first load — the visit this count exists for — without one.
func TestPlayersOnline_SentOnConnect(t *testing.T) {
	_, srv := newTestHub(t)
	conn := dialWS(t, srv)
	defer conn.Close()

	if n := readPlayersOnline(t, conn); n != 1 {
		t.Errorf("players_online on connect = %d, want 1", n)
	}
}

// The count moving is what reaches the sockets already here. Nothing is sent
// while it holds still: the ticker checks, it does not announce.
func TestPlayersOnline_UpdatesWhenSomebodyArrives(t *testing.T) {
	shortenOnlinePeriod(t)
	_, srv := newTestHub(t)

	first := dialWS(t, srv)
	defer first.Close()
	if n := readPlayersOnline(t, first); n != 1 {
		t.Fatalf("first socket saw %d, want 1", n)
	}

	second := dialWS(t, srv)
	defer second.Close()

	if n := readPlayersOnline(t, first); n != 2 {
		t.Errorf("after an arrival the first socket saw %d, want 2", n)
	}
}

// A tick that changes nothing sends nothing. Without this the count would be
// one small message per seatless socket every period, forever, on a server
// where nobody is doing anything.
func TestPlayersOnline_SilentWhileUnchanged(t *testing.T) {
	shortenOnlinePeriod(t)
	_, srv := newTestHub(t)

	conn := dialWS(t, srv)
	defer conn.Close()
	if n := readPlayersOnline(t, conn); n != 1 {
		t.Fatalf("connect count = %d, want 1", n)
	}

	// Several periods with nobody arriving or leaving.
	conn.SetReadDeadline(time.Now().Add(200 * time.Millisecond))
	if _, _, err := conn.ReadMessage(); err == nil {
		t.Errorf("a still count was broadcast anyway")
	}
}

// A seated socket is not told: the count is drawn on the home screen and
// nowhere else, and a table in the middle of a match has no use for a message
// arriving on a timer.
func TestPlayersOnline_NotSentToASeatedSocket(t *testing.T) {
	shortenOnlinePeriod(t)
	_, srv := newTestHub(t)

	host := dialWS(t, srv)
	defer host.Close()
	if n := readPlayersOnline(t, host); n != 1 {
		t.Fatalf("connect count = %d, want 1", n)
	}
	sendMsg(t, host, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Alice"})
	readMsgOfType(t, host, protocol.SMsgRoomCreated)

	// Somebody else arrives: the count moves, and the seated socket must not
	// hear about it.
	other := dialWS(t, srv)
	defer other.Close()
	if n := readPlayersOnline(t, other); n != 2 {
		t.Fatalf("arriving socket saw %d, want 2", n)
	}

	host.SetReadDeadline(time.Now().Add(200 * time.Millisecond))
	for {
		_, data, err := host.ReadMessage()
		if err != nil {
			break // nothing arrived, which is the point
		}
		if msg := decodeServerMsg(t, data); msg.Type == protocol.SMsgPlayersOnline {
			t.Fatalf("a seated socket was sent players_online")
		}
	}
}

// A player who gives their seat up is on the home screen again, so the next
// tick owes them the count — even on a server where nothing else moves. This is
// what the per-socket watermark buys over a single hub-wide one.
func TestPlayersOnline_ResumesAfterLeavingATable(t *testing.T) {
	shortenOnlinePeriod(t)
	_, srv := newTestHub(t)

	host := dialWS(t, srv)
	defer host.Close()
	if n := readPlayersOnline(t, host); n != 1 {
		t.Fatalf("connect count = %d, want 1", n)
	}
	sendMsg(t, host, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Alice"})
	readMsgOfType(t, host, protocol.SMsgRoomCreated)

	// Two more sockets arrive while this one is seated and hears nothing.
	for i := 0; i < 2; i++ {
		c := dialWS(t, srv)
		t.Cleanup(func() { c.Close() })
	}

	sendMsg(t, host, protocol.ClientMsg{Type: protocol.CMsgLeaveRoom})
	readMsgOfType(t, host, protocol.SMsgLeftRoom)

	if n := readPlayersOnline(t, host); n != 3 {
		t.Errorf("back on the home screen the count read %d, want 3", n)
	}
}

func decodeServerMsg(t *testing.T, data []byte) protocol.ServerMsg {
	t.Helper()
	var msg protocol.ServerMsg
	if err := json.Unmarshal(data, &msg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	return msg
}
