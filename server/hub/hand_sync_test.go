package hub_test

import (
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"loco/server/hub"
	"loco/server/protocol"
)

// Every path that grows a hand must tell the affected player WHICH cards it
// gained — a count is only enough for the other players. A client that never
// receives the cards silently runs a shorter hand than the server: it empties
// the visible hand, the server still holds cards, and the round never ends.

// startedGame is the per-connection view returned by setupActiveGame: the
// connection whose turn it is, the opponent's, and the active seat index.
type startedGame struct {
	activeConn *websocket.Conn
	otherConn  *websocket.Conn
	activeIdx  int
}

func setupActiveGame(t *testing.T) startedGame {
	t.Helper()
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
	if gs1.State.Turn == gs1.State.YourIndex {
		return startedGame{activeConn: conn1, otherConn: conn2, activeIdx: gs1.State.YourIndex}
	}
	return startedGame{activeConn: conn2, otherConn: conn1, activeIdx: gs2.State.YourIndex}
}

// TestCatchUNO_TargetReceivesPenaltyCards: the caught player draws 2 penalty
// cards server-side. Without the private card_drawn their local hand stays two
// cards short — they play their last visible card, the server still holds two,
// and the round can never end.
func TestCatchUNO_TargetReceivesPenaltyCards(t *testing.T) {
	t.Setenv("LOCO_E2E", "1")
	g := setupActiveGame(t)

	zero := 0
	sendMsg(t, g.activeConn, protocol.ClientMsg{
		Type: protocol.CMsgDebugSetState,
		Debug: &protocol.DebugStateDTO{
			Hand:        []protocol.CardDTO{{Color: "red", Kind: "number", Value: 6}, {Color: "red", Kind: "number", Value: 7}},
			Discard:     &protocol.CardDTO{Color: "red", Kind: "number", Value: 5},
			PendingDraw: &zero,
		},
	})
	readMsgOfType(t, g.activeConn, protocol.SMsgGameState)
	readMsgOfType(t, g.otherConn, protocol.SMsgGameState)

	// Down to 1 card without declaring UNO.
	sendMsg(t, g.activeConn, protocol.ClientMsg{
		Type: protocol.CMsgPlayCard,
		Card: &protocol.CardDTO{Color: "red", Kind: "number", Value: 7},
	})
	readMsgOfType(t, g.activeConn, protocol.SMsgCardPlayed)
	readMsgOfType(t, g.otherConn, protocol.SMsgCardPlayed)

	sendMsg(t, g.otherConn, protocol.ClientMsg{Type: protocol.CMsgCatchUno})
	readMsgOfType(t, g.activeConn, protocol.SMsgUnoCaught)
	readMsgOfType(t, g.otherConn, protocol.SMsgUnoCaught)

	// The caught player must be told exactly which 2 cards they gained.
	drawn := readMsgOfType(t, g.activeConn, protocol.SMsgCardDrawn)
	if len(drawn.Cards) != 2 {
		t.Fatalf("caught player received %d cards, want 2 (hand would desync)", len(drawn.Cards))
	}
	if drawn.Seat() != g.activeIdx {
		t.Errorf("card_drawn PlayerIndex = %d, want %d", drawn.Seat(), g.activeIdx)
	}

	// The catcher only needs the count.
	observed := readMsgOfType(t, g.otherConn, protocol.SMsgCardDrawn)
	if observed.DrawnCount != 2 {
		t.Errorf("observer DrawnCount = %d, want 2", observed.DrawnCount)
	}
	if observed.Seat() != g.activeIdx {
		t.Errorf("observer card_drawn PlayerIndex = %d, want %d", observed.Seat(), g.activeIdx)
	}
}

// TestCatchUNO_PenaltyCarriesTurnState: a hand can grow without anybody having
// drawn on their turn. Every card_drawn must therefore state has_drawn and
// pending_draw explicitly, to the drawer and to the observers alike.
//
// Regression: both fields were `omitempty`, so a false / zero never reached the
// wire and the client filled the blank with "has drawn". The caught player then
// had its Draw button disabled and every Pass refused with "you must draw a card
// before passing" — unblockable until the turn timer auto-acted.
func TestCatchUNO_PenaltyCarriesTurnState(t *testing.T) {
	t.Setenv("LOCO_E2E", "1")
	g := setupActiveGame(t)

	zero := 0
	sendMsg(t, g.activeConn, protocol.ClientMsg{
		Type: protocol.CMsgDebugSetState,
		Debug: &protocol.DebugStateDTO{
			Hand:        []protocol.CardDTO{{Color: "red", Kind: "number", Value: 6}, {Color: "red", Kind: "number", Value: 7}},
			Discard:     &protocol.CardDTO{Color: "red", Kind: "number", Value: 5},
			PendingDraw: &zero,
		},
	})
	readMsgOfType(t, g.activeConn, protocol.SMsgGameState)
	readMsgOfType(t, g.otherConn, protocol.SMsgGameState)

	sendMsg(t, g.activeConn, protocol.ClientMsg{
		Type: protocol.CMsgPlayCard,
		Card: &protocol.CardDTO{Color: "red", Kind: "number", Value: 7},
	})
	readMsgOfType(t, g.activeConn, protocol.SMsgCardPlayed)
	readMsgOfType(t, g.otherConn, protocol.SMsgCardPlayed)

	sendMsg(t, g.otherConn, protocol.ClientMsg{Type: protocol.CMsgCatchUno})
	readMsgOfType(t, g.activeConn, protocol.SMsgUnoCaught)
	readMsgOfType(t, g.otherConn, protocol.SMsgUnoCaught)

	for _, tc := range []struct {
		name string
		msg  protocol.ServerMsg
	}{
		{"caught player", readMsgOfType(t, g.activeConn, protocol.SMsgCardDrawn)},
		{"observer", readMsgOfType(t, g.otherConn, protocol.SMsgCardDrawn)},
	} {
		if tc.msg.HasDrawn == nil {
			t.Errorf("%s: card_drawn omitted has_drawn (client would assume true)", tc.name)
		} else if *tc.msg.HasDrawn {
			t.Errorf("%s: card_drawn has_drawn = true, want false (nobody drew on their turn)", tc.name)
		}
		if tc.msg.PendingDraw == nil {
			t.Errorf("%s: card_drawn omitted pending_draw", tc.name)
		} else if *tc.msg.PendingDraw != 0 {
			t.Errorf("%s: card_drawn pending_draw = %d, want 0", tc.name, *tc.msg.PendingDraw)
		}
	}
}

// TestDrawCard_CarriesTurnState: the other side of the same contract — a real
// voluntary draw reports has_drawn=true to everyone, so the Pass button unlocks.
func TestDrawCard_CarriesTurnState(t *testing.T) {
	t.Setenv("LOCO_E2E", "1")
	g := setupActiveGame(t)

	zero := 0
	sendMsg(t, g.activeConn, protocol.ClientMsg{
		Type: protocol.CMsgDebugSetState,
		Debug: &protocol.DebugStateDTO{
			Hand:        []protocol.CardDTO{{Color: "blue", Kind: "number", Value: 3}},
			Discard:     &protocol.CardDTO{Color: "red", Kind: "number", Value: 5},
			PendingDraw: &zero,
		},
	})
	readMsgOfType(t, g.activeConn, protocol.SMsgGameState)
	readMsgOfType(t, g.otherConn, protocol.SMsgGameState)

	sendMsg(t, g.activeConn, protocol.ClientMsg{Type: protocol.CMsgDrawCard})

	for _, tc := range []struct {
		name string
		msg  protocol.ServerMsg
	}{
		{"drawer", readMsgOfType(t, g.activeConn, protocol.SMsgCardDrawn)},
		{"observer", readMsgOfType(t, g.otherConn, protocol.SMsgCardDrawn)},
	} {
		if tc.msg.HasDrawn == nil || !*tc.msg.HasDrawn {
			t.Errorf("%s: card_drawn has_drawn = %v, want true", tc.name, tc.msg.HasDrawn)
		}
	}
}

// TestTurnTimeout_PenaltyDrawSendsCardsToDrawer: a timed-out player facing a
// pending draw takes the whole stack. The draw itself does not cost the turn
// (rules.md §14.5) — the timeout handler passes it for them afterwards — and
// either way they must be told which cards they took.
func TestTurnTimeout_PenaltyDrawSendsCardsToDrawer(t *testing.T) {
	t.Setenv("LOCO_E2E", "1")

	prev := hub.TurnTimeout
	hub.TurnTimeout = 1500 * time.Millisecond
	t.Cleanup(func() { hub.TurnTimeout = prev })

	g := setupActiveGame(t)

	// Put a +2 penalty on the active player without touching whose turn it is —
	// the turn timer armed at game start is bound to that seat.
	pending := 2
	sendMsg(t, g.activeConn, protocol.ClientMsg{
		Type: protocol.CMsgDebugSetState,
		Debug: &protocol.DebugStateDTO{
			Hand:        []protocol.CardDTO{{Color: "blue", Kind: "number", Value: 3}},
			Discard:     &protocol.CardDTO{Color: "red", Kind: "draw_two"},
			PendingDraw: &pending,
		},
	})
	readMsgOfType(t, g.activeConn, protocol.SMsgGameState)
	readMsgOfType(t, g.otherConn, protocol.SMsgGameState)

	drawn := readMsgOfType(t, g.activeConn, protocol.SMsgCardDrawn)
	if len(drawn.Cards) != 2 {
		t.Fatalf("timed-out player received %d cards, want 2 (hand would desync)", len(drawn.Cards))
	}

	observed := readMsgOfType(t, g.otherConn, protocol.SMsgCardDrawn)
	if observed.DrawnCount != 2 {
		t.Errorf("observer DrawnCount = %d, want 2", observed.DrawnCount)
	}
}
