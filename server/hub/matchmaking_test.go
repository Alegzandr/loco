package hub_test

import (
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"loco/server/hub"
	"loco/server/protocol"
)

// shortReveal collapses the versus screen so the tests below do not spend two
// and a half seconds each waiting for presentation.
func shortReveal(t *testing.T) {
	t.Helper()
	prev := hub.MatchmakingRevealDelay
	hub.MatchmakingRevealDelay = 30 * time.Millisecond
	t.Cleanup(func() { hub.MatchmakingRevealDelay = prev })
}

// queueUp sends find_match and returns the acknowledgement.
func queueUp(t *testing.T, srv *httptest.Server, nickname string) *websocket.Conn {
	t.Helper()
	conn := dialWS(t, srv)
	t.Cleanup(func() { conn.Close() })
	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgFindMatch, Nickname: nickname})
	readMsgOfType(t, conn, protocol.SMsgMatchmakingQueued)
	return conn
}

// A lone player waits. The acknowledgement says nothing about how many other
// people are searching, which is the rule the whole mode is built on: a count
// that reads "1" is an instruction to give up.
func TestMatchmaking_FirstPlayerWaitsAndLearnsNothingAboutTheQueue(t *testing.T) {
	_, srv := newTestHub(t)
	conn := dialWS(t, srv)
	t.Cleanup(func() { conn.Close() })

	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgFindMatch, Nickname: "Alice"})
	ack := readMsgOfType(t, conn, protocol.SMsgMatchmakingQueued)

	if ack.Players != nil || ack.MaxPlayers != 0 || ack.RoomCode != "" {
		t.Errorf("matchmaking_queued leaked room or roster data: %+v", ack)
	}

	// And nothing else arrives: there is nobody to pair with.
	conn.SetReadDeadline(time.Now().Add(200 * time.Millisecond))
	if _, _, err := conn.ReadMessage(); err == nil {
		t.Error("a solitary searcher was sent a second message; want silence until an opponent arrives")
	}
}

func TestMatchmaking_PairsTwoPlayersAndDealsWithoutAnybodyPressingStart(t *testing.T) {
	shortReveal(t)
	_, srv := newTestHub(t)

	a := queueUp(t, srv, "Alice")
	b := queueUp(t, srv, "Bob")

	foundA := readMsgOfType(t, a, protocol.SMsgMatchFound)
	foundB := readMsgOfType(t, b, protocol.SMsgMatchFound)

	if foundA.RoomCode == "" || foundA.RoomCode != foundB.RoomCode {
		t.Fatalf("match_found room codes = %q / %q, want one shared code", foundA.RoomCode, foundB.RoomCode)
	}
	if foundA.OwnSeat() != 0 || foundB.OwnSeat() != 1 {
		t.Errorf("seats = %d / %d, want 0 / 1", foundA.OwnSeat(), foundB.OwnSeat())
	}
	if foundA.SessionToken == "" || foundA.SessionToken == foundB.SessionToken {
		t.Error("each seat must get its own session token")
	}
	if foundA.MaxPlayers != 2 {
		t.Errorf("max_players = %d, want 2 (the mode is 1v1)", foundA.MaxPlayers)
	}
	if len(foundA.Players) != 2 {
		t.Fatalf("players = %d, want 2", len(foundA.Players))
	}
	if foundA.StartsInMs <= 0 {
		t.Error("starts_in_ms must tell the client how long the reveal lasts")
	}

	// Nobody sends start_game. The match deals itself.
	readMsgOfType(t, a, protocol.SMsgGameStarted)
	readMsgOfType(t, b, protocol.SMsgGameStarted)
	completeMapLoad(t, a, b)
}

// Two strangers picking the same name is ordinary, and it must not fail a
// pairing neither of them did anything wrong in.
func TestMatchmaking_DisambiguatesIdenticalNicknames(t *testing.T) {
	shortReveal(t)
	_, srv := newTestHub(t)

	a := queueUp(t, srv, "Alex")
	b := queueUp(t, srv, "Alex")

	found := readMsgOfType(t, a, protocol.SMsgMatchFound)
	readMsgOfType(t, b, protocol.SMsgMatchFound)
	if len(found.Players) != 2 {
		t.Fatalf("players = %d, want 2", len(found.Players))
	}
	if found.Players[0].Nickname == found.Players[1].Nickname {
		t.Errorf("both seats are named %q; the second must be disambiguated", found.Players[0].Nickname)
	}
	if found.Players[0].Nickname != "Alex" {
		t.Errorf("first seat = %q, want the name they typed", found.Players[0].Nickname)
	}
}

func TestMatchmaking_CancelTakesThePlayerOutOfTheQueue(t *testing.T) {
	shortReveal(t)
	_, srv := newTestHub(t)

	a := queueUp(t, srv, "Alice")
	sendMsg(t, a, protocol.ClientMsg{Type: protocol.CMsgCancelMatchmaking})
	readMsgOfType(t, a, protocol.SMsgMatchmakingCancelled)

	// A second player arriving now has nobody to be paired with.
	b := queueUp(t, srv, "Bob")
	b.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
	if _, _, err := b.ReadMessage(); err == nil {
		t.Error("a cancelled searcher was still paired")
	}
}

// A socket that goes away must not be paired with somebody who is still there:
// the survivor would be seated opposite an empty chair.
func TestMatchmaking_DisconnectLeavesTheQueue(t *testing.T) {
	shortReveal(t)
	_, srv := newTestHub(t)

	a := queueUp(t, srv, "Alice")
	a.Close()
	// Give the hub its unregister.
	time.Sleep(100 * time.Millisecond)

	b := queueUp(t, srv, "Bob")
	b.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
	if _, _, err := b.ReadMessage(); err == nil {
		t.Error("a departed searcher was still paired")
	}
}

// A matchmade room has no host: the format is fixed, the size is two, the match
// starts by itself and there is nobody to add a bot for.
func TestMatchmaking_HostControlsAreRefused(t *testing.T) {
	shortReveal(t)
	_, srv := newTestHub(t)

	a := queueUp(t, srv, "Alice")
	b := queueUp(t, srv, "Bob")
	readMsgOfType(t, a, protocol.SMsgMatchFound)
	readMsgOfType(t, b, protocol.SMsgMatchFound)
	readMsgOfType(t, a, protocol.SMsgGameStarted)
	readMsgOfType(t, b, protocol.SMsgGameStarted)
	completeMapLoad(t, a, b)

	for _, msg := range []protocol.ClientMsg{
		{Type: protocol.CMsgAddBot},
		{Type: protocol.CMsgStartGame},
		{Type: protocol.CMsgSetMatchFormat, MatchFormat: "BO7"},
		{Type: protocol.CMsgSetMaxPlayers, MaxPlayers: 4},
		// `rematch` is deliberately not in this list: it is not refused in a
		// matchmade room, it means something else there. See the rematch tests.
	} {
		sendMsg(t, a, msg)
		got := readMsgOfType(t, a, protocol.SMsgError)
		if got.Error != "not available in a matchmade game" {
			t.Errorf("%s: error = %q, want the matchmade refusal", msg.Type, got.Error)
		}
	}
}

// The frustrating case, and the reason the mode has its own timings: the
// opponent stops being there. The player who is still at the table must be told
// the match is over, not left auto-passing against an empty seat.
func TestMatchmaking_OpponentDisconnectForfeitsAfterTheShortHold(t *testing.T) {
	shortReveal(t)
	prev := hub.MatchmakingReconnectTimeout
	hub.MatchmakingReconnectTimeout = 150 * time.Millisecond
	t.Cleanup(func() { hub.MatchmakingReconnectTimeout = prev })

	_, srv := newTestHub(t)
	a := queueUp(t, srv, "Alice")
	b := queueUp(t, srv, "Bob")
	readMsgOfType(t, a, protocol.SMsgMatchFound)
	readMsgOfType(t, b, protocol.SMsgMatchFound)
	readMsgOfType(t, a, protocol.SMsgGameStarted)
	readMsgOfType(t, b, protocol.SMsgGameStarted)
	completeMapLoad(t, a, b)

	b.Close()

	gone := readMsgOfType(t, a, protocol.SMsgPlayerDisconnected)
	if gone.ForfeitDeadline == 0 {
		t.Error("player_disconnected carried no forfeit deadline: the player left at the table gets no countdown")
	}

	end := readMsgOfType(t, a, protocol.SMsgMatchEnd)
	if !end.Forfeit {
		t.Error("match_end.forfeit = false, want true")
	}
	if end.MatchWinner != "Alice" {
		t.Errorf("match_winner = %q, want Alice", end.MatchWinner)
	}
	if end.Seat() != 1 {
		t.Errorf("match_end named seat %d as the one that left, want 1", end.Seat())
	}
}

// An ordinary room keeps the 60s hold and does not forfeit: those are people
// who came in together, and the hold exists so a drop is not the end.
func TestMatchmaking_OrdinaryRoomDoesNotForfeitOnDisconnect(t *testing.T) {
	prevReconnect := hub.ReconnectTimeout
	hub.ReconnectTimeout = 150 * time.Millisecond
	t.Cleanup(func() { hub.ReconnectTimeout = prevReconnect })

	_, srv := newTestHub(t)
	conn1, conn2, _ := setupTwoPlayerGame(t, srv)
	_ = conn2
	conn2.Close()

	gone := readMsgOfType(t, conn1, protocol.SMsgPlayerDisconnected)
	if gone.ForfeitDeadline != 0 {
		t.Errorf("forfeit_deadline = %d in an ordinary room, want 0", gone.ForfeitDeadline)
	}
	left := readMsgOfType(t, conn1, protocol.SMsgPlayerLeft)
	if left.Type != protocol.SMsgPlayerLeft {
		t.Fatal("expected player_left")
	}
	conn1.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
	for {
		var msg protocol.ServerMsg
		if err := conn1.ReadJSON(&msg); err != nil {
			break
		}
		if msg.Type == protocol.SMsgMatchEnd {
			t.Fatal("an ordinary room forfeited a match on a disconnect")
		}
	}
}

// Quitting on purpose is a forfeit, announced as one and immediate: there is
// nothing to wait for when the player has said they are leaving.
func TestMatchmaking_LeaveRoomForfeitsImmediately(t *testing.T) {
	shortReveal(t)
	_, srv := newTestHub(t)

	a := queueUp(t, srv, "Alice")
	b := queueUp(t, srv, "Bob")
	readMsgOfType(t, a, protocol.SMsgMatchFound)
	readMsgOfType(t, b, protocol.SMsgMatchFound)
	readMsgOfType(t, a, protocol.SMsgGameStarted)
	readMsgOfType(t, b, protocol.SMsgGameStarted)
	completeMapLoad(t, a, b)

	sendMsg(t, b, protocol.ClientMsg{Type: protocol.CMsgLeaveRoom})

	end := readMsgOfType(t, a, protocol.SMsgMatchEnd)
	if !end.Forfeit || end.MatchWinner != "Alice" {
		t.Errorf("match_end = %+v, want a forfeit won by Alice", end)
	}
	readMsgOfType(t, b, protocol.SMsgLeftRoom)
}

// The other half of "nobody waits for somebody who is not there": a player who
// is connected but has stopped playing. Two turn timeouts end the match, rather
// than four followed by a reconnect hold nobody at the table agreed to sit
// through. Whoever is left gets the win; the seat that went quiet is named.
func TestMatchmaking_AFKForfeitsTheMatch(t *testing.T) {
	shortReveal(t)
	prevTurn := hub.TurnTimeout
	hub.TurnTimeout = 80 * time.Millisecond
	t.Cleanup(func() { hub.TurnTimeout = prevTurn })

	_, srv := newTestHub(t)
	a := queueUp(t, srv, "Alice")
	b := queueUp(t, srv, "Bob")
	readMsgOfType(t, a, protocol.SMsgMatchFound)
	readMsgOfType(t, b, protocol.SMsgMatchFound)
	readMsgOfType(t, a, protocol.SMsgGameStarted)
	readMsgOfType(t, b, protocol.SMsgGameStarted)
	completeMapLoad(t, a, b)

	// Neither of them plays. Turns alternate, so the seat that started runs out
	// of its second turn first and is the one declared away.
	end := waitForType(t, a, protocol.SMsgMatchEnd, 60)
	if !end.Forfeit {
		t.Error("match_end.forfeit = false: an AFK match must end as a forfeit, not as a win on points")
	}
	away := end.Seat()
	if away < 0 || away > 1 {
		t.Fatalf("match_end named seat %d, want the seat that went quiet", away)
	}
	if want := []string{"Alice", "Bob"}[1-away]; end.MatchWinner != want {
		t.Errorf("match_winner = %q, want %q (the seat still at the table)", end.MatchWinner, want)
	}
	waitForType(t, b, protocol.SMsgMatchEnd, 60)
}

// waitForType is readMsgOfType with room for the traffic a few auto-played
// turns produce before the message under test.
func waitForType(t *testing.T, conn *websocket.Conn, typ protocol.ServerMsgType, limit int) protocol.ServerMsg {
	t.Helper()
	for i := 0; i < limit; i++ {
		msg := readMsg(t, conn)
		if msg.Type == typ {
			return msg
		}
	}
	t.Fatalf("did not receive %q within %d messages", typ, limit)
	return protocol.ServerMsg{}
}

// A rematch between two strangers is an agreement, not a decision: one offer
// changes nothing on its own.
//
// The negative read ends this test, deliberately. A read that times out leaves a
// gorilla connection permanently broken, so "nothing arrived" has to be the last
// thing a socket is asked.
func TestMatchmaking_OneRematchOfferDealsNothing(t *testing.T) {
	t.Setenv("LOCO_E2E", "1")
	shortReveal(t)
	_, srv := newTestHub(t)

	a, b := pairedMatch(t, srv)
	finishRoundForSeat(t, a, b)

	sendMsg(t, a, protocol.ClientMsg{Type: protocol.CMsgRematch})
	offered := readMsgOfType(t, a, protocol.SMsgRematchOffered)
	if offered.Seat() != 0 {
		t.Errorf("rematch_offered named seat %d, want 0", offered.Seat())
	}
	// The other side is told somebody is waiting on them: an offer nobody can
	// see is an offer nobody answers.
	if got := readMsgOfType(t, b, protocol.SMsgRematchOffered); got.Seat() != 0 {
		t.Errorf("the opponent was told seat %d offered, want 0", got.Seat())
	}

	a.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
	if _, _, err := a.ReadMessage(); err == nil {
		t.Error("a single rematch offer started a match on its own")
	}
}

// Both offers in, and the same two are dealt again: another reveal, another
// match, no queue in between.
func TestMatchmaking_BothOffersDealTheSamePairAgain(t *testing.T) {
	t.Setenv("LOCO_E2E", "1")
	shortReveal(t)
	_, srv := newTestHub(t)

	a, b := pairedMatch(t, srv)
	finishRoundForSeat(t, a, b)

	sendMsg(t, a, protocol.ClientMsg{Type: protocol.CMsgRematch})
	readMsgOfType(t, a, protocol.SMsgRematchOffered)
	readMsgOfType(t, b, protocol.SMsgRematchOffered)

	sendMsg(t, b, protocol.ClientMsg{Type: protocol.CMsgRematch})
	found := readMsgOfType(t, a, protocol.SMsgMatchFound)
	readMsgOfType(t, b, protocol.SMsgMatchFound)
	if len(found.Players) != 2 {
		t.Fatalf("rematch dealt %d players, want the same 2", len(found.Players))
	}
	if found.OwnSeat() != 0 {
		t.Errorf("seat = %d, want the seat they already had", found.OwnSeat())
	}
	readMsgOfType(t, a, protocol.SMsgGameStarted)
	readMsgOfType(t, b, protocol.SMsgGameStarted)
	completeMapLoad(t, a, b)
}

// pairedMatch queues two players and takes them through to an open table.
func pairedMatch(t *testing.T, srv *httptest.Server) (a, b *websocket.Conn) {
	t.Helper()
	a = queueUp(t, srv, "Alice")
	b = queueUp(t, srv, "Bob")
	readMsgOfType(t, a, protocol.SMsgMatchFound)
	readMsgOfType(t, b, protocol.SMsgMatchFound)
	readMsgOfType(t, a, protocol.SMsgGameStarted)
	readMsgOfType(t, b, protocol.SMsgGameStarted)
	completeMapLoad(t, a, b)
	return a, b
}

// There is nobody to agree with once the other side has gone. The client's
// other button, which finds the next opponent, is the answer to that.
func TestMatchmaking_RematchRefusedWhenTheOpponentHasLeft(t *testing.T) {
	shortReveal(t)
	_, srv := newTestHub(t)

	a := queueUp(t, srv, "Alice")
	b := queueUp(t, srv, "Bob")
	readMsgOfType(t, a, protocol.SMsgMatchFound)
	readMsgOfType(t, b, protocol.SMsgMatchFound)
	readMsgOfType(t, a, protocol.SMsgGameStarted)
	readMsgOfType(t, b, protocol.SMsgGameStarted)
	completeMapLoad(t, a, b)

	sendMsg(t, b, protocol.ClientMsg{Type: protocol.CMsgLeaveRoom})
	readMsgOfType(t, a, protocol.SMsgMatchEnd)

	sendMsg(t, a, protocol.ClientMsg{Type: protocol.CMsgRematch})
	got := readMsgOfType(t, a, protocol.SMsgError)
	if got.Error != "your opponent has left the table" {
		t.Errorf("error = %q, want the departed-opponent refusal", got.Error)
	}
}

// finishRoundForSeat plays `winner` down to an empty hand through the debug
// seam, which is the only end to a match that leaves both players seated.
func finishRoundForSeat(t *testing.T, winner, other *websocket.Conn) {
	t.Helper()
	// One card each, ours playable on the discard: playing it ends the round,
	// and a BO1 round ending ends the match.
	sendMsg(t, winner, protocol.ClientMsg{
		Type: protocol.CMsgDebugSetState,
		DebugHands: []protocol.DebugHandOverrideDTO{
			{PlayerIndex: 0, Hand: []protocol.CardDTO{{Color: "red", Kind: "number", Value: 5}}},
			{PlayerIndex: 1, Hand: []protocol.CardDTO{{Color: "blue", Kind: "number", Value: 9}}},
		},
		DebugDiscard:     &protocol.CardDTO{Color: "red", Kind: "number", Value: 3},
		DebugActiveColor: "red",
		DebugPendingDraw: intPtrTest(0),
		DebugCurrentTurn: intPtrTest(0),
		DebugDirection:   intPtrTest(1),
	})
	readMsgOfType(t, winner, protocol.SMsgGameState)
	sendMsg(t, winner, protocol.ClientMsg{
		Type: protocol.CMsgPlayCard,
		Card: &protocol.CardDTO{Color: "red", Kind: "number", Value: 5},
	})
	readMsgOfType(t, winner, protocol.SMsgMatchEnd)
	readMsgOfType(t, other, protocol.SMsgMatchEnd)
}

func intPtrTest(v int) *int { return &v }

// An ordinary match has no quit button and must not gain one through the wire:
// leaving one mid-match would hand a group's game away on a stray message.
func TestMatchmaking_LeaveRoomRefusedInAnOrdinaryMatch(t *testing.T) {
	_, srv := newTestHub(t)
	conn1, _, _ := setupTwoPlayerGame(t, srv)

	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgLeaveRoom})
	got := readMsgOfType(t, conn1, protocol.SMsgError)
	if got.Error != "you cannot leave a match in progress" {
		t.Errorf("error = %q, want the mid-match refusal", got.Error)
	}
}

// "Find another opponent" is one button on the game-over screen: a player still
// sitting in the finished room goes straight back into the queue.
func TestMatchmaking_FindMatchReleasesAFinishedSeat(t *testing.T) {
	shortReveal(t)
	_, srv := newTestHub(t)

	a := queueUp(t, srv, "Alice")
	b := queueUp(t, srv, "Bob")
	readMsgOfType(t, a, protocol.SMsgMatchFound)
	readMsgOfType(t, b, protocol.SMsgMatchFound)
	readMsgOfType(t, a, protocol.SMsgGameStarted)
	readMsgOfType(t, b, protocol.SMsgGameStarted)
	completeMapLoad(t, a, b)

	// Bob quits, which finishes the match for both of them.
	sendMsg(t, b, protocol.ClientMsg{Type: protocol.CMsgLeaveRoom})
	readMsgOfType(t, a, protocol.SMsgMatchEnd)

	// Alice, still seated in the finished room, searches again.
	sendMsg(t, a, protocol.ClientMsg{Type: protocol.CMsgFindMatch, Nickname: "Alice"})
	readMsgOfType(t, a, protocol.SMsgMatchmakingQueued)

	c := queueUp(t, srv, "Carol")
	found := readMsgOfType(t, a, protocol.SMsgMatchFound)
	readMsgOfType(t, c, protocol.SMsgMatchFound)
	if len(found.Players) != 2 {
		t.Fatalf("players = %d, want a fresh 1v1", len(found.Players))
	}
}

// A player who is actually playing cannot queue out from under their opponent.
func TestMatchmaking_FindMatchRefusedDuringAMatch(t *testing.T) {
	_, srv := newTestHub(t)
	conn1, _, _ := setupTwoPlayerGame(t, srv)

	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgFindMatch, Nickname: "Alice"})
	got := readMsgOfType(t, conn1, protocol.SMsgError)
	if got.Error != "already in a room" {
		t.Errorf("error = %q, want %q", got.Error, "already in a room")
	}
}
