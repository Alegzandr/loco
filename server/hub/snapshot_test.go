package hub_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"loco/server/hub"
	"loco/server/protocol"
)

// A snapshot is what turns a deploy from "everybody loses their match" into a
// reconnect the client already knows how to do. These tests exercise the whole
// round trip through real sockets rather than the marshalling alone: the thing
// that has to survive is a player's hand, and the only proof of that is a
// player getting it back.

// newHubOn starts a hub on its own test server, with no t.Cleanup ordering
// assumptions: a restart test runs two of these in sequence.
func newHubOn(t *testing.T) (*hub.Hub, *httptest.Server, func()) {
	t.Helper()
	h := hub.New()
	go h.Run()
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", h.ServeWS)
	srv := httptest.NewServer(mux)
	return h, srv, func() {
		srv.Close()
		h.Stop()
	}
}

// snapshotPath returns a path in a temp dir that no snapshot has written yet.
func snapshotPath(t *testing.T) string {
	t.Helper()
	return filepath.Join(t.TempDir(), "snapshot.json")
}

// setupGameKeepingState is setupTwoPlayerGameWithTokens plus the personalised
// state each player was dealt, which is the thing a restart has to give back.
func setupGameKeepingState(t *testing.T, srv *httptest.Server) (conn1, conn2 *websocket.Conn, code string, tokens [2]string, state1, state2 *protocol.GameStateDTO) {
	t.Helper()

	conn1 = dialWS(t, srv)
	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Alice"})
	created := readMsgOfType(t, conn1, protocol.SMsgRoomCreated)
	code, tokens[0] = created.RoomCode, created.SessionToken

	conn2 = dialWS(t, srv)
	sendMsg(t, conn2, protocol.ClientMsg{Type: protocol.CMsgJoinRoom, Nickname: "Bob", RoomCode: code})
	joined := readMsgOfType(t, conn2, protocol.SMsgRoomJoined)
	tokens[1] = joined.SessionToken
	readMsgOfType(t, conn1, protocol.SMsgPlayerJoined)

	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgStartGame})
	gs1 := readMsgOfType(t, conn1, protocol.SMsgGameStarted)
	gs2 := readMsgOfType(t, conn2, protocol.SMsgGameStarted)
	completeMapLoad(t, conn1, conn2)
	if gs1.State == nil || gs2.State == nil {
		t.Fatal("game_started carried no state")
	}
	return conn1, conn2, code, tokens, gs1.State, gs2.State
}

func TestSnapshot_MatchSurvivesARestart(t *testing.T) {
	path := snapshotPath(t)

	// --- the process that is about to be replaced ---
	h1, srv1, stop1 := newHubOn(t)

	conn1, conn2, code, tokens, state1, state2 := setupGameKeepingState(t, srv1)

	h1.BeginDrain()
	readMsgOfType(t, conn1, protocol.SMsgServerUpdating)
	readMsgOfType(t, conn2, protocol.SMsgServerUpdating)

	if err := h1.SaveSnapshot(path); err != nil {
		t.Fatalf("SaveSnapshot: %v", err)
	}
	conn1.Close()
	conn2.Close()
	stop1()

	// --- the process that replaces it ---
	h2, srv2, stop2 := newHubOn(t)
	defer stop2()

	if err := h2.LoadSnapshot(path); err != nil {
		t.Fatalf("LoadSnapshot: %v", err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Error("the snapshot file survived the load; a snapshot must never be replayed twice")
	}

	// Both clients come back exactly the way a dropped socket does: same
	// nickname, same table code, same token out of sessionStorage.
	back1 := reconnectAs(t, srv2, code, "Alice", tokens[0])
	defer back1.Close()
	back2 := reconnectAs(t, srv2, code, "Bob", tokens[1])
	defer back2.Close()

	after1 := readMsgOfType(t, back1, protocol.SMsgPlayerReconnected)
	if after1.State == nil {
		t.Fatal("no state after reconnecting into the restarted server")
	}
	assertSameState(t, "Alice", state1, after1.State)

	after2 := readMsgOfType(t, back2, protocol.SMsgPlayerReconnected)
	if after2.State == nil {
		t.Fatal("no state after reconnecting into the restarted server")
	}
	assertSameState(t, "Bob", state2, after2.State)
}

func TestSnapshot_RestoredSeatKeepsPlaying(t *testing.T) {
	t.Setenv("LOCO_E2E", "1")
	path := snapshotPath(t)

	h1, srv1, stop1 := newHubOn(t)
	conn1, conn2, code, tokens, state1, _ := setupGameKeepingState(t, srv1)

	if err := h1.SaveSnapshot(path); err != nil {
		t.Fatalf("SaveSnapshot: %v", err)
	}
	conn1.Close()
	conn2.Close()
	stop1()

	h2, srv2, stop2 := newHubOn(t)
	defer stop2()
	if err := h2.LoadSnapshot(path); err != nil {
		t.Fatalf("LoadSnapshot: %v", err)
	}

	back1 := reconnectAs(t, srv2, code, "Alice", tokens[0])
	defer back1.Close()
	readMsgOfType(t, back1, protocol.SMsgPlayerReconnected)
	back2 := reconnectAs(t, srv2, code, "Bob", tokens[1])
	defer back2.Close()
	readMsgOfType(t, back2, protocol.SMsgPlayerReconnected)

	// A restored room is a room: it takes moves, and the table is open. If the
	// map-loading gate came back shut and nothing reopened it, this play is
	// refused with "waiting for every player to load the table".
	seat := state1.YourIndex
	zero := 0
	sendMsg(t, back1, protocol.ClientMsg{
		Type: protocol.CMsgDebugSetState,
		Debug: &protocol.DebugStateDTO{
			Hand:        []protocol.CardDTO{{Color: "red", Kind: "number", Value: 3}},
			Discard:     &protocol.CardDTO{Color: "red", Kind: "number", Value: 5},
			ActiveColor: "red",
			PendingDraw: &zero,
			CurrentTurn: &seat,
		},
	})
	readMsgOfType(t, back1, protocol.SMsgGameState)

	sendMsg(t, back1, protocol.ClientMsg{
		Type: protocol.CMsgPlayCard,
		Card: &protocol.CardDTO{Color: "red", Kind: "number", Value: 3},
	})
	played := readMsgOfType(t, back2, protocol.SMsgCardPlayed)
	if played.Card == nil || played.Card.Value != 3 {
		t.Fatalf("a restored match refused a legal play: got %+v", played.Card)
	}
}

func TestSnapshot_LobbiesAreNotSaved(t *testing.T) {
	path := snapshotPath(t)

	h, srv, stop := newHubOn(t)
	conn := dialWS(t, srv)
	defer conn.Close()
	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Alice"})
	readMsgOfType(t, conn, protocol.SMsgRoomCreated)

	if err := h.SaveSnapshot(path); err != nil {
		t.Fatalf("SaveSnapshot: %v", err)
	}
	stop()

	// A lobby has nothing to lose and its host is on the table screen, not in a
	// match. Carrying it across would resurrect a room nobody was in, and with
	// nothing else to carry there is no file at all: a clean deploy leaves no
	// snapshot behind.
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Errorf("a snapshot was written for a lobby-only server (%d room(s))", snapshotRoomCount(t, path))
	}
}

func TestSnapshot_RefusedWhenTooOld(t *testing.T) {
	path := snapshotPath(t)

	h1, srv1, stop1 := newHubOn(t)
	conn1, conn2, _, _ := setupTwoPlayerGameWithTokens(t, srv1)
	if err := h1.SaveSnapshot(path); err != nil {
		t.Fatalf("SaveSnapshot: %v", err)
	}
	conn1.Close()
	conn2.Close()
	stop1()

	backdateSnapshot(t, path, hub.SnapshotMaxAge+time.Minute)

	h2, _, stop2 := newHubOn(t)
	defer stop2()
	if err := h2.LoadSnapshot(path); err != nil {
		t.Fatalf("LoadSnapshot on a stale file should be a no-op, got: %v", err)
	}
	// Nobody is coming back after that long, and reviving their table would put
	// a room nobody can reach on a fresh server.
	if got := h2.GetMetrics().RoomsActive; got != 0 {
		t.Errorf("a stale snapshot restored %d room(s), want 0", got)
	}
}

func TestSnapshot_RefusedOnSchemaMismatch(t *testing.T) {
	path := snapshotPath(t)

	h1, srv1, stop1 := newHubOn(t)
	conn1, conn2, _, _ := setupTwoPlayerGameWithTokens(t, srv1)
	if err := h1.SaveSnapshot(path); err != nil {
		t.Fatalf("SaveSnapshot: %v", err)
	}
	conn1.Close()
	conn2.Close()
	stop1()

	rewriteSchemaVersion(t, path, hub.SnapshotSchemaVersion+1)

	h2, _, stop2 := newHubOn(t)
	defer stop2()
	// The whole point of the version: a room shaped by another build is not a
	// room this one can play, and guessing is worse than dropping it. The drain
	// is what keeps this case rare.
	if err := h2.LoadSnapshot(path); err != nil {
		t.Fatalf("LoadSnapshot on a foreign schema should be a no-op, got: %v", err)
	}
	if got := h2.GetMetrics().RoomsActive; got != 0 {
		t.Errorf("a foreign-schema snapshot restored %d room(s), want 0", got)
	}
}

func TestSnapshot_NoFileIsNotAnError(t *testing.T) {
	h, _, stop := newHubOn(t)
	defer stop()

	// The ordinary start: nothing was ever written, and the server boots.
	if err := h.LoadSnapshot(snapshotPath(t)); err != nil {
		t.Fatalf("LoadSnapshot with no file: %v", err)
	}
}

func TestSnapshot_DisabledWhenNoPathIsConfigured(t *testing.T) {
	h, _, stop := newHubOn(t)
	defer stop()

	// Local dev and the E2E suite run without a snapshot path, and must behave
	// exactly as they did before this existed.
	if err := h.SaveSnapshot(""); err != nil {
		t.Fatalf("SaveSnapshot(\"\"): %v", err)
	}
	if err := h.LoadSnapshot(""); err != nil {
		t.Fatalf("LoadSnapshot(\"\"): %v", err)
	}
}

// --- helpers ---

func reconnectAs(t *testing.T, srv *httptest.Server, code, nickname, token string) *websocket.Conn {
	t.Helper()
	conn := dialWS(t, srv)
	sendMsg(t, conn, protocol.ClientMsg{
		Type:         protocol.CMsgJoinRoom,
		Nickname:     nickname,
		RoomCode:     code,
		SessionToken: token,
	})
	return conn
}

// assertSameState compares everything a player would notice.
func assertSameState(t *testing.T, who string, want, got *protocol.GameStateDTO) {
	t.Helper()
	if got.YourIndex != want.YourIndex {
		t.Errorf("%s: your_index = %d, want %d", who, got.YourIndex, want.YourIndex)
	}
	if len(got.Hand) != len(want.Hand) {
		t.Fatalf("%s: hand of %d cards, want %d", who, len(got.Hand), len(want.Hand))
	}
	for i := range want.Hand {
		if got.Hand[i] != want.Hand[i] {
			t.Errorf("%s: hand[%d] = %+v, want %+v", who, i, got.Hand[i], want.Hand[i])
		}
	}
	if got.Discard != want.Discard {
		t.Errorf("%s: discard = %+v, want %+v", who, got.Discard, want.Discard)
	}
	if got.ActiveColor != want.ActiveColor {
		t.Errorf("%s: active_color = %q, want %q", who, got.ActiveColor, want.ActiveColor)
	}
	if got.Turn != want.Turn {
		t.Errorf("%s: turn = %d, want %d", who, got.Turn, want.Turn)
	}
	if got.Direction != want.Direction {
		t.Errorf("%s: direction = %d, want %d", who, got.Direction, want.Direction)
	}
	if got.PendingDraw != want.PendingDraw {
		t.Errorf("%s: pending_draw = %d, want %d", who, got.PendingDraw, want.PendingDraw)
	}
	if got.RoundNumber != want.RoundNumber {
		t.Errorf("%s: round_number = %d, want %d", who, got.RoundNumber, want.RoundNumber)
	}
	// The map is drawn once per match. A restored table that redrew it would put
	// two players in different rooms.
	if got.MapID != want.MapID {
		t.Errorf("%s: map_id = %q, want %q", who, got.MapID, want.MapID)
	}
	if got.MatchFormat != want.MatchFormat {
		t.Errorf("%s: match_format = %q, want %q", who, got.MatchFormat, want.MatchFormat)
	}
	if len(got.Players) != len(want.Players) {
		t.Errorf("%s: %d players, want %d", who, len(got.Players), len(want.Players))
	}
}

// readSnapshotFile pulls the raw JSON apart without going through the hub's own
// types, so a test cannot pass just because both sides share a bug.
func readSnapshotFile(t *testing.T, path string) map[string]any {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read snapshot: %v", err)
	}
	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatalf("unmarshal snapshot: %v", err)
	}
	return raw
}

func writeSnapshotFile(t *testing.T, path string, raw map[string]any) {
	t.Helper()
	data, err := json.Marshal(raw)
	if err != nil {
		t.Fatalf("marshal snapshot: %v", err)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatalf("write snapshot: %v", err)
	}
}

func snapshotRoomCount(t *testing.T, path string) int {
	t.Helper()
	raw := readSnapshotFile(t, path)
	rooms, _ := raw["rooms"].([]any)
	return len(rooms)
}

func backdateSnapshot(t *testing.T, path string, by time.Duration) {
	t.Helper()
	raw := readSnapshotFile(t, path)
	raw["saved_at"] = time.Now().Add(-by).Format(time.RFC3339Nano)
	writeSnapshotFile(t, path, raw)
}

func rewriteSchemaVersion(t *testing.T, path string, version int) {
	t.Helper()
	raw := readSnapshotFile(t, path)
	raw["schema_version"] = version
	writeSnapshotFile(t, path, raw)
}
