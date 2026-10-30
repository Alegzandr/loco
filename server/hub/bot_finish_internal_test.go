package hub

import (
	"testing"
	"time"

	"loco/server/game"
)

// One moment, one answer: the window is armed again by every action taken inside
// it, and a fresh draw per arming made the busiest table the fastest one.
func TestMomentJitter_SameMomentSameAnswerInsideTheBound(t *testing.T) {
	at := time.Unix(1_700_000_000, 123_456_789)
	max := 800 * time.Millisecond
	seen := map[time.Duration]bool{}
	for seat := 0; seat < 6; seat++ {
		for i := 0; i < 50; i++ {
			moment := at.Add(time.Duration(i) * time.Millisecond)
			j := momentJitter(seat, moment, saltFinish, max)
			if j < 0 || j > max {
				t.Fatalf("momentJitter = %v, want inside [0, %v]", j, max)
			}
			if again := momentJitter(seat, moment, saltFinish, max); again != j {
				t.Fatalf("momentJitter answered %v then %v for the same moment", j, again)
			}
			seen[j] = true
		}
	}
	if len(seen) < 50 {
		t.Errorf("momentJitter took %d distinct values over 300 moments: it is not jitter", len(seen))
	}
	if got := momentJitter(0, at, saltFinish, 0); got != 0 {
		t.Errorf("momentJitter with no range = %v, want 0", got)
	}
}

// The later of the two floors holds: an undeclared last card keeps the bot's
// finish behind its own declaration, and a declared one only behind the delay.
func TestBotFinishDue_TheLaterFloorHolds(t *testing.T) {
	origUno, origUnoJ := BotUnoDelay, BotUnoJitterMax
	origFin, origFinJ := BotFinishDelay, BotFinishJitterMax
	t.Cleanup(func() {
		BotUnoDelay, BotUnoJitterMax = origUno, origUnoJ
		BotFinishDelay, BotFinishJitterMax = origFin, origFinJ
	})
	BotUnoDelay, BotUnoJitterMax = 2*time.Second, 0
	BotFinishDelay, BotFinishJitterMax = 500*time.Millisecond, 0

	window := time.Unix(1_700_000_000, 0)
	since := window.Add(100 * time.Millisecond)
	s := &game.GameState{
		Hands:            []game.Hand{{}, {Cards: []game.Card{{Color: game.Red, Kind: game.Number, Value: 7}}}},
		LastCardAt:       []time.Time{{}, window},
		LastCardDeclared: []bool{false, false},
	}
	if got, want := botFinishDue(s, 1, since), window.Add(2*time.Second); !got.Equal(want) {
		t.Errorf("undeclared: due %v after the window, want %v", got.Sub(window), want.Sub(window))
	}
	s.LastCardDeclared[1] = true
	if got, want := botFinishDue(s, 1, since), since.Add(500*time.Millisecond); !got.Equal(want) {
		t.Errorf("declared: due %v after since, want %v", got.Sub(since), want.Sub(since))
	}
}
