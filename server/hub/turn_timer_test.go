package hub_test

import (
	"testing"
	"time"

	"loco/server/hub"
	"loco/server/protocol"
)

// Deviation §14.5 — a forced draw does not cost the turn: the victim takes the
// whole stack and then plays normally. The domain keeps that promise, but the
// turn clock was armed when the penalty card landed, so every second spent
// deciding whether to counter is a second gone from the turn that follows the
// draw. A player who takes their time draws the stack and is auto-passed moments
// later: the seat disappears right after the draw, which is the exact bug the
// deviation exists to prevent. Drawing re-arms the clock.
//
// Both penalty cards are covered because both are what a player actually gets
// hit by; they share one code path (PendingDraw → DrawCard) and a regression in
// it would land on the pair, so the pair is what the test watches.
func TestPenaltyDraw_RearmsTurnTimer(t *testing.T) {
	cases := []struct {
		name    string
		discard protocol.CardDTO
		pending int
	}{
		{"draw_two", protocol.CardDTO{Color: "blue", Kind: "draw_two"}, 2},
		{"wild_draw_four", protocol.CardDTO{Color: "wild", Kind: "wild_draw_four"}, 4},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("LOCO_E2E", "1")

			prev := hub.TurnTimeout
			hub.TurnTimeout = 700 * time.Millisecond
			t.Cleanup(func() { hub.TurnTimeout = prev })

			g := setupActiveGame(t)

			// The penalty lands on the active seat. debug_set_state does not touch
			// whose turn it is, so the timer armed at game start is still running.
			pending := tc.pending
			sendMsg(t, g.activeConn, protocol.ClientMsg{
				Type:             protocol.CMsgDebugSetState,
				DebugHand:        []protocol.CardDTO{{Color: "blue", Kind: "number", Value: 3}},
				DebugDiscard:     &tc.discard,
				DebugActiveColor: "blue",
				DebugPendingDraw: &pending,
			})
			readMsgOfType(t, g.activeConn, protocol.SMsgGameState)
			readMsgOfType(t, g.otherConn, protocol.SMsgGameState)

			// Deciding not to counter burns most of the original turn.
			time.Sleep(400 * time.Millisecond)

			sendMsg(t, g.activeConn, protocol.ClientMsg{Type: protocol.CMsgDrawCard})
			drawn := readMsgOfType(t, g.activeConn, protocol.SMsgCardDrawn)
			if len(drawn.Cards) != tc.pending {
				t.Fatalf("penalty draw gave %d cards, want %d", len(drawn.Cards), tc.pending)
			}
			if drawn.Turn != g.activeIdx {
				t.Fatalf("turn moved to %d after a forced draw, want %d (deviation §14.5)", drawn.Turn, g.activeIdx)
			}

			// The announced deadline must be a fresh turn, not the leftover of the old one.
			remaining := time.Until(time.UnixMilli(drawn.TurnDeadline))
			if remaining < 500*time.Millisecond {
				t.Errorf("turn deadline after penalty draw leaves %v, want ~%v (timer not re-armed)", remaining, hub.TurnTimeout)
			}

			// And the seat must still be ours past the original deadline.
			time.Sleep(400 * time.Millisecond)
			sendMsg(t, g.activeConn, protocol.ClientMsg{
				Type: protocol.CMsgPlayCard,
				Card: &protocol.CardDTO{Color: "blue", Kind: "number", Value: 3},
			})
			played := readMsgOfType(t, g.activeConn, protocol.SMsgCardPlayed)
			if played.PlayerIndex != g.activeIdx {
				t.Errorf("card_played PlayerIndex = %d, want %d", played.PlayerIndex, g.activeIdx)
			}
		})
	}
}
