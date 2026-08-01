package hub

import (
	"testing"
	"time"
)

// The bot think delay is dead time in CI: 1.2–2.2 s per bot turn, paid by every
// E2E test that lets a bot play. It is the one bot timing that can be shortened
// without changing what a test proves, because nothing races it — unlike the
// catch, declaration and interrupt delays, which are reaction windows a human
// (or a test) is meant to be able to win.
//
// The override is gated on LOCO_E2E for the same reason debug_set_state is: a
// production server must not be able to grow instant bots through a stray
// environment variable.
func TestBotTimingOverride(t *testing.T) {
	const (
		defThink  = 1200 * time.Millisecond
		defJitter = 1000 * time.Millisecond
	)

	env := func(m map[string]string) func(string) string {
		return func(k string) string { return m[k] }
	}

	cases := []struct {
		name       string
		vars       map[string]string
		wantThink  time.Duration
		wantJitter time.Duration
		wantOK     bool
	}{
		{
			name:   "no debug gate is no override",
			vars:   map[string]string{"LOCO_BOT_THINK_MS": "50", "LOCO_BOT_JITTER_MS": "0"},
			wantOK: false,
		},
		{
			name:   "debug gate alone changes nothing",
			vars:   map[string]string{"LOCO_E2E": "1"},
			wantOK: false,
		},
		{
			name:       "both values",
			vars:       map[string]string{"LOCO_E2E": "1", "LOCO_BOT_THINK_MS": "150", "LOCO_BOT_JITTER_MS": "100"},
			wantThink:  150 * time.Millisecond,
			wantJitter: 100 * time.Millisecond,
			wantOK:     true,
		},
		{
			name:       "think alone keeps the default jitter",
			vars:       map[string]string{"LOCO_E2E": "1", "LOCO_BOT_THINK_MS": "150"},
			wantThink:  150 * time.Millisecond,
			wantJitter: defJitter,
			wantOK:     true,
		},
		{
			name:       "jitter alone keeps the default think",
			vars:       map[string]string{"LOCO_E2E": "1", "LOCO_BOT_JITTER_MS": "0"},
			wantThink:  defThink,
			wantJitter: 0,
			wantOK:     true,
		},
		{
			// A typo must leave the shipped timing in place rather than silently
			// producing a 0 ms bot, which would rewrite every race in the suite.
			name:   "garbage is ignored",
			vars:   map[string]string{"LOCO_E2E": "1", "LOCO_BOT_THINK_MS": "fast"},
			wantOK: false,
		},
		{
			name:   "negative is ignored",
			vars:   map[string]string{"LOCO_E2E": "1", "LOCO_BOT_THINK_MS": "-1"},
			wantOK: false,
		},
		{
			name:       "a bad value does not void a good one",
			vars:       map[string]string{"LOCO_E2E": "1", "LOCO_BOT_THINK_MS": "150", "LOCO_BOT_JITTER_MS": "soon"},
			wantThink:  150 * time.Millisecond,
			wantJitter: defJitter,
			wantOK:     true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			think, jitter, ok := botTimingOverride(env(tc.vars), defThink, defJitter)
			if ok != tc.wantOK {
				t.Fatalf("ok = %v, want %v", ok, tc.wantOK)
			}
			if !ok {
				return
			}
			if think != tc.wantThink {
				t.Errorf("think = %v, want %v", think, tc.wantThink)
			}
			if jitter != tc.wantJitter {
				t.Errorf("jitter = %v, want %v", jitter, tc.wantJitter)
			}
		})
	}
}

// ApplyBotTimingEnv is called once at startup, so the only thing worth pinning
// about it is that it writes the package vars the scheduler actually reads and
// leaves them alone when there is nothing to apply.
func TestApplyBotTimingEnv(t *testing.T) {
	origThink, origJitter := BotThinkDelay, BotJitterMax
	t.Cleanup(func() {
		BotThinkDelay, BotJitterMax = origThink, origJitter
	})

	t.Setenv("LOCO_E2E", "1")
	t.Setenv("LOCO_BOT_THINK_MS", "80")
	t.Setenv("LOCO_BOT_JITTER_MS", "40")
	ApplyBotTimingEnv()
	if BotThinkDelay != 80*time.Millisecond || BotJitterMax != 40*time.Millisecond {
		t.Fatalf("think/jitter = %v/%v, want 80ms/40ms", BotThinkDelay, BotJitterMax)
	}

	BotThinkDelay, BotJitterMax = origThink, origJitter
	t.Setenv("LOCO_E2E", "")
	ApplyBotTimingEnv()
	if BotThinkDelay != origThink || BotJitterMax != origJitter {
		t.Fatalf("think/jitter = %v/%v without the debug gate, want the defaults", BotThinkDelay, BotJitterMax)
	}
}
