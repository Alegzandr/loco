package hub_test

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/gorilla/websocket"
	"loco/server/protocol"
)

// A 1v1 against the server: the queue's experience with the queue taken out.
//
// The property that matters beyond the mode working is the last test here: it
// touches nothing the matchmaking queue owns. The queue is the one server-global
// the E2E suite has to serialise around, and a second entry point quietly
// joining it would make every parallel run flaky in a way nothing points at.

// playBot sends the message and reads the deal back.
func playBot(t *testing.T, conn *websocket.Conn, nickname string) protocol.ServerMsg {
	t.Helper()
	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgPlayBot, Nickname: nickname})
	return readMsgOfType(t, conn, protocol.SMsgGameStarted)
}

func TestPlayBot_DealsAHandWithNothingToPress(t *testing.T) {
	_, srv := newTestHub(t)
	conn := dialWS(t, srv)
	t.Cleanup(func() { conn.Close() })

	started := playBot(t, conn, "Alice")

	// The whole identity, on the one message this mode has: there is no
	// room_created and no match_found in front of it, so without these a reload
	// could not reclaim the seat.
	if started.RoomCode == "" {
		t.Error("game_started carried no room code")
	}
	if started.SessionToken == "" {
		t.Error("game_started carried no session token")
	}
	if started.OwnSeat() != 0 {
		t.Errorf("player_id = %d, want 0", started.OwnSeat())
	}
	if started.State == nil {
		t.Fatal("game_started carried no state")
	}
	if len(started.State.Hand) != 8 {
		t.Errorf("hand = %d cards, want 8", len(started.State.Hand))
	}
	if len(started.State.Players) != 2 {
		t.Fatalf("players = %d, want 2", len(started.State.Players))
	}
	if started.State.Players[0].Nickname != "Alice" {
		t.Errorf("seat 0 = %q, want Alice", started.State.Players[0].Nickname)
	}
	if !started.State.Players[1].IsBot {
		t.Error("seat 1 is not marked as a bot")
	}
	// One round, like the queue's: the entry promises a hand now.
	if started.State.MatchFormat != "BO1" {
		t.Errorf("match_format = %q, want BO1", started.State.MatchFormat)
	}
	if started.State.MaxPlayers != 2 {
		t.Errorf("max_players = %d, want 2", started.State.MaxPlayers)
	}

	// And the table is shut behind the map gate like every other match: the
	// clock starts at match_ready, not here.
	readMsgOfType(t, conn, protocol.SMsgMatchLoading)
}

// The table has no host, exactly like a matchmade one: nothing to configure,
// nobody to configure it for, and nobody with standing to remove the other seat.
func TestPlayBot_HostControlsAreRefused(t *testing.T) {
	_, srv := newTestHub(t)
	conn := dialWS(t, srv)
	t.Cleanup(func() { conn.Close() })
	playBot(t, conn, "Alice")
	readMsgOfType(t, conn, protocol.SMsgMatchLoading)

	for _, msg := range []protocol.ClientMsg{
		{Type: protocol.CMsgAddBot},
		{Type: protocol.CMsgStartGame},
		{Type: protocol.CMsgSetMatchFormat, MatchFormat: "BO7"},
		{Type: protocol.CMsgSetMaxPlayers, MaxPlayers: 4},
		{Type: protocol.CMsgKickPlayer, TargetIndex: intPtrTest(1)},
		{Type: protocol.CMsgTransferHost, TargetIndex: intPtrTest(1)},
	} {
		sendMsg(t, conn, msg)
		got := readMsgOfType(t, conn, protocol.SMsgError)
		if got.Error != "not available in this game" {
			t.Errorf("%s: error = %q, want the hostless refusal", msg.Type, got.Error)
		}
	}
}

// Leaving a solo game costs nobody anything: there is no one to walk out on and
// nothing to award the match to, so the seat goes and the table goes with it.
func TestPlayBot_LeavingTakesTheTableWithIt(t *testing.T) {
	_, srv := newTestHub(t)
	conn := dialWS(t, srv)
	t.Cleanup(func() { conn.Close() })

	started := playBot(t, conn, "Alice")
	readMsgOfType(t, conn, protocol.SMsgMatchLoading)
	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgMapReady})
	readMsgOfType(t, conn, protocol.SMsgMatchReady)

	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgLeaveRoom})
	readMsgOfType(t, conn, protocol.SMsgLeftRoom)

	if !roomGone(t, srv, started.RoomCode) {
		t.Error("the solo table outlived the only player at it")
	}
}

// A rematch is an ask in every room but this one. Here the ask has no addressee:
// the other seat is the server. Another game is another play_bot, which is what
// the game-over screen sends.
func TestPlayBot_RematchIsRefusedAndAnotherPressDealsAgain(t *testing.T) {
	_, srv := newTestHub(t)
	conn := dialWS(t, srv)
	t.Cleanup(func() { conn.Close() })

	first := playBot(t, conn, "Alice")
	readMsgOfType(t, conn, protocol.SMsgMatchLoading)
	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgMapReady})
	readMsgOfType(t, conn, protocol.SMsgMatchReady)

	winSoloMatch(t, conn)

	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgRematch})
	if got := readMsgOfType(t, conn, protocol.SMsgError); got.Error != "not available in this game" {
		t.Errorf("rematch: error = %q, want the hostless refusal", got.Error)
	}

	// The button that *is* offered: another press, another table, another hand.
	second := playBot(t, conn, "Alice")
	if second.RoomCode == first.RoomCode {
		t.Errorf("the second game reused the first table (%s)", second.RoomCode)
	}
	if second.State == nil || len(second.State.Hand) != 8 {
		t.Error("the second game was not dealt a fresh hand")
	}
}

// The property the E2E suite depends on: this mode is not the queue.
func TestPlayBot_NeverTouchesTheMatchmakingQueue(t *testing.T) {
	_, srv := newTestHub(t)
	conn := dialWS(t, srv)
	t.Cleanup(func() { conn.Close() })

	before := readMetrics(t, srv.URL)
	playBot(t, conn, "Alice")
	readMsgOfType(t, conn, protocol.SMsgMatchLoading)
	after := readMetrics(t, srv.URL)

	if after.MatchmakingQueue != 0 || before.MatchmakingQueue != 0 {
		t.Errorf("matchmaking_queue moved: %d -> %d", before.MatchmakingQueue, after.MatchmakingQueue)
	}
	if after.MatchesMatchmade != before.MatchesMatchmade {
		t.Errorf("matches_matchmade moved: %d -> %d", before.MatchesMatchmade, after.MatchesMatchmade)
	}
	if after.MatchesSolo != before.MatchesSolo+1 {
		t.Errorf("matches_solo = %d, want %d", after.MatchesSolo, before.MatchesSolo+1)
	}
}

// --- helpers -------------------------------------------------------------

// metricsShape is the handful of counters these tests read. Declared here rather
// than reaching for hub.Metrics so the test reads the JSON an operator reads.
type metricsShape struct {
	MatchmakingQueue int32 `json:"matchmaking_queue"`
	MatchesMatchmade int32 `json:"matches_matchmade"`
	MatchesSolo      int32 `json:"matches_solo"`
}

func readMetrics(t *testing.T, base string) metricsShape {
	t.Helper()
	resp, err := http.Get(base + "/metrics")
	if err != nil {
		t.Fatalf("GET /metrics: %v", err)
	}
	defer resp.Body.Close()
	var m metricsShape
	if err := json.NewDecoder(resp.Body).Decode(&m); err != nil {
		t.Fatalf("decode /metrics: %v", err)
	}
	return m
}

// winSoloMatch drives the human seat to a win, so the table reaches game over.
func winSoloMatch(t *testing.T, conn *websocket.Conn) {
	t.Helper()
	t.Setenv("LOCO_E2E", "1")
	winCard := protocol.CardDTO{Color: "red", Kind: "number", Value: 7}
	top := protocol.CardDTO{Color: "red", Kind: "number", Value: 7}
	zero, turnIdx := 0, 0
	sendMsg(t, conn, protocol.ClientMsg{
		Type: protocol.CMsgDebugSetState,
		Debug: &protocol.DebugStateDTO{
			Hand:        []protocol.CardDTO{winCard},
			Discard:     &top,
			PendingDraw: &zero,
			CurrentTurn: &turnIdx,
		},
	})
	readMsgOfType(t, conn, protocol.SMsgGameState)
	declareBeforeWinning(t, conn)
	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgPlayCard, Card: &winCard})
	readMsgOfType(t, conn, protocol.SMsgMatchEnd)
}
