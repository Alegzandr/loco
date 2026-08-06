package hub_test

import (
	"testing"

	"github.com/gorilla/websocket"
	"loco/server/protocol"
)

// Streamer mode is the one preference in this game that is not purely local.
// The table code is a single string shared by everybody who can see it, so a
// host who is streaming is exposed by their guests' screens as much as by their
// own — blurring only the host's copy would protect the one screen that was
// already being watched carefully.
//
// These tests pin the whole of that: who may set it, who hears about it, and
// every path a client can learn the current answer from without being told
// twice.

func TestSetStreamerMode_ReachesEverySeat(t *testing.T) {
	_, srv := newTestHub(t)
	host, guests, _ := setupLobby(t, srv, "Bob")

	sendMsg(t, host, protocol.ClientMsg{Type: protocol.CMsgSetStreamerMode, StreamerMode: true})

	// The host included: the setting is the table's answer now, not the state of
	// one switch in one panel, and a host whose own client had it off (a second
	// tab, a reload) has to converge on it too.
	for _, seat := range []struct {
		name string
		conn *websocket.Conn
	}{{"the host", host}, {"Bob", guests[0]}} {
		if got := readMsgOfType(t, seat.conn, protocol.SMsgStreamerModeChanged); !got.StreamerMode {
			t.Errorf("%s was told streamer_mode=false, want true", seat.name)
		}
	}
}

// Off travels exactly like on. The switch is a state, not a toggle, so the
// message that turns it off is the same message with the other value.
func TestSetStreamerMode_TurnsBackOff(t *testing.T) {
	_, srv := newTestHub(t)
	host, guests, _ := setupLobby(t, srv, "Bob")
	bob := guests[0]

	sendMsg(t, host, protocol.ClientMsg{Type: protocol.CMsgSetStreamerMode, StreamerMode: true})
	readMsgOfType(t, bob, protocol.SMsgStreamerModeChanged)

	sendMsg(t, host, protocol.ClientMsg{Type: protocol.CMsgSetStreamerMode})
	if got := readMsgOfType(t, bob, protocol.SMsgStreamerModeChanged); got.StreamerMode {
		t.Error("streamer_mode stayed on after being switched off")
	}
}

// A repeat of the state the table is already in is not an error — a client whose
// switch was flipped twice is a correct client — but it is broadcast to nobody.
// The switch sits under a thumb in a panel that opens on every screen.
func TestSetStreamerMode_RepeatBroadcastsNothing(t *testing.T) {
	_, srv := newTestHub(t)
	host, guests, _ := setupLobby(t, srv, "Bob")
	bob := guests[0]

	sendMsg(t, host, protocol.ClientMsg{Type: protocol.CMsgSetStreamerMode, StreamerMode: true})
	readMsgOfType(t, bob, protocol.SMsgStreamerModeChanged)

	// The second true says nothing new. The false behind it does, so it is what
	// Bob's next streamer_mode_changed must carry: if the repeat had gone out,
	// this read would find it first and report true.
	sendMsg(t, host, protocol.ClientMsg{Type: protocol.CMsgSetStreamerMode, StreamerMode: true})
	sendMsg(t, host, protocol.ClientMsg{Type: protocol.CMsgSetStreamerMode})

	if got := readMsgOfType(t, bob, protocol.SMsgStreamerModeChanged); got.StreamerMode {
		t.Error("the repeated set was broadcast; want it swallowed")
	}
}

// It is a table setting, and a table's settings are seat 0's.
func TestSetStreamerMode_RefusedForAGuest(t *testing.T) {
	_, srv := newTestHub(t)
	host, guests, _ := setupLobby(t, srv, "Bob")

	sendMsg(t, guests[0], protocol.ClientMsg{Type: protocol.CMsgSetStreamerMode, StreamerMode: true})
	expectError(t, guests[0], "only the host")

	// And nothing moved: the host is the seat that would have been told.
	sendMsg(t, host, protocol.ClientMsg{Type: protocol.CMsgSetStreamerMode, StreamerMode: true})
	if got := readMsgOfType(t, host, protocol.SMsgStreamerModeChanged); !got.StreamerMode {
		t.Error("the host's own set did not take")
	}
}

// A table with no host has no code on anybody's screen, so there is nothing to
// blur and nobody to ask. Refused like every other host control at one.
func TestSetStreamerMode_RefusedAtAHostlessTable(t *testing.T) {
	_, srv := newTestHub(t)
	conn := dialWS(t, srv)
	defer conn.Close()

	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgPlayBot, Nickname: "Alice"})
	readMsgOfType(t, conn, protocol.SMsgGameStarted)

	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgSetStreamerMode, StreamerMode: true})
	expectError(t, conn, "not available in this game")
}

// Somebody who types the code after the host started streaming has to arrive
// already blurred. Waiting for the next flip of the switch would mean the code
// is readable on their screen for as long as the host does not touch it.
func TestSetStreamerMode_RidesTheJoin(t *testing.T) {
	_, srv := newTestHub(t)
	host, _, code := setupLobby(t, srv)

	sendMsg(t, host, protocol.ClientMsg{Type: protocol.CMsgSetStreamerMode, StreamerMode: true})
	readMsgOfType(t, host, protocol.SMsgStreamerModeChanged)

	guest := dialWS(t, srv)
	defer guest.Close()
	sendMsg(t, guest, protocol.ClientMsg{Type: protocol.CMsgJoinRoom, Nickname: "Bob", RoomCode: code})

	if got := readMsgOfType(t, guest, protocol.SMsgRoomJoined); !got.StreamerMode {
		t.Error("room_joined did not carry the table's streamer mode")
	}
}

// And a tab that reloads mid-match rebuilds the table from the state snapshot
// and nothing else, so the setting rides that too. A code that comes back
// readable on a stream is the failure this whole thing exists to prevent.
func TestSetStreamerMode_RidesTheStateSnapshot(t *testing.T) {
	_, srv := newTestHub(t)
	host, guests, _ := setupLobby(t, srv, "Bob")

	sendMsg(t, host, protocol.ClientMsg{Type: protocol.CMsgSetStreamerMode, StreamerMode: true})
	readMsgOfType(t, host, protocol.SMsgStreamerModeChanged)
	readMsgOfType(t, guests[0], protocol.SMsgStreamerModeChanged)

	sendMsg(t, host, protocol.ClientMsg{Type: protocol.CMsgStartGame})
	started := readMsgOfType(t, guests[0], protocol.SMsgGameStarted)
	if started.State == nil {
		t.Fatal("game_started carried no state")
	}
	if !started.State.StreamerMode {
		t.Error("the dealt state dropped the table's streamer mode")
	}
}
