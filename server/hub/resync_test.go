package hub_test

import (
	"testing"
	"time"

	"loco/server/hub"
	"loco/server/protocol"
)

// A client whose board has drifted from the server's has no way back on its
// own: it keeps offering the action its own copy says is legal, and every
// attempt comes back refused. The refusal itself has to carry the correction.
func TestPlayCard_IllegalPlayResyncsTheClient(t *testing.T) {
	t.Setenv("LOCO_E2E", "1")

	// Keep the bot off the board entirely: a bot play would repair the client
	// by accident and prove nothing about the refusal.
	origThink := hub.BotThinkDelay
	hub.BotThinkDelay = 30 * time.Second
	t.Cleanup(func() { hub.BotThinkDelay = origThink })

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
		t.Fatal("missing game state in game_started")
	}
	me := gs.State.YourIndex

	// A yellow 4 on the pile, a hand of reds: nothing here is playable. This is
	// the board from the report, where the client believed otherwise.
	redSwap := protocol.CardDTO{Color: "red", Kind: "swap"}
	zero := 0
	dir := 1
	sendMsg(t, conn, protocol.ClientMsg{
		Type:             protocol.CMsgDebugSetState,
		DebugHand:        []protocol.CardDTO{redSwap, {Color: "red", Kind: "number", Value: 2}},
		DebugDiscard:     &protocol.CardDTO{Color: "yellow", Kind: "number", Value: 4},
		DebugActiveColor: "yellow",
		DebugPendingDraw: &zero,
		DebugCurrentTurn: &me,
		DebugDirection:   &dir,
	})
	readMsgOfType(t, conn, protocol.SMsgGameState)

	// The tap a drifted client sends: an off-colour Swap, target named.
	target := 1 - me
	sendMsg(t, conn, protocol.ClientMsg{
		Type:         protocol.CMsgPlayCard,
		Card:         &redSwap,
		ChosenPlayer: &target,
	})

	refusal := readMsgOfType(t, conn, protocol.SMsgError)
	if refusal.Error != "illegal card play" {
		t.Fatalf("error = %q, want the unchanged wire string %q", refusal.Error, "illegal card play")
	}

	// ...and the state that proves it, so the next tap is refused by the client
	// rather than by the server.
	fresh := readMsgOfType(t, conn, protocol.SMsgGameState)
	if fresh.State == nil {
		t.Fatal("resync carried no state")
	}
	if fresh.State.ActiveColor != "yellow" {
		t.Errorf("resync active_color = %q, want \"yellow\"", fresh.State.ActiveColor)
	}
	if fresh.State.Discard.Kind != "number" || fresh.State.Discard.Value != 4 {
		t.Errorf("resync discard = %+v, want the yellow 4", fresh.State.Discard)
	}
	if len(fresh.State.Hand) != 2 {
		t.Errorf("resync hand = %d cards, want 2 (the refused card never left)", len(fresh.State.Hand))
	}
}

// Losing an interrupt race is not a drift: the client's board was right, it was
// simply beaten. Answering one with a personalised snapshot would put the most
// expensive message this server sends on the wire at the busiest moment of the
// busiest table, which is the one place that cannot afford it.
func TestInterrupt_LostRaceDoesNotResync(t *testing.T) {
	t.Setenv("LOCO_E2E", "1")

	origThink := hub.BotThinkDelay
	origProb := hub.BotInterruptProb
	origCatchProb := hub.BotCatchProb
	hub.BotThinkDelay = 30 * time.Second
	hub.BotInterruptProb = 0
	hub.BotCatchProb = 0
	t.Cleanup(func() {
		hub.BotThinkDelay = origThink
		hub.BotInterruptProb = origProb
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
		t.Fatal("missing game state in game_started")
	}
	me := gs.State.YourIndex

	red5 := protocol.CardDTO{Color: "red", Kind: "number", Value: 5}
	zero := 0
	dir := 1
	sendMsg(t, conn, protocol.ClientMsg{
		Type:             protocol.CMsgDebugSetState,
		DebugHand:        []protocol.CardDTO{red5, {Color: "red", Kind: "number", Value: 2}},
		DebugDiscard:     &protocol.CardDTO{Color: "red", Kind: "number", Value: 3},
		DebugActiveColor: "red",
		DebugPendingDraw: &zero,
		DebugCurrentTurn: &me,
		DebugDirection:   &dir,
	})
	readMsgOfType(t, conn, protocol.SMsgGameState)

	// debug_set_state never arms the interrupt window, so this is the refusal a
	// player gets for pressing a beat after somebody drew or passed.
	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgInterruptPlay, Card: &red5})
	if got := readMsgOfType(t, conn, protocol.SMsgError); got.Error != "interrupt window closed" {
		t.Fatalf("error = %q, want %q", got.Error, "interrupt window closed")
	}

	// Nothing else may follow. Read until the socket goes quiet.
	conn.SetReadDeadline(time.Now().Add(400 * time.Millisecond))
	for {
		var msg protocol.ServerMsg
		if err := conn.ReadJSON(&msg); err != nil {
			return // deadline reached: nothing arrived
		}
		if msg.Type == protocol.SMsgGameState {
			t.Fatal("a lost interrupt race triggered a state resync")
		}
	}
}
