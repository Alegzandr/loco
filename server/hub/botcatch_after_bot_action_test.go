package hub_test

import (
	"testing"
	"time"

	"loco/server/hub"
	"loco/server/protocol"
)

// A bot's own Global Switch hands a human their last card, and §8 makes
// receiving it exactly as declarable as playing down to it. Nobody answered
// that.
//
// A Global Switch rather than a Swap because a Swap only ever leaves the table
// when it pays the bot (`botSwapPays`), and an exchange that leaves the other
// seat on one card never does: the rotation is the rearranging card a bot
// still plays into a hand smaller than its own.
//
// Regression: the catch was armed after a *human* action only — the three
// gameplay handlers — while the bots' own declarations were armed everywhere. So
// the one board state a player cannot see coming, their hand shrinking to a
// single card because somebody else played a card, was also the one nobody at
// the table would ever punish. Both halves are armed together now
// (`maybeScheduleBotReactions`), from every point a board can change.
func TestBotCatchesAfterItsOwnRotationLeavesAHumanOnOneCard(t *testing.T) {
	t.Setenv("LOCO_E2E", "1")

	origThink := hub.BotThinkDelay
	origJitter := hub.BotJitterMax
	origCatchDelay := hub.BotCatchDelay
	origCatchJitter := hub.BotCatchJitterMax
	origCatchProb := hub.BotCatchProb
	origInterruptProb := hub.BotInterruptProb
	// The bot has to take its turn here — the rotation is the whole fixture — so the
	// think delay is short rather than absent. Everything else is pinned.
	hub.BotThinkDelay = 20 * time.Millisecond
	hub.BotJitterMax = 0
	hub.BotCatchDelay = 20 * time.Millisecond
	hub.BotCatchJitterMax = 0
	hub.BotCatchProb = 1
	hub.BotInterruptProb = 0
	t.Cleanup(func() {
		hub.BotThinkDelay = origThink
		hub.BotJitterMax = origJitter
		hub.BotCatchDelay = origCatchDelay
		hub.BotCatchJitterMax = origCatchJitter
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

	// Three cards, so the card played below leaves two: the window this asserts
	// must be opened by the bot's Global Switch and by nothing we did.
	zero := 0
	dir := 1
	sendMsg(t, conn, protocol.ClientMsg{
		Type: protocol.CMsgDebugSetState,
		Debug: &protocol.DebugStateDTO{
			Hand: []protocol.CardDTO{
				{Color: "red", Kind: "number", Value: 5},
				{Color: "red", Kind: "number", Value: 6},
				{Color: "red", Kind: "number", Value: 7},
			},
			// One playable card and it is the Global Switch, so what the bot does
			// with its turn is not a coin toss. It keeps a second card, which is
			// what stops the rotation from being a finish and keeps the bot out of
			// the catch it is about to make.
			Hands: []protocol.DebugHandOverrideDTO{
				{PlayerIndex: bot, Hand: []protocol.CardDTO{
					{Color: "wild", Kind: "global_switch"},
					{Color: "blue", Kind: "number", Value: 3},
				}},
			},
			Discard:     &protocol.CardDTO{Color: "red", Kind: "number", Value: 9},
			ActiveColor: "red",
			PendingDraw: &zero,
			CurrentTurn: &me,
			Direction:   &dir,
		},
	})
	readMsgOfType(t, conn, protocol.SMsgGameState)

	sendMsg(t, conn, protocol.ClientMsg{
		Type: protocol.CMsgPlayCard,
		Card: &protocol.CardDTO{Color: "red", Kind: "number", Value: 5},
	})
	readMsgOfType(t, conn, protocol.SMsgCardPlayed)

	// The bot rotates its one remaining card onto us and then answers the window
	// it just opened.
	caught := readMsgOfType(t, conn, protocol.SMsgUnoCaught)
	if caught.Seat() != me {
		t.Errorf("uno_caught named seat %d, want ours at %d", caught.Seat(), me)
	}
}
