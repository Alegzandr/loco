package hub_test

import (
	"testing"

	"github.com/gorilla/websocket"
	"loco/server/protocol"
)

// The evening's recap: one row per finished match, kept across the rematch that
// wipes the scoreboard. Without it a group playing six matches on one table ends
// up with nobody able to say who won.

func TestMatchHistory_FirstMatchIsOneRow(t *testing.T) {
	conn1, conn2 := openBO1Table(t)
	end := winMatchReturningEnd(t, conn1, conn2)

	rec := end.MatchHistory
	if len(rec) != 1 {
		t.Fatalf("match_history = %d rows, want 1", len(rec))
	}
	if rec[0].WinnerIndex != 0 {
		t.Errorf("winner_index = %d, want 0", rec[0].WinnerIndex)
	}
	if len(rec[0].RoundsWon) != 2 || rec[0].RoundsWon[0] != 1 || rec[0].RoundsWon[1] != 0 {
		t.Errorf("rounds_won = %v, want [1 0]", rec[0].RoundsWon)
	}
	if len(rec[0].Scores) != 2 {
		t.Errorf("scores = %v, want two seats", rec[0].Scores)
	}
}

// The one that matters: a rematch nils the room's scores, and the recap has to
// outlive that.
func TestMatchHistory_SurvivesARematch(t *testing.T) {
	conn1, conn2, _ := winBO1(t)

	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgRematch})
	readMsgOfType(t, conn1, protocol.SMsgRematchOffered)
	readMsgOfType(t, conn2, protocol.SMsgRematchOffered)
	sendMsg(t, conn2, protocol.ClientMsg{Type: protocol.CMsgRematch})
	readMsgOfType(t, conn1, protocol.SMsgRematchStarted)
	readMsgOfType(t, conn2, protocol.SMsgRematchStarted)

	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgStartGame})
	readMsgOfType(t, conn1, protocol.SMsgGameStarted)
	readMsgOfType(t, conn2, protocol.SMsgGameStarted)
	completeMapLoad(t, conn1, conn2)

	// Second match, won by the same seat. The scoreboard restarted; the recap
	// must not have.
	end := winMatchReturningEnd(t, conn1, conn2)
	if len(end.MatchHistory) != 2 {
		t.Fatalf("match_history after the second match = %d rows, want 2", len(end.MatchHistory))
	}
	for i, row := range end.MatchHistory {
		if row.WinnerIndex != 0 {
			t.Errorf("row %d: winner_index = %d, want 0", i, row.WinnerIndex)
		}
	}
	// And the live scoreboard is this match alone, exactly as before.
	for _, e := range end.Scoreboard {
		if e.RoundsWon > 1 {
			t.Errorf("scoreboard leaked across the rematch: %s has %d rounds won", e.Nickname, e.RoundsWon)
		}
	}
}

// A seat that leaves takes its column with it, and the seats above it re-base.
// Same rule as the tokens, the bots and the gone set: they never shift apart.
func TestMatchHistory_FollowsASeatLeaving(t *testing.T) {
	conn1, conn2, conn3 := winBO1WithThree(t)

	// Bob (seat 1) leaves the finished table; the recap must re-base onto two
	// seats with Carol's column intact.
	sendMsg(t, conn2, protocol.ClientMsg{Type: protocol.CMsgLeaveRoom})
	readMsgOfType(t, conn2, protocol.SMsgLeftRoom)
	readMsgOfType(t, conn1, protocol.SMsgPlayerLeft)
	readMsgOfType(t, conn3, protocol.SMsgPlayerLeft)

	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgRematch})
	readMsgOfType(t, conn1, protocol.SMsgRematchOffered)
	readMsgOfType(t, conn3, protocol.SMsgRematchOffered)
	sendMsg(t, conn3, protocol.ClientMsg{Type: protocol.CMsgRematch})
	readMsgOfType(t, conn1, protocol.SMsgRematchStarted)
	readMsgOfType(t, conn3, protocol.SMsgRematchStarted)

	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgStartGame})
	readMsgOfType(t, conn1, protocol.SMsgGameStarted)
	readMsgOfType(t, conn3, protocol.SMsgGameStarted)
	completeMapLoad(t, conn1, conn3)

	end := winMatchReturningEnd(t, conn1, conn3)
	if len(end.MatchHistory) != 2 {
		t.Fatalf("match_history = %d rows, want 2", len(end.MatchHistory))
	}
	for i, row := range end.MatchHistory {
		if len(row.RoundsWon) != 2 || len(row.Scores) != 2 {
			t.Errorf("row %d: %d/%d seats, want 2 (the departed column should be gone)",
				i, len(row.RoundsWon), len(row.Scores))
		}
	}
	if end.MatchHistory[0].WinnerIndex != 0 {
		t.Errorf("first match winner_index = %d, want 0", end.MatchHistory[0].WinnerIndex)
	}
}

// --- helpers -------------------------------------------------------------

// openBO1Table opens a two-seat table and deals it, stopping short of the win so
// the caller keeps the match_end message.
func openBO1Table(t *testing.T) (*websocket.Conn, *websocket.Conn) {
	t.Helper()
	_, srv := newTestHub(t)

	conn1 := dialWS(t, srv)
	t.Cleanup(func() { conn1.Close() })
	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Alice"})
	code := readMsgOfType(t, conn1, protocol.SMsgRoomCreated).RoomCode

	conn2 := dialWS(t, srv)
	t.Cleanup(func() { conn2.Close() })
	sendMsg(t, conn2, protocol.ClientMsg{Type: protocol.CMsgJoinRoom, Nickname: "Bob", RoomCode: code})
	readMsgOfType(t, conn2, protocol.SMsgRoomJoined)
	readMsgOfType(t, conn1, protocol.SMsgPlayerJoined)

	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgStartGame})
	readMsgOfType(t, conn1, protocol.SMsgGameStarted)
	readMsgOfType(t, conn2, protocol.SMsgGameStarted)
	completeMapLoad(t, conn1, conn2)
	return conn1, conn2
}

// winMatchReturningEnd is winMatchFromHostTurn that hands the match_end back.
func winMatchReturningEnd(t *testing.T, host *websocket.Conn, others ...*websocket.Conn) protocol.ServerMsg {
	t.Helper()
	t.Setenv("LOCO_E2E", "1")
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
	end := readMsgOfType(t, host, protocol.SMsgMatchEnd)
	for _, c := range others {
		readMsgOfType(t, c, protocol.SMsgMatchEnd)
	}
	return end
}

// winBO1WithThree opens a three-seat BO1 table and finishes its first match.
func winBO1WithThree(t *testing.T) (*websocket.Conn, *websocket.Conn, *websocket.Conn) {
	t.Helper()
	_, srv := newTestHub(t)

	conn1 := dialWS(t, srv)
	t.Cleanup(func() { conn1.Close() })
	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Alice"})
	code := readMsgOfType(t, conn1, protocol.SMsgRoomCreated).RoomCode

	conn2 := dialWS(t, srv)
	t.Cleanup(func() { conn2.Close() })
	sendMsg(t, conn2, protocol.ClientMsg{Type: protocol.CMsgJoinRoom, Nickname: "Bob", RoomCode: code})
	readMsgOfType(t, conn2, protocol.SMsgRoomJoined)
	readMsgOfType(t, conn1, protocol.SMsgPlayerJoined)

	conn3 := dialWS(t, srv)
	t.Cleanup(func() { conn3.Close() })
	sendMsg(t, conn3, protocol.ClientMsg{Type: protocol.CMsgJoinRoom, Nickname: "Carol", RoomCode: code})
	readMsgOfType(t, conn3, protocol.SMsgRoomJoined)
	readMsgOfType(t, conn1, protocol.SMsgPlayerJoined)
	readMsgOfType(t, conn2, protocol.SMsgPlayerJoined)

	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgStartGame})
	readMsgOfType(t, conn1, protocol.SMsgGameStarted)
	readMsgOfType(t, conn2, protocol.SMsgGameStarted)
	readMsgOfType(t, conn3, protocol.SMsgGameStarted)
	completeMapLoad(t, conn1, conn2, conn3)

	winMatchReturningEnd(t, conn1, conn2, conn3)
	return conn1, conn2, conn3
}
