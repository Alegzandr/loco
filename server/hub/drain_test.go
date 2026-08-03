package hub_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"loco/server/hub"
	"loco/server/protocol"
)

// Draining is what a deploy does to a server people are playing on. These tests
// pin both halves of the contract: nothing new starts, and nothing already
// running is disturbed.

// expectError reads until an error arrives and checks what it says.
func expectError(t *testing.T, conn *websocket.Conn, want string) {
	t.Helper()
	msg := readMsgOfType(t, conn, protocol.SMsgError)
	if !strings.Contains(msg.Error, want) {
		t.Fatalf("error = %q, want it to contain %q", msg.Error, want)
	}
}

func TestDrain_RefusesNewTables(t *testing.T) {
	h, srv := newTestHub(t)

	conn := dialWS(t, srv)
	defer conn.Close()
	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Alice"})
	created := readMsgOfType(t, conn, protocol.SMsgRoomCreated)

	h.BeginDrain()

	other := dialWS(t, srv)
	defer other.Close()
	sendMsg(t, other, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Bob"})
	expectError(t, other, "server updating")

	// A table that does not exist reads as the update, not as a typo: the code
	// the player was handed a minute ago was real.
	sendMsg(t, other, protocol.ClientMsg{Type: protocol.CMsgJoinRoom, Nickname: "Bob", RoomCode: "ZZZZZZ"})
	expectError(t, other, "server updating")

	// The lobby that already exists is still joinable, and that is deliberate:
	// the refusal is on dealing, not on sitting down.
	sendMsg(t, other, protocol.ClientMsg{Type: protocol.CMsgJoinRoom, Nickname: "Bob", RoomCode: created.RoomCode})
	readMsgOfType(t, other, protocol.SMsgRoomJoined)

	// Dealing is what would extend the drain without bound, so it is refused.
	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgStartGame})
	expectError(t, conn, "server updating")
}

func TestDrain_RefusesMatchmakingAndEmptiesTheQueue(t *testing.T) {
	h, srv := newTestHub(t)

	waiting := dialWS(t, srv)
	defer waiting.Close()
	sendMsg(t, waiting, protocol.ClientMsg{Type: protocol.CMsgFindMatch, Nickname: "Alice"})
	readMsgOfType(t, waiting, protocol.SMsgMatchmakingQueued)

	h.BeginDrain()

	// Somebody already searching is told why and taken off the screen, rather
	// than left waiting for an opponent this process will never pair.
	expectError(t, waiting, "server updating")
	readMsgOfType(t, waiting, protocol.SMsgMatchmakingCancelled)

	sendMsg(t, waiting, protocol.ClientMsg{Type: protocol.CMsgFindMatch, Nickname: "Alice"})
	expectError(t, waiting, "server updating")

	if q := metricsOf(t, srv).MatchmakingQueue; q != 0 {
		t.Errorf("matchmaking_queue = %d after drain, want 0", q)
	}
}

func TestDrain_MatchInProgressKeepsPlaying(t *testing.T) {
	t.Setenv("LOCO_E2E", "1")

	h, srv := newTestHub(t)

	conn1 := dialWS(t, srv)
	t.Cleanup(func() { conn1.Close() })
	conn2 := dialWS(t, srv)
	t.Cleanup(func() { conn2.Close() })

	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Alice"})
	created := readMsgOfType(t, conn1, protocol.SMsgRoomCreated)
	sendMsg(t, conn2, protocol.ClientMsg{Type: protocol.CMsgJoinRoom, Nickname: "Bob", RoomCode: created.RoomCode})
	readMsgOfType(t, conn2, protocol.SMsgRoomJoined)
	readMsgOfType(t, conn1, protocol.SMsgPlayerJoined)

	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgStartGame})
	gs1 := readMsgOfType(t, conn1, protocol.SMsgGameStarted)
	gs2 := readMsgOfType(t, conn2, protocol.SMsgGameStarted)
	completeMapLoad(t, conn1, conn2)
	if gs1.State == nil || gs2.State == nil {
		t.Fatal("missing game state in game_started")
	}

	h.BeginDrain()

	// The table is told, once, so the screen can say what is happening.
	readMsgOfType(t, conn1, protocol.SMsgServerUpdating)
	readMsgOfType(t, conn2, protocol.SMsgServerUpdating)

	active, observer := conn1, conn2
	activeIdx := gs1.State.YourIndex
	if gs1.State.Turn != gs1.State.YourIndex {
		active, observer = conn2, conn1
		activeIdx = gs2.State.YourIndex
	}

	zero := 0
	sendMsg(t, active, protocol.ClientMsg{
		Type: protocol.CMsgDebugSetState,
		Debug: &protocol.DebugStateDTO{
			Hand:        []protocol.CardDTO{{Color: "red", Kind: "number", Value: 3}},
			Discard:     &protocol.CardDTO{Color: "red", Kind: "number", Value: 5},
			ActiveColor: "red",
			PendingDraw: &zero,
			CurrentTurn: &activeIdx,
		},
	})
	readMsgOfType(t, active, protocol.SMsgGameState)
	readMsgOfType(t, observer, protocol.SMsgGameState)

	sendMsg(t, active, protocol.ClientMsg{
		Type: protocol.CMsgPlayCard,
		Card: &protocol.CardDTO{Color: "red", Kind: "number", Value: 3},
	})
	played := readMsgOfType(t, observer, protocol.SMsgCardPlayed)
	if played.Card == nil || played.Card.Value != 3 {
		t.Fatalf("a card played during the drain did not resolve: got %+v", played.Card)
	}
}

// The notice used to be gated on StatusPlaying, which meant it missed the three
// places a drain is actually felt. A waiting room is one of them: the host is
// about to press a start button that comes back refused, and being turned down
// is not how a player should learn a deploy is under way.
func TestDrain_NotifiesTablesThatHaveNotDealt(t *testing.T) {
	h, srv := newTestHub(t)

	host := dialWS(t, srv)
	defer host.Close()
	sendMsg(t, host, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Alice"})
	created := readMsgOfType(t, host, protocol.SMsgRoomCreated)

	guest := dialWS(t, srv)
	defer guest.Close()
	sendMsg(t, guest, protocol.ClientMsg{
		Type: protocol.CMsgJoinRoom, Nickname: "Bob", RoomCode: created.RoomCode,
	})
	readMsgOfType(t, guest, protocol.SMsgRoomJoined)
	readMsgOfType(t, host, protocol.SMsgPlayerJoined)

	h.BeginDrain()

	readMsgOfType(t, host, protocol.SMsgServerUpdating)
	readMsgOfType(t, guest, protocol.SMsgServerUpdating)
}

// The other one: a table that is over. The rematch button on that screen stops
// working during a drain, and a refusal on the only control the screen has
// reads as a broken button rather than as a deploy.
func TestDrain_NotifiesFinishedTables(t *testing.T) {
	h, conn1, conn2, _, _, _ := winBO1WithTokens(t)

	h.BeginDrain()

	readMsgOfType(t, conn1, protocol.SMsgServerUpdating)
	readMsgOfType(t, conn2, protocol.SMsgServerUpdating)

	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgRematch})
	expectError(t, conn1, "server updating")
}

func TestDrain_ReconnectStillWorks(t *testing.T) {
	h, srv := newTestHub(t)

	conn1, conn2, code, tokens := setupTwoPlayerGameWithTokens(t, srv)

	h.BeginDrain()
	readMsgOfType(t, conn1, protocol.SMsgServerUpdating)

	conn2.Close()
	readMsgOfType(t, conn1, protocol.SMsgPlayerDisconnected)

	back := dialWS(t, srv)
	defer back.Close()
	sendMsg(t, back, protocol.ClientMsg{
		Type:         protocol.CMsgJoinRoom,
		Nickname:     "Bob",
		RoomCode:     code,
		SessionToken: tokens[1],
	})
	msg := readMsgOfType(t, back, protocol.SMsgPlayerReconnected)
	if msg.State == nil {
		t.Fatal("a reconnect during the drain returned no state")
	}
}

func TestDrain_DoneOnlyOnceTheLastMatchEnds(t *testing.T) {
	h, srv := newTestHubFastCleanup(t, 50*time.Millisecond)

	conn1, conn2, _ := setupTwoPlayerGame(t, srv)

	h.BeginDrain()

	select {
	case <-h.DrainDone():
		t.Fatal("the drain completed while a match was still being played")
	case <-time.After(100 * time.Millisecond):
	}

	// Both players walk away: the room empties, the cleanup runs, and that is
	// the last thing holding the drain open.
	conn1.Close()
	conn2.Close()

	select {
	case <-h.DrainDone():
	case <-time.After(5 * time.Second):
		t.Fatal("the drain never completed after the last table went away")
	}
}

func TestDrain_DoneImmediatelyWhenNobodyIsPlaying(t *testing.T) {
	h, _ := newTestHub(t)

	h.BeginDrain()

	select {
	case <-h.DrainDone():
	case <-time.After(2 * time.Second):
		t.Fatal("the drain on an idle server never completed")
	}
}

func TestDrain_ReportedOnHealthAndMetrics(t *testing.T) {
	h, srv := newTestHub(t)

	if healthOf(t, srv).Draining {
		t.Error("health reported draining before any signal")
	}

	h.BeginDrain()

	if !healthOf(t, srv).Draining {
		t.Error("health did not report draining")
	}
	if !metricsOf(t, srv).Draining {
		t.Error("metrics did not report draining")
	}
}

// --- helpers ---

func healthOf(t *testing.T, srv *httptest.Server) hub.HealthStats {
	t.Helper()
	var stats hub.HealthStats
	getJSON(t, srv.URL+"/health", &stats)
	return stats
}

func metricsOf(t *testing.T, srv *httptest.Server) hub.MetricsStats {
	t.Helper()
	var m hub.MetricsStats
	getJSON(t, srv.URL+"/metrics", &m)
	return m
}

func getJSON(t *testing.T, url string, into any) {
	t.Helper()
	resp, err := http.Get(url)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	defer resp.Body.Close()
	if err := json.NewDecoder(resp.Body).Decode(into); err != nil {
		t.Fatalf("decode %s: %v", url, err)
	}
}
