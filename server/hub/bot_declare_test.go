package hub_test

import (
	"testing"
	"time"

	"loco/server/hub"
	"loco/server/protocol"
)

// Receiving your last card owes the table a declaration exactly like playing
// down to it (rules.md §8). A bot has to pay that rule too.
//
// Regression: the scheduler was keyed on the seat that had just *acted*, so a
// human whose Swap left a bot on one card scheduled nothing at all. The bot sat
// there undeclared and catchable for the full 5 s window, which is a free +2 no
// human ever offers, and bots do catch humans, so the asymmetry ran one way.
func TestBotDeclaresAfterAHumanSwapLeavesItOnOneCard(t *testing.T) {
	t.Setenv("LOCO_E2E", "1")

	origThink := hub.BotThinkDelay
	origUno := hub.BotUnoDelay
	origUnoJitter := hub.BotUnoJitterMax
	origCatchProb := hub.BotCatchProb
	origInterruptProb := hub.BotInterruptProb
	// The bot must not take its ordinary turn (it would leave one card behind by
	// playing, which is the path that already worked); only the declaration is
	// under test, and it is made deterministic.
	hub.BotThinkDelay = 30 * time.Second
	hub.BotUnoDelay = 20 * time.Millisecond
	hub.BotUnoJitterMax = 0
	hub.BotCatchProb = 0
	hub.BotInterruptProb = 0
	t.Cleanup(func() {
		hub.BotThinkDelay = origThink
		hub.BotUnoDelay = origUno
		hub.BotUnoJitterMax = origUnoJitter
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
	bot := 1 - me

	// Swap is coloured, so it matches the red discard normally.
	redSwap := protocol.CardDTO{Color: "red", Kind: "swap"}
	zero := 0
	dir := 1
	sendMsg(t, conn, protocol.ClientMsg{
		Type: protocol.CMsgDebugSetState,
		// Playing the Swap leaves us holding one card, which the swap then hands
		// to the bot: the bot ends on exactly one card it has never announced.
		DebugHand: []protocol.CardDTO{redSwap, {Color: "blue", Kind: "number", Value: 9}},
		DebugHands: []protocol.DebugHandOverrideDTO{
			{PlayerIndex: bot, Hand: []protocol.CardDTO{
				{Color: "green", Kind: "number", Value: 3},
				{Color: "green", Kind: "number", Value: 4},
				{Color: "green", Kind: "number", Value: 5},
			}},
		},
		DebugDiscard:     &protocol.CardDTO{Color: "red", Kind: "number", Value: 3},
		DebugActiveColor: "red",
		DebugPendingDraw: &zero,
		DebugCurrentTurn: &me,
		DebugDirection:   &dir,
	})
	readMsgOfType(t, conn, protocol.SMsgGameState)

	target := bot
	sendMsg(t, conn, protocol.ClientMsg{
		Type:         protocol.CMsgPlayCard,
		Card:         &redSwap,
		ChosenPlayer: &target,
	})
	readMsgOfType(t, conn, protocol.SMsgCardPlayed)

	declared := readMsgOfType(t, conn, protocol.SMsgUnoDeclared)
	if declared.Seat() != bot {
		t.Errorf("uno_declared named seat %d, want the bot at %d", declared.Seat(), bot)
	}
}

// The other half of the rule: the declaration is still deferred, so a human who
// reacts fast enough can take the +2 first. A bot that declared the instant the
// swap landed would be uncatchable by construction, which is the bug the delay
// was introduced for in the first place.
func TestBotDeclarationAfterASwapIsStillCatchable(t *testing.T) {
	t.Setenv("LOCO_E2E", "1")

	origThink := hub.BotThinkDelay
	origUno := hub.BotUnoDelay
	origUnoJitter := hub.BotUnoJitterMax
	origCatchProb := hub.BotCatchProb
	origInterruptProb := hub.BotInterruptProb
	hub.BotThinkDelay = 30 * time.Second
	// Long enough that the catch below is unambiguously first.
	hub.BotUnoDelay = 5 * time.Second
	hub.BotUnoJitterMax = 0
	hub.BotCatchProb = 0
	hub.BotInterruptProb = 0
	t.Cleanup(func() {
		hub.BotThinkDelay = origThink
		hub.BotUnoDelay = origUno
		hub.BotUnoJitterMax = origUnoJitter
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
	bot := 1 - me

	redSwap := protocol.CardDTO{Color: "red", Kind: "swap"}
	zero := 0
	dir := 1
	sendMsg(t, conn, protocol.ClientMsg{
		Type:      protocol.CMsgDebugSetState,
		DebugHand: []protocol.CardDTO{redSwap, {Color: "blue", Kind: "number", Value: 9}},
		DebugHands: []protocol.DebugHandOverrideDTO{
			{PlayerIndex: bot, Hand: []protocol.CardDTO{
				{Color: "green", Kind: "number", Value: 3},
				{Color: "green", Kind: "number", Value: 4},
			}},
		},
		DebugDiscard:     &protocol.CardDTO{Color: "red", Kind: "number", Value: 3},
		DebugActiveColor: "red",
		DebugPendingDraw: &zero,
		DebugCurrentTurn: &me,
		DebugDirection:   &dir,
	})
	readMsgOfType(t, conn, protocol.SMsgGameState)

	target := bot
	sendMsg(t, conn, protocol.ClientMsg{
		Type:         protocol.CMsgPlayCard,
		Card:         &redSwap,
		ChosenPlayer: &target,
	})
	readMsgOfType(t, conn, protocol.SMsgCardPlayed)

	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgCatchUno, TargetIndex: &target})
	caught := readMsgOfType(t, conn, protocol.SMsgUnoCaught)
	if caught.Seat() != bot {
		t.Errorf("uno_caught named seat %d, want the bot at %d", caught.Seat(), bot)
	}
}
