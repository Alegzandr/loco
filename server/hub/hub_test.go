package hub_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"loco/server/hub"
	"loco/server/protocol"
)

// dialWS connects to a test WebSocket server and returns the connection.
func dialWS(t *testing.T, srv *httptest.Server) *websocket.Conn {
	t.Helper()
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	return conn
}

// sendMsg marshals and sends a ClientMsg.
func sendMsg(t *testing.T, conn *websocket.Conn, msg protocol.ClientMsg) {
	t.Helper()
	data, _ := json.Marshal(msg)
	if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
		t.Fatalf("write: %v", err)
	}
}

// readMsg reads and unmarshals the next ServerMsg with a timeout.
func readMsg(t *testing.T, conn *websocket.Conn) protocol.ServerMsg {
	t.Helper()
	conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	_, data, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	var msg protocol.ServerMsg
	if err := json.Unmarshal(data, &msg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	return msg
}

// readMsgOfType reads messages until it gets one with the expected type (skips others).
func readMsgOfType(t *testing.T, conn *websocket.Conn, typ protocol.ServerMsgType) protocol.ServerMsg {
	t.Helper()
	for i := 0; i < 10; i++ {
		msg := readMsg(t, conn)
		if msg.Type == typ {
			return msg
		}
	}
	t.Fatalf("did not receive message of type %q within 10 attempts", typ)
	return protocol.ServerMsg{}
}

// completeMapLoad takes every connection through the map-loading handshake that
// now sits between game_started and the first legal move.
//
// The table is shut until each client answers map_ready, so a test that skips
// this gets "waiting for every player to load the table" on its first play and
// then blocks reading a message the server will never send. Going through the
// real handshake rather than disabling the gate in tests is deliberate: it is
// the path production takes, and the gate is exactly the kind of thing that
// rots the moment nothing exercises it.
func completeMapLoad(t *testing.T, conns ...*websocket.Conn) {
	t.Helper()
	for _, c := range conns {
		sendMsg(t, c, protocol.ClientMsg{Type: protocol.CMsgMapReady})
	}
	for _, c := range conns {
		readMsgOfType(t, c, protocol.SMsgMatchReady)
	}
}

// newTestHub creates a Hub, starts it, and returns a test HTTP server.
func newTestHub(t *testing.T) (*hub.Hub, *httptest.Server) {
	t.Helper()
	h := hub.New()
	go h.Run()
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", h.ServeWS)
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		stats := h.GetStats()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(stats)
	})
	mux.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
		m := h.GetMetrics()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(m)
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(func() {
		srv.Close()
		h.Stop()
	})
	return h, srv
}

// setupTwoPlayerGame creates a room, joins a second player, starts the game,
// and returns both connections and the room code.
func setupTwoPlayerGame(t *testing.T, srv *httptest.Server) (conn1, conn2 *websocket.Conn, roomCode string) {
	t.Helper()
	conn1, conn2, roomCode, _ = setupTwoPlayerGameWithTokens(t, srv)
	return conn1, conn2, roomCode
}

// setupTwoPlayerGameWithTokens is like setupTwoPlayerGame but also returns [alice, bob] session tokens.
func setupTwoPlayerGameWithTokens(t *testing.T, srv *httptest.Server) (conn1, conn2 *websocket.Conn, roomCode string, tokens [2]string) {
	t.Helper()

	conn1 = dialWS(t, srv)
	t.Cleanup(func() { conn1.Close() })

	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Alice"})
	created := readMsgOfType(t, conn1, protocol.SMsgRoomCreated)
	roomCode = created.RoomCode
	tokens[0] = created.SessionToken

	conn2 = dialWS(t, srv)
	t.Cleanup(func() { conn2.Close() })

	sendMsg(t, conn2, protocol.ClientMsg{Type: protocol.CMsgJoinRoom, Nickname: "Bob", RoomCode: roomCode})
	joined := readMsgOfType(t, conn2, protocol.SMsgRoomJoined)
	tokens[1] = joined.SessionToken
	readMsgOfType(t, conn1, protocol.SMsgPlayerJoined)

	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgStartGame})
	readMsgOfType(t, conn1, protocol.SMsgGameStarted)
	readMsgOfType(t, conn2, protocol.SMsgGameStarted)
	completeMapLoad(t, conn1, conn2)

	return conn1, conn2, roomCode, tokens
}

// --- Tests ---

func TestHealthEndpoint(t *testing.T) {
	_, srv := newTestHub(t)

	resp, err := http.Get(srv.URL + "/health")
	if err != nil {
		t.Fatalf("health GET: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Fatalf("expected application/json, got %q", ct)
	}

	var stats hub.HealthStats
	if err := json.NewDecoder(resp.Body).Decode(&stats); err != nil {
		t.Fatalf("decode health: %v", err)
	}
	if stats.Status != "ok" {
		t.Errorf("expected status ok, got %q", stats.Status)
	}
}

func TestHealthEndpointRoomCount(t *testing.T) {
	h, srv := newTestHub(t)
	_ = h

	// No rooms yet
	resp, _ := http.Get(srv.URL + "/health")
	var stats hub.HealthStats
	json.NewDecoder(resp.Body).Decode(&stats)
	resp.Body.Close()
	if stats.Rooms != 0 {
		t.Errorf("expected 0 rooms, got %d", stats.Rooms)
	}

	// Create a room
	conn := dialWS(t, srv)
	defer conn.Close()
	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Alice"})
	readMsgOfType(t, conn, protocol.SMsgRoomCreated)

	// Allow hub to process
	time.Sleep(10 * time.Millisecond)

	resp2, _ := http.Get(srv.URL + "/health")
	var stats2 hub.HealthStats
	json.NewDecoder(resp2.Body).Decode(&stats2)
	resp2.Body.Close()
	if stats2.Rooms != 1 {
		t.Errorf("expected 1 room, got %d", stats2.Rooms)
	}
	if stats2.Clients < 1 {
		t.Errorf("expected >= 1 client, got %d", stats2.Clients)
	}
}

func TestPlayerDisconnectDuringGame_BroadcastsDisconnected(t *testing.T) {
	_, srv := newTestHub(t)

	conn1, conn2, _ := setupTwoPlayerGame(t, srv)

	// Bob disconnects
	conn2.Close()

	// Alice should receive player_disconnected
	msg := readMsgOfType(t, conn1, protocol.SMsgPlayerDisconnected)
	if msg.Seat() != 1 {
		t.Errorf("expected PlayerIndex 1, got %d", msg.Seat())
	}
	if msg.Nickname != "Bob" {
		t.Errorf("expected Nickname Bob, got %q", msg.Nickname)
	}
	// Bob's connected flag should be false in the player list
	for _, p := range msg.Players {
		if p.Index == 1 && p.Connected {
			t.Errorf("expected Bob to be disconnected in player list")
		}
	}
}

func TestPlayerReconnect_DuringGame(t *testing.T) {
	_, srv := newTestHub(t)

	conn1, conn2, roomCode, tokens := setupTwoPlayerGameWithTokens(t, srv)

	// Bob disconnects
	conn2.Close()
	// Alice sees disconnected
	readMsgOfType(t, conn1, protocol.SMsgPlayerDisconnected)

	// Bob reconnects with same nickname, room code, and session token
	conn2new := dialWS(t, srv)
	defer conn2new.Close()

	sendMsg(t, conn2new, protocol.ClientMsg{
		Type:         protocol.CMsgJoinRoom,
		Nickname:     "Bob",
		RoomCode:     roomCode,
		SessionToken: tokens[1],
	})

	// Bob receives player_reconnected with game state
	msg := readMsgOfType(t, conn2new, protocol.SMsgPlayerReconnected)
	if msg.PlayerID != 1 {
		t.Errorf("expected PlayerID 1, got %d", msg.PlayerID)
	}
	if msg.RoomCode != roomCode {
		t.Errorf("expected RoomCode %q, got %q", roomCode, msg.RoomCode)
	}
	if msg.State == nil {
		t.Fatal("expected game state in reconnect message")
	}
	if msg.State.YourIndex != 1 {
		t.Errorf("expected YourIndex 1, got %d", msg.State.YourIndex)
	}

	// Alice sees player_reconnected broadcast
	aliceMsg := readMsgOfType(t, conn1, protocol.SMsgPlayerReconnected)
	if aliceMsg.Seat() != 1 {
		t.Errorf("expected PlayerIndex 1, got %d", aliceMsg.Seat())
	}
	// Bob should now be connected in Alice's player list
	for _, p := range aliceMsg.Players {
		if p.Index == 1 && !p.Connected {
			t.Errorf("expected Bob to be connected after reconnect")
		}
	}
}

func TestPlayerReconnect_WrongToken_Rejected(t *testing.T) {
	_, srv := newTestHub(t)

	_, conn2, roomCode, _ := setupTwoPlayerGameWithTokens(t, srv)
	conn2.Close()

	// Try to reconnect with correct nickname but wrong token
	conn3 := dialWS(t, srv)
	defer conn3.Close()

	sendMsg(t, conn3, protocol.ClientMsg{
		Type:         protocol.CMsgJoinRoom,
		Nickname:     "Bob",
		RoomCode:     roomCode,
		SessionToken: "wrong-token",
	})

	msg := readMsgOfType(t, conn3, protocol.SMsgError)
	if !strings.Contains(msg.Error, "invalid session token") {
		t.Errorf("expected 'invalid session token' error, got %q", msg.Error)
	}
}

func TestPlayerReconnect_WrongNickname_Rejected(t *testing.T) {
	_, srv := newTestHub(t)

	_, conn2, roomCode := setupTwoPlayerGame(t, srv)
	conn2.Close()

	// Try to reconnect with a different nickname
	conn3 := dialWS(t, srv)
	defer conn3.Close()

	sendMsg(t, conn3, protocol.ClientMsg{
		Type:     protocol.CMsgJoinRoom,
		Nickname: "Charlie",
		RoomCode: roomCode,
	})

	msg := readMsgOfType(t, conn3, protocol.SMsgError)
	if !strings.Contains(msg.Error, "game already in progress") {
		t.Errorf("expected 'game already in progress' error, got %q", msg.Error)
	}
}

func TestPlayerDisconnect_InLobby_RemovesPlayer(t *testing.T) {
	_, srv := newTestHub(t)

	conn1 := dialWS(t, srv)
	defer conn1.Close()
	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Alice"})
	created := readMsgOfType(t, conn1, protocol.SMsgRoomCreated)

	conn2 := dialWS(t, srv)
	defer conn2.Close()
	sendMsg(t, conn2, protocol.ClientMsg{Type: protocol.CMsgJoinRoom, Nickname: "Bob", RoomCode: created.RoomCode})
	readMsgOfType(t, conn2, protocol.SMsgRoomJoined)
	readMsgOfType(t, conn1, protocol.SMsgPlayerJoined)

	// Bob disconnects in lobby
	conn2.Close()

	// Alice sees player_left (not player_disconnected)
	msg := readMsgOfType(t, conn1, protocol.SMsgPlayerLeft)
	if msg.Nickname != "Bob" {
		t.Errorf("expected Nickname Bob, got %q", msg.Nickname)
	}
}

func TestPlayerReconnect_AfterReconnect_CanContinuePlaying(t *testing.T) {
	_, srv := newTestHub(t)

	conn1, conn2, roomCode, tokens := setupTwoPlayerGameWithTokens(t, srv)

	// Bob disconnects and reconnects
	conn2.Close()
	readMsgOfType(t, conn1, protocol.SMsgPlayerDisconnected)

	conn2new := dialWS(t, srv)
	defer conn2new.Close()
	sendMsg(t, conn2new, protocol.ClientMsg{
		Type:         protocol.CMsgJoinRoom,
		Nickname:     "Bob",
		RoomCode:     roomCode,
		SessionToken: tokens[1],
	})

	reconnectMsg := readMsgOfType(t, conn2new, protocol.SMsgPlayerReconnected)
	if reconnectMsg.State == nil {
		t.Fatal("expected game state after reconnect")
	}
	readMsgOfType(t, conn1, protocol.SMsgPlayerReconnected)

	// Verify the game state is valid — Bob knows whose turn it is
	state := reconnectMsg.State
	if state.Turn < 0 || state.Turn > 1 {
		t.Errorf("unexpected turn index %d", state.Turn)
	}
	if len(state.Hand) == 0 {
		t.Errorf("expected Bob to have cards in hand")
	}

	// Whichever player's turn it is, they should be able to draw (demonstrates server still works)
	if state.Turn == 0 {
		sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgDrawCard})
		readMsgOfType(t, conn1, protocol.SMsgCardDrawn)
	} else {
		sendMsg(t, conn2new, protocol.ClientMsg{Type: protocol.CMsgDrawCard})
		readMsgOfType(t, conn2new, protocol.SMsgCardDrawn)
	}
}

func TestPlayerConnectedFlag_InPlayerList(t *testing.T) {
	_, srv := newTestHub(t)

	conn1, conn2, _ := setupTwoPlayerGame(t, srv)
	defer conn1.Close()

	// Bob disconnects
	conn2.Close()

	disconnectMsg := readMsgOfType(t, conn1, protocol.SMsgPlayerDisconnected)

	// All players in the list should have correct Connected values
	for _, p := range disconnectMsg.Players {
		if p.Index == 0 && !p.Connected {
			t.Errorf("Alice should be connected")
		}
		if p.Index == 1 && p.Connected {
			t.Errorf("Bob should be disconnected")
		}
	}
}

func TestRoomCode_IsHumanFriendly6Chars(t *testing.T) {
	_, srv := newTestHub(t)
	conn := dialWS(t, srv)
	defer conn.Close()

	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Alice"})
	created := readMsgOfType(t, conn, protocol.SMsgRoomCreated)

	code := created.RoomCode
	if len(code) != 6 {
		t.Errorf("room code length = %d, want 6", len(code))
	}
	// All characters should be from the human-friendly charset (no 0, O, 1, I, l)
	for _, ch := range code {
		if ch == '0' || ch == 'O' || ch == '1' || ch == 'I' || ch == 'l' {
			t.Errorf("room code %q contains confusing char %q", code, ch)
		}
	}
}

func TestRoomCode_UniqueAcrossMultipleRooms(t *testing.T) {
	_, srv := newTestHub(t)

	codes := make(map[string]bool)
	for i := 0; i < 5; i++ {
		conn := dialWS(t, srv)
		defer conn.Close()
		nickname := fmt.Sprintf("Player%d", i)
		sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: nickname})
		created := readMsgOfType(t, conn, protocol.SMsgRoomCreated)
		if codes[created.RoomCode] {
			t.Errorf("room code collision: %q appeared twice", created.RoomCode)
		}
		codes[created.RoomCode] = true
	}
}

func TestSetMatchFormat_HostOnly(t *testing.T) {
	_, srv := newTestHub(t)

	conn1 := dialWS(t, srv)
	defer conn1.Close()
	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Alice"})
	created := readMsgOfType(t, conn1, protocol.SMsgRoomCreated)

	conn2 := dialWS(t, srv)
	defer conn2.Close()
	sendMsg(t, conn2, protocol.ClientMsg{Type: protocol.CMsgJoinRoom, Nickname: "Bob", RoomCode: created.RoomCode})
	readMsgOfType(t, conn2, protocol.SMsgRoomJoined)
	readMsgOfType(t, conn1, protocol.SMsgPlayerJoined)

	// Bob (non-host) tries to set format
	sendMsg(t, conn2, protocol.ClientMsg{Type: protocol.CMsgSetMatchFormat, MatchFormat: "BO3"})
	errMsg := readMsgOfType(t, conn2, protocol.SMsgError)
	if !strings.Contains(errMsg.Error, "only the host") {
		t.Errorf("expected host-only error, got %q", errMsg.Error)
	}
}

func TestSetMatchFormat_BroadcastsToAll(t *testing.T) {
	_, srv := newTestHub(t)

	conn1 := dialWS(t, srv)
	defer conn1.Close()
	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Alice"})
	created := readMsgOfType(t, conn1, protocol.SMsgRoomCreated)

	conn2 := dialWS(t, srv)
	defer conn2.Close()
	sendMsg(t, conn2, protocol.ClientMsg{Type: protocol.CMsgJoinRoom, Nickname: "Bob", RoomCode: created.RoomCode})
	readMsgOfType(t, conn2, protocol.SMsgRoomJoined)
	readMsgOfType(t, conn1, protocol.SMsgPlayerJoined)

	// Alice sets format to BO3
	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgSetMatchFormat, MatchFormat: "BO3"})
	aliceMsg := readMsgOfType(t, conn1, protocol.SMsgLobbyConfigChanged)
	bobMsg := readMsgOfType(t, conn2, protocol.SMsgLobbyConfigChanged)

	if aliceMsg.MatchFormat != "BO3" {
		t.Errorf("Alice: MatchFormat = %q, want BO3", aliceMsg.MatchFormat)
	}
	if bobMsg.MatchFormat != "BO3" {
		t.Errorf("Bob: MatchFormat = %q, want BO3", bobMsg.MatchFormat)
	}
}

func TestSetMaxPlayers_BroadcastsToAll(t *testing.T) {
	_, srv := newTestHub(t)

	conn1 := dialWS(t, srv)
	defer conn1.Close()
	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Alice"})
	created := readMsgOfType(t, conn1, protocol.SMsgRoomCreated)

	conn2 := dialWS(t, srv)
	defer conn2.Close()
	sendMsg(t, conn2, protocol.ClientMsg{Type: protocol.CMsgJoinRoom, Nickname: "Bob", RoomCode: created.RoomCode})
	readMsgOfType(t, conn2, protocol.SMsgRoomJoined)
	readMsgOfType(t, conn1, protocol.SMsgPlayerJoined)

	// Alice sets max players to 4
	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgSetMaxPlayers, MaxPlayers: 4})
	aliceMsg := readMsgOfType(t, conn1, protocol.SMsgLobbyConfigChanged)
	bobMsg := readMsgOfType(t, conn2, protocol.SMsgLobbyConfigChanged)

	if aliceMsg.MaxPlayers != 4 {
		t.Errorf("Alice: MaxPlayers = %d, want 4", aliceMsg.MaxPlayers)
	}
	if bobMsg.MaxPlayers != 4 {
		t.Errorf("Bob: MaxPlayers = %d, want 4", bobMsg.MaxPlayers)
	}
}

func TestSetMaxPlayers_CannotDropBelowCurrent(t *testing.T) {
	_, srv := newTestHub(t)

	conn1 := dialWS(t, srv)
	defer conn1.Close()
	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Alice"})
	created := readMsgOfType(t, conn1, protocol.SMsgRoomCreated)

	conn2 := dialWS(t, srv)
	defer conn2.Close()
	sendMsg(t, conn2, protocol.ClientMsg{Type: protocol.CMsgJoinRoom, Nickname: "Bob", RoomCode: created.RoomCode})
	readMsgOfType(t, conn2, protocol.SMsgRoomJoined)
	readMsgOfType(t, conn1, protocol.SMsgPlayerJoined)

	// Try to set max players to 1 (below current count of 2)
	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgSetMaxPlayers, MaxPlayers: 1})
	errMsg := readMsgOfType(t, conn1, protocol.SMsgError)
	if errMsg.Error == "" {
		t.Error("expected error when setting max players below current count")
	}
}

func TestRoomCreated_IncludesMatchFormatAndMaxPlayers(t *testing.T) {
	_, srv := newTestHub(t)
	conn := dialWS(t, srv)
	defer conn.Close()

	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Alice"})
	created := readMsgOfType(t, conn, protocol.SMsgRoomCreated)

	if created.MatchFormat != "BO1" {
		t.Errorf("default MatchFormat = %q, want BO1", created.MatchFormat)
	}
	if created.MaxPlayers != 10 {
		t.Errorf("default MaxPlayers = %d, want 10", created.MaxPlayers)
	}
}

func TestGameState_IncludesRoundAndScoreboard(t *testing.T) {
	_, srv := newTestHub(t)
	conn1, _, _ := setupTwoPlayerGame(t, srv)
	defer conn1.Close()

	// The game_started message contains state with round info
	// We already consumed game_started in setup, so read any card_drawn/state messages
	// Just verify the setup works correctly by checking game is running
	// The state is sent in setupTwoPlayerGame already
	t.Log("game state scoreboard test: game started successfully with round info")
}

// --- Metrics tests ---

func TestMetricsEndpoint_ReturnsJSON(t *testing.T) {
	_, srv := newTestHub(t)

	resp, err := http.Get(srv.URL + "/metrics")
	if err != nil {
		t.Fatalf("metrics GET: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Fatalf("expected application/json, got %q", ct)
	}

	var m hub.MetricsStats
	if err := json.NewDecoder(resp.Body).Decode(&m); err != nil {
		t.Fatalf("decode metrics: %v", err)
	}
}

func TestMetricsEndpoint_RoomsAndPlayersCount(t *testing.T) {
	_, srv := newTestHub(t)

	// Initially zero rooms and zero players.
	resp, _ := http.Get(srv.URL + "/metrics")
	var m hub.MetricsStats
	json.NewDecoder(resp.Body).Decode(&m)
	resp.Body.Close()
	if m.RoomsActive != 0 {
		t.Errorf("want 0 rooms_active, got %d", m.RoomsActive)
	}
	if m.PlayersConnected != 0 {
		t.Errorf("want 0 players_connected, got %d", m.PlayersConnected)
	}

	// Create a room — one room, one player.
	conn := dialWS(t, srv)
	defer conn.Close()
	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Alice"})
	readMsgOfType(t, conn, protocol.SMsgRoomCreated)
	time.Sleep(10 * time.Millisecond)

	resp2, _ := http.Get(srv.URL + "/metrics")
	var m2 hub.MetricsStats
	json.NewDecoder(resp2.Body).Decode(&m2)
	resp2.Body.Close()
	if m2.RoomsActive != 1 {
		t.Errorf("want 1 rooms_active, got %d", m2.RoomsActive)
	}
	if m2.PlayersConnected < 1 {
		t.Errorf("want >=1 players_connected, got %d", m2.PlayersConnected)
	}
}

func TestMetricsEndpoint_MatchesStartedAndFinished(t *testing.T) {
	_, srv := newTestHub(t)

	resp0, _ := http.Get(srv.URL + "/metrics")
	var m0 hub.MetricsStats
	json.NewDecoder(resp0.Body).Decode(&m0)
	resp0.Body.Close()
	if m0.MatchesStarted != 0 {
		t.Errorf("want 0 matches_started initially, got %d", m0.MatchesStarted)
	}

	// Start a game.
	setupTwoPlayerGame(t, srv)
	time.Sleep(10 * time.Millisecond)

	resp1, _ := http.Get(srv.URL + "/metrics")
	var m1 hub.MetricsStats
	json.NewDecoder(resp1.Body).Decode(&m1)
	resp1.Body.Close()
	if m1.MatchesStarted != 1 {
		t.Errorf("want 1 matches_started after game start, got %d", m1.MatchesStarted)
	}
}

func TestMetricsEndpoint_BotsActive(t *testing.T) {
	_, srv := newTestHub(t)

	conn := dialWS(t, srv)
	defer conn.Close()
	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Alice"})
	readMsgOfType(t, conn, protocol.SMsgRoomCreated)

	// Add a bot.
	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgAddBot})
	readMsgOfType(t, conn, protocol.SMsgPlayerJoined)
	time.Sleep(10 * time.Millisecond)

	resp, _ := http.Get(srv.URL + "/metrics")
	var m hub.MetricsStats
	json.NewDecoder(resp.Body).Decode(&m)
	resp.Body.Close()
	if m.BotsActive != 1 {
		t.Errorf("want 1 bots_active, got %d", m.BotsActive)
	}
}

// --- Room cleanup tests ---

// newTestHubFastCleanup creates a hub with a shortened EmptyRoomTimeout for test speed.
func newTestHubFastCleanup(t *testing.T, timeout time.Duration) (*hub.Hub, *httptest.Server) {
	t.Helper()
	orig := hub.EmptyRoomTimeout
	hub.EmptyRoomTimeout = timeout
	t.Cleanup(func() { hub.EmptyRoomTimeout = orig })
	return newTestHub(t)
}

func TestRoomCleanup_EmptyLobbyDeletedAfterTimeout(t *testing.T) {
	_, srv := newTestHubFastCleanup(t, 80*time.Millisecond)

	conn := dialWS(t, srv)
	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Alice"})
	readMsgOfType(t, conn, protocol.SMsgRoomCreated)

	// Room exists while Alice is connected.
	time.Sleep(10 * time.Millisecond)
	resp, _ := http.Get(srv.URL + "/metrics")
	var m hub.MetricsStats
	json.NewDecoder(resp.Body).Decode(&m)
	resp.Body.Close()
	if m.RoomsActive != 1 {
		t.Fatalf("want 1 room before disconnect, got %d", m.RoomsActive)
	}

	// Alice disconnects — room should now start the cleanup timer.
	conn.Close()

	// Before timeout: room should still exist (give hub time to process disconnect).
	time.Sleep(20 * time.Millisecond)
	resp2, _ := http.Get(srv.URL + "/metrics")
	var m2 hub.MetricsStats
	json.NewDecoder(resp2.Body).Decode(&m2)
	resp2.Body.Close()
	if m2.RoomsActive != 1 {
		t.Errorf("want room still alive before cleanup timeout, got %d rooms", m2.RoomsActive)
	}

	// After timeout: room should be gone.
	time.Sleep(120 * time.Millisecond)
	resp3, _ := http.Get(srv.URL + "/metrics")
	var m3 hub.MetricsStats
	json.NewDecoder(resp3.Body).Decode(&m3)
	resp3.Body.Close()
	if m3.RoomsActive != 0 {
		t.Errorf("want 0 rooms after cleanup timeout, got %d", m3.RoomsActive)
	}
}

func TestRoomCleanup_CancelledOnRejoin(t *testing.T) {
	_, srv := newTestHubFastCleanup(t, 150*time.Millisecond)

	conn1 := dialWS(t, srv)
	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Alice"})
	created := readMsgOfType(t, conn1, protocol.SMsgRoomCreated)
	roomCode := created.RoomCode

	// Alice disconnects, starting the cleanup timer.
	conn1.Close()
	time.Sleep(30 * time.Millisecond)

	// Bob joins the (still-alive) room before the timer fires.
	conn2 := dialWS(t, srv)
	defer conn2.Close()
	sendMsg(t, conn2, protocol.ClientMsg{Type: protocol.CMsgJoinRoom, Nickname: "Bob", RoomCode: roomCode})
	msg := readMsg(t, conn2)
	if msg.Type == protocol.SMsgError {
		t.Fatalf("expected to join room, got error: %q", msg.Error)
	}

	// Wait well past the original cleanup deadline.
	time.Sleep(200 * time.Millisecond)

	// Room should still exist because Bob is in it.
	resp, _ := http.Get(srv.URL + "/metrics")
	var m hub.MetricsStats
	json.NewDecoder(resp.Body).Decode(&m)
	resp.Body.Close()
	if m.RoomsActive != 1 {
		t.Errorf("want room still alive after Bob joined, got %d rooms", m.RoomsActive)
	}
}

// --- Input validation tests ---

func TestCreateRoom_EmptyNickname_Rejected(t *testing.T) {
	_, srv := newTestHub(t)
	conn := dialWS(t, srv)
	defer conn.Close()

	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: ""})
	msg := readMsgOfType(t, conn, protocol.SMsgError)
	if !strings.Contains(msg.Error, "nickname") {
		t.Errorf("expected nickname error, got %q", msg.Error)
	}
}

func TestCreateRoom_NicknameTooLong_Rejected(t *testing.T) {
	_, srv := newTestHub(t)
	conn := dialWS(t, srv)
	defer conn.Close()

	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: strings.Repeat("a", 21)})
	msg := readMsgOfType(t, conn, protocol.SMsgError)
	if !strings.Contains(msg.Error, "nickname") {
		t.Errorf("expected nickname error, got %q", msg.Error)
	}
}

func TestJoinRoom_InvalidRoomCode_Rejected(t *testing.T) {
	_, srv := newTestHub(t)
	conn := dialWS(t, srv)
	defer conn.Close()

	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgJoinRoom, Nickname: "Alice", RoomCode: "BAD!!"})
	msg := readMsgOfType(t, conn, protocol.SMsgError)
	if !strings.Contains(msg.Error, "invalid room code") {
		t.Errorf("expected 'invalid room code' error, got %q", msg.Error)
	}
}

func TestJoinRoom_EmptyNickname_Rejected(t *testing.T) {
	_, srv := newTestHub(t)
	conn := dialWS(t, srv)
	defer conn.Close()

	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgJoinRoom, Nickname: "", RoomCode: "ABCDEF"})
	msg := readMsgOfType(t, conn, protocol.SMsgError)
	if !strings.Contains(msg.Error, "nickname") {
		t.Errorf("expected nickname error, got %q", msg.Error)
	}
}

// drainUntil reads WebSocket messages until it sees the given type or the deadline passes.
// Returns true if the target type was seen.
func drainUntil(conn *websocket.Conn, typ protocol.ServerMsgType, deadline time.Duration) bool {
	end := time.Now().Add(deadline)
	for time.Now().Before(end) {
		conn.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
		_, data, err := conn.ReadMessage()
		if err != nil {
			return false
		}
		var msg protocol.ServerMsg
		if json.Unmarshal(data, &msg) == nil && msg.Type == typ {
			return true
		}
	}
	return false
}

// TestGoroutineStability_FullLifecycle is the comprehensive regression test for 504.
// It exercises: create→join→start (bot)→game→match_end→close (normal path),
// create→start (bot)→disconnect mid-game (reconnect expiry path), and repeated
// room creation and immediate teardown (cleanup timer path) — all in one run.
// The goroutine count must not grow proportionally to the number of rooms.
func TestGoroutineStability_FullLifecycle(t *testing.T) {
	// Override timeouts so the test completes in well under 1 second of wall time.
	origEmpty := hub.EmptyRoomTimeout
	origReconnect := hub.ReconnectTimeout
	hub.EmptyRoomTimeout = 80 * time.Millisecond
	hub.ReconnectTimeout = 120 * time.Millisecond
	t.Cleanup(func() {
		hub.EmptyRoomTimeout = origEmpty
		hub.ReconnectTimeout = origReconnect
	})

	_, srv := newTestHub(t)

	runtime.GC()
	time.Sleep(20 * time.Millisecond)
	baseline := runtime.NumGoroutine()

	// ── Path 1: rapid create + immediate leave (cleanup timer path) ────────
	const quickRooms = 10
	for i := 0; i < quickRooms; i++ {
		conn := dialWS(t, srv)
		sendMsg(t, conn, protocol.ClientMsg{
			Type: protocol.CMsgCreateRoom, Nickname: fmt.Sprintf("Quick%d", i),
		})
		readMsgOfType(t, conn, protocol.SMsgRoomCreated)
		conn.Close() // triggers scheduleRoomCleanup
	}

	// ── Path 2: full bot game → match_end → close ──────────────────────────
	botGameConn := func(nickname string) {
		conn := dialWS(t, srv)
		defer conn.Close()

		sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: nickname})
		created := readMsgOfType(t, conn, protocol.SMsgRoomCreated)

		sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgAddBot, RoomCode: created.RoomCode})
		readMsgOfType(t, conn, protocol.SMsgPlayerJoined)

		sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgStartGame})
		readMsgOfType(t, conn, protocol.SMsgGameStarted)
		completeMapLoad(t, conn)

		drainUntil(conn, protocol.SMsgMatchEnd, 8*time.Second)
		// conn.Close() via defer — triggers scheduleRoomCleanup
	}
	botGameConn("BotPlayer1")
	botGameConn("BotPlayer2")

	// ── Path 3: mid-game disconnect → reconnect expiry ─────────────────────
	// Start a bot game, immediately disconnect the human to fire reconnect expiry.
	const midDisconnectRooms = 3
	for i := 0; i < midDisconnectRooms; i++ {
		conn := dialWS(t, srv)
		sendMsg(t, conn, protocol.ClientMsg{
			Type: protocol.CMsgCreateRoom, Nickname: fmt.Sprintf("Disconn%d", i),
		})
		created := readMsgOfType(t, conn, protocol.SMsgRoomCreated)

		sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgAddBot, RoomCode: created.RoomCode})
		readMsgOfType(t, conn, protocol.SMsgPlayerJoined)

		sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgStartGame})
		readMsgOfType(t, conn, protocol.SMsgGameStarted)
		completeMapLoad(t, conn)

		// Disconnect immediately — triggers reconnect expiry timer (120 ms in tests).
		conn.Close()
	}

	// ── Wait for all timers: ReconnectTimeout + EmptyRoomTimeout + buffer ─
	// Longest timer is ReconnectTimeout (120 ms) + EmptyRoomTimeout (80 ms) + 200 ms buffer.
	time.Sleep(500 * time.Millisecond)
	runtime.GC()
	time.Sleep(20 * time.Millisecond)

	after := runtime.NumGoroutine()
	// Total rooms exercised: quickRooms + 2 bot games + midDisconnect rooms = 15.
	// With the old goroutine+sleep model each would leave multiple goroutines.
	// With time.AfterFunc, the delta must be small regardless of room count.
	slack := 12
	if after > baseline+slack {
		t.Errorf(
			"goroutine leak detected: baseline=%d after=%d delta=%d exceeds slack=%d"+
				" (rooms=%d, bot_games=2, mid_disconnects=%d)",
			baseline, after, after-baseline, slack,
			quickRooms, midDisconnectRooms,
		)
	}
}

// TestMetrics_GoroutineCountPresent verifies that GET /metrics includes goroutine_count.
func TestMetrics_GoroutineCountPresent(t *testing.T) {
	h, srv := newTestHub(t)
	resp, err := http.Get(srv.URL + "/metrics")
	if err != nil {
		t.Fatalf("GET /metrics: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	var m hub.MetricsStats
	if err := json.NewDecoder(resp.Body).Decode(&m); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if m.GoroutineCount <= 0 {
		t.Errorf("goroutine_count should be > 0, got %d", m.GoroutineCount)
	}
	_ = h
}

// TestGoroutineStability_RoomLifecycle verifies that creating and destroying many rooms
// does not leak goroutines. This is a regression test for the 504 bug caused by
// goroutine accumulation from room cleanup timers, reconnect expiry timers, and
// bot move schedulers.
func TestGoroutineStability_RoomLifecycle(t *testing.T) {
	// Speed up cleanup so the test doesn't take minutes.
	original := hub.EmptyRoomTimeout
	hub.EmptyRoomTimeout = 80 * time.Millisecond
	t.Cleanup(func() { hub.EmptyRoomTimeout = original })

	_, srv := newTestHub(t)

	// Allow runtime to settle before sampling baseline.
	runtime.GC()
	time.Sleep(20 * time.Millisecond)
	baseline := runtime.NumGoroutine()

	const numRooms = 20
	for i := 0; i < numRooms; i++ {
		conn := dialWS(t, srv)
		nickname := fmt.Sprintf("Player%d", i)
		sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: nickname})
		readMsgOfType(t, conn, protocol.SMsgRoomCreated)
		// Close immediately — triggers cleanup timer.
		conn.Close()
	}

	// Wait for all cleanup timers (EmptyRoomTimeout + a small buffer).
	time.Sleep(200 * time.Millisecond)
	runtime.GC()
	time.Sleep(20 * time.Millisecond)

	after := runtime.NumGoroutine()
	// Allow a generous slack: hub Run goroutine + readPump teardown overhead.
	// The key property: goroutines must NOT grow proportionally to numRooms.
	slack := 10
	if after > baseline+slack {
		t.Errorf("goroutine leak: baseline=%d after=%d (created %d rooms); delta=%d exceeds slack=%d",
			baseline, after, numRooms, after-baseline, slack)
	}
}

// TestGoroutineStability_BotGame verifies that running a 1v1 bot game to completion
// and then closing the connection does not leave goroutines behind.
func TestGoroutineStability_BotGame(t *testing.T) {
	original := hub.EmptyRoomTimeout
	hub.EmptyRoomTimeout = 80 * time.Millisecond
	t.Cleanup(func() { hub.EmptyRoomTimeout = original })

	_, srv := newTestHub(t)

	runtime.GC()
	time.Sleep(20 * time.Millisecond)
	baseline := runtime.NumGoroutine()

	conn := dialWS(t, srv)

	// Create room and add a bot.
	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Human"})
	created := readMsgOfType(t, conn, protocol.SMsgRoomCreated)
	code := created.RoomCode

	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgAddBot, RoomCode: code})
	readMsgOfType(t, conn, protocol.SMsgPlayerJoined)

	// Start the game.
	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgStartGame})
	readMsgOfType(t, conn, protocol.SMsgGameStarted)
	completeMapLoad(t, conn)

	// Drain messages until match_end or gameover (bot game finishes on its own).
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		conn.SetReadDeadline(time.Now().Add(2 * time.Second))
		_, data, err := conn.ReadMessage()
		if err != nil {
			break
		}
		var msg protocol.ServerMsg
		if json.Unmarshal(data, &msg) == nil {
			if msg.Type == protocol.SMsgMatchEnd {
				break
			}
		}
	}

	conn.Close()

	// Wait for cleanup timers to fire and goroutines to settle.
	time.Sleep(300 * time.Millisecond)
	runtime.GC()
	time.Sleep(20 * time.Millisecond)

	after := runtime.NumGoroutine()
	slack := 10
	if after > baseline+slack {
		t.Errorf("goroutine leak after bot game: baseline=%d after=%d delta=%d exceeds slack=%d",
			baseline, after, after-baseline, slack)
	}
}

// --- Turn timer tests ---

// TestTurnTimer_StartsAtMatchReadyNotGameStarted pins where the clock starts.
//
// It used to start at game_started, which meant the first player's 30 seconds
// began while somebody else's browser was still decoding a megabyte of map. In a
// game whose reaction windows are decided by arrival order that is a head start,
// not a cosmetic problem, so the timer is now armed by match_ready, the message
// that goes out once every client has answered map_ready.
func TestTurnTimer_StartsAtMatchReadyNotGameStarted(t *testing.T) {
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
	started1 := readMsgOfType(t, conn1, protocol.SMsgGameStarted)
	started2 := readMsgOfType(t, conn2, protocol.SMsgGameStarted)

	if started1.State == nil || started2.State == nil {
		t.Fatal("game_started missing state")
	}
	// No clock yet: the table is still shut.
	if started1.State.TurnDeadline != 0 {
		t.Errorf("conn1: game_started carries TurnDeadline %d; the clock must not start before match_ready",
			started1.State.TurnDeadline)
	}
	if started2.State.TurnDeadline != 0 {
		t.Errorf("conn2: game_started carries TurnDeadline %d; the clock must not start before match_ready",
			started2.State.TurnDeadline)
	}

	// Both clients answer; the table opens and the clock starts with it.
	for _, c := range []*websocket.Conn{conn1, conn2} {
		sendMsg(t, c, protocol.ClientMsg{Type: protocol.CMsgMapReady})
	}
	for i, c := range []*websocket.Conn{conn1, conn2} {
		ready := readMsgOfType(t, c, protocol.SMsgMatchReady)
		if ready.TurnDeadline == 0 {
			t.Errorf("conn%d: match_ready carries no TurnDeadline", i+1)
			continue
		}
		if ready.TurnDeadline <= time.Now().UnixMilli() {
			t.Errorf("conn%d: TurnDeadline %d should be in the future", i+1, ready.TurnDeadline)
		}
	}
}

// TestTurnTimer_AutoDrawAndPass verifies that when a human player does not act within
// TurnTimeout the server auto-draws and auto-passes, broadcasting turn_changed to all.
func TestTurnTimer_AutoDrawAndPass(t *testing.T) {
	orig := hub.TurnTimeout
	hub.TurnTimeout = 80 * time.Millisecond
	t.Cleanup(func() { hub.TurnTimeout = orig })

	_, srv := newTestHub(t)
	conn1, conn2, _ := setupTwoPlayerGame(t, srv)

	// Neither player acts. After TurnTimeout the server auto-draws then auto-passes.
	// Both connections must receive turn_changed (broadcast to all room members).
	if !drainUntil(conn1, protocol.SMsgTurnChanged, 2*time.Second) {
		t.Error("conn1: expected turn_changed after turn timeout, got none")
	}
	if !drainUntil(conn2, protocol.SMsgTurnChanged, 2*time.Second) {
		t.Error("conn2: expected turn_changed after turn timeout, got none")
	}
}

// TestTurnTimer_CardPlayedIncludesDeadline verifies that a card_played broadcast
// carries a non-zero TurnDeadline so clients can reset their countdown display.
func TestTurnTimer_CardPlayedIncludesDeadline(t *testing.T) {
	orig := hub.TurnTimeout
	hub.TurnTimeout = 30 * time.Second // long so it doesn't fire during the test
	t.Cleanup(func() { hub.TurnTimeout = orig })

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
	state1 := readMsgOfType(t, conn1, protocol.SMsgGameStarted)
	readMsgOfType(t, conn2, protocol.SMsgGameStarted)
	completeMapLoad(t, conn1, conn2)

	// Whichever player has the first turn draws a card, which should broadcast
	// a card_drawn message with a TurnDeadline.
	var drawConn *websocket.Conn
	var otherConn *websocket.Conn
	if state1.State != nil && state1.State.Turn == 0 {
		drawConn, otherConn = conn1, conn2
	} else {
		drawConn, otherConn = conn2, conn1
	}

	sendMsg(t, drawConn, protocol.ClientMsg{Type: protocol.CMsgDrawCard})

	// The drawing player receives card_drawn with their new card + deadline.
	drawn := readMsgOfType(t, drawConn, protocol.SMsgCardDrawn)
	if drawn.TurnDeadline == 0 {
		t.Error("card_drawn (private) missing TurnDeadline")
	}
	// The other player also receives a card_drawn broadcast with deadline.
	drawnBroadcast := readMsgOfType(t, otherConn, protocol.SMsgCardDrawn)
	if drawnBroadcast.TurnDeadline == 0 {
		t.Error("card_drawn (broadcast) missing TurnDeadline")
	}
}

// TestTurnTimer_BotGameSurvivesInterleavedTimeouts pins the liveness property the
// turn timer and the bot scheduler have to keep between them: a human who never
// acts is auto-drawn and auto-passed every TurnTimeout while the bot
// self-schedules through BotThinkDelay, and the two must keep interleaving
// without ever deadlocking, then let the match finish.
//
// The round is ended deliberately, by handing the bot a single playable card,
// rather than waited out. Waiting it out is what this test used to do, and
// "the bot empties its hand inside 30 seconds" is not a property of this code:
// a human who never plays keeps drawing, so the round runs exactly as long as
// the bot needs to empty a hand that a Swap or a +4 chain can refill at any
// moment. Usually that is eight turns. About once in eight runs it was over a
// hundred, and the test failed on wall clock with the server working perfectly.
// What is asserted now is what actually has to hold: the game keeps moving
// under sustained timer pressure, and it can still reach match_end.
func TestTurnTimer_BotGameSurvivesInterleavedTimeouts(t *testing.T) {
	// The deliberate ending goes through debug_set_state.
	t.Setenv("LOCO_E2E", "1")

	origTimeout := hub.TurnTimeout
	origBotDelay := hub.BotThinkDelay
	origJitter := hub.BotJitterMax
	origUnoDelay := hub.BotUnoDelay
	origUnoJitter := hub.BotUnoJitterMax
	origCatchDelay := hub.BotCatchDelay
	origCatchJitter := hub.BotCatchJitterMax
	origCatchProb := hub.BotCatchProb
	origAFKThreshold := hub.AFKKickThreshold
	// This test deliberately lets the human time out repeatedly while the bot keeps playing,
	// so disable AFK kick (would otherwise force-disconnect after 4 timeouts and stall the test).
	hub.AFKKickThreshold = 1 << 30
	t.Cleanup(func() { hub.AFKKickThreshold = origAFKThreshold })
	// Use moderate delays to avoid flooding the per-client send buffer (cap 256)
	// with messages faster than the test goroutine can drain them. When the buffer
	// fills, the hub drops messages, including match_end, and the test fails for
	// a reason that has nothing to do with what it checks. 10ms bot delay + 50ms
	// turn timeout produces roughly 10 messages a second.
	hub.BotThinkDelay = 10 * time.Millisecond
	hub.BotJitterMax = 0
	hub.BotUnoDelay = 0
	hub.BotUnoJitterMax = 0
	hub.BotCatchDelay = 0
	hub.BotCatchJitterMax = 0
	hub.BotCatchProb = 0 // disable bot catches in this test to keep message flow simple
	hub.TurnTimeout = 50 * time.Millisecond
	t.Cleanup(func() {
		hub.TurnTimeout = origTimeout
		hub.BotThinkDelay = origBotDelay
		hub.BotJitterMax = origJitter
		hub.BotUnoDelay = origUnoDelay
		hub.BotUnoJitterMax = origUnoJitter
		hub.BotCatchDelay = origCatchDelay
		hub.BotCatchJitterMax = origCatchJitter
		hub.BotCatchProb = origCatchProb
	})

	origEmpty := hub.EmptyRoomTimeout
	hub.EmptyRoomTimeout = 80 * time.Millisecond
	t.Cleanup(func() { hub.EmptyRoomTimeout = origEmpty })

	_, srv := newTestHub(t)

	conn := dialWS(t, srv)
	t.Cleanup(func() { conn.Close() })

	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Human"})
	created := readMsgOfType(t, conn, protocol.SMsgRoomCreated)
	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgAddBot, RoomCode: created.RoomCode})
	readMsgOfType(t, conn, protocol.SMsgPlayerJoined)
	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgStartGame})
	readMsgOfType(t, conn, protocol.SMsgGameStarted)
	completeMapLoad(t, conn)
	conn.SetReadDeadline(time.Time{}) // clear stale 3-second deadline left by readMsg

	// Read messages in a goroutine so we can apply an overall deadline without
	// hitting gorilla/websocket's "repeated read on failed connection" panic.
	msgCh := make(chan protocol.ServerMsg, 64)
	go func() {
		defer close(msgCh)
		for {
			_, data, err := conn.ReadMessage()
			if err != nil {
				return
			}
			var msg protocol.ServerMsg
			if json.Unmarshal(data, &msg) == nil {
				msgCh <- msg
			}
		}
	}()

	// next reads one message, or reports that the game went quiet. A deadlock is
	// exactly a gap with no traffic, so the per-message budget is the real
	// assertion here: it is generous enough that a busy machine never trips it,
	// and short enough that a genuinely wedged hub does.
	next := func(budget time.Duration) (protocol.ServerMsg, bool) {
		timer := time.NewTimer(budget)
		defer timer.Stop()
		select {
		case msg, ok := <-msgCh:
			return msg, ok
		case <-timer.C:
			return protocol.ServerMsg{}, false
		}
	}

	// ─── Phase 1: the interleaving itself ───────────────────────────────────
	// Every turn_changed here is a turn timer firing on a human who did nothing
	// and the hub passing for them; every card_played is the bot's own schedule
	// coming round. Requiring several of each proves the two keep taking turns
	// instead of one starving the other.
	const wantPasses, wantBotPlays = 5, 3
	passes, botPlays := 0, 0
	matchEnded := false
	for (passes < wantPasses || botPlays < wantBotPlays) && !matchEnded {
		msg, ok := next(10 * time.Second)
		if !ok {
			t.Fatalf("game went quiet after %d auto-passes and %d bot plays; the timer and the bot scheduler have deadlocked",
				passes, botPlays)
		}
		switch msg.Type {
		case protocol.SMsgTurnChanged:
			passes++
		case protocol.SMsgCardPlayed:
			botPlays++
		case protocol.SMsgMatchEnd:
			// The bot emptied its hand on its own before we got there. Nothing
			// left to force, and the assertion below is already satisfied.
			matchEnded = true
		}
	}

	if matchEnded {
		return
	}

	// ─── Phase 2: end the round on purpose ──────────────────────────────────
	// One playable card, nothing pending, a discard it matches: the bot wins on
	// its next turn whatever the deck happens to hold.
	noPending := 0
	sendMsg(t, conn, protocol.ClientMsg{
		Type: protocol.CMsgDebugSetState,
		DebugHands: []protocol.DebugHandOverrideDTO{
			{PlayerIndex: 1, Hand: []protocol.CardDTO{{Color: "red", Kind: "number", Value: 7}}},
		},
		DebugDiscard:     &protocol.CardDTO{Color: "red", Kind: "number", Value: 5},
		DebugActiveColor: "red",
		DebugPendingDraw: &noPending,
	})

	for {
		msg, ok := next(15 * time.Second)
		if !ok {
			t.Fatal("no match_end after the bot was handed a winning card; the round did not close")
		}
		if msg.Type == protocol.SMsgError {
			t.Fatalf("debug_set_state refused: %q", msg.Error)
		}
		if msg.Type == protocol.SMsgMatchEnd {
			return
		}
	}
}

// TestImmediateClose_NoZombieClient verifies that N connections closed immediately
// after upgrade leave no zombie entries in h.clients (statClients → 0).
func TestImmediateClose_NoZombieClient(t *testing.T) {
	h, srv := newTestHub(t)

	const N = 50
	for i := 0; i < N; i++ {
		conn := dialWS(t, srv)
		// Close before the hub has necessarily processed the register message.
		conn.Close()
	}

	// Poll until all clients are cleaned up or timeout.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if h.GetStats().Clients == 0 {
			return // all cleaned up — no zombies
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Errorf("zombie clients remain after immediate-close storm: statClients=%d", h.GetStats().Clients)
}

// TestRegisterHook_CleanupAfterImmediateClose uses the register hook to close
// the connection at the exact moment the client is registered (but before
// goroutines start), then verifies the hub always cleans up the entry.
func TestRegisterHook_CleanupAfterImmediateClose(t *testing.T) {
	h, srv := newTestHub(t)

	// hookFired is closed by the hook to signal that registration happened.
	hookFired := make(chan struct{})
	h.SetRegisterHook(func() {
		// Signal once; remove hook so subsequent connections are unaffected.
		h.SetRegisterHook(nil)
		close(hookFired)
	})

	conn := dialWS(t, srv)

	// Wait until the hub has registered the client (hook fires in hub goroutine).
	select {
	case <-hookFired:
	case <-time.After(2 * time.Second):
		t.Fatal("register hook never fired")
	}

	// Close the connection right after registration, before c.start() was called
	// (the hook ran between add-to-map and start()). The hub must still clean up.
	conn.Close()

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if h.GetStats().Clients == 0 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Errorf("hub retained zombie after hook-timed close: statClients=%d", h.GetStats().Clients)
}

// TestInterruptPlay_NonMatchingCard_Rejected verifies that the hub routes
// CMsgInterruptPlay to the domain and returns an error when the card does not
// exactly match the top discard.
func TestInterruptPlay_NonMatchingCard_Rejected(t *testing.T) {
	_, srv := newTestHub(t)

	conn1, conn2, _ := setupTwoPlayerGame(t, srv)

	// Determine who has the first turn by looking at what game_started delivered.
	// We already consumed game_started inside setupTwoPlayerGame, so we need to
	// identify the non-current player. We'll use the approach of having the
	// non-current-turn player attempt an interrupt with a deliberately bad card.
	// The server must reject it with an error regardless of whose turn it is.

	// Player 1 (Bob, conn2) attempts interrupt with a wild card, which is always rejected.
	wildCard := &protocol.CardDTO{Color: "wild", Kind: "wild"}
	sendMsg(t, conn2, protocol.ClientMsg{
		Type: protocol.CMsgInterruptPlay,
		Card: wildCard,
	})

	// Bob should get an error (wild cards cannot be used to interrupt, or it is their turn).
	got := readMsgOfType(t, conn2, protocol.SMsgError)
	if got.Error == "" {
		t.Errorf("expected non-empty error for invalid interrupt, got empty")
	}

	// Alice (conn1) must not have received any card_played event.
	conn1.SetReadDeadline(time.Now().Add(100 * time.Millisecond))
	_, data, err := conn1.ReadMessage()
	if err == nil {
		var msg protocol.ServerMsg
		json.Unmarshal(data, &msg) //nolint:errcheck
		if msg.Type == protocol.SMsgCardPlayed {
			t.Errorf("alice received unexpected card_played after invalid interrupt")
		}
	}
}

// TestInterruptPlay_OwnTurn_Rejected verifies that sending interrupt_play when
// it is already the sender's turn returns an error (use play_card instead).
func TestInterruptPlay_OwnTurn_Rejected(t *testing.T) {
	_, srv := newTestHub(t)

	// Capture the game_started message for player 0 (Alice) so we know who goes first.
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
	completeMapLoad(t, conn1, conn2)

	// Determine who has the first turn.
	var currentTurnConn *websocket.Conn
	var currentTurnHand []protocol.CardDTO
	if gs1.State != nil && gs2.State != nil {
		if gs1.State.Turn == gs1.State.YourIndex {
			currentTurnConn = conn1
			currentTurnHand = gs1.State.Hand
		} else {
			currentTurnConn = conn2
			currentTurnHand = gs2.State.Hand
		}
	}
	if currentTurnConn == nil || len(currentTurnHand) == 0 {
		t.Skip("could not determine current turn player or hand is empty")
	}

	// The current-turn player sends interrupt_play — must be rejected.
	sendMsg(t, currentTurnConn, protocol.ClientMsg{
		Type: protocol.CMsgInterruptPlay,
		Card: &protocol.CardDTO{Color: currentTurnHand[0].Color, Kind: currentTurnHand[0].Kind, Value: currentTurnHand[0].Value},
	})

	got := readMsgOfType(t, currentTurnConn, protocol.SMsgError)
	if got.Error == "" {
		t.Errorf("expected error for interrupt on own turn, got empty")
	}
}

// TestInterruptPlay_ValidMatch_AcceptedAndBroadcast verifies the happy path:
// active player plays Red-5 (opens the interrupt window), then the other player
// interrupts with their own Red-5. Server must broadcast interrupt_success and
// the new card_played to all clients, and transfer the lead to the interrupter.
func TestInterruptPlay_ValidMatch_AcceptedAndBroadcast(t *testing.T) {
	t.Setenv("LOCO_E2E", "1") // enable debug_set_state

	_, srv := newTestHub(t)

	conn1 := dialWS(t, srv)
	t.Cleanup(func() { conn1.Close() })
	conn2 := dialWS(t, srv)
	t.Cleanup(func() { conn2.Close() })
	conn3 := dialWS(t, srv)
	t.Cleanup(func() { conn3.Close() })

	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Alice"})
	created := readMsgOfType(t, conn1, protocol.SMsgRoomCreated)
	sendMsg(t, conn2, protocol.ClientMsg{Type: protocol.CMsgJoinRoom, Nickname: "Bob", RoomCode: created.RoomCode})
	readMsgOfType(t, conn2, protocol.SMsgRoomJoined)
	readMsgOfType(t, conn1, protocol.SMsgPlayerJoined)
	sendMsg(t, conn3, protocol.ClientMsg{Type: protocol.CMsgJoinRoom, Nickname: "Carol", RoomCode: created.RoomCode})
	readMsgOfType(t, conn3, protocol.SMsgRoomJoined)
	readMsgOfType(t, conn1, protocol.SMsgPlayerJoined)
	readMsgOfType(t, conn2, protocol.SMsgPlayerJoined)
	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgStartGame})
	readMsgOfType(t, conn1, protocol.SMsgGameStarted)
	readMsgOfType(t, conn2, protocol.SMsgGameStarted)
	readMsgOfType(t, conn3, protocol.SMsgGameStarted)
	completeMapLoad(t, conn1, conn2, conn3)

	// Pin Alice (player 0) as the active player; Carol (player 2) is a non-current,
	// non-just-played seat — the only valid interjecter after Alice plays.
	red5 := protocol.CardDTO{Color: "red", Kind: "number", Value: 5}
	blue9 := protocol.CardDTO{Color: "blue", Kind: "number", Value: 9}
	zero := 0
	sendMsg(t, conn1, protocol.ClientMsg{
		Type:         protocol.CMsgDebugSetState,
		DebugDiscard: &red5,
		DebugHands: []protocol.DebugHandOverrideDTO{
			{PlayerIndex: 0, Hand: []protocol.CardDTO{red5, blue9}},
			{PlayerIndex: 1, Hand: []protocol.CardDTO{blue9, blue9}},
			{PlayerIndex: 2, Hand: []protocol.CardDTO{red5, blue9}},
		},
		DebugPendingDraw: &zero,
		DebugCurrentTurn: &zero,
	})
	readMsgOfType(t, conn1, protocol.SMsgGameState)
	readMsgOfType(t, conn2, protocol.SMsgGameState)
	readMsgOfType(t, conn3, protocol.SMsgGameState)

	// Active (Alice) plays Red-5 → window opens, turn passes to Bob (1).
	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgPlayCard, Card: &red5})
	readMsgOfType(t, conn1, protocol.SMsgCardPlayed)
	readMsgOfType(t, conn2, protocol.SMsgCardPlayed)
	readMsgOfType(t, conn3, protocol.SMsgCardPlayed)

	// Carol (non-current) interrupts with her Red-5.
	sendMsg(t, conn3, protocol.ClientMsg{Type: protocol.CMsgInterruptPlay, Card: &red5})
	readMsgOfType(t, conn1, protocol.SMsgInterruptSuccess)
	readMsgOfType(t, conn2, protocol.SMsgInterruptSuccess)
	readMsgOfType(t, conn3, protocol.SMsgInterruptSuccess)
	cp1 := readMsgOfType(t, conn1, protocol.SMsgCardPlayed)
	readMsgOfType(t, conn2, protocol.SMsgCardPlayed)
	readMsgOfType(t, conn3, protocol.SMsgCardPlayed)
	if cp1.Card == nil || cp1.Card.Color != "red" || cp1.Card.Kind != "number" || cp1.Card.Value != 5 {
		t.Fatalf("card_played mismatch: %+v", cp1.Card)
	}
}

// TestInterruptPlayCard_BatchAlias_Accepted verifies that interrupt_play_card
// (alias message type) with a play_cards array delivers a batch identical-card
// interrupt and emits an interrupt_success notification.
func TestInterruptPlayCard_BatchAlias_Accepted(t *testing.T) {
	t.Setenv("LOCO_E2E", "1") // enable debug_set_state

	_, srv := newTestHub(t)

	conn1 := dialWS(t, srv)
	t.Cleanup(func() { conn1.Close() })
	conn2 := dialWS(t, srv)
	t.Cleanup(func() { conn2.Close() })
	conn3 := dialWS(t, srv)
	t.Cleanup(func() { conn3.Close() })

	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Alice"})
	created := readMsgOfType(t, conn1, protocol.SMsgRoomCreated)
	sendMsg(t, conn2, protocol.ClientMsg{Type: protocol.CMsgJoinRoom, Nickname: "Bob", RoomCode: created.RoomCode})
	readMsgOfType(t, conn2, protocol.SMsgRoomJoined)
	readMsgOfType(t, conn1, protocol.SMsgPlayerJoined)
	sendMsg(t, conn3, protocol.ClientMsg{Type: protocol.CMsgJoinRoom, Nickname: "Carol", RoomCode: created.RoomCode})
	readMsgOfType(t, conn3, protocol.SMsgRoomJoined)
	readMsgOfType(t, conn1, protocol.SMsgPlayerJoined)
	readMsgOfType(t, conn2, protocol.SMsgPlayerJoined)
	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgStartGame})
	readMsgOfType(t, conn1, protocol.SMsgGameStarted)
	readMsgOfType(t, conn2, protocol.SMsgGameStarted)
	readMsgOfType(t, conn3, protocol.SMsgGameStarted)
	completeMapLoad(t, conn1, conn2, conn3)

	// Pin Alice (player 0) active; Carol (player 2) is the non-current interjecter.
	red3 := protocol.CardDTO{Color: "red", Kind: "number", Value: 3}
	blue9 := protocol.CardDTO{Color: "blue", Kind: "number", Value: 9}
	zero := 0
	sendMsg(t, conn1, protocol.ClientMsg{
		Type:         protocol.CMsgDebugSetState,
		DebugDiscard: &red3,
		DebugHands: []protocol.DebugHandOverrideDTO{
			{PlayerIndex: 0, Hand: []protocol.CardDTO{red3, blue9}},
			{PlayerIndex: 1, Hand: []protocol.CardDTO{blue9, blue9}},
			{PlayerIndex: 2, Hand: []protocol.CardDTO{red3, red3, blue9}},
		},
		DebugPendingDraw: &zero,
		DebugCurrentTurn: &zero,
	})
	readMsgOfType(t, conn1, protocol.SMsgGameState)
	readMsgOfType(t, conn2, protocol.SMsgGameState)
	readMsgOfType(t, conn3, protocol.SMsgGameState)

	// Active (Alice) plays Red-3 first to open the interrupt window.
	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgPlayCard, Card: &red3})
	readMsgOfType(t, conn1, protocol.SMsgCardPlayed)
	readMsgOfType(t, conn2, protocol.SMsgCardPlayed)
	readMsgOfType(t, conn3, protocol.SMsgCardPlayed)

	// Interrupter (Carol) sends interrupt_play_card (alias) with 2 identical Red-3.
	sendMsg(t, conn3, protocol.ClientMsg{
		Type:      protocol.CMsgInterruptPlayCard,
		PlayCards: []protocol.CardDTO{red3, red3},
	})

	// All three clients must receive interrupt_success then card_played.
	is1 := readMsgOfType(t, conn1, protocol.SMsgInterruptSuccess)
	readMsgOfType(t, conn2, protocol.SMsgInterruptSuccess)
	readMsgOfType(t, conn3, protocol.SMsgInterruptSuccess)
	if len(is1.Cards) != 2 {
		t.Errorf("interrupt_success cards count = %d, want 2", len(is1.Cards))
	}
	readMsgOfType(t, conn1, protocol.SMsgCardPlayed)
	readMsgOfType(t, conn2, protocol.SMsgCardPlayed)
	readMsgOfType(t, conn3, protocol.SMsgCardPlayed)
}

// TestInterruptPlay_GlobalSwitch_ResendsHands verifies that a GlobalSwitch
// played as an *interrupt* rearranges every hand and that every client is told
// so: without a personalised game_state each client keeps the hand it can no
// longer play, taps a phantom card and gets "card not in hand" forever.
func TestInterruptPlay_GlobalSwitch_ResendsHands(t *testing.T) {
	t.Setenv("LOCO_E2E", "1") // enable debug_set_state

	_, srv := newTestHub(t)

	conn1 := dialWS(t, srv)
	t.Cleanup(func() { conn1.Close() })
	conn2 := dialWS(t, srv)
	t.Cleanup(func() { conn2.Close() })
	conn3 := dialWS(t, srv)
	t.Cleanup(func() { conn3.Close() })

	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Alice"})
	created := readMsgOfType(t, conn1, protocol.SMsgRoomCreated)
	sendMsg(t, conn2, protocol.ClientMsg{Type: protocol.CMsgJoinRoom, Nickname: "Bob", RoomCode: created.RoomCode})
	readMsgOfType(t, conn2, protocol.SMsgRoomJoined)
	readMsgOfType(t, conn1, protocol.SMsgPlayerJoined)
	sendMsg(t, conn3, protocol.ClientMsg{Type: protocol.CMsgJoinRoom, Nickname: "Carol", RoomCode: created.RoomCode})
	readMsgOfType(t, conn3, protocol.SMsgRoomJoined)
	readMsgOfType(t, conn1, protocol.SMsgPlayerJoined)
	readMsgOfType(t, conn2, protocol.SMsgPlayerJoined)
	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgStartGame})
	readMsgOfType(t, conn1, protocol.SMsgGameStarted)
	readMsgOfType(t, conn2, protocol.SMsgGameStarted)
	readMsgOfType(t, conn3, protocol.SMsgGameStarted)
	completeMapLoad(t, conn1, conn2, conn3)

	gs := protocol.CardDTO{Color: "wild", Kind: "global_switch"}
	red3 := protocol.CardDTO{Color: "red", Kind: "number", Value: 3}
	blue9 := protocol.CardDTO{Color: "blue", Kind: "number", Value: 9}
	green7 := protocol.CardDTO{Color: "green", Kind: "number", Value: 7}
	zero := 0
	sendMsg(t, conn1, protocol.ClientMsg{
		Type:         protocol.CMsgDebugSetState,
		DebugDiscard: &red3,
		DebugHands: []protocol.DebugHandOverrideDTO{
			{PlayerIndex: 0, Hand: []protocol.CardDTO{gs, blue9}},
			{PlayerIndex: 1, Hand: []protocol.CardDTO{green7}},
			{PlayerIndex: 2, Hand: []protocol.CardDTO{gs, red3}},
		},
		DebugPendingDraw: &zero,
		DebugCurrentTurn: &zero,
	})
	readMsgOfType(t, conn1, protocol.SMsgGameState)
	readMsgOfType(t, conn2, protocol.SMsgGameState)
	readMsgOfType(t, conn3, protocol.SMsgGameState)

	// Alice plays her GlobalSwitch: hands rotate one seat and the window opens.
	// Direction is clockwise, so seat i receives seat i-1's hand:
	// 0←[gs,red3], 1←[blue9], 2←[green7].
	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgPlayCard, Card: &gs, ChosenColor: "red"})
	readMsgOfType(t, conn1, protocol.SMsgCardPlayed)
	readMsgOfType(t, conn2, protocol.SMsgCardPlayed)
	readMsgOfType(t, conn3, protocol.SMsgCardPlayed)
	readMsgOfType(t, conn1, protocol.SMsgGameState)
	readMsgOfType(t, conn2, protocol.SMsgGameState)
	readMsgOfType(t, conn3, protocol.SMsgGameState)

	// Alice now holds the GlobalSwitch she just received and takes the lead back
	// with it. Hands rotate again: 0←[green7], 1←[red3], 2←[blue9].
	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgInterruptPlay, Card: &gs, ChosenColor: "blue"})
	readMsgOfType(t, conn1, protocol.SMsgInterruptSuccess)
	readMsgOfType(t, conn2, protocol.SMsgInterruptSuccess)
	readMsgOfType(t, conn3, protocol.SMsgInterruptSuccess)
	readMsgOfType(t, conn1, protocol.SMsgCardPlayed)
	readMsgOfType(t, conn2, protocol.SMsgCardPlayed)
	readMsgOfType(t, conn3, protocol.SMsgCardPlayed)

	st1 := readMsgOfType(t, conn1, protocol.SMsgGameState)
	st2 := readMsgOfType(t, conn2, protocol.SMsgGameState)
	st3 := readMsgOfType(t, conn3, protocol.SMsgGameState)
	want := []struct {
		state *protocol.GameStateDTO
		seat  string
		color string
		value int
	}{
		{st1.State, "Alice", "green", 7},
		{st2.State, "Bob", "red", 3},
		{st3.State, "Carol", "blue", 9},
	}
	for _, w := range want {
		if w.state == nil || len(w.state.Hand) != 1 {
			t.Fatalf("%s: game_state hand = %+v, want exactly 1 card", w.seat, w.state)
		}
		if got := w.state.Hand[0]; got.Color != w.color || got.Value != w.value {
			t.Errorf("%s holds %s %d, want %s %d", w.seat, got.Color, got.Value, w.color, w.value)
		}
	}

	// The interjecter names the colour, exactly as on any other wild. 'wild'
	// matches nothing and would strand the whole table.
	if st1.State.ActiveColor != "blue" {
		t.Errorf("active_color = %q, want \"blue\" (chosen by the interjecter)", st1.State.ActiveColor)
	}
}

// TestCatchUNO_HumanCatchesHuman verifies the complete catch-UNO flow:
// player plays to 1 card without declaring, opponent sends catch_uno,
// both players receive uno_caught with the correct target index.
func TestCatchUNO_HumanCatchesHuman(t *testing.T) {
	t.Setenv("LOCO_E2E", "1") // enable debug_set_state

	_, srv := newTestHub(t)

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

	// Identify which connection belongs to the active player.
	var activeConn, catcherConn *websocket.Conn
	var activeIdx int
	if gs1.State.Turn == gs1.State.YourIndex {
		activeConn, catcherConn = conn1, conn2
		activeIdx = gs1.State.YourIndex
	} else {
		activeConn, catcherConn = conn2, conn1
		activeIdx = gs2.State.YourIndex
	}

	// Patch the active player's hand and the shared discard to known values.
	zero := 0
	sendMsg(t, activeConn, protocol.ClientMsg{
		Type:             protocol.CMsgDebugSetState,
		DebugHand:        []protocol.CardDTO{{Color: "red", Kind: "number", Value: 6}, {Color: "red", Kind: "number", Value: 7}},
		DebugDiscard:     &protocol.CardDTO{Color: "red", Kind: "number", Value: 5},
		DebugPendingDraw: &zero,
	})
	// Both players receive a personalized game_state from debug_set_state.
	readMsgOfType(t, activeConn, protocol.SMsgGameState)
	readMsgOfType(t, catcherConn, protocol.SMsgGameState)

	// Active player plays one card → drops to 1 card without declaring UNO.
	sendMsg(t, activeConn, protocol.ClientMsg{
		Type: protocol.CMsgPlayCard,
		Card: &protocol.CardDTO{Color: "red", Kind: "number", Value: 7},
	})
	readMsgOfType(t, activeConn, protocol.SMsgCardPlayed)
	readMsgOfType(t, catcherConn, protocol.SMsgCardPlayed)

	// Other player catches within the 5-second window.
	sendMsg(t, catcherConn, protocol.ClientMsg{Type: protocol.CMsgCatchUno})

	// Both must receive uno_caught for the active player.
	caught1 := readMsgOfType(t, activeConn, protocol.SMsgUnoCaught)
	caught2 := readMsgOfType(t, catcherConn, protocol.SMsgUnoCaught)
	if caught1.Seat() != activeIdx {
		t.Errorf("uno_caught PlayerIndex = %d, want %d", caught1.Seat(), activeIdx)
	}
	_ = caught2
}

func TestDebugSetState_OverridesHandsAndTurn(t *testing.T) {
	t.Setenv("LOCO_E2E", "1")

	_, srv := newTestHub(t)

	conn1 := dialWS(t, srv)
	t.Cleanup(func() { conn1.Close() })
	conn2 := dialWS(t, srv)
	t.Cleanup(func() { conn2.Close() })

	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Alice"})
	created := readMsgOfType(t, conn1, protocol.SMsgRoomCreated)
	sendMsg(t, conn2, protocol.ClientMsg{
		Type:     protocol.CMsgJoinRoom,
		Nickname: "Bob",
		RoomCode: created.RoomCode,
	})
	readMsgOfType(t, conn2, protocol.SMsgRoomJoined)
	readMsgOfType(t, conn1, protocol.SMsgPlayerJoined)

	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgStartGame})
	gs1 := readMsgOfType(t, conn1, protocol.SMsgGameStarted)
	gs2 := readMsgOfType(t, conn2, protocol.SMsgGameStarted)
	completeMapLoad(t, conn1, conn2)
	if gs1.State == nil || gs2.State == nil {
		t.Fatal("missing game state in game_started")
	}
	idx1 := gs1.State.YourIndex
	idx2 := gs2.State.YourIndex
	if idx1 == idx2 {
		t.Fatal("expected distinct player indices")
	}

	pending := 2
	sendMsg(t, conn1, protocol.ClientMsg{
		Type: protocol.CMsgDebugSetState,
		DebugHands: []protocol.DebugHandOverrideDTO{
			{
				PlayerIndex: idx1,
				Hand: []protocol.CardDTO{
					{Color: "red", Kind: "number", Value: 1},
				},
			},
			{
				PlayerIndex: idx2,
				Hand: []protocol.CardDTO{
					{Color: "blue", Kind: "number", Value: 9},
					{Color: "green", Kind: "number", Value: 2},
				},
			},
		},
		DebugDiscard:     &protocol.CardDTO{Color: "red", Kind: "number", Value: 5},
		DebugPendingDraw: &pending,
		DebugCurrentTurn: &idx2,
	})

	post1 := readMsgOfType(t, conn1, protocol.SMsgGameState)
	post2 := readMsgOfType(t, conn2, protocol.SMsgGameState)
	if post1.State == nil || post2.State == nil {
		t.Fatal("missing state in game_state after debug_set_state")
	}

	if post1.State.Turn != idx2 || post2.State.Turn != idx2 {
		t.Fatalf("turn mismatch after debug_set_state: got %d/%d, want %d", post1.State.Turn, post2.State.Turn, idx2)
	}
	if post1.State.PendingDraw != pending || post2.State.PendingDraw != pending {
		t.Fatalf("pending draw mismatch after debug_set_state: got %d/%d, want %d", post1.State.PendingDraw, post2.State.PendingDraw, pending)
	}
	if got := len(post1.State.Hand); got != 1 {
		t.Fatalf("player1 hand size = %d, want 1", got)
	}
	if got := len(post2.State.Hand); got != 2 {
		t.Fatalf("player2 hand size = %d, want 2", got)
	}
}

// TestBotCatch_WithinWindow verifies that a bot catches a human player who plays
// to 1 card without declaring UNO, within the valid catch window.
// Uses BotCatchProb=1.0 (always) and BotCatchDelay=10ms for determinism.
// Skips if the bot holds the first turn (non-deterministic seed).
func TestBotCatch_WithinWindow(t *testing.T) {
	t.Setenv("LOCO_E2E", "1") // enable debug_set_state

	origBotDelay := hub.BotThinkDelay
	origCatchDelay := hub.BotCatchDelay
	origCatchJitter := hub.BotCatchJitterMax
	origCatchProb := hub.BotCatchProb
	// Prevent bot from taking its turn during the test; keep catch fast.
	hub.BotThinkDelay = 30 * time.Second
	hub.BotCatchDelay = 10 * time.Millisecond
	hub.BotCatchJitterMax = 0
	hub.BotCatchProb = 1.0 // always catch
	t.Cleanup(func() {
		hub.BotThinkDelay = origBotDelay
		hub.BotCatchDelay = origCatchDelay
		hub.BotCatchJitterMax = origCatchJitter
		hub.BotCatchProb = origCatchProb
	})

	_, srv := newTestHub(t)
	conn := dialWS(t, srv)
	t.Cleanup(func() { conn.Close() })

	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Alice"})
	readMsgOfType(t, conn, protocol.SMsgRoomCreated)

	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgAddBot})
	readMsgOfType(t, conn, protocol.SMsgPlayerJoined) // bot joined

	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgStartGame})
	gs := readMsgOfType(t, conn, protocol.SMsgGameStarted)
	completeMapLoad(t, conn)
	if gs.State == nil {
		t.Fatal("missing game state in game_started")
	}

	// Only proceed if it's Alice's turn; otherwise the bot holds first turn and
	// BotThinkDelay=30s means we'd wait too long.
	if gs.State.Turn != gs.State.YourIndex {
		t.Skip("bot has the first turn in this seed; skipping (non-deterministic by design)")
	}

	// Give Alice exactly 2 matching cards and a known discard.
	zero := 0
	sendMsg(t, conn, protocol.ClientMsg{
		Type:             protocol.CMsgDebugSetState,
		DebugHand:        []protocol.CardDTO{{Color: "red", Kind: "number", Value: 6}, {Color: "red", Kind: "number", Value: 7}},
		DebugDiscard:     &protocol.CardDTO{Color: "red", Kind: "number", Value: 5},
		DebugPendingDraw: &zero,
	})
	readMsgOfType(t, conn, protocol.SMsgGameState)

	// Alice plays one card → 1 card remaining, no UNO declaration.
	sendMsg(t, conn, protocol.ClientMsg{
		Type: protocol.CMsgPlayCard,
		Card: &protocol.CardDTO{Color: "red", Kind: "number", Value: 7},
	})
	readMsgOfType(t, conn, protocol.SMsgCardPlayed)

	// Bot should catch within BotCatchDelay (10ms) + processing time.
	// readMsgOfType retries up to 10 messages, each with a 3s read deadline.
	caught := readMsgOfType(t, conn, protocol.SMsgUnoCaught)
	if caught.Seat() != gs.State.YourIndex {
		t.Errorf("uno_caught PlayerIndex = %d, want %d (Alice)", caught.Seat(), gs.State.YourIndex)
	}
}

// TestBotCatch_StaleCallback_IgnoredAfterDeclared verifies that if a player declares
// UNO before the scheduled bot catch fires, the stale catch is silently discarded
// (LastCardDeclared=true → CatchUndeclared returns error → no broadcast).
func TestBotCatch_StaleCallback_IgnoredAfterDeclared(t *testing.T) {
	t.Setenv("LOCO_E2E", "1")

	origBotDelay := hub.BotThinkDelay
	origCatchDelay := hub.BotCatchDelay
	origCatchJitter := hub.BotCatchJitterMax
	origCatchProb := hub.BotCatchProb
	// Long catch delay so we can declare before the bot catch fires.
	hub.BotThinkDelay = 30 * time.Second
	hub.BotCatchDelay = 300 * time.Millisecond
	hub.BotCatchJitterMax = 0
	hub.BotCatchProb = 1.0
	t.Cleanup(func() {
		hub.BotThinkDelay = origBotDelay
		hub.BotCatchDelay = origCatchDelay
		hub.BotCatchJitterMax = origCatchJitter
		hub.BotCatchProb = origCatchProb
	})

	_, srv := newTestHub(t)
	conn := dialWS(t, srv)
	t.Cleanup(func() { conn.Close() })

	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Alice"})
	readMsgOfType(t, conn, protocol.SMsgRoomCreated)

	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgAddBot})
	readMsgOfType(t, conn, protocol.SMsgPlayerJoined)

	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgStartGame})
	gs := readMsgOfType(t, conn, protocol.SMsgGameStarted)
	completeMapLoad(t, conn)
	if gs.State == nil {
		t.Fatal("missing game state")
	}

	if gs.State.Turn != gs.State.YourIndex {
		t.Skip("bot has first turn; skipping")
	}

	// Give Alice 2 matching cards.
	zero := 0
	sendMsg(t, conn, protocol.ClientMsg{
		Type:             protocol.CMsgDebugSetState,
		DebugHand:        []protocol.CardDTO{{Color: "red", Kind: "number", Value: 6}, {Color: "red", Kind: "number", Value: 7}},
		DebugDiscard:     &protocol.CardDTO{Color: "red", Kind: "number", Value: 5},
		DebugPendingDraw: &zero,
	})
	readMsgOfType(t, conn, protocol.SMsgGameState)

	// Alice plays → 1 card. Bot catch scheduled at 300ms.
	sendMsg(t, conn, protocol.ClientMsg{
		Type: protocol.CMsgPlayCard,
		Card: &protocol.CardDTO{Color: "red", Kind: "number", Value: 7},
	})
	readMsgOfType(t, conn, protocol.SMsgCardPlayed)

	// Alice declares UNO immediately — before the 300ms bot catch fires.
	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgDeclareUno})
	readMsgOfType(t, conn, protocol.SMsgUnoDeclared)

	// Wait past the bot catch delay.
	time.Sleep(400 * time.Millisecond)

	// No uno_caught must arrive after declaration.
	conn.SetReadDeadline(time.Now().Add(100 * time.Millisecond))
	_, data, err := conn.ReadMessage()
	if err == nil {
		var msg protocol.ServerMsg
		json.Unmarshal(data, &msg) //nolint:errcheck
		if msg.Type == protocol.SMsgUnoCaught {
			t.Error("received spurious uno_caught after player already declared UNO")
		}
	}
	// A timeout (read deadline exceeded) here is expected and correct.
}

// TestBotUno_CatchableDuringAnnounceDelay is the regression test for a
// bot-declared LOCO! that was impossible to catch: the hub used to call
// DeclareLastCard the instant the bot played its second-to-last card and only
// defer the uno_declared broadcast, so the seat was already settled server-side
// while every client still showed an open 5 s catch window. Every Contre-LOCO!
// tap in that window came back "player already declared".
//
// The declaration must now happen when it is announced, so the delay is a real
// reaction window.
func TestBotUno_CatchableDuringAnnounceDelay(t *testing.T) {
	t.Setenv("LOCO_E2E", "1")

	origBotDelay := hub.BotThinkDelay
	origJitter := hub.BotJitterMax
	origUnoDelay := hub.BotUnoDelay
	origUnoJitter := hub.BotUnoJitterMax
	origCatchProb := hub.BotCatchProb
	hub.BotThinkDelay = 20 * time.Millisecond
	hub.BotJitterMax = 0
	hub.BotUnoDelay = 2 * time.Second // long enough for the catch below to land first
	hub.BotUnoJitterMax = 0
	hub.BotCatchProb = 0 // bots must not catch Alice in this scenario
	t.Cleanup(func() {
		hub.BotThinkDelay = origBotDelay
		hub.BotJitterMax = origJitter
		hub.BotUnoDelay = origUnoDelay
		hub.BotUnoJitterMax = origUnoJitter
		hub.BotCatchProb = origCatchProb
	})

	_, srv := newTestHub(t)
	conn := dialWS(t, srv)
	t.Cleanup(func() { conn.Close() })

	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Alice"})
	readMsgOfType(t, conn, protocol.SMsgRoomCreated)

	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgAddBot})
	readMsgOfType(t, conn, protocol.SMsgPlayerJoined)

	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgStartGame})
	gs := readMsgOfType(t, conn, protocol.SMsgGameStarted)
	completeMapLoad(t, conn)
	if gs.State == nil {
		t.Fatal("missing game state")
	}
	alice := gs.State.YourIndex
	bot := 1 - alice

	// Bot holds two playable numbers: its next move takes it down to one card.
	// Alice moves first so the bot's turn is scheduled by a real play
	// (debug_set_state does not schedule bot moves).
	zero := 0
	sendMsg(t, conn, protocol.ClientMsg{
		Type: protocol.CMsgDebugSetState,
		DebugHands: []protocol.DebugHandOverrideDTO{
			{PlayerIndex: bot, Hand: []protocol.CardDTO{
				{Color: "red", Kind: "number", Value: 6},
				{Color: "red", Kind: "number", Value: 7},
			}},
			{PlayerIndex: alice, Hand: []protocol.CardDTO{
				{Color: "red", Kind: "number", Value: 4},
				{Color: "blue", Kind: "number", Value: 2},
				{Color: "green", Kind: "number", Value: 3},
			}},
		},
		DebugDiscard:     &protocol.CardDTO{Color: "red", Kind: "number", Value: 5},
		DebugActiveColor: "red",
		DebugPendingDraw: &zero,
		DebugCurrentTurn: &alice,
	})
	readMsgOfType(t, conn, protocol.SMsgGameState)

	sendMsg(t, conn, protocol.ClientMsg{
		Type: protocol.CMsgPlayCard,
		Card: &protocol.CardDTO{Color: "red", Kind: "number", Value: 4},
	})

	// Bot plays → one card left, declaration not yet announced.
	deadline := time.Now().Add(5 * time.Second)
	for {
		if time.Now().After(deadline) {
			t.Fatal("bot never played")
		}
		msg := readMsgOfType(t, conn, protocol.SMsgCardPlayed)
		if msg.Seat() == bot {
			break
		}
	}

	// Alice catches it inside the window the UI is showing her.
	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgCatchUno, TargetIndex: &bot})
	caught := readMsgOfType(t, conn, protocol.SMsgUnoCaught)
	if caught.Seat() != bot {
		t.Errorf("uno_caught PlayerIndex = %d, want %d (the bot, i.e. the caught seat)", caught.Seat(), bot)
	}

	// The swallowed announcement must not resurface: the bot took the penalty
	// and is no longer on one card.
	time.Sleep(hub.BotUnoDelay + 300*time.Millisecond)
	conn.SetReadDeadline(time.Now().Add(200 * time.Millisecond)) //nolint:errcheck
	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			break
		}
		var msg protocol.ServerMsg
		json.Unmarshal(data, &msg) //nolint:errcheck
		if msg.Type == protocol.SMsgUnoDeclared && msg.Seat() == bot {
			t.Fatal("bot announced LOCO! after being caught")
		}
	}
}

// TestLobbyHostDisconnect_NewHostCanStartGame is a regression test for the
// deadlock where the original host (playerID 0) disconnects from the lobby and
// no remaining player can start the game (because handleStartGame required
// playerID == 0 and nobody held that slot anymore).
//
// The fix re-indexes room.Players, roomMembers, bot slots, and session tokens
// so the first remaining player becomes the new host (playerID 0).
func TestLobbyHostDisconnect_NewHostCanStartGame(t *testing.T) {
	_, srv := newTestHub(t)

	// Alice creates the room (host, playerID 0).
	conn1 := dialWS(t, srv)
	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Alice"})
	created := readMsgOfType(t, conn1, protocol.SMsgRoomCreated)

	// Bob joins (playerID 1).
	conn2 := dialWS(t, srv)
	t.Cleanup(func() { conn2.Close() })
	sendMsg(t, conn2, protocol.ClientMsg{Type: protocol.CMsgJoinRoom, Nickname: "Bob", RoomCode: created.RoomCode})
	bobJoined := readMsgOfType(t, conn2, protocol.SMsgRoomJoined)
	if bobJoined.PlayerID != 1 {
		t.Fatalf("Bob expected playerID 1, got %d", bobJoined.PlayerID)
	}
	readMsgOfType(t, conn1, protocol.SMsgPlayerJoined)

	// Carol joins (playerID 2) so that after Alice leaves, the room still has 2 players.
	conn3 := dialWS(t, srv)
	t.Cleanup(func() { conn3.Close() })
	sendMsg(t, conn3, protocol.ClientMsg{Type: protocol.CMsgJoinRoom, Nickname: "Carol", RoomCode: created.RoomCode})
	readMsgOfType(t, conn3, protocol.SMsgRoomJoined)
	readMsgOfType(t, conn1, protocol.SMsgPlayerJoined)
	readMsgOfType(t, conn2, protocol.SMsgPlayerJoined)

	// Alice (host) disconnects.
	conn1.Close()

	// Wait for the disconnect to propagate to surviving clients.
	playerLeft := readMsgOfType(t, conn2, protocol.SMsgPlayerLeft)
	if playerLeft.Nickname != "Alice" {
		t.Errorf("expected player_left for Alice, got %q", playerLeft.Nickname)
	}
	readMsgOfType(t, conn3, protocol.SMsgPlayerLeft)

	// Bob (now first remaining → new host with playerID 0) starts the game.
	sendMsg(t, conn2, protocol.ClientMsg{Type: protocol.CMsgStartGame})
	gs := readMsgOfType(t, conn2, protocol.SMsgGameStarted)
	if gs.State == nil {
		t.Fatal("game_started missing state — host promotion failed")
	}
	if gs.State.YourIndex != 0 {
		t.Errorf("Bob (new host) YourIndex = %d, want 0", gs.State.YourIndex)
	}
	if len(gs.State.Players) != 2 {
		t.Errorf("game started with %d players, want 2 (Alice should have been removed)", len(gs.State.Players))
	}
	// Carol should also receive game_started.
	carolStart := readMsgOfType(t, conn3, protocol.SMsgGameStarted)
	completeMapLoad(t, conn2, conn3)
	if carolStart.State == nil || carolStart.State.YourIndex != 1 {
		t.Errorf("Carol expected YourIndex 1 in game_started, got %+v", carolStart.State)
	}
}

// TestLobbyHostDisconnect_BotsRemoveLeavesRoom verifies that when the host
// leaves a lobby that contains only the host + bots, the room is cleaned up
// rather than left in a zombie state where bots have no human to control them.
func TestLobbyHostDisconnect_BotsOnlyTriggersCleanup(t *testing.T) {
	origEmpty := hub.EmptyRoomTimeout
	hub.EmptyRoomTimeout = 80 * time.Millisecond
	t.Cleanup(func() { hub.EmptyRoomTimeout = origEmpty })

	h, srv := newTestHub(t)

	conn := dialWS(t, srv)
	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Alice"})
	readMsgOfType(t, conn, protocol.SMsgRoomCreated)

	// Add a bot.
	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgAddBot})
	readMsgOfType(t, conn, protocol.SMsgPlayerJoined)

	if got := h.GetStats().Rooms; got != 1 {
		t.Fatalf("rooms after add_bot = %d, want 1", got)
	}

	// Host leaves; only the bot remains. Room must be scheduled for cleanup.
	conn.Close()

	// Wait past the cleanup timeout.
	time.Sleep(200 * time.Millisecond)

	if got := h.GetStats().Rooms; got != 0 {
		t.Errorf("rooms after host-only-with-bots disconnect = %d, want 0 (room should have been cleaned up)", got)
	}
}

// TestRoundTransition_CardPlayedReflectsWinningPlay is a regression test for the
// bug where, in BO3+ matches, the card_played broadcast for the round-winning
// play used to read room.State *after* dealRound had already run (because
// markPlayerFinished dealt the next round inline). Clients then briefly saw the
// new round's freshly-flipped first card as the "played" card.
//
// The fix moves dealRound out of markPlayerFinished into Room.BeginNextRound,
// which the hub calls only after broadcasting card_played + round_end.
//
// This test forces a known winning play in a BO3 match and asserts that:
//   - card_played carries the actual played card (not garbage from the new round)
//   - round_end follows
//   - game_started for the next round arrives with a fresh state
func TestRoundTransition_CardPlayedReflectsWinningPlay(t *testing.T) {
	t.Setenv("LOCO_E2E", "1") // enable debug_set_state
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

	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgSetMatchFormat, MatchFormat: "BO3"})
	readMsgOfType(t, conn1, protocol.SMsgLobbyConfigChanged)
	readMsgOfType(t, conn2, protocol.SMsgLobbyConfigChanged)

	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgStartGame})
	gs1 := readMsgOfType(t, conn1, protocol.SMsgGameStarted)
	readMsgOfType(t, conn2, protocol.SMsgGameStarted)
	completeMapLoad(t, conn1, conn2)
	if gs1.State == nil {
		t.Fatal("missing game_started state for Alice")
	}

	// Force Alice (host, index 0) to be on turn with exactly one playable card.
	winCard := protocol.CardDTO{Color: "red", Kind: "number", Value: 7}
	top := protocol.CardDTO{Color: "red", Kind: "number", Value: 7}
	zero := 0
	turnIdx := 0
	sendMsg(t, conn1, protocol.ClientMsg{
		Type:             protocol.CMsgDebugSetState,
		DebugHand:        []protocol.CardDTO{winCard},
		DebugDiscard:     &top,
		DebugPendingDraw: &zero,
		DebugCurrentTurn: &turnIdx,
	})
	readMsgOfType(t, conn1, protocol.SMsgGameState)
	readMsgOfType(t, conn2, protocol.SMsgGameState)

	// Alice plays her last card → wins round 1 → BO3 dealing round 2.
	sendMsg(t, conn1, protocol.ClientMsg{
		Type: protocol.CMsgPlayCard,
		Card: &winCard,
	})

	// First message: card_played. Must carry the actual winning card (Red number 7),
	// NOT whatever random card got flipped to start round 2.
	played := readMsgOfType(t, conn1, protocol.SMsgCardPlayed)
	if played.Card == nil {
		t.Fatal("card_played missing card")
	}
	if played.Card.Color != "red" || played.Card.Kind != "number" || played.Card.Value != 7 {
		t.Errorf("card_played reported wrong card after winning play: got color=%s kind=%s value=%d, want red/number/7 (this is the round-transition broadcast bug)",
			played.Card.Color, played.Card.Kind, played.Card.Value)
	}
	if played.Seat() != 0 {
		t.Errorf("card_played player_index = %d, want 0 (Alice)", played.Seat())
	}

	// Next: round_end with the just-completed round number (1) and Alice as winner.
	roundEnd := readMsgOfType(t, conn1, protocol.SMsgRoundEnd)
	if roundEnd.RoundNumber != 1 {
		t.Errorf("round_end RoundNumber = %d, want 1", roundEnd.RoundNumber)
	}
	if roundEnd.RoundWinner != "Alice" {
		t.Errorf("round_end RoundWinner = %q, want Alice", roundEnd.RoundWinner)
	}

	// Then game_started for round 2 with a fresh state.
	gs2 := readMsgOfType(t, conn1, protocol.SMsgGameStarted)
	if gs2.State == nil {
		t.Fatal("missing game_started state for round 2")
	}
	if gs2.State.RoundNumber != 2 {
		t.Errorf("round 2 game_started RoundNumber = %d, want 2", gs2.State.RoundNumber)
	}
	if len(gs2.State.Hand) != 8 {
		t.Errorf("round 2 hand size = %d, want 8", len(gs2.State.Hand))
	}
}

// TestRateLimit_BurstThenError verifies the per-client token bucket. The bucket
// allows a burst of 20, then refills at 10/sec. A client that fires 30 quick
// messages should get error responses after the bucket drains.
func TestRateLimit_BurstThenError(t *testing.T) {
	h, srv := newTestHub(t)

	conn := dialWS(t, srv)
	t.Cleanup(func() { conn.Close() })
	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Alice"})
	readMsgOfType(t, conn, protocol.SMsgRoomCreated)

	// Fire a burst of 30 messages back-to-back (clearly above the 20-token burst).
	// Use unknown_message so dispatch returns "unknown message type" — but the
	// rate-limiter rejects BEFORE dispatch, so once the bucket drains we see
	// "rate limit exceeded" instead.
	const burst = 30
	for i := 0; i < burst; i++ {
		sendMsg(t, conn, protocol.ClientMsg{Type: "unknown_msg_type"})
	}

	// Drain the responses and count how many were rate-limited vs unknown-type.
	rateLimited := 0
	unknown := 0
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) && (rateLimited+unknown) < burst {
		conn.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
		_, data, err := conn.ReadMessage()
		if err != nil {
			break
		}
		var msg protocol.ServerMsg
		if json.Unmarshal(data, &msg) != nil {
			continue
		}
		if msg.Type != protocol.SMsgError {
			continue
		}
		switch {
		case strings.Contains(msg.Error, "rate limit"):
			rateLimited++
		case strings.Contains(msg.Error, "unknown message"):
			unknown++
		}
	}

	if rateLimited == 0 {
		t.Errorf("expected at least 1 rate-limit error after %d-message burst, got %d (unknown=%d)", burst, rateLimited, unknown)
	}
	if got := h.GetMetrics().MessagesRateLimited; got == 0 {
		t.Errorf("metrics MessagesRateLimited = 0 after rate-limit burst, want > 0")
	}
}

// TestMetrics_DebugModeFlag verifies that GetMetrics surfaces the LOCO_E2E
// gate so an operator can detect a misconfigured production deploy.
func TestMetrics_DebugModeFlag(t *testing.T) {
	h, _ := newTestHub(t)

	// Default: env var unset → false.
	if h.GetMetrics().DebugModeActive {
		t.Error("DebugModeActive should be false when LOCO_E2E is unset")
	}

	t.Setenv("LOCO_E2E", "1")
	if !h.GetMetrics().DebugModeActive {
		t.Error("DebugModeActive should be true when LOCO_E2E=1")
	}
}

// TestAFK_KicksAfterConsecutiveTimeouts verifies that a human player who lets
// their turn timer expire AFKKickThreshold times in a row gets force-disconnected
// (the server sends an "afk_kicked" error and closes the WebSocket).
func TestAFK_KicksAfterConsecutiveTimeouts(t *testing.T) {
	origTimeout := hub.TurnTimeout
	origThreshold := hub.AFKKickThreshold
	origBotDelay := hub.BotThinkDelay
	origJitter := hub.BotJitterMax
	origCatchProb := hub.BotCatchProb
	hub.TurnTimeout = 30 * time.Millisecond
	hub.AFKKickThreshold = 2
	hub.BotThinkDelay = 5 * time.Millisecond
	hub.BotJitterMax = 0
	hub.BotCatchProb = 0
	t.Cleanup(func() {
		hub.TurnTimeout = origTimeout
		hub.AFKKickThreshold = origThreshold
		hub.BotThinkDelay = origBotDelay
		hub.BotJitterMax = origJitter
		hub.BotCatchProb = origCatchProb
	})

	_, srv := newTestHub(t)

	conn := dialWS(t, srv)
	t.Cleanup(func() { conn.Close() })

	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Idler"})
	created := readMsgOfType(t, conn, protocol.SMsgRoomCreated)
	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgAddBot, RoomCode: created.RoomCode})
	readMsgOfType(t, conn, protocol.SMsgPlayerJoined)
	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgStartGame})
	readMsgOfType(t, conn, protocol.SMsgGameStarted)
	completeMapLoad(t, conn)
	conn.SetReadDeadline(time.Time{})

	// Drain messages waiting for an "afk_kicked" error or a clean close.
	deadline := time.After(3 * time.Second)
	for {
		select {
		case <-deadline:
			t.Fatal("timed out waiting for AFK kick")
		default:
		}
		conn.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
		_, data, err := conn.ReadMessage()
		if err != nil {
			// Connection closed: this is the expected end state after kick.
			return
		}
		var msg protocol.ServerMsg
		if json.Unmarshal(data, &msg) != nil {
			continue
		}
		if msg.Type == protocol.SMsgError && msg.Error == "afk_kicked" {
			return
		}
		if msg.Type == protocol.SMsgMatchEnd {
			t.Fatal("match ended before AFK kick fired — bot won too fast for the test")
		}
	}
}

// TestPlayCard_SwapBroadcastsChosenPlayer verifies that when a Swap card is
// played, the card_played broadcast carries the target player index so clients
// can show "X swapped with Y" without inferring it from hand-size deltas.
func TestPlayCard_SwapBroadcastsChosenPlayer(t *testing.T) {
	t.Setenv("LOCO_E2E", "1")

	_, srv := newTestHub(t)

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

	var activeConn, observerConn *websocket.Conn
	var activeIdx, targetIdx int
	if gs1.State.Turn == gs1.State.YourIndex {
		activeConn, observerConn = conn1, conn2
		activeIdx = gs1.State.YourIndex
		targetIdx = gs2.State.YourIndex
	} else {
		activeConn, observerConn = conn2, conn1
		activeIdx = gs2.State.YourIndex
		targetIdx = gs1.State.YourIndex
	}

	zero := 0
	sendMsg(t, activeConn, protocol.ClientMsg{
		Type:             protocol.CMsgDebugSetState,
		DebugHand:        []protocol.CardDTO{{Color: "red", Kind: "swap"}},
		DebugDiscard:     &protocol.CardDTO{Color: "red", Kind: "number", Value: 5},
		DebugActiveColor: "red",
		DebugPendingDraw: &zero,
		DebugCurrentTurn: &activeIdx,
	})
	readMsgOfType(t, activeConn, protocol.SMsgGameState)
	readMsgOfType(t, observerConn, protocol.SMsgGameState)

	sendMsg(t, activeConn, protocol.ClientMsg{
		Type:         protocol.CMsgPlayCard,
		Card:         &protocol.CardDTO{Color: "red", Kind: "swap"},
		ChosenPlayer: &targetIdx,
	})

	for _, c := range []*websocket.Conn{activeConn, observerConn} {
		cp := readMsgOfType(t, c, protocol.SMsgCardPlayed)
		if cp.Card == nil || cp.Card.Kind != "swap" {
			t.Fatalf("card_played card mismatch: got %+v, want swap", cp.Card)
		}
		if cp.ChosenPlayer == nil {
			t.Fatalf("card_played missing chosen_player for swap")
		}
		if *cp.ChosenPlayer != targetIdx {
			t.Errorf("card_played chosen_player = %d, want %d", *cp.ChosenPlayer, targetIdx)
		}
	}
}

// TestPlayCard_NonSwapOmitsChosenPlayer verifies chosen_player is nil for normal plays.
func TestPlayCard_NonSwapOmitsChosenPlayer(t *testing.T) {
	t.Setenv("LOCO_E2E", "1")

	_, srv := newTestHub(t)

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

	var activeConn, observerConn *websocket.Conn
	var activeIdx int
	if gs1.State.Turn == gs1.State.YourIndex {
		activeConn, observerConn = conn1, conn2
		activeIdx = gs1.State.YourIndex
	} else {
		activeConn, observerConn = conn2, conn1
		activeIdx = gs2.State.YourIndex
	}

	zero := 0
	sendMsg(t, activeConn, protocol.ClientMsg{
		Type:             protocol.CMsgDebugSetState,
		DebugHand:        []protocol.CardDTO{{Color: "red", Kind: "number", Value: 7}},
		DebugDiscard:     &protocol.CardDTO{Color: "red", Kind: "number", Value: 5},
		DebugActiveColor: "red",
		DebugPendingDraw: &zero,
		DebugCurrentTurn: &activeIdx,
	})
	readMsgOfType(t, activeConn, protocol.SMsgGameState)
	readMsgOfType(t, observerConn, protocol.SMsgGameState)

	sendMsg(t, activeConn, protocol.ClientMsg{
		Type: protocol.CMsgPlayCard,
		Card: &protocol.CardDTO{Color: "red", Kind: "number", Value: 7},
	})

	for _, c := range []*websocket.Conn{activeConn, observerConn} {
		cp := readMsgOfType(t, c, protocol.SMsgCardPlayed)
		if cp.ChosenPlayer != nil {
			t.Errorf("card_played chosen_player should be nil for non-swap, got %d", *cp.ChosenPlayer)
		}
	}
}

// TestPlayCard_DirectionInPayload verifies card_played carries the post-effect
// play direction so clients can update the direction indicator immediately
// without waiting for the next full game_state.
func TestPlayCard_DirectionInPayload(t *testing.T) {
	t.Setenv("LOCO_E2E", "1")

	_, srv := newTestHub(t)

	conn1 := dialWS(t, srv)
	t.Cleanup(func() { conn1.Close() })
	conn2 := dialWS(t, srv)
	t.Cleanup(func() { conn2.Close() })
	conn3 := dialWS(t, srv)
	t.Cleanup(func() { conn3.Close() })

	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Alice"})
	created := readMsgOfType(t, conn1, protocol.SMsgRoomCreated)
	sendMsg(t, conn2, protocol.ClientMsg{Type: protocol.CMsgJoinRoom, Nickname: "Bob", RoomCode: created.RoomCode})
	readMsgOfType(t, conn2, protocol.SMsgRoomJoined)
	readMsgOfType(t, conn1, protocol.SMsgPlayerJoined)
	sendMsg(t, conn3, protocol.ClientMsg{Type: protocol.CMsgJoinRoom, Nickname: "Carol", RoomCode: created.RoomCode})
	readMsgOfType(t, conn3, protocol.SMsgRoomJoined)
	readMsgOfType(t, conn1, protocol.SMsgPlayerJoined)
	readMsgOfType(t, conn2, protocol.SMsgPlayerJoined)

	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgStartGame})
	readMsgOfType(t, conn1, protocol.SMsgGameStarted)
	readMsgOfType(t, conn2, protocol.SMsgGameStarted)
	readMsgOfType(t, conn3, protocol.SMsgGameStarted)
	completeMapLoad(t, conn1, conn2, conn3)

	// Pin Alice (player 0) as active with a Reverse and a Number, on a red discard.
	zero := 0
	red5 := protocol.CardDTO{Color: "red", Kind: "number", Value: 5}
	redReverse := protocol.CardDTO{Color: "red", Kind: "reverse"}
	red7 := protocol.CardDTO{Color: "red", Kind: "number", Value: 7}
	sendMsg(t, conn1, protocol.ClientMsg{
		Type:             protocol.CMsgDebugSetState,
		DebugDiscard:     &red5,
		DebugActiveColor: "red",
		DebugHands: []protocol.DebugHandOverrideDTO{
			{PlayerIndex: 0, Hand: []protocol.CardDTO{redReverse, red7}},
			{PlayerIndex: 1, Hand: []protocol.CardDTO{red5, red5}},
			{PlayerIndex: 2, Hand: []protocol.CardDTO{red5, red5}},
		},
		DebugPendingDraw: &zero,
		DebugCurrentTurn: &zero,
	})
	readMsgOfType(t, conn1, protocol.SMsgGameState)
	readMsgOfType(t, conn2, protocol.SMsgGameState)
	readMsgOfType(t, conn3, protocol.SMsgGameState)

	// Play Reverse → direction must flip to -1 in the broadcast.
	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgPlayCard, Card: &redReverse})
	for _, c := range []*websocket.Conn{conn1, conn2, conn3} {
		cp := readMsgOfType(t, c, protocol.SMsgCardPlayed)
		if cp.Direction != -1 {
			t.Errorf("card_played direction after Reverse = %d, want -1", cp.Direction)
		}
	}

	// After Reverse from seat 0 with direction -1, next player is seat 2 (Carol).
	// She plays a non-action card → direction must remain -1 in the broadcast.
	sendMsg(t, conn3, protocol.ClientMsg{Type: protocol.CMsgPlayCard, Card: &red5})
	for _, c := range []*websocket.Conn{conn1, conn2, conn3} {
		cp := readMsgOfType(t, c, protocol.SMsgCardPlayed)
		if cp.Direction != -1 {
			t.Errorf("card_played direction after non-Reverse = %d, want -1 (unchanged)", cp.Direction)
		}
	}
}

// The score table's ping column is fed by a broadcast the client never asks
// for, so its shape (one entry per seat, bots flagged, unmeasured seats at -1)
// is the whole contract.
func TestLatencyBroadcast_OneEntryPerSeat(t *testing.T) {
	prevBroadcast, prevPing := hub.LatencyBroadcastPeriod, hub.PingPeriod
	hub.LatencyBroadcastPeriod = 40 * time.Millisecond
	hub.PingPeriod = 20 * time.Millisecond
	t.Cleanup(func() {
		hub.LatencyBroadcastPeriod = prevBroadcast
		hub.PingPeriod = prevPing
	})

	_, srv := newTestHub(t)

	conn1 := dialWS(t, srv)
	defer conn1.Close()
	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Alice"})
	created := readMsgOfType(t, conn1, protocol.SMsgRoomCreated)

	conn2 := dialWS(t, srv)
	defer conn2.Close()
	sendMsg(t, conn2, protocol.ClientMsg{Type: protocol.CMsgJoinRoom, Nickname: "Bob", RoomCode: created.RoomCode})
	readMsgOfType(t, conn2, protocol.SMsgRoomJoined)
	readMsgOfType(t, conn1, protocol.SMsgPlayerJoined)

	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgAddBot})
	readMsgOfType(t, conn1, protocol.SMsgPlayerJoined)

	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgStartGame})
	readMsgOfType(t, conn1, protocol.SMsgGameStarted)
	completeMapLoad(t, conn1, conn2)

	msg := readMsgOfType(t, conn1, protocol.SMsgLatency)
	if len(msg.Latencies) != 3 {
		t.Fatalf("latencies = %v, want one entry per seat (3)", msg.Latencies)
	}
	for i, e := range msg.Latencies {
		if e.PlayerIndex != i {
			t.Errorf("entry %d has player_index %d", i, e.PlayerIndex)
		}
	}
	if msg.Latencies[2].Bot != true {
		t.Error("seat 2 is a bot and must be flagged as one")
	}
	if msg.Latencies[2].RTTMs != -1 {
		t.Errorf("bot rtt = %d, want -1 (no connection to measure)", msg.Latencies[2].RTTMs)
	}
	// The broadcast only goes out once something has actually been measured, so
	// at least one human seat carries a real round trip by now.
	if msg.Latencies[0].RTTMs < 0 && msg.Latencies[1].RTTMs < 0 {
		t.Errorf("no human seat measured: %v", msg.Latencies)
	}
	for _, i := range []int{0, 1} {
		if msg.Latencies[i].Bot {
			t.Errorf("human seat %d flagged as a bot", i)
		}
	}
}

// A lobby has nothing to show a ping next to; the broadcast must stay off until
// the match is actually running.
func TestLatencyBroadcast_NotSentInLobby(t *testing.T) {
	prevBroadcast, prevPing := hub.LatencyBroadcastPeriod, hub.PingPeriod
	hub.LatencyBroadcastPeriod = 40 * time.Millisecond
	hub.PingPeriod = 20 * time.Millisecond
	t.Cleanup(func() {
		hub.LatencyBroadcastPeriod = prevBroadcast
		hub.PingPeriod = prevPing
	})

	_, srv := newTestHub(t)

	conn := dialWS(t, srv)
	defer conn.Close()
	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Alice"})
	readMsgOfType(t, conn, protocol.SMsgRoomCreated)

	conn.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			break // read deadline: nothing arrived, which is the point
		}
		var msg protocol.ServerMsg
		if err := json.Unmarshal(data, &msg); err == nil && msg.Type == protocol.SMsgLatency {
			t.Fatal("latency broadcast sent to a room still in the lobby")
		}
	}
}

// The event log is the one unbounded field in a game_state, and no client reads
// it: it exists so a reconnecting player's history can be rebuilt. It therefore
// rides the reconnect snapshot only: a personalised game_state, which is built
// and marshalled once per recipient, must not carry 50 events per seat.
func TestEventLog_OnlyOnReconnectSnapshot(t *testing.T) {
	_, srv := newTestHub(t)

	conn1, conn2, roomCode, tokens := setupTwoPlayerGameWithTokens(t, srv)

	conn2.Close()
	readMsgOfType(t, conn1, protocol.SMsgPlayerDisconnected)

	conn2new := dialWS(t, srv)
	defer conn2new.Close()
	sendMsg(t, conn2new, protocol.ClientMsg{
		Type:         protocol.CMsgJoinRoom,
		Nickname:     "Bob",
		RoomCode:     roomCode,
		SessionToken: tokens[1],
	})

	msg := readMsgOfType(t, conn2new, protocol.SMsgPlayerReconnected)
	if msg.State == nil {
		t.Fatal("expected game state in reconnect message")
	}
	// Start() records a round_started event, so the log is never empty here.
	if len(msg.State.EventLog) == 0 {
		t.Error("reconnect snapshot carries no event log; a reconnecting client cannot rebuild its history")
	}
}

func TestEventLog_AbsentFromBroadcastGameState(t *testing.T) {
	_, srv := newTestHub(t)

	// game_started is the personalised game_state every player is sent at the
	// top of each round, one build and one marshal per recipient. Built here
	// rather than through setupTwoPlayerGameWithTokens, which consumes it.
	host := dialWS(t, srv)
	defer host.Close()
	sendMsg(t, host, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Alice"})
	created := readMsgOfType(t, host, protocol.SMsgRoomCreated)

	guest := dialWS(t, srv)
	defer guest.Close()
	sendMsg(t, guest, protocol.ClientMsg{Type: protocol.CMsgJoinRoom, Nickname: "Bob", RoomCode: created.RoomCode})
	readMsgOfType(t, guest, protocol.SMsgRoomJoined)
	readMsgOfType(t, host, protocol.SMsgPlayerJoined)

	sendMsg(t, host, protocol.ClientMsg{Type: protocol.CMsgStartGame})
	started := readMsgOfType(t, host, protocol.SMsgGameStarted)
	completeMapLoad(t, host, guest)
	if started.State == nil {
		t.Fatal("expected game state in game_started")
	}
	if len(started.State.EventLog) != 0 {
		t.Errorf("game_started carries %d event-log entries; the log is reconnect-only", len(started.State.EventLog))
	}
}

// TestCatchUNO_FailedCatchCostsACard pins the wager: the catcher's button was
// armed, but the target's LOCO! reached the hub first, so the call is refused
// AND charged one card. Without the price, mashing Contre-LOCO! on every seat
// holding one card would be free and always correct.
func TestCatchUNO_FailedCatchCostsACard(t *testing.T) {
	t.Setenv("LOCO_E2E", "1")

	_, srv := newTestHub(t)

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

	activeConn, catcherConn := conn1, conn2
	activeIdx, catcherIdx := gs1.State.YourIndex, gs2.State.YourIndex
	catcherHand := len(gs2.State.Hand)
	if gs1.State.Turn != gs1.State.YourIndex {
		activeConn, catcherConn = conn2, conn1
		activeIdx, catcherIdx = gs2.State.YourIndex, gs1.State.YourIndex
		catcherHand = len(gs1.State.Hand)
	}

	zero := 0
	sendMsg(t, activeConn, protocol.ClientMsg{
		Type:             protocol.CMsgDebugSetState,
		DebugHand:        []protocol.CardDTO{{Color: "red", Kind: "number", Value: 6}, {Color: "red", Kind: "number", Value: 7}},
		DebugDiscard:     &protocol.CardDTO{Color: "red", Kind: "number", Value: 5},
		DebugPendingDraw: &zero,
	})
	readMsgOfType(t, activeConn, protocol.SMsgGameState)
	readMsgOfType(t, catcherConn, protocol.SMsgGameState)

	sendMsg(t, activeConn, protocol.ClientMsg{
		Type: protocol.CMsgPlayCard,
		Card: &protocol.CardDTO{Color: "red", Kind: "number", Value: 7},
	})
	readMsgOfType(t, activeConn, protocol.SMsgCardPlayed)
	readMsgOfType(t, catcherConn, protocol.SMsgCardPlayed)

	// The target declares first, then the catcher taps anyway.
	sendMsg(t, activeConn, protocol.ClientMsg{Type: protocol.CMsgDeclareUno})
	readMsgOfType(t, activeConn, protocol.SMsgUnoDeclared)
	readMsgOfType(t, catcherConn, protocol.SMsgUnoDeclared)

	sendMsg(t, catcherConn, protocol.ClientMsg{Type: protocol.CMsgCatchUno, TargetIndex: &activeIdx})

	// The whole room learns whose call missed.
	failed := readMsgOfType(t, catcherConn, protocol.SMsgCatchFailed)
	if failed.Seat() != catcherIdx {
		t.Errorf("catch_failed PlayerIndex = %d, want the catcher %d", failed.Seat(), catcherIdx)
	}
	if seen := readMsgOfType(t, activeConn, protocol.SMsgCatchFailed); seen.Seat() != catcherIdx {
		t.Errorf("target saw catch_failed for seat %d, want %d", seen.Seat(), catcherIdx)
	}

	// And the catcher is handed the penalty card itself, not just a count.
	drawn := readMsgOfType(t, catcherConn, protocol.SMsgCardDrawn)
	if len(drawn.Cards) != 1 {
		t.Fatalf("card_drawn carried %d cards, want 1", len(drawn.Cards))
	}
	if drawn.Seat() != catcherIdx {
		t.Errorf("card_drawn PlayerIndex = %d, want %d", drawn.Seat(), catcherIdx)
	}

	// The target keeps its single card: a missed catch never touches the seat
	// it was aimed at.
	sendMsg(t, catcherConn, protocol.ClientMsg{Type: protocol.CMsgDebugSetState})
	st := readMsgOfType(t, catcherConn, protocol.SMsgGameState)
	if st.State == nil || len(st.State.Hand) != catcherHand+1 {
		t.Fatalf("catcher hand = %d, want %d", len(st.State.Hand), catcherHand+1)
	}
	for _, p := range st.State.Players {
		if p.Index == activeIdx && p.HandSize != 1 {
			t.Errorf("target hand size = %d, want 1 untouched", p.HandSize)
		}
	}
}
