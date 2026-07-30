package hub

import (
	"testing"
	"time"
)

// The score table's ping column is only as trustworthy as this function: a
// single raw sample carries the jitter of one packet, and a value that jumps
// 40, then 180, then 50 reads as a broken readout rather than as a busy network.
func TestNotePong_SmoothsSamples(t *testing.T) {
	c := &Client{}
	c.latencyMs.Store(-1)

	now := time.Now()

	// A pong with no ping behind it (or a clock that went backwards) must not
	// publish a flattering 0 ms.
	c.notePong(now)
	if got := c.latency(); got != -1 {
		t.Fatalf("latency after unsolicited pong = %d, want -1 (unknown)", got)
	}

	// First real sample lands as-is: there is nothing to smooth it against.
	c.pingSentAt.Store(now.Add(-100 * time.Millisecond).UnixNano())
	c.notePong(now)
	if got := c.latency(); got != 100 {
		t.Fatalf("first sample = %d, want 100", got)
	}

	// Second sample is folded in: 0.6*100 + 0.4*200 = 140.
	c.pingSentAt.Store(now.Add(-200 * time.Millisecond).UnixNano())
	c.notePong(now)
	if got := c.latency(); got != 140 {
		t.Errorf("smoothed latency = %d, want 140", got)
	}
}

func TestNotePong_ClampsStalledConnection(t *testing.T) {
	c := &Client{}
	c.latencyMs.Store(-1)
	now := time.Now()
	c.pingSentAt.Store(now.Add(-3 * time.Hour).UnixNano())
	c.notePong(now)
	if got := c.latency(); got != maxLatencyMs {
		t.Errorf("latency = %d, want the %d cap", got, maxLatencyMs)
	}
}
