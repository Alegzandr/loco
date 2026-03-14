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
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return h, srv
}

// setupTwoPlayerGame creates a room, joins a second player, starts the game,
// and returns both connections and the room code.
func setupTwoPlayerGame(t *testing.T, srv *httptest.Server) (conn1, conn2 *websocket.Conn, roomCode string) {
	t.Helper()

	conn1 = dialWS(t, srv)
	t.Cleanup(func() { conn1.Close() })

	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Alice"})
	created := readMsgOfType(t, conn1, protocol.SMsgRoomCreated)
	roomCode = created.RoomCode

	conn2 = dialWS(t, srv)
	t.Cleanup(func() { conn2.Close() })

	sendMsg(t, conn2, protocol.ClientMsg{Type: protocol.CMsgJoinRoom, Nickname: "Bob", RoomCode: roomCode})
	readMsgOfType(t, conn2, protocol.SMsgRoomJoined)
	readMsgOfType(t, conn1, protocol.SMsgPlayerJoined)

	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgStartGame})
	readMsgOfType(t, conn1, protocol.SMsgGameStarted)
	readMsgOfType(t, conn2, protocol.SMsgGameStarted)

	return conn1, conn2, roomCode
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
	if msg.PlayerIndex != 1 {
		t.Errorf("expected PlayerIndex 1, got %d", msg.PlayerIndex)
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

	conn1, conn2, roomCode := setupTwoPlayerGame(t, srv)

	// Bob disconnects
	conn2.Close()
	// Alice sees disconnected
	readMsgOfType(t, conn1, protocol.SMsgPlayerDisconnected)

	// Bob reconnects with same nickname and room code
	conn2new := dialWS(t, srv)
	defer conn2new.Close()

	sendMsg(t, conn2new, protocol.ClientMsg{
		Type:     protocol.CMsgJoinRoom,
		Nickname: "Bob",
		RoomCode: roomCode,
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
	if aliceMsg.PlayerIndex != 1 {
		t.Errorf("expected PlayerIndex 1, got %d", aliceMsg.PlayerIndex)
	}
	// Bob should now be connected in Alice's player list
	for _, p := range aliceMsg.Players {
		if p.Index == 1 && !p.Connected {
			t.Errorf("expected Bob to be connected after reconnect")
		}
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

	conn1, conn2, roomCode := setupTwoPlayerGame(t, srv)

	// Bob disconnects and reconnects
	conn2.Close()
	readMsgOfType(t, conn1, protocol.SMsgPlayerDisconnected)

	conn2new := dialWS(t, srv)
	defer conn2new.Close()
	sendMsg(t, conn2new, protocol.ClientMsg{
		Type:     protocol.CMsgJoinRoom,
		Nickname: "Bob",
		RoomCode: roomCode,
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
