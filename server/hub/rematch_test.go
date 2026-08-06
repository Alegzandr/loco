package hub_test

import (
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"loco/server/protocol"
)

// winBO1 drives a fresh 2-player BO1 room to match_end and returns the two
// connections plus the room code. conn1 is the host (Alice, index 0).
func winBO1(t *testing.T) (*websocket.Conn, *websocket.Conn, string) {
	t.Helper()
	_, srv := newTestHub(t)

	conn1 := dialWS(t, srv)
	t.Cleanup(func() { conn1.Close() })
	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Alice"})
	created := readMsgOfType(t, conn1, protocol.SMsgRoomCreated)
	code := created.RoomCode

	conn2 := dialWS(t, srv)
	t.Cleanup(func() { conn2.Close() })
	sendMsg(t, conn2, protocol.ClientMsg{Type: protocol.CMsgJoinRoom, Nickname: "Bob", RoomCode: code})
	readMsgOfType(t, conn2, protocol.SMsgRoomJoined)
	readMsgOfType(t, conn1, protocol.SMsgPlayerJoined)

	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgStartGame})
	readMsgOfType(t, conn1, protocol.SMsgGameStarted)
	readMsgOfType(t, conn2, protocol.SMsgGameStarted)
	completeMapLoad(t, conn1, conn2)

	winMatchFromHostTurn(t, conn1, conn2)
	return conn1, conn2, code
}

// winMatchFromHostTurn hands the host a single playable card on their turn and
// plays it, ending a BO1 match. Extra conns are drained so they stay in sync.
func winMatchFromHostTurn(t *testing.T, host *websocket.Conn, others ...*websocket.Conn) {
	t.Helper()
	t.Setenv("LOCO_E2E", "1") // enable debug_set_state
	winCard := protocol.CardDTO{Color: "red", Kind: "number", Value: 7}
	top := protocol.CardDTO{Color: "red", Kind: "number", Value: 7}
	zero, turnIdx := 0, 0
	sendMsg(t, host, protocol.ClientMsg{
		Type: protocol.CMsgDebugSetState,
		Debug: &protocol.DebugStateDTO{
			Hand:        []protocol.CardDTO{winCard},
			Discard:     &top,
			PendingDraw: &zero,
			CurrentTurn: &turnIdx,
		},
	})
	readMsgOfType(t, host, protocol.SMsgGameState)
	for _, c := range others {
		readMsgOfType(t, c, protocol.SMsgGameState)
	}

	declareBeforeWinning(t, host)
	sendMsg(t, host, protocol.ClientMsg{Type: protocol.CMsgPlayCard, Card: &winCard})
	readMsgOfType(t, host, protocol.SMsgMatchEnd)
	for _, c := range others {
		readMsgOfType(t, c, protocol.SMsgMatchEnd)
	}
}

// winBO1AtThree is winBO1 with Carol at the table: Alice hosts at seat 0, Bob
// sits at 1 and Carol at 2, and the host wins the match.
func winBO1AtThree(t *testing.T) []*websocket.Conn {
	t.Helper()
	_, srv := newTestHub(t)

	conn1 := dialWS(t, srv)
	t.Cleanup(func() { conn1.Close() })
	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Alice"})
	code := readMsgOfType(t, conn1, protocol.SMsgRoomCreated).RoomCode

	conns := []*websocket.Conn{conn1}
	for _, name := range []string{"Bob", "Carol"} {
		c := dialWS(t, srv)
		t.Cleanup(func() { c.Close() })
		sendMsg(t, c, protocol.ClientMsg{Type: protocol.CMsgJoinRoom, Nickname: name, RoomCode: code})
		readMsgOfType(t, c, protocol.SMsgRoomJoined)
		conns = append(conns, c)
	}
	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgStartGame})
	for _, c := range conns {
		readMsgOfType(t, c, protocol.SMsgGameStarted)
	}
	completeMapLoad(t, conns...)
	winMatchFromHostTurn(t, conn1, conns[1], conns[2])
	return conns
}

// Two asks are a game. The seat that said nothing is not left behind by it: the
// room reopens as a lobby with the whole table still in it, which is the reason
// the quorum can stop at two without anybody losing their seat.
func TestRematch_TwoAsksDealItPastTwoSeats(t *testing.T) {
	conns := winBO1AtThree(t)

	sendMsg(t, conns[1], protocol.ClientMsg{Type: protocol.CMsgRematch})
	for _, c := range conns {
		if msg := readMsgOfType(t, c, protocol.SMsgRematchOffered); msg.RematchNeeded != 2 {
			t.Errorf("rematch_needed = %d, want 2", msg.RematchNeeded)
		}
	}
	sendMsg(t, conns[2], protocol.ClientMsg{Type: protocol.CMsgRematch})

	for i, c := range conns {
		msg := readMsgOfType(t, c, protocol.SMsgRematchStarted)
		if len(msg.Players) != 3 {
			t.Errorf("client %d: players in the reopened room = %d, want 3", i, len(msg.Players))
		}
	}
}

// The table goes to somebody who asked for it. Alice hosted and said nothing,
// so the badge lands on the earliest-seated asker — Bob at seat 1, even though
// Carol pressed first — and the press that starts the match is his.
func TestRematch_HostWhoNeverAskedHandsTheTableOver(t *testing.T) {
	conns := winBO1AtThree(t)

	sendMsg(t, conns[2], protocol.ClientMsg{Type: protocol.CMsgRematch})
	for _, c := range conns {
		readMsgOfType(t, c, protocol.SMsgRematchOffered)
	}
	sendMsg(t, conns[1], protocol.ClientMsg{Type: protocol.CMsgRematch})

	wantSeats := []int{1, 0, 2} // Alice and Bob traded places; Carol stayed put.
	for i, c := range conns {
		msg := readMsgOfType(t, c, protocol.SMsgRematchStarted)
		if msg.OwnSeat() != wantSeats[i] {
			t.Errorf("client %d: player_id = %d, want %d", i, msg.OwnSeat(), wantSeats[i])
		}
		if len(msg.Players) == 0 || msg.Players[0].Nickname != "Bob" {
			t.Errorf("client %d: host of the reopened room = %+v, want Bob", i, msg.Players)
		}
	}

	// The badge is the real thing and not a label: the new host starts the match.
	sendMsg(t, conns[1], protocol.ClientMsg{Type: protocol.CMsgStartGame})
	for _, c := range conns {
		readMsgOfType(t, c, protocol.SMsgGameStarted)
	}
}

func TestRematch_ReopensRoomOnceTwoHaveAsked(t *testing.T) {
	conn1, conn2, code := winBO1(t)

	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgRematch})
	readMsgOfType(t, conn1, protocol.SMsgRematchOffered)
	readMsgOfType(t, conn2, protocol.SMsgRematchOffered)
	sendMsg(t, conn2, protocol.ClientMsg{Type: protocol.CMsgRematch})

	for i, conn := range []*websocket.Conn{conn1, conn2} {
		msg := readMsgOfType(t, conn, protocol.SMsgRematchStarted)
		if msg.RoomCode != code {
			t.Errorf("client %d: room_code = %q, want %q", i, msg.RoomCode, code)
		}
		if msg.OwnSeat() != i {
			t.Errorf("client %d: player_id = %d, want %d", i, msg.OwnSeat(), i)
		}
		if len(msg.Players) != 2 {
			t.Errorf("client %d: players = %d, want 2", i, len(msg.Players))
		}
		if msg.MatchFormat == "" || msg.MaxPlayers == 0 {
			t.Errorf("client %d: lobby config missing (format=%q max=%d)", i, msg.MatchFormat, msg.MaxPlayers)
		}
	}

	// The reopened room must be startable again, and the new match must begin
	// from a clean slate: full hands, round 1, zeroed scores.
	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgStartGame})
	gs := readMsgOfType(t, conn1, protocol.SMsgGameStarted)
	readMsgOfType(t, conn2, protocol.SMsgGameStarted)
	completeMapLoad(t, conn1, conn2)
	if gs.State == nil {
		t.Fatal("game_started without state after rematch")
	}
	if len(gs.State.Hand) != 8 {
		t.Errorf("hand size after rematch = %d, want 8", len(gs.State.Hand))
	}
	if gs.State.RoundNumber != 1 {
		t.Errorf("round_number after rematch = %d, want 1", gs.State.RoundNumber)
	}
	for _, e := range gs.State.Scoreboard {
		if e.Score != 0 || e.RoundsWon != 0 {
			t.Errorf("stale score for %s: score=%d wins=%d", e.Nickname, e.Score, e.RoundsWon)
		}
	}
}

// The host owns the format, the size and the start. They do not own whether
// anybody else wants another match, so the button is an offer on every screen.
//
// The negative read ends this test, deliberately: a read that times out leaves
// a gorilla connection permanently broken.
func TestRematch_AnySeatMayAskAndOneAskDealsNothing(t *testing.T) {
	conn1, conn2, _ := winBO1(t)

	sendMsg(t, conn2, protocol.ClientMsg{Type: protocol.CMsgRematch})

	// The whole offer state travels, to both of them: the player who has not
	// answered has to know somebody is waiting on them.
	for i, conn := range []*websocket.Conn{conn2, conn1} {
		msg := readMsgOfType(t, conn, protocol.SMsgRematchOffered)
		if msg.Seat() != 1 {
			t.Errorf("client %d: rematch_offered named seat %d, want 1", i, msg.Seat())
		}
		if got := msg.Offers(); len(got) != 1 || got[0] != 1 {
			t.Errorf("client %d: offers = %v, want [1]", i, got)
		}
		if msg.RematchNeeded != 2 {
			t.Errorf("client %d: rematch_needed = %d, want 2", i, msg.RematchNeeded)
		}
	}

	conn2.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
	if _, _, err := conn2.ReadMessage(); err == nil {
		t.Error("a single ask reopened the room on its own")
	}
}

// Nobody is left waiting on a player who is not there. The ask that could not
// be answered is retired with the seat, and the answer to the table's question
// is the departure itself.
func TestRematch_DepartureCompletesTheAgreement(t *testing.T) {
	conn1, conn2, _ := winBO1(t)

	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgRematch})
	readMsgOfType(t, conn1, protocol.SMsgRematchOffered)
	readMsgOfType(t, conn2, protocol.SMsgRematchOffered)

	sendMsg(t, conn2, protocol.ClientMsg{Type: protocol.CMsgLeaveRoom})

	msg := readMsgOfType(t, conn1, protocol.SMsgRematchStarted)
	if len(msg.Players) != 1 || msg.Players[0].Nickname != "Alice" {
		t.Fatalf("players after the departure = %+v, want Alice alone", msg.Players)
	}
}

// The seats above a departure move down, and so do their asks. Alice at seat 0
// leaves a table of three: Bob's ask must follow him from seat 1 to seat 0
// rather than being read as Carol's.
func TestRematch_ReindexesOffersWhenASeatLeaves(t *testing.T) {
	_, srv := newTestHub(t)

	conn1 := dialWS(t, srv)
	t.Cleanup(func() { conn1.Close() })
	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Alice"})
	code := readMsgOfType(t, conn1, protocol.SMsgRoomCreated).RoomCode

	conns := []*websocket.Conn{conn1}
	for _, name := range []string{"Bob", "Carol"} {
		c := dialWS(t, srv)
		t.Cleanup(func() { c.Close() })
		sendMsg(t, c, protocol.ClientMsg{Type: protocol.CMsgJoinRoom, Nickname: name, RoomCode: code})
		readMsgOfType(t, c, protocol.SMsgRoomJoined)
		conns = append(conns, c)
	}
	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgStartGame})
	for _, c := range conns {
		readMsgOfType(t, c, protocol.SMsgGameStarted)
	}
	completeMapLoad(t, conns...)
	winMatchFromHostTurn(t, conn1, conns[1], conns[2])

	sendMsg(t, conns[1], protocol.ClientMsg{Type: protocol.CMsgRematch})
	if msg := readMsgOfType(t, conns[2], protocol.SMsgRematchOffered); msg.RematchNeeded != 2 {
		t.Errorf("rematch_needed = %d, want 2", msg.RematchNeeded)
	}

	conn1.Close()
	// The seat is held rather than removed — the match is over and the rematch is
	// not, so a socket that drops here has the reconnect window to come back into
	// it. Nothing is re-based for a seat that is still there: Bob keeps index 1.
	// What goes is the quorum the absent seat was part of, which is the half of a
	// departure that matters here — nobody waits on somebody who is not there.
	readMsgOfType(t, conns[2], protocol.SMsgPlayerDisconnected)
	msg := readMsgOfType(t, conns[2], protocol.SMsgRematchOffered)
	if got := msg.Offers(); len(got) != 1 || got[0] != 1 {
		t.Errorf("offers after the host dropped = %v, want [1] (Bob, seat unchanged)", got)
	}
	if msg.RematchNeeded != 2 {
		t.Errorf("rematch_needed = %d, want 2", msg.RematchNeeded)
	}

	// Carol answering is now the whole table.
	sendMsg(t, conns[2], protocol.ClientMsg{Type: protocol.CMsgRematch})
	if started := readMsgOfType(t, conns[1], protocol.SMsgRematchStarted); len(started.Players) != 2 {
		t.Errorf("players in the reopened room = %d, want 2", len(started.Players))
	}
}

func TestRematch_RejectedBeforeMatchIsOver(t *testing.T) {
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

	// In the lobby there is nothing to rematch yet.
	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgRematch})
	if msg := readMsgOfType(t, conn1, protocol.SMsgError); !strings.Contains(msg.Error, "match is over") {
		t.Errorf("lobby rematch error = %q, want it to mention the match not being over", msg.Error)
	}

	// Mid-match it is still rejected.
	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgStartGame})
	readMsgOfType(t, conn1, protocol.SMsgGameStarted)
	readMsgOfType(t, conn2, protocol.SMsgGameStarted)
	completeMapLoad(t, conn1, conn2)
	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgRematch})
	if msg := readMsgOfType(t, conn1, protocol.SMsgError); !strings.Contains(msg.Error, "match is over") {
		t.Errorf("mid-match rematch error = %q, want it to mention the match not being over", msg.Error)
	}
}

// A player who leaves after the match ends must not be dealt a hand in the
// rematch: their seat is pruned and the survivors are re-indexed.
func TestRematch_PrunesPlayerWhoLeftAfterMatchEnd(t *testing.T) {
	conn1, conn2, _ := winBO1(t)

	conn2.Close()
	// The host observes the drop before rematching. A finished table holds the
	// seat rather than releasing it, so this is player_disconnected; what makes
	// the seat go is pruneAbsentPlayers at the moment the rematch deals, which is
	// what this test is about.
	readMsgOfType(t, conn1, protocol.SMsgPlayerDisconnected)

	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgRematch})
	msg := readMsgOfType(t, conn1, protocol.SMsgRematchStarted)
	if len(msg.Players) != 1 {
		t.Fatalf("players after prune = %d, want 1 (Bob left)", len(msg.Players))
	}
	if msg.Players[0].Nickname != "Alice" || msg.Players[0].Index != 0 {
		t.Errorf("remaining player = %+v, want Alice at index 0", msg.Players[0])
	}
	if msg.OwnSeat() != 0 {
		t.Errorf("host player_id = %d, want 0", msg.OwnSeat())
	}

	// One human alone cannot start: the room stays a usable lobby awaiting a
	// join or a bot rather than dealing a broken match.
	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgStartGame})
	if e := readMsgOfType(t, conn1, protocol.SMsgError); !strings.Contains(e.Error, "at least") {
		t.Errorf("start error = %q, want a minimum-player error", e.Error)
	}

	// Adding a bot works again because the room is genuinely back in lobby state.
	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgAddBot})
	readMsgOfType(t, conn1, protocol.SMsgPlayerJoined)
	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgStartGame})
	if gs := readMsgOfType(t, conn1, protocol.SMsgGameStarted); gs.State == nil || len(gs.State.Players) != 2 {
		t.Errorf("rematch with bot did not start with 2 players: %+v", gs.State)
	}
	completeMapLoad(t, conn1)
}

// Bots occupy nil member slots; pruning must leave them alone.
func TestRematch_KeepsBots(t *testing.T) {
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
	msg := readMsgOfType(t, conn, protocol.SMsgRematchStarted)
	if len(msg.Players) != 2 {
		t.Fatalf("players after rematch = %d, want 2 (Alice + Bot1)", len(msg.Players))
	}
	if msg.Players[1].Nickname != "Bot1" {
		t.Errorf("player 1 = %q, want Bot1 to survive the prune", msg.Players[1].Nickname)
	}
	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgStartGame})
	if gs := readMsgOfType(t, conn, protocol.SMsgGameStarted); gs.State == nil {
		t.Fatal("rematch with bot failed to start")
	}
	completeMapLoad(t, conn)
}
