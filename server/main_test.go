package main

import (
	"testing"
	"time"
)

// The drain timeout is the only thing standing between a deploy and killing the
// matches on the server, so a value it cannot read must never resolve to "do
// not wait". Zero is the one answer this function is not allowed to give.
func TestParseDrainTimeout(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want time.Duration
	}{
		{"unset", "", defaultDrainTimeout},
		{"go duration", "90s", 90 * time.Second},
		{"minutes", "15m", 15 * time.Minute},
		{"bare seconds", "120", 120 * time.Second},
		{"nonsense falls back", "soon", defaultDrainTimeout},
		{"zero falls back", "0", defaultDrainTimeout},
		{"negative falls back", "-5m", defaultDrainTimeout},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := parseDrainTimeout(tc.raw); got != tc.want {
				t.Errorf("parseDrainTimeout(%q) = %s, want %s", tc.raw, got, tc.want)
			}
		})
	}
}
