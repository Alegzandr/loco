package hub_test

import (
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"loco/server/game"
	"loco/server/hub"
	"loco/server/protocol"
)

// twoHumansAtStart creates a room, joins a second human and starts the match,
// returning both connections with the table still shut.
func twoHumansAtStart(t *testing.T) (*websocket.Conn, *websocket.Conn) {
	t.Helper()
	_, srv := newTestHub(t)

	conn1 := dialWS(t, srv)
	t.Cleanup(func() { conn1.Close() })
	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Alice"})
	created := readMsgOfType(t, conn1, protocol.SMsgRoomCreated)

	conn2 := dialWS(t, srv)
	t.Cleanup(func() { conn2.Close() })
	sendMsg(t, conn2, protocol.ClientMsg{Type: protocol.CMsgJoinRoom, Nickname: "Bob", RoomCode: created.RoomCode})
	readMsgOfType(t, conn2, protocol.SMsgRoomJoined)
	readMsgOfType(t, conn1, protocol.SMsgPlayerJoined)

	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgStartGame})
	readMsgOfType(t, conn1, protocol.SMsgGameStarted)
	readMsgOfType(t, conn2, protocol.SMsgGameStarted)
	return conn1, conn2
}

// The map has to reach the client, and it has to reach it in the snapshot rather
// than only in game_started: a player who reconnects mid-match must rebuild the
// same room as everybody else, not fall back to the plain felt.
func TestMapID_RidesTheGameState(t *testing.T) {
	_, srv := newTestHub(t)

	conn := dialWS(t, srv)
	t.Cleanup(func() { conn.Close() })
	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Alice"})
	readMsgOfType(t, conn, protocol.SMsgRoomCreated)
	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgAddBot})
	readMsgOfType(t, conn, protocol.SMsgPlayerJoined)

	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgStartGame})
	started := readMsgOfType(t, conn, protocol.SMsgGameStarted)
	if started.State == nil {
		t.Fatal("game_started missing state")
	}
	if started.State.MapID == "" {
		t.Fatal("game_started carries no map_id")
	}
	// The hour and the sky travel with it: the client renders the scene from
	// the three ids, and a snapshot carrying one without the other two is a room
	// drawn at a default hour for whoever reloaded.
	if !game.TimeOfDay(started.State.TimeOfDay).Valid() {
		t.Errorf("game_started carries time_of_day=%q, want a valid hour", started.State.TimeOfDay)
	}
	if !game.Weather(started.State.Weather).Valid() {
		t.Errorf("game_started carries weather=%q, want a valid sky", started.State.Weather)
	}
	completeMapLoad(t, conn)
}

// Every seat must be told the same room. Two players describing two different
// tables to a viewer is a table that does not exist.
func TestMapID_IsTheSameForEverySeat(t *testing.T) {
	_, srv := newTestHub(t)

	conn1 := dialWS(t, srv)
	t.Cleanup(func() { conn1.Close() })
	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Alice"})
	created := readMsgOfType(t, conn1, protocol.SMsgRoomCreated)

	conn2 := dialWS(t, srv)
	t.Cleanup(func() { conn2.Close() })
	sendMsg(t, conn2, protocol.ClientMsg{Type: protocol.CMsgJoinRoom, Nickname: "Bob", RoomCode: created.RoomCode})
	readMsgOfType(t, conn2, protocol.SMsgRoomJoined)
	readMsgOfType(t, conn1, protocol.SMsgPlayerJoined)

	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgStartGame})
	gs1 := readMsgOfType(t, conn1, protocol.SMsgGameStarted)
	gs2 := readMsgOfType(t, conn2, protocol.SMsgGameStarted)
	if gs1.State == nil || gs2.State == nil {
		t.Fatal("game_started missing state")
	}
	if gs1.State.TimeOfDay != gs2.State.TimeOfDay || gs1.State.Weather != gs2.State.Weather {
		t.Errorf("two seats dealt under two skies: %q/%q vs %q/%q",
			gs1.State.TimeOfDay, gs1.State.Weather, gs2.State.TimeOfDay, gs2.State.Weather)
	}
	if gs1.State.MapID != gs2.State.MapID {
		t.Errorf("map_id = %q for Alice and %q for Bob; every seat plays in one room",
			gs1.State.MapID, gs2.State.MapID)
	}
	completeMapLoad(t, conn1, conn2)
}

// The gate's whole point: a client that skips its own loading screen must not be
// the only one able to act while everybody else is still downloading.
func TestMapLoading_RefusesGameplayUntilTheTableOpens(t *testing.T) {
	conn1, conn2 := twoHumansAtStart(t)

	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgDrawCard})
	if e := readMsgOfType(t, conn1, protocol.SMsgError); !strings.Contains(e.Error, "load the table") {
		t.Errorf("error = %q, want a refusal naming the loading table", e.Error)
	}

	completeMapLoad(t, conn1, conn2)
}

// One arrival is not enough: the table waits for the last one.
func TestMapLoading_WaitsForEverySeat(t *testing.T) {
	conn1, conn2 := twoHumansAtStart(t)

	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgMapReady})
	progress := readMsgOfType(t, conn1, protocol.SMsgMatchLoading)
	// The first broadcast (nobody ready) may still be in the pipe; walk to the
	// one that names seat 0.
	for i := 0; i < 5 && len(progress.PlayersReady) == 0; i++ {
		progress = readMsgOfType(t, conn1, protocol.SMsgMatchLoading)
	}
	if len(progress.PlayersReady) != 1 || progress.PlayersReady[0] != 0 {
		t.Fatalf("players_ready = %v, want just seat 0", progress.PlayersReady)
	}

	// Still shut: Bob has not answered.
	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgDrawCard})
	if e := readMsgOfType(t, conn1, protocol.SMsgError); !strings.Contains(e.Error, "load the table") {
		t.Errorf("error = %q, want the table to still be shut", e.Error)
	}

	sendMsg(t, conn2, protocol.ClientMsg{Type: protocol.CMsgMapReady})
	readMsgOfType(t, conn1, protocol.SMsgMatchReady)
	readMsgOfType(t, conn2, protocol.SMsgMatchReady)
}

// A bot has nothing to download, so a human alone with bots never waits.
func TestMapLoading_BotsAreReadyImmediately(t *testing.T) {
	_, srv := newTestHub(t)

	conn := dialWS(t, srv)
	t.Cleanup(func() { conn.Close() })
	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Alice"})
	readMsgOfType(t, conn, protocol.SMsgRoomCreated)
	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgAddBot})
	readMsgOfType(t, conn, protocol.SMsgPlayerJoined)

	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgStartGame})
	readMsgOfType(t, conn, protocol.SMsgGameStarted)
	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgMapReady})

	ready := readMsgOfType(t, conn, protocol.SMsgMatchReady)
	// The clock is only armed for a human seat: bots keep their own timing, so
	// a round the bot opens legitimately has no deadline to report. The starter
	// is drawn at random, so this test would flake half the time if it asserted
	// a deadline unconditionally.
	if ready.Turn == 0 && ready.TurnDeadline == 0 {
		t.Error("match_ready opens on the human's turn but carries no turn deadline")
	}
	if ready.Turn != 0 && ready.TurnDeadline != 0 {
		t.Errorf("match_ready opens on the bot's turn with TurnDeadline %d; bots run their own clock",
			ready.TurnDeadline)
	}
}

// One tab thrown into the background must not hold nine other people on a
// loading screen. The table starts without it.
func TestMapLoading_TimeoutOpensTheTableAnyway(t *testing.T) {
	orig := hub.MapLoadTimeout
	hub.MapLoadTimeout = 120 * time.Millisecond
	t.Cleanup(func() { hub.MapLoadTimeout = orig })

	conn1, conn2 := twoHumansAtStart(t)

	// Only Alice answers. Bob never does.
	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgMapReady})

	readMsgOfType(t, conn1, protocol.SMsgMatchReady)
	readMsgOfType(t, conn2, protocol.SMsgMatchReady)
}

// A seat that leaves during the gate stops being a seat the table waits on;
// otherwise the room sits out the full timeout for a player who is provably gone.
func TestMapLoading_DisconnectStopsBlockingTheTable(t *testing.T) {
	orig := hub.MapLoadTimeout
	// Long enough that a pass would have to come from the disconnect path, not
	// from the deadline quietly rescuing the test.
	hub.MapLoadTimeout = 30 * time.Second
	t.Cleanup(func() { hub.MapLoadTimeout = orig })

	conn1, conn2 := twoHumansAtStart(t)

	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgMapReady})
	conn2.Close()

	readMsgOfType(t, conn1, protocol.SMsgMatchReady)
}

// A rematch draws a new map, so the gate has to re-arm. If the previous match's
// gate leaked, the second match would either never open or open without waiting.
func TestMapLoading_RearmsOnRematch(t *testing.T) {
	_, srv := newTestHub(t)

	conn := dialWS(t, srv)
	t.Cleanup(func() { conn.Close() })
	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Alice"})
	readMsgOfType(t, conn, protocol.SMsgRoomCreated)
	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgAddBot})
	readMsgOfType(t, conn, protocol.SMsgPlayerJoined)

	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgStartGame})
	readMsgOfType(t, conn, protocol.SMsgGameStarted)
	completeMapLoad(t, conn)
	winMatchFromHostTurn(t, conn)

	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgRematch})
	readMsgOfType(t, conn, protocol.SMsgRematchStarted)

	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgStartGame})
	gs := readMsgOfType(t, conn, protocol.SMsgGameStarted)
	if gs.State == nil || gs.State.MapID == "" {
		t.Fatal("rematch dealt no map")
	}
	// Still gated: the new map is one nobody has downloaded.
	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgDrawCard})
	if e := readMsgOfType(t, conn, protocol.SMsgError); !strings.Contains(e.Error, "load the table") {
		t.Errorf("error = %q, want the rematch to gate on its new map too", e.Error)
	}
	completeMapLoad(t, conn)
}

// A duplicate answer is a double click or a message already in flight, not an
// attack, and it must not earn an error toast in the middle of a match.
func TestMapLoading_RepeatedMapReadyIsHarmless(t *testing.T) {
	conn1, conn2 := twoHumansAtStart(t)

	completeMapLoad(t, conn1, conn2)

	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgMapReady})
	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgDrawCard})
	// The draw is answered on its merits ("not your turn" if Bob leads). What
	// matters is that nothing complains about the map.
	for i := 0; i < 6; i++ {
		msg := readMsg(t, conn1)
		if msg.Type == protocol.SMsgError && strings.Contains(msg.Error, "load the table") {
			t.Fatalf("a repeated map_ready re-shut the table: %q", msg.Error)
		}
		if msg.Type == protocol.SMsgCardDrawn || msg.Type == protocol.SMsgError {
			return
		}
	}
}
