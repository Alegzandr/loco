package hub_test

import (
	"encoding/json"
	"testing"
	"time"

	"loco/server/hub"
	"loco/server/protocol"
)

// The interject is the game's signature mechanic, and until now it ran one way:
// bots could be interrupted and never interrupted back. This walks the whole
// path — human plays, bot slams an identical card, the table is told.
func TestBotInterrupt_SlamsBackOnAHumanPlay(t *testing.T) {
	t.Setenv("LOCO_E2E", "1")

	origThink := hub.BotThinkDelay
	origDelay := hub.BotInterruptDelay
	origJitter := hub.BotInterruptJitterMax
	origProb := hub.BotInterruptProb
	origCatchProb := hub.BotCatchProb
	// Keep the bot off its ordinary turn so the only thing it can do is react,
	// and make the reaction deterministic.
	hub.BotThinkDelay = 30 * time.Second
	hub.BotInterruptDelay = 10 * time.Millisecond
	hub.BotInterruptJitterMax = 0
	hub.BotInterruptProb = 1.0
	hub.BotCatchProb = 0
	t.Cleanup(func() {
		hub.BotThinkDelay = origThink
		hub.BotInterruptDelay = origDelay
		hub.BotInterruptJitterMax = origJitter
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
	bot := 1 - me

	red5 := protocol.CardDTO{Color: "red", Kind: "number", Value: 5}
	zero := 0
	sendMsg(t, conn, protocol.ClientMsg{
		Type:      protocol.CMsgDebugSetState,
		DebugHand: []protocol.CardDTO{red5, {Color: "blue", Kind: "number", Value: 9}},
		DebugHands: []protocol.DebugHandOverrideDTO{
			{PlayerIndex: bot, Hand: []protocol.CardDTO{red5, {Color: "green", Kind: "number", Value: 3}}},
		},
		DebugDiscard:     &protocol.CardDTO{Color: "red", Kind: "number", Value: 3},
		DebugActiveColor: "red",
		DebugPendingDraw: &zero,
		DebugCurrentTurn: &me,
	})
	readMsgOfType(t, conn, protocol.SMsgGameState)

	// Only a real play arms the window; debug_set_state leaves it closed.
	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgPlayCard, Card: &red5})
	readMsgOfType(t, conn, protocol.SMsgCardPlayed)

	got := readMsgOfType(t, conn, protocol.SMsgInterruptSuccess)
	if got.Seat() != bot {
		t.Errorf("interrupt_success player_index = %d, want the bot at %d", got.Seat(), bot)
	}
	if len(got.Cards) != 1 {
		t.Fatalf("interrupt_success carried %d cards, want 1", len(got.Cards))
	}
	if got.Cards[0].Color != "red" || got.Cards[0].Value != 5 {
		t.Errorf("bot slammed %+v, want the red 5 that was on the pile", got.Cards[0])
	}
}

// Bots must stay fallible. The probability gate is the only thing between
// "bots take part in the mechanic" and "bots answer every card a human plays",
// so it has to be wired to something.
func TestBotInterrupt_ProbabilityGateIsWired(t *testing.T) {
	t.Setenv("LOCO_E2E", "1")

	origThink := hub.BotThinkDelay
	origDelay := hub.BotInterruptDelay
	origJitter := hub.BotInterruptJitterMax
	origProb := hub.BotInterruptProb
	origCatchProb := hub.BotCatchProb
	hub.BotThinkDelay = 30 * time.Second
	hub.BotInterruptDelay = 10 * time.Millisecond
	hub.BotInterruptJitterMax = 0
	hub.BotInterruptProb = 0 // never
	hub.BotCatchProb = 0
	t.Cleanup(func() {
		hub.BotThinkDelay = origThink
		hub.BotInterruptDelay = origDelay
		hub.BotInterruptJitterMax = origJitter
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
	bot := 1 - me

	red5 := protocol.CardDTO{Color: "red", Kind: "number", Value: 5}
	zero := 0
	sendMsg(t, conn, protocol.ClientMsg{
		Type:      protocol.CMsgDebugSetState,
		DebugHand: []protocol.CardDTO{red5, {Color: "blue", Kind: "number", Value: 9}},
		DebugHands: []protocol.DebugHandOverrideDTO{
			{PlayerIndex: bot, Hand: []protocol.CardDTO{red5, {Color: "green", Kind: "number", Value: 3}}},
		},
		DebugDiscard:     &protocol.CardDTO{Color: "red", Kind: "number", Value: 3},
		DebugActiveColor: "red",
		DebugPendingDraw: &zero,
		DebugCurrentTurn: &me,
	})
	readMsgOfType(t, conn, protocol.SMsgGameState)

	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgPlayCard, Card: &red5})
	readMsgOfType(t, conn, protocol.SMsgCardPlayed)

	// Nothing should arrive. Read until the socket goes quiet.
	conn.SetReadDeadline(time.Now().Add(400 * time.Millisecond))
	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			break // read deadline: the table stayed silent, which is the assertion
		}
		var msg protocol.ServerMsg
		if json.Unmarshal(data, &msg) == nil && msg.Type == protocol.SMsgInterruptSuccess {
			t.Fatal("bot interjected with BotInterruptProb = 0")
		}
	}
}
