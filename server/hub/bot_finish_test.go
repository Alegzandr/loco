package hub_test

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"loco/server/hub"
	"loco/server/protocol"
)

// botFinishTable opens a 1v1 against a bot, past the map gate, and returns the
// socket with our seat and the bot's.
func botFinishTable(t *testing.T) (conn *websocket.Conn, me, bot int) {
	t.Helper()
	_, srv := newTestHub(t)
	conn = dialWS(t, srv)
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
	me = gs.State.YourIndex
	return conn, me, 1 - me
}

// awaitType reads until a message of typ arrives or budget runs out, and says
// when it arrived. Unlike readMsgOfType it does not count messages: a held move
// leaves the socket quiet for a while, and quiet is what is being measured.
func awaitType(t *testing.T, conn *websocket.Conn, typ protocol.ServerMsgType, budget time.Duration) (protocol.ServerMsg, time.Time) {
	t.Helper()
	end := time.Now().Add(budget)
	for {
		conn.SetReadDeadline(end)
		_, data, err := conn.ReadMessage()
		if err != nil {
			t.Fatalf("no %q within %v: %v", typ, budget, err)
		}
		var msg protocol.ServerMsg
		if json.Unmarshal(data, &msg) == nil && msg.Type == typ {
			return msg, time.Now()
		}
	}
}

func pinBotFinishTimings(t *testing.T) {
	t.Helper()
	t.Setenv("LOCO_E2E", "1")
	think, jitter := hub.BotThinkDelay, hub.BotJitterMax
	uno, unoJitter := hub.BotUnoDelay, hub.BotUnoJitterMax
	finish, finishJitter := hub.BotFinishDelay, hub.BotFinishJitterMax
	interrupt, interruptJitter, interruptProb := hub.BotInterruptDelay, hub.BotInterruptJitterMax, hub.BotInterruptProb
	catchProb := hub.BotCatchProb
	t.Cleanup(func() {
		hub.BotThinkDelay, hub.BotJitterMax = think, jitter
		hub.BotUnoDelay, hub.BotUnoJitterMax = uno, unoJitter
		hub.BotFinishDelay, hub.BotFinishJitterMax = finish, finishJitter
		hub.BotInterruptDelay, hub.BotInterruptJitterMax, hub.BotInterruptProb = interrupt, interruptJitter, interruptProb
		hub.BotCatchProb = catchProb
	})
	hub.BotJitterMax = 0
	hub.BotUnoJitterMax = 0
	hub.BotFinishJitterMax = 0
	hub.BotInterruptJitterMax = 0
	hub.BotCatchProb = 0
}

// A bot that can take the round by slamming its last card onto ours does not do
// it at the pace of an ordinary slam. At 0.7s nobody at the table has read the
// pile yet; the finish waits BotFinishDelay from the card it answers.
func TestBotFinish_InterjectIsHeldToTheFinishDelay(t *testing.T) {
	pinBotFinishTimings(t)
	hub.BotThinkDelay = 30 * time.Second // the slam is the only way it can finish
	hub.BotInterruptDelay = 10 * time.Millisecond
	hub.BotInterruptProb = 1.0
	hub.BotUnoDelay = 0
	hub.BotFinishDelay = 400 * time.Millisecond

	conn, me, bot := botFinishTable(t)
	red5 := protocol.CardDTO{Color: "red", Kind: "number", Value: 5}
	zero := 0
	sendMsg(t, conn, protocol.ClientMsg{
		Type: protocol.CMsgDebugSetState,
		Debug: &protocol.DebugStateDTO{
			Hand:        []protocol.CardDTO{red5, {Color: "blue", Kind: "number", Value: 9}},
			Hands:       []protocol.DebugHandOverrideDTO{{PlayerIndex: bot, Hand: []protocol.CardDTO{red5}}},
			Discard:     &protocol.CardDTO{Color: "red", Kind: "number", Value: 3},
			ActiveColor: "red",
			PendingDraw: &zero,
			CurrentTurn: &me,
		},
	})
	readMsgOfType(t, conn, protocol.SMsgGameState)

	start := time.Now()
	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgPlayCard, Card: &red5})
	got, at := awaitType(t, conn, protocol.SMsgInterruptSuccess, 3*time.Second)
	if got.Seat() != bot {
		t.Fatalf("interrupt_success named seat %d, want the bot at %d", got.Seat(), bot)
	}
	if held := at.Sub(start); held < hub.BotFinishDelay {
		t.Errorf("the bot took the round %v after our card, want at least %v", held, hub.BotFinishDelay)
	}
	awaitType(t, conn, protocol.SMsgRoundEnd, 3*time.Second)
}

// Same floor on the bot's own turn: its last two copies, dumped together with the
// call on the message, were on the table at the ordinary think delay.
func TestBotFinish_TurnBatchIsHeldToTheFinishDelay(t *testing.T) {
	pinBotFinishTimings(t)
	hub.BotThinkDelay = 10 * time.Millisecond
	hub.BotInterruptProb = 0
	hub.BotFinishDelay = 400 * time.Millisecond

	conn, me, bot := botFinishTable(t)
	red5 := protocol.CardDTO{Color: "red", Kind: "number", Value: 5}
	red8 := protocol.CardDTO{Color: "red", Kind: "number", Value: 8}
	zero := 0
	dir := 1
	sendMsg(t, conn, protocol.ClientMsg{
		Type: protocol.CMsgDebugSetState,
		Debug: &protocol.DebugStateDTO{
			Hand:        []protocol.CardDTO{red5, {Color: "blue", Kind: "number", Value: 9}},
			Hands:       []protocol.DebugHandOverrideDTO{{PlayerIndex: bot, Hand: []protocol.CardDTO{red8, red8}}},
			Discard:     &protocol.CardDTO{Color: "red", Kind: "number", Value: 3},
			ActiveColor: "red",
			PendingDraw: &zero,
			CurrentTurn: &me,
			Direction:   &dir,
		},
	})
	readMsgOfType(t, conn, protocol.SMsgGameState)

	start := time.Now()
	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgPlayCard, Card: &red5})
	end, at := awaitType(t, conn, protocol.SMsgRoundEnd, 3*time.Second)
	if end.RoundWinner != "Bot1" {
		t.Fatalf("round_end winner = %q, want the bot", end.RoundWinner)
	}
	if held := at.Sub(start); held < hub.BotFinishDelay {
		t.Errorf("the bot took the round %v after its turn came, want at least %v", held, hub.BotFinishDelay)
	}
}

// The other floor: a bot on an undeclared last card does not finish before its
// own declaration would have come. It used to make the call on the spot when it
// found a card to play, which shut the catch window the moment its turn came —
// so a bot handed its last card was never catchable by anybody, however fast.
func TestBotFinish_WaitsForItsOwnDeclarationSoTheCatchCanLand(t *testing.T) {
	pinBotFinishTimings(t)
	hub.BotThinkDelay = 10 * time.Millisecond
	hub.BotInterruptProb = 0
	hub.BotFinishDelay = 0
	hub.BotUnoDelay = 1500 * time.Millisecond

	conn, me, bot := botFinishTable(t)
	redSwap := protocol.CardDTO{Color: "red", Kind: "swap"}
	zero := 0
	dir := 1
	sendMsg(t, conn, protocol.ClientMsg{
		Type: protocol.CMsgDebugSetState,
		Debug: &protocol.DebugStateDTO{
			// The Swap hands the bot our last card, a red 7 it can play straight
			// onto the red Swap the moment its turn comes.
			Hand: []protocol.CardDTO{redSwap, {Color: "red", Kind: "number", Value: 7}},
			Hands: []protocol.DebugHandOverrideDTO{{PlayerIndex: bot, Hand: []protocol.CardDTO{
				{Color: "green", Kind: "number", Value: 3},
				{Color: "green", Kind: "number", Value: 4},
				{Color: "green", Kind: "number", Value: 5},
			}}},
			Discard:     &protocol.CardDTO{Color: "red", Kind: "number", Value: 3},
			ActiveColor: "red",
			PendingDraw: &zero,
			CurrentTurn: &me,
			Direction:   &dir,
		},
	})
	readMsgOfType(t, conn, protocol.SMsgGameState)

	target := bot
	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgPlayCard, Card: &redSwap, ChosenPlayer: &target})
	readMsgOfType(t, conn, protocol.SMsgCardPlayed)
	// Well past the bot's think delay: before, the round was already over.
	time.Sleep(200 * time.Millisecond)

	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgCatchUno, TargetIndex: &target})
	caught, _ := awaitType(t, conn, protocol.SMsgUnoCaught, 3*time.Second)
	if caught.Seat() != bot {
		t.Errorf("uno_caught named seat %d, want the bot at %d", caught.Seat(), bot)
	}
}
