package hub_test

import (
	"testing"
	"time"

	"loco/server/hub"
	"loco/server/protocol"
)

// A forced draw does not cost the turn (rules.md §14.5), so the victim's clock
// has to be visible for the whole of it: while they decide whether to counter,
// and again once they have taken the stack and still owe the table a play or a
// pass. Every message on that path must therefore carry a live turn_deadline —
// turn_deadline is omitempty, so a missing one reaches the client as null and
// takes the countdown bar off the screen entirely.
func TestForcedDraw_KeepsTurnDeadlineOnEveryMessage(t *testing.T) {
	t.Setenv("LOCO_E2E", "1") // enable debug_set_state

	orig := hub.TurnTimeout
	hub.TurnTimeout = 30 * time.Second
	t.Cleanup(func() { hub.TurnTimeout = orig })

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
	readMsgOfType(t, conn1, protocol.SMsgGameStarted)
	readMsgOfType(t, conn2, protocol.SMsgGameStarted)
	completeMapLoad(t, conn1, conn2)

	red5 := protocol.CardDTO{Color: "red", Kind: "number", Value: 5}
	blue9 := protocol.CardDTO{Color: "blue", Kind: "number", Value: 9}
	redDrawTwo := protocol.CardDTO{Color: "red", Kind: "draw_two"}
	zero := 0
	sendMsg(t, conn1, protocol.ClientMsg{
		Type: protocol.CMsgDebugSetState,
		Debug: &protocol.DebugStateDTO{
			Discard: &red5,
			Hands: []protocol.DebugHandOverrideDTO{
				{PlayerIndex: 0, Hand: []protocol.CardDTO{redDrawTwo, blue9}},
				{PlayerIndex: 1, Hand: []protocol.CardDTO{blue9, blue9}},
			},
			PendingDraw: &zero,
			CurrentTurn: &zero,
		},
	})
	readMsgOfType(t, conn1, protocol.SMsgGameState)
	readMsgOfType(t, conn2, protocol.SMsgGameState)

	// Alice lands the +2 on Bob.
	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgPlayCard, Card: &redDrawTwo})
	readMsgOfType(t, conn1, protocol.SMsgCardPlayed)
	played := readMsgOfType(t, conn2, protocol.SMsgCardPlayed)
	if played.PendingDraw == nil || *played.PendingDraw != 2 {
		t.Fatalf("card_played pending_draw = %v, want 2", played.PendingDraw)
	}
	if played.Seat() != 1 && played.Turn != 1 {
		t.Fatalf("card_played turn = %d, want Bob (1)", played.Turn)
	}
	if played.TurnDeadline == 0 {
		t.Error("card_played that opens a forced draw carries no turn_deadline: " +
			"the victim's countdown bar goes off screen while they decide whether to counter")
	}

	// Bob takes the stack. The turn is still his, so the clock must come back.
	sendMsg(t, conn2, protocol.ClientMsg{Type: protocol.CMsgDrawCard})
	drawn := readMsgOfType(t, conn2, protocol.SMsgCardDrawn)
	if drawn.TurnDeadline == 0 {
		t.Error("card_drawn after a forced draw carries no turn_deadline")
	}
	observed := readMsgOfType(t, conn1, protocol.SMsgCardDrawn)
	if observed.TurnDeadline == 0 {
		t.Error("card_drawn broadcast after a forced draw carries no turn_deadline")
	}
}

// Same property from the seat it is actually played from most of the time: a
// bot lands the +2 and the human it lands on has to see their clock the moment
// the card hits the pile, because deciding whether to counter is what that
// clock is measuring.
func TestForcedDraw_BotPlayedPenaltyCarriesTheVictimsDeadline(t *testing.T) {
	t.Setenv("LOCO_E2E", "1")

	origTimeout := hub.TurnTimeout
	origThink := hub.BotThinkDelay
	origJitter := hub.BotJitterMax
	origInterrupt := hub.BotInterruptProb
	origCatch := hub.BotCatchProb
	hub.TurnTimeout = 30 * time.Second
	hub.BotThinkDelay = 10 * time.Millisecond
	hub.BotJitterMax = 0
	hub.BotInterruptProb = 0
	hub.BotCatchProb = 0
	t.Cleanup(func() {
		hub.TurnTimeout = origTimeout
		hub.BotThinkDelay = origThink
		hub.BotJitterMax = origJitter
		hub.BotInterruptProb = origInterrupt
		hub.BotCatchProb = origCatch
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

	red3 := protocol.CardDTO{Color: "red", Kind: "number", Value: 3}
	blue9 := protocol.CardDTO{Color: "blue", Kind: "number", Value: 9}
	blue7 := protocol.CardDTO{Color: "blue", Kind: "number", Value: 7}
	redDrawTwo := protocol.CardDTO{Color: "red", Kind: "draw_two"}
	zero := 0
	sendMsg(t, conn, protocol.ClientMsg{
		Type: protocol.CMsgDebugSetState,
		Debug: &protocol.DebugStateDTO{
			Hand: []protocol.CardDTO{red3, blue9},
			Hands: []protocol.DebugHandOverrideDTO{
				// Only the +2 is playable on a red 5, so the bot's move is pinned.
				{PlayerIndex: bot, Hand: []protocol.CardDTO{redDrawTwo, blue7}},
			},
			Discard:     &protocol.CardDTO{Color: "red", Kind: "number", Value: 5},
			ActiveColor: "red",
			PendingDraw: &zero,
			CurrentTurn: &me,
		},
	})
	readMsgOfType(t, conn, protocol.SMsgGameState)

	// Hand the turn over for real: debug_set_state does not schedule the bot.
	sendMsg(t, conn, protocol.ClientMsg{Type: protocol.CMsgPlayCard, Card: &red3})
	readMsgOfType(t, conn, protocol.SMsgCardPlayed)

	penalty := readMsgOfType(t, conn, protocol.SMsgCardPlayed)
	if penalty.Seat() != bot {
		t.Fatalf("second card_played came from seat %d, want the bot at %d", penalty.Seat(), bot)
	}
	if penalty.PendingDraw == nil || *penalty.PendingDraw != 2 {
		t.Fatalf("bot's card_played pending_draw = %v, want 2", penalty.PendingDraw)
	}
	if penalty.Turn != me {
		t.Fatalf("turn after the bot's +2 = %d, want the victim at %d", penalty.Turn, me)
	}
	if penalty.TurnDeadline == 0 {
		t.Error("the +2 that starts a forced draw carries no turn_deadline, " +
			"so the victim's countdown bar leaves the screen the moment the card lands")
	}
}
