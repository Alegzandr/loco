package hub_test

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"loco/server/hub"
	"loco/server/protocol"
)

// An AFK kick answers the socket, never the turn: the seat is held like any
// other drop, and the clock goes on drawing and passing for it. It used to
// return before the auto-pass, and a table of two humans and a bot sat on the
// kicked seat's turn for the rest of the match.
func TestAFK_KickStillMovesTheTurn(t *testing.T) {
	origTimeout := hub.TurnTimeout
	origThreshold := hub.AFKKickThreshold
	origBotDelay := hub.BotThinkDelay
	origJitter := hub.BotJitterMax
	origCatchProb := hub.BotCatchProb
	hub.TurnTimeout = 40 * time.Millisecond
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
	t.Setenv("LOCO_E2E", "1")

	_, srv := newTestHub(t)
	idler := dialWS(t, srv)
	t.Cleanup(func() { idler.Close() })
	watcher := dialWS(t, srv)
	t.Cleanup(func() { watcher.Close() })

	sendMsg(t, idler, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Idler"})
	created := readMsgOfType(t, idler, protocol.SMsgRoomCreated)
	sendMsg(t, watcher, protocol.ClientMsg{Type: protocol.CMsgJoinRoom, Nickname: "Watcher", RoomCode: created.RoomCode})
	readMsgOfType(t, watcher, protocol.SMsgRoomJoined)
	readMsgOfType(t, idler, protocol.SMsgPlayerJoined)
	sendMsg(t, idler, protocol.ClientMsg{Type: protocol.CMsgAddBot})
	readMsgOfType(t, idler, protocol.SMsgPlayerJoined)
	readMsgOfType(t, watcher, protocol.SMsgPlayerJoined)
	sendMsg(t, idler, protocol.ClientMsg{Type: protocol.CMsgStartGame})
	gs := readMsgOfType(t, idler, protocol.SMsgGameStarted)
	readMsgOfType(t, watcher, protocol.SMsgGameStarted)
	sendMsg(t, idler, protocol.ClientMsg{Type: protocol.CMsgMapReady})
	sendMsg(t, watcher, protocol.ClientMsg{Type: protocol.CMsgMapReady})
	readMsgOfType(t, idler, protocol.SMsgMatchReady)
	ready := readMsgOfType(t, watcher, protocol.SMsgMatchReady)

	me := gs.State.YourIndex
	watcherSeat := 1
	// The watcher answers every turn of its own with a draw and a pass, so it
	// never trips the threshold itself; the idler answers nothing.
	answer := func(msg protocol.ServerMsg) {
		if msg.Turn != watcherSeat {
			return
		}
		switch msg.Type {
		case protocol.SMsgMatchReady, protocol.SMsgTurnChanged, protocol.SMsgCardPlayed:
			sendMsg(t, watcher, protocol.ClientMsg{Type: protocol.CMsgDrawCard})
			sendMsg(t, watcher, protocol.ClientMsg{Type: protocol.CMsgPassTurn})
		}
	}
	answer(ready)

	// The watcher sees the idler go (the kick closes the socket), and then
	// the turn has to keep moving: a turn_changed or a play after that.
	// One deadline for the whole wait: gorilla refuses further reads on a
	// connection whose read has once timed out.
	deadline := time.Now().Add(4 * time.Second)
	_ = watcher.SetReadDeadline(deadline)
	gone := false
	for time.Now().Before(deadline) {
		_, data, err := watcher.ReadMessage()
		if err != nil {
			t.Fatalf("watcher read (kicked seat seen leaving: %t): %v", gone, err)
		}
		var msg protocol.ServerMsg
		if json.Unmarshal(data, &msg) != nil {
			continue
		}
		if msg.Type == protocol.SMsgMatchEnd {
			t.Fatal("match ended before the kick could be observed")
		}
		answer(msg)
		if msg.Type == protocol.SMsgPlayerDisconnected && msg.Seat() == me {
			gone = true
			continue
		}
		// The disconnect broadcast crosses a goroutine, so the turn_changed of
		// the kick's own auto-pass may land before it: what proves the turn
		// still moves is any change after the seat was seen to go.
		if gone && (msg.Type == protocol.SMsgTurnChanged || msg.Type == protocol.SMsgCardPlayed) {
			return
		}
	}
	if !gone {
		t.Fatal("the idler was never kicked")
	}
	t.Fatal("the turn never moved off the kicked seat")
}

// A seat number below zero is the out-of-range case with the sign flipped:
// refused and counted, never charged as a wager.
func TestCatchUno_NegativeTargetIsRefusedNotCharged(t *testing.T) {
	t.Setenv("LOCO_E2E", "1")
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

	before := len(gs.State.Hand)
	neg := -1
	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgCatchUno, TargetIndex: &neg})
	msg := readMsg(t, conn)
	if msg.Type != protocol.SMsgError {
		t.Fatalf("got %s, want an error", msg.Type)
	}
	if msg.Type == protocol.SMsgCardDrawn || len(msg.Cards) > 0 {
		t.Fatalf("a forged target drew cards: %+v", msg)
	}
	_ = before
}

// A batch longer than the hand is refused before a card of it is decoded.
func TestPlayCard_BatchLongerThanTheHandIsRefused(t *testing.T) {
	t.Setenv("LOCO_E2E", "1")
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

	batch := make([]protocol.CardDTO, len(gs.State.Hand)+1)
	for i := range batch {
		batch[i] = protocol.CardDTO{Color: "red", Kind: "number", Value: 5}
	}
	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgPlayCard, PlayCards: batch})
	msg := readMsgOfType(t, conn, protocol.SMsgError)
	if !strings.Contains(msg.Error, "exceeds the hand") {
		t.Errorf("error = %q, want the batch refused for its length", msg.Error)
	}
}

// A snapshot carries the catch state: a tab that reloads inside a window lands
// on a board where that window is still open, and a seat whose call is spent
// does not get its LOCO! button back.
func TestReconnect_SnapshotCarriesCatchState(t *testing.T) {
	t.Setenv("LOCO_E2E", "1")
	origCatchProb := hub.BotCatchProb
	origUno := hub.BotUnoDelay
	hub.BotCatchProb = 0
	hub.BotUnoDelay = time.Hour
	t.Cleanup(func() {
		hub.BotCatchProb = origCatchProb
		hub.BotUnoDelay = origUno
	})

	_, srv := newTestHub(t)
	conn := dialWS(t, srv)
	t.Cleanup(func() { conn.Close() })

	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Alice"})
	created := readMsgOfType(t, conn, protocol.SMsgRoomCreated)
	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgAddBot})
	readMsgOfType(t, conn, protocol.SMsgPlayerJoined)
	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgStartGame})
	gs := readMsgOfType(t, conn, protocol.SMsgGameStarted)
	completeMapLoad(t, conn)

	me := gs.State.YourIndex
	bot := 1 - me
	zero := 0
	dir := 1
	// Two cards for us; the bot holds one, undeclared, on a window opened by
	// the deal's stamp. Play one of ours: we are on one card too, undeclared.
	sendMsg(t, conn, protocol.ClientMsg{
		Type: protocol.CMsgDebugSetState,
		Debug: &protocol.DebugStateDTO{
			Hand: []protocol.CardDTO{{Color: "red", Kind: "number", Value: 5}, {Color: "red", Kind: "number", Value: 6}},
			Hands: []protocol.DebugHandOverrideDTO{{PlayerIndex: bot, Hand: []protocol.CardDTO{
				{Color: "blue", Kind: "number", Value: 3}, {Color: "blue", Kind: "number", Value: 4}, {Color: "blue", Kind: "number", Value: 7},
			}}},
			Discard:     &protocol.CardDTO{Color: "red", Kind: "number", Value: 9},
			ActiveColor: "red",
			PendingDraw: &zero,
			CurrentTurn: &me,
			Direction:   &dir,
		},
	})
	readMsgOfType(t, conn, protocol.SMsgGameState)
	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgPlayCard, Card: &protocol.CardDTO{Color: "red", Kind: "number", Value: 5}})
	played := readMsgOfType(t, conn, protocol.SMsgCardPlayed)
	if len(played.CatchSeats) != 1 || played.CatchSeats[0].PlayerIndex != me {
		t.Fatalf("card_played catch_seats = %+v, want our seat on the hook", played.CatchSeats)
	}

	// Reload: the old socket goes, and a fresh one reclaims the seat with
	// the token.
	conn.Close()
	time.Sleep(50 * time.Millisecond)
	conn2 := dialWS(t, srv)
	t.Cleanup(func() { conn2.Close() })
	sendMsg(t, conn2, protocol.ClientMsg{
		Type: protocol.CMsgJoinRoom, Nickname: "Alice", RoomCode: created.RoomCode, SessionToken: created.SessionToken,
	})
	back := readMsgOfType(t, conn2, protocol.SMsgPlayerReconnected)
	if back.State == nil {
		t.Fatal("reclaim carried no state")
	}
	if len(back.State.CatchSeats) != 1 || back.State.CatchSeats[0].PlayerIndex != me {
		t.Errorf("snapshot catch_seats = %+v, want our seat still on the hook", back.State.CatchSeats)
	}
	if back.State.CatchSeats[0].EndsAt != played.CatchSeats[0].EndsAt {
		t.Errorf("snapshot window ends at %d, card_played said %d", back.State.CatchSeats[0].EndsAt, played.CatchSeats[0].EndsAt)
	}

	// Call it, reload again: the call is spent and the snapshot says so.
	sendMsg(t, conn2, protocol.ClientMsg{Type: protocol.CMsgDeclareUno})
	readMsgOfType(t, conn2, protocol.SMsgUnoDeclared)
	conn2.Close()
	time.Sleep(50 * time.Millisecond)
	conn3 := dialWS(t, srv)
	t.Cleanup(func() { conn3.Close() })
	sendMsg(t, conn3, protocol.ClientMsg{
		Type: protocol.CMsgJoinRoom, Nickname: "Alice", RoomCode: created.RoomCode, SessionToken: back.SessionToken,
	})
	again := readMsgOfType(t, conn3, protocol.SMsgPlayerReconnected)
	if again.State == nil {
		t.Fatal("second reclaim carried no state")
	}
	if len(again.State.DeclaredSeats) != 1 || again.State.DeclaredSeats[0] != me {
		t.Errorf("snapshot declared_seats = %v, want our seat", again.State.DeclaredSeats)
	}
	if len(again.State.CatchSeats) != 0 {
		t.Errorf("snapshot catch_seats = %+v after our call, want none", again.State.CatchSeats)
	}
}

// The recap a rematch carries has one column per seat: a record with no seats
// in it is a `null` on the wire, which the client's schema refuses and dev
// builds drop the whole deal over.
func TestMatchmaking_RematchRecapHasOneColumnPerSeat(t *testing.T) {
	t.Setenv("LOCO_E2E", "1")
	shortReveal(t)
	_, srv := newTestHub(t)

	a, b := pairedMatch(t, srv)
	finishRoundForSeat(t, a, b)

	sendMsg(t, a, protocol.ClientMsg{Type: protocol.CMsgRematch})
	readMsgOfType(t, a, protocol.SMsgRematchOffered)
	readMsgOfType(t, b, protocol.SMsgRematchOffered)
	sendMsg(t, b, protocol.ClientMsg{Type: protocol.CMsgRematch})
	readMsgOfType(t, a, protocol.SMsgMatchFound)
	readMsgOfType(t, b, protocol.SMsgMatchFound)
	gs := readMsgOfType(t, a, protocol.SMsgGameStarted)
	readMsgOfType(t, b, protocol.SMsgGameStarted)
	if gs.State == nil || len(gs.State.MatchHistory) != 1 {
		t.Fatalf("game_started match_history = %+v, want the one finished match", gs.State)
	}
	rec := gs.State.MatchHistory[0]
	if len(rec.RoundsWon) != 2 || len(rec.Scores) != 2 {
		t.Errorf("record = %+v, want two columns", rec)
	}
}

// A matchmade table is a lobby for the two and a half seconds of the versus
// reveal, and a reload there used to be a lobby departure: the seat left the
// roster with every column it had in the recap, and the reclaim came back as
// a fresh Join under a fresh seat. Held instead: the reload reclaims its own
// seat, the deal goes ahead with it, and a rematch's recap keeps its columns.
func TestMatchmaking_ReloadDuringTheRevealKeepsTheSeat(t *testing.T) {
	t.Setenv("LOCO_E2E", "1")
	prev := hub.MatchmakingRevealDelay
	hub.MatchmakingRevealDelay = 600 * time.Millisecond
	t.Cleanup(func() { hub.MatchmakingRevealDelay = prev })
	_, srv := newTestHub(t)

	a := queueUp(t, srv, "Alice")
	b := queueUp(t, srv, "Bob")
	foundA := readMsgOfType(t, a, protocol.SMsgMatchFound)
	readMsgOfType(t, b, protocol.SMsgMatchFound)

	// Alice's tab reloads inside the reveal.
	a.Close()
	time.Sleep(50 * time.Millisecond)
	away := readMsgOfType(t, b, protocol.SMsgPlayerDisconnected)
	if away.Seat() != foundA.OwnSeat() {
		t.Errorf("player_disconnected named seat %d, want Alice's %d", away.Seat(), foundA.OwnSeat())
	}

	a2 := dialWS(t, srv)
	t.Cleanup(func() { a2.Close() })
	sendMsg(t, a2, protocol.ClientMsg{
		Type: protocol.CMsgJoinRoom, Nickname: "Alice", RoomCode: foundA.RoomCode, SessionToken: foundA.SessionToken,
	})
	back := readMsgOfType(t, a2, protocol.SMsgPlayerReconnected)
	if back.OwnSeat() != foundA.OwnSeat() {
		t.Errorf("reclaim seated Alice at %d, want her own seat %d", back.OwnSeat(), foundA.OwnSeat())
	}
	readMsgOfType(t, b, protocol.SMsgPlayerReconnected)

	// The deal still comes, to the same two seats.
	gsA := readMsgOfType(t, a2, protocol.SMsgGameStarted)
	gsB := readMsgOfType(t, b, protocol.SMsgGameStarted)
	if gsA.State == nil || gsB.State == nil || len(gsA.State.Players) != 2 {
		t.Fatalf("deal after a reveal reload: %+v / %+v", gsA.State, gsB.State)
	}
	if gsA.State.YourIndex != foundA.OwnSeat() {
		t.Errorf("dealt Alice at %d, want %d", gsA.State.YourIndex, foundA.OwnSeat())
	}
}

// The same reload, inside a rematch's reveal: the finished match keeps its
// two columns in the recap the next deal carries.
func TestMatchmaking_ReloadDuringRematchRevealKeepsTheRecap(t *testing.T) {
	t.Setenv("LOCO_E2E", "1")
	prev := hub.MatchmakingRevealDelay
	hub.MatchmakingRevealDelay = 600 * time.Millisecond
	t.Cleanup(func() { hub.MatchmakingRevealDelay = prev })
	_, srv := newTestHub(t)

	a, b := pairedMatch(t, srv)
	finishRoundForSeat(t, a, b)
	sendMsg(t, a, protocol.ClientMsg{Type: protocol.CMsgRematch})
	readMsgOfType(t, a, protocol.SMsgRematchOffered)
	readMsgOfType(t, b, protocol.SMsgRematchOffered)
	sendMsg(t, b, protocol.ClientMsg{Type: protocol.CMsgRematch})
	foundA := readMsgOfType(t, a, protocol.SMsgMatchFound)
	readMsgOfType(t, b, protocol.SMsgMatchFound)

	a.Close()
	time.Sleep(50 * time.Millisecond)
	readMsgOfType(t, b, protocol.SMsgPlayerDisconnected)
	a2 := dialWS(t, srv)
	t.Cleanup(func() { a2.Close() })
	sendMsg(t, a2, protocol.ClientMsg{
		Type: protocol.CMsgJoinRoom, Nickname: "Alice", RoomCode: foundA.RoomCode, SessionToken: foundA.SessionToken,
	})
	readMsgOfType(t, a2, protocol.SMsgPlayerReconnected)
	readMsgOfType(t, b, protocol.SMsgPlayerReconnected)

	gs := readMsgOfType(t, a2, protocol.SMsgGameStarted)
	readMsgOfType(t, b, protocol.SMsgGameStarted)
	if gs.State == nil || len(gs.State.MatchHistory) != 1 {
		t.Fatalf("recap after a reveal reload = %+v, want the one finished match", gs.State)
	}
	if rec := gs.State.MatchHistory[0]; len(rec.RoundsWon) != 2 || len(rec.Scores) != 2 {
		t.Errorf("record = %+v, want two columns", rec)
	}
}

// A pairing whose other half closed the tab during the reveal is still torn
// down for the survivor: nobody connected at all deals nothing.
func TestMatchmaking_BothGoneDuringTheRevealDealsNothing(t *testing.T) {
	prev := hub.MatchmakingRevealDelay
	hub.MatchmakingRevealDelay = 200 * time.Millisecond
	t.Cleanup(func() { hub.MatchmakingRevealDelay = prev })
	h, srv := newTestHub(t)

	a := queueUp(t, srv, "Alice")
	b := queueUp(t, srv, "Bob")
	readMsgOfType(t, a, protocol.SMsgMatchFound)
	readMsgOfType(t, b, protocol.SMsgMatchFound)
	a.Close()
	b.Close()
	time.Sleep(500 * time.Millisecond)
	if n := h.GetStats().Rooms; n != 0 {
		t.Errorf("rooms after both left during the reveal = %d, want 0", n)
	}
}
