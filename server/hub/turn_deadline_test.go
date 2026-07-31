package hub_test

import (
	"testing"
	"time"

	"loco/server/hub"
	"loco/server/protocol"
)

// A bot's turn has no clock: scheduleTurnTimer deliberately arms no timeout for
// one. The deadline it broadcasts must say so.
//
// Regression: scheduleTurnTimer returned early for a bot without touching
// turnStartedAt, and turnDeadlineMs reads that map with no notion of whose turn
// it is. Every card_played that handed the turn to a bot therefore carried the
// *previous human's* deadline, already part-spent. The client mounts its
// countdown bar on any non-null deadline, so it sat there draining the remains
// of somebody else's clock and turning urgent-red under a seat that cannot time
// out at all.
//
// The two plays matter in this order: the Skip proves a deadline was recorded
// (so the second assertion cannot pass merely because nothing was ever set),
// and the number then hands the turn over.
func TestTurnDeadline_AbsentDuringBotTurn(t *testing.T) {
	t.Setenv("LOCO_E2E", "1")

	origThink := hub.BotThinkDelay
	origCatchProb := hub.BotCatchProb
	origInterruptProb := hub.BotInterruptProb
	// Keep the bot inert: this test is about what the server says, not about
	// what the bot does with the turn it is given.
	hub.BotThinkDelay = 30 * time.Second
	hub.BotCatchProb = 0
	hub.BotInterruptProb = 0
	t.Cleanup(func() {
		hub.BotThinkDelay = origThink
		hub.BotCatchProb = origCatchProb
		hub.BotInterruptProb = origInterruptProb
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

	redSkip := protocol.CardDTO{Color: "red", Kind: "skip"}
	red5 := protocol.CardDTO{Color: "red", Kind: "number", Value: 5}
	zero := 0
	dir := 1
	sendMsg(t, conn, protocol.ClientMsg{
		Type: protocol.CMsgDebugSetState,
		// Four cards so neither play leaves the seat on one (a catch window) or
		// on none (the round ends and a fresh hand is dealt).
		DebugHand: []protocol.CardDTO{
			redSkip, red5,
			{Color: "blue", Kind: "number", Value: 9},
			{Color: "green", Kind: "number", Value: 3},
		},
		DebugDiscard:     &protocol.CardDTO{Color: "red", Kind: "number", Value: 3},
		DebugActiveColor: "red",
		DebugPendingDraw: &zero,
		DebugCurrentTurn: &me,
		DebugDirection:   &dir,
	})
	readMsgOfType(t, conn, protocol.SMsgGameState)

	// A Skip at a two-seat table skips the bot and hands the turn back to us,
	// so this card_played describes a human turn and must carry a live clock.
	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgPlayCard, Card: &redSkip})
	human := readMsgOfType(t, conn, protocol.SMsgCardPlayed)
	if human.Turn != me {
		t.Fatalf("after a Skip at two seats the turn is %d, want it back on %d", human.Turn, me)
	}
	if human.TurnDeadline == 0 {
		t.Fatal("card_played for a human turn carried no deadline: the rest of this test would pass vacuously")
	}

	// Now hand the turn to the bot.
	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgPlayCard, Card: &red5})
	bot := readMsgOfType(t, conn, protocol.SMsgCardPlayed)
	if bot.Turn == me {
		t.Fatalf("expected the turn to move off seat %d", me)
	}
	if bot.TurnDeadline != 0 {
		t.Errorf("card_played handing the turn to a bot carried deadline %d, want 0 (a bot has no clock; the client would drain the previous human's bar under it)",
			bot.TurnDeadline)
	}
}
