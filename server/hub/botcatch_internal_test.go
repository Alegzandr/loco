package hub

import (
	"testing"
	"time"

	"loco/server/game"
)

// catchWindowLength asks the domain how long a seat stays on the hook instead of
// restating the 5 s here. CatchWindowEnd is the window added to the moment it
// opened, so the difference between the two is the window itself and a seat
// nobody has put on the hook answers it exactly as well as a live one.
func catchWindowLength(t *testing.T) time.Duration {
	t.Helper()
	r := game.NewRoom("WINDOW")
	if err := r.Join("Alice"); err != nil {
		t.Fatalf("join: %v", err)
	}
	if err := r.Join("Bob"); err != nil {
		t.Fatalf("join: %v", err)
	}
	if err := r.Start(); err != nil {
		t.Fatalf("start: %v", err)
	}
	return r.State.CatchWindowEnd(0).Sub(r.State.LastCardAt[0])
}

// TestBotCatchTiming_LateAndInsideTheWindow pins both ends of the bot's
// Contre-LOCO!, because both of them are the feature.
//
// The floor: the seat that forgot the call is looking at an armed chip for the
// whole window, so a bot answering in the first half takes the press away from
// the player who was already going for it — and the one control this game asks a
// newcomer to learn becomes one they never get to use.
//
// The ceiling: a call that lands after the window costs its caller a card, so a
// bot must never be scheduled into a race it cannot win.
func TestBotCatchTiming_LateAndInsideTheWindow(t *testing.T) {
	window := catchWindowLength(t)

	if BotCatchDelay < window/2 {
		t.Errorf("BotCatchDelay = %v, want at least half of the %v window: the seat that owes the call has to be able to make it",
			BotCatchDelay, window)
	}
	latest := BotCatchDelay + BotCatchJitterMax
	if latest >= window {
		t.Errorf("BotCatchDelay+BotCatchJitterMax = %v, want inside the %v window", latest, window)
	}
	// Half a second of it is kept clear: the job still has to cross the table's
	// box, and a bot arriving late would pay a card for a call nothing chose.
	if margin := window - latest; margin < 500*time.Millisecond {
		t.Errorf("only %v of the %v window left after the latest bot catch, want at least 500ms", margin, window)
	}
}

// TestBotCatchAttempt_OneVerdictPerWindow is the property that keeps a table of
// four bots as winnable as a table of one. A window is armed once per action
// taken inside it — a play down to one card, a bot's turn two seconds later, an
// interject — so the verdict has to belong to the window: rolled per arming, the
// delay would be the minimum of N draws and the probability 1-(1-p)^N, and the
// busier the board the faster and the surer the catch.
func TestBotCatchAttempt_OneVerdictPerWindow(t *testing.T) {
	at := time.Now()
	delay, attempt := botCatchAttempt(2, at)
	for i := 0; i < 50; i++ {
		gotDelay, gotAttempt := botCatchAttempt(2, at)
		if gotDelay != delay || gotAttempt != attempt {
			t.Fatalf("arming the same window twice answered (%v, %v) then (%v, %v)",
				delay, attempt, gotDelay, gotAttempt)
		}
	}
}

// TestBotCatchAttempt_VariesAcrossWindows is the other half: one answer per
// window is only right *within* a window. Two windows a millisecond apart, or
// the same instant on two seats, must not share a moment to strike, or every bot
// catch of the evening lands on the same beat.
func TestBotCatchAttempt_VariesAcrossWindows(t *testing.T) {
	if BotCatchJitterMax == 0 {
		t.Skip("no jitter configured")
	}
	base := time.Now()
	seen := map[time.Duration]struct{}{}
	for i := 0; i < 200; i++ {
		d, _ := botCatchAttempt(i%4, base.Add(time.Duration(i)*time.Millisecond))
		if d < BotCatchDelay || d > BotCatchDelay+BotCatchJitterMax {
			t.Fatalf("delay %v outside [%v, %v]", d, BotCatchDelay, BotCatchDelay+BotCatchJitterMax)
		}
		seen[d] = struct{}{}
	}
	if len(seen) < 20 {
		t.Errorf("only %d distinct delays over 200 windows; the jitter is not spreading", len(seen))
	}
}

// TestBotCatchAttempt_ProbabilityBounds covers the two ends every other test in
// this package leans on when it pins BotCatchProb to 0 or 1 to make the bots
// deterministic.
func TestBotCatchAttempt_ProbabilityBounds(t *testing.T) {
	orig := BotCatchProb
	t.Cleanup(func() { BotCatchProb = orig })

	base := time.Now()
	BotCatchProb = 0
	for i := 0; i < 200; i++ {
		if _, attempt := botCatchAttempt(i%4, base.Add(time.Duration(i)*time.Microsecond)); attempt {
			t.Fatal("BotCatchProb = 0 must never attempt")
		}
	}
	BotCatchProb = 1
	for i := 0; i < 200; i++ {
		if _, attempt := botCatchAttempt(i%4, base.Add(time.Duration(i)*time.Microsecond)); !attempt {
			t.Fatal("BotCatchProb = 1 must always attempt")
		}
	}
}

// TestBotCatchAttempt_HonoursItsProbability keeps the middle honest: the point of
// the hash is that it answers one window the same way twice, not that it leans.
func TestBotCatchAttempt_HonoursItsProbability(t *testing.T) {
	orig := BotCatchProb
	t.Cleanup(func() { BotCatchProb = orig })
	BotCatchProb = 0.5

	base := time.Now()
	const n = 4000
	attempts := 0
	for i := 0; i < n; i++ {
		if _, attempt := botCatchAttempt(i%4, base.Add(time.Duration(i)*time.Microsecond)); attempt {
			attempts++
		}
	}
	if attempts < n*4/10 || attempts > n*6/10 {
		t.Errorf("%d/%d windows answered at p=0.5; want roughly half", attempts, n)
	}
}
