package hub_test

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gorilla/websocket"
	"loco/server/hub"
	"loco/server/protocol"
)

// Hardening: the refusals that stand between a stranger with a socket and this
// process.
//
// Every test here is a security property, not a game rule. They are grouped in
// one file because they share a shape: send something no honest client sends,
// and assert the server answers rather than dies, grows or tells.

// --- A gameplay message at a table that has not dealt ---
//
// room.State is nil in a lobby (game.NewRoom, and ResetForRematch puts it back).
// handleDrawCard and handleCatchUno both read it before any status check, so two
// frames (create_room then draw_card) segfaulted the event loop, and with no
// recover in Run that is the whole process and every match on it. The gate in
// dispatch is the fix; these are the two vectors that found it.

func TestGameplayMessageInLobbyIsRefused(t *testing.T) {
	zero := 0
	cases := []struct {
		name string
		msg  protocol.ClientMsg
	}{
		{"draw_card", protocol.ClientMsg{Type: protocol.CMsgDrawCard}},
		{"catch_uno", protocol.ClientMsg{Type: protocol.CMsgCatchUno, TargetIndex: &zero}},
		{"catch_uno without a target", protocol.ClientMsg{Type: protocol.CMsgCatchUno}},
		{"pass_turn", protocol.ClientMsg{Type: protocol.CMsgPassTurn}},
		{"declare_uno", protocol.ClientMsg{Type: protocol.CMsgDeclareUno}},
		{"interrupt_play", protocol.ClientMsg{Type: protocol.CMsgInterruptPlay}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := hub.New()
			go h.Run()
			defer h.Stop()
			srv := httptest.NewServer(http.HandlerFunc(h.ServeWS))
			defer srv.Close()

			conn := dialWS(t, srv)
			defer conn.Close()
			sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Auditeur"})
			readMsgOfType(t, conn, protocol.SMsgRoomCreated)

			sendMsg(t, conn, tc.msg)
			if msg := readMsg(t, conn); msg.Type != protocol.SMsgError {
				t.Fatalf("expected an error, got %q", msg.Type)
			}

			// The hub is still answering, which is the half a panic would fail.
			sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgAddBot})
			readMsgOfType(t, conn, protocol.SMsgPlayerJoined)
		})
	}
}

// --- A panic in a handler must cost one message, not the server ---

func TestDispatchPanicDoesNotKillTheHub(t *testing.T) {
	h := hub.New()
	h.SetDispatchProbe(func() { panic("audit probe") })
	go h.Run()
	defer h.Stop()
	srv := httptest.NewServer(http.HandlerFunc(h.ServeWS))
	defer srv.Close()

	conn := dialWS(t, srv)
	defer conn.Close()
	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Auditeur"})
	if msg := readMsg(t, conn); msg.Type != protocol.SMsgError {
		t.Fatalf("a panicking handler must answer an error, got %q", msg.Type)
	}

	// The event loop survived it: a second client is served normally.
	h.SetDispatchProbe(nil)
	other := dialWS(t, srv)
	defer other.Close()
	sendMsg(t, other, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Survivant"})
	readMsgOfType(t, other, protocol.SMsgRoomCreated)
}

// --- Resource caps ---
//
// Nothing bounded h.rooms or h.clients, and the token bucket is per socket, so
// it bounds nothing in aggregate. Connect, create_room, disconnect: the table
// outlives the socket by EmptyRoomTimeout, and the loop is free.

func TestRoomsAreCapped(t *testing.T) {
	defer restoreInt(&hub.MaxRooms, hub.MaxRooms)()
	hub.MaxRooms = 3

	h := hub.New()
	go h.Run()
	defer h.Stop()
	srv := httptest.NewServer(http.HandlerFunc(h.ServeWS))
	defer srv.Close()

	for i := 0; i < hub.MaxRooms; i++ {
		conn := dialWS(t, srv)
		defer conn.Close()
		sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: fmt.Sprintf("Hote%d", i)})
		readMsgOfType(t, conn, protocol.SMsgRoomCreated)
	}

	over := dialWS(t, srv)
	defer over.Close()
	sendMsg(t, over, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "DeTrop"})
	msg := readMsg(t, over)
	if msg.Type != protocol.SMsgError {
		t.Fatalf("expected the cap to refuse, got %q", msg.Type)
	}
}

func TestConnectionsPerNetworkAreCapped(t *testing.T) {
	defer restoreInt(&hub.MaxConnsPerNet, hub.MaxConnsPerNet)()
	hub.MaxConnsPerNet = 2

	h := hub.New()
	go h.Run()
	defer h.Stop()
	srv := httptest.NewServer(http.HandlerFunc(h.ServeWS))
	defer srv.Close()

	// Every test connection comes from the loopback prefix, so they all count
	// against the same bucket.
	for i := 0; i < hub.MaxConnsPerNet; i++ {
		conn := dialWS(t, srv)
		defer conn.Close()
		sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: fmt.Sprintf("Hote%d", i)})
		readMsgOfType(t, conn, protocol.SMsgRoomCreated)
	}

	// Refused at the upgrade, before a Client exists: a connection this server
	// will not serve should not cost it a goroutine pair and a send buffer.
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
	conn, resp, err := websocket.DefaultDialer.Dial(url, nil)
	if err == nil {
		conn.Close()
		t.Fatal("the cap accepted one connection too many")
	}
	if resp == nil || resp.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("expected 429, got %v", resp)
	}
}

// restoreInt puts an exported knob back after a test has narrowed it.
func restoreInt(p *int, v int) func() {
	return func() { *p = v }
}

// --- Table-code enumeration ---
//
// A wrong code cost nothing: no counter, no penalty, nothing per address. The
// space is 32^6, but finding *any* live table scales with how many are open, so
// a sweep lands in somebody else's lobby on a busy server.

func TestRepeatedBadTableCodesAreThrottled(t *testing.T) {
	defer restoreInt(&hub.MaxFailedJoins, hub.MaxFailedJoins)()
	hub.MaxFailedJoins = 3

	h := hub.New()
	go h.Run()
	defer h.Stop()
	srv := httptest.NewServer(http.HandlerFunc(h.ServeWS))
	defer srv.Close()

	host := dialWS(t, srv)
	defer host.Close()
	sendMsg(t, host, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Hote"})
	created := readMsgOfType(t, host, protocol.SMsgRoomCreated)

	sweeper := dialWS(t, srv)
	defer sweeper.Close()
	codes := []string{"AAAAAA", "BBBBBB", "CCCCCC", "DDDDDD", "EEEEEE"}
	for _, code := range codes {
		sendMsg(t, sweeper, protocol.ClientMsg{
			Type: protocol.CMsgJoinRoom, Nickname: "Balayeur", RoomCode: code,
		})
		if msg := readMsg(t, sweeper); msg.Type != protocol.SMsgError {
			t.Fatalf("code %s: expected an error, got %q", code, msg.Type)
		}
	}

	// Past the budget the real code is refused too: the sweep cannot cash in
	// the hit it just paid for.
	sendMsg(t, sweeper, protocol.ClientMsg{
		Type: protocol.CMsgJoinRoom, Nickname: "Balayeur", RoomCode: created.RoomCode,
	})
	if msg := readMsg(t, sweeper); msg.Type != protocol.SMsgError {
		t.Fatalf("a throttled sweeper must not be seated, got %q", msg.Type)
	}
}

// A player who mistypes once still gets in: the budget is for a sweep, not for
// a human at a keyboard.
func TestOneMistypedCodeDoesNotLockAPlayerOut(t *testing.T) {
	h := hub.New()
	go h.Run()
	defer h.Stop()
	srv := httptest.NewServer(http.HandlerFunc(h.ServeWS))
	defer srv.Close()

	host := dialWS(t, srv)
	defer host.Close()
	sendMsg(t, host, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Hote"})
	created := readMsgOfType(t, host, protocol.SMsgRoomCreated)

	guest := dialWS(t, srv)
	defer guest.Close()
	sendMsg(t, guest, protocol.ClientMsg{Type: protocol.CMsgJoinRoom, Nickname: "Invite", RoomCode: "ZZZZZZ"})
	if msg := readMsg(t, guest); msg.Type != protocol.SMsgError {
		t.Fatalf("expected room not found, got %q", msg.Type)
	}
	sendMsg(t, guest, protocol.ClientMsg{
		Type: protocol.CMsgJoinRoom, Nickname: "Invite", RoomCode: created.RoomCode,
	})
	readMsgOfType(t, guest, protocol.SMsgRoomJoined)
}

// --- The nickname oracle on a reclaim ---
//
// "invalid session token for reconnect" for a nickname seated at that table and
// "game already in progress" for anything else told a stranger which names are
// playing. One string for both.

func TestReclaimRefusalRevealsNothingAboutTheRoster(t *testing.T) {
	h := hub.New()
	go h.Run()
	defer h.Stop()
	srv := httptest.NewServer(http.HandlerFunc(h.ServeWS))
	defer srv.Close()

	host := dialWS(t, srv)
	defer host.Close()
	sendMsg(t, host, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Hote"})
	created := readMsgOfType(t, host, protocol.SMsgRoomCreated)

	guest := dialWS(t, srv)
	sendMsg(t, guest, protocol.ClientMsg{
		Type: protocol.CMsgJoinRoom, Nickname: "Invite", RoomCode: created.RoomCode,
	})
	readMsgOfType(t, guest, protocol.SMsgRoomJoined)

	sendMsg(t, host, protocol.ClientMsg{Type: protocol.CMsgStartGame})
	readMsgOfType(t, host, protocol.SMsgGameStarted)
	readMsgOfType(t, guest, protocol.SMsgGameStarted)

	// Drop the guest so its seat is genuinely reclaimable, then try to take it
	// with no token, and try a name nobody at the table has.
	guest.Close()

	seated := dialWS(t, srv)
	defer seated.Close()
	sendMsg(t, seated, protocol.ClientMsg{
		Type: protocol.CMsgJoinRoom, Nickname: "Invite", RoomCode: created.RoomCode, SessionToken: "00",
	})
	withSeat := readMsgOfType(t, seated, protocol.SMsgError)

	stranger := dialWS(t, srv)
	defer stranger.Close()
	sendMsg(t, stranger, protocol.ClientMsg{
		Type: protocol.CMsgJoinRoom, Nickname: "Inconnu", RoomCode: created.RoomCode, SessionToken: "00",
	})
	withoutSeat := readMsgOfType(t, stranger, protocol.SMsgError)

	if withSeat.Error != withoutSeat.Error {
		t.Fatalf("the refusal names the roster: seated=%q stranger=%q", withSeat.Error, withoutSeat.Error)
	}
}

// --- A reclaimed seat gets a fresh token ---
//
// The old one has been on a socket that died, in sessionStorage, and in a
// snapshot on disk. Once it has been spent, it stops being the proof.

func TestReconnectRotatesTheSessionToken(t *testing.T) {
	h := hub.New()
	go h.Run()
	defer h.Stop()
	srv := httptest.NewServer(http.HandlerFunc(h.ServeWS))
	defer srv.Close()

	host := dialWS(t, srv)
	defer host.Close()
	sendMsg(t, host, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Hote"})
	created := readMsgOfType(t, host, protocol.SMsgRoomCreated)

	guest := dialWS(t, srv)
	sendMsg(t, guest, protocol.ClientMsg{
		Type: protocol.CMsgJoinRoom, Nickname: "Invite", RoomCode: created.RoomCode,
	})
	joined := readMsgOfType(t, guest, protocol.SMsgRoomJoined)

	sendMsg(t, host, protocol.ClientMsg{Type: protocol.CMsgStartGame})
	readMsgOfType(t, host, protocol.SMsgGameStarted)
	readMsgOfType(t, guest, protocol.SMsgGameStarted)
	guest.Close()

	back := dialWS(t, srv)
	defer back.Close()
	sendMsg(t, back, protocol.ClientMsg{
		Type: protocol.CMsgJoinRoom, Nickname: "Invite",
		RoomCode: created.RoomCode, SessionToken: joined.SessionToken,
	})
	reconnected := readMsgOfType(t, back, protocol.SMsgPlayerReconnected)
	if reconnected.SessionToken == "" {
		t.Fatal("a reclaim must hand back a token, or the next one cannot be made")
	}
	if reconnected.SessionToken == joined.SessionToken {
		t.Fatal("the spent token is still the proof")
	}

	// And the spent one no longer opens the seat.
	back.Close()
	replay := dialWS(t, srv)
	defer replay.Close()
	sendMsg(t, replay, protocol.ClientMsg{
		Type: protocol.CMsgJoinRoom, Nickname: "Invite",
		RoomCode: created.RoomCode, SessionToken: joined.SessionToken,
	})
	if msg := readMsg(t, replay); msg.Type != protocol.SMsgError {
		t.Fatalf("a replayed token reclaimed the seat: %q", msg.Type)
	}
}
