package hub_test

import (
	"strings"
	"testing"

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
		Type:             protocol.CMsgDebugSetState,
		DebugHand:        []protocol.CardDTO{winCard},
		DebugDiscard:     &top,
		DebugPendingDraw: &zero,
		DebugCurrentTurn: &turnIdx,
	})
	readMsgOfType(t, host, protocol.SMsgGameState)
	for _, c := range others {
		readMsgOfType(t, c, protocol.SMsgGameState)
	}

	sendMsg(t, host, protocol.ClientMsg{Type: protocol.CMsgPlayCard, Card: &winCard})
	readMsgOfType(t, host, protocol.SMsgMatchEnd)
	for _, c := range others {
		readMsgOfType(t, c, protocol.SMsgMatchEnd)
	}
}

func TestRematch_ReopensRoomForBothPlayers(t *testing.T) {
	conn1, conn2, code := winBO1(t)

	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgRematch})

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

func TestRematch_RejectedForNonHost(t *testing.T) {
	_, conn2, _ := winBO1(t)

	sendMsg(t, conn2, protocol.ClientMsg{Type: protocol.CMsgRematch})
	msg := readMsgOfType(t, conn2, protocol.SMsgError)
	if !strings.Contains(msg.Error, "host") {
		t.Errorf("error = %q, want it to mention the host restriction", msg.Error)
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
	// The host observes the departure before rematching.
	readMsgOfType(t, conn1, protocol.SMsgPlayerLeft)

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
