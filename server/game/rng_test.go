package game

import (
	"math/rand"
	"testing"
	"time"
)

// The deal is hidden state, so the source that produces it has to be
// unguessable. This file runs the actual attack rather than asserting a
// property of the constructor: seeding a room from time.Now().UnixNano() is not
// wrong because the clock is "not random", it is wrong because an attacker who
// can bracket the moment the room was created has a search space small enough
// to walk, and the first message the server sends back tells them when they
// have found it.
//
// The observables below are exactly what a player legitimately receives in
// game_started: the map, the starting seat, and their own eight cards. Nothing
// here reads a field a client could not see.

// deal is what one candidate seed produces, and what game_started reveals.
type deal struct {
	mapID MapID
	turn  int
	hand  []Card
}

// dealFromSeed replays the server's own deal for a candidate seed. It mirrors
// NewRoom + Join + Start, with the one difference that matters: the source is
// the seed under test rather than a fresh one.
func dealFromSeed(t *testing.T, seed int64, nicknames []string) deal {
	t.Helper()
	r := NewRoom("SEED01")
	for _, n := range nicknames {
		if err := r.Join(n); err != nil {
			t.Fatalf("Join(%q): %v", n, err)
		}
	}
	r.rng = rand.New(rand.NewSource(seed))
	if err := r.Start(); err != nil {
		t.Fatalf("Start(): %v", err)
	}
	return deal{mapID: r.MapID, turn: r.State.CurrentTurn, hand: r.State.Hands[0].Cards}
}

func sameDeal(a, b deal) bool {
	if a.mapID != b.mapID || a.turn != b.turn || len(a.hand) != len(b.hand) {
		return false
	}
	for i := range a.hand {
		if a.hand[i] != b.hand[i] {
			return false
		}
	}
	return true
}

// searchClockSeeds walks every nanosecond in [from, to] and reports the seed
// whose deal matches, or false. This is the attacker's offline step, and it is
// cheap: the window a round trip leaves open is microseconds wide, and one
// candidate costs a 112-card shuffle.
func searchClockSeeds(t *testing.T, from, to int64, nicknames []string, target deal) (int64, bool) {
	t.Helper()
	for seed := from; seed <= to; seed++ {
		if sameDeal(dealFromSeed(t, seed, nicknames), target) {
			return seed, true
		}
	}
	return 0, false
}

// TestNewRoom_SeedIsNotRecoverableFromTheClock is the regression test for the
// audit finding. It fails against a room seeded with time.Now().UnixNano().
func TestNewRoom_SeedIsNotRecoverableFromTheClock(t *testing.T) {
	nicknames := []string{"alice", "bob"}

	// Bracket the constructor, and only the constructor: that is where the seed
	// is taken, so this is the tightest window an attacker could ever have — far
	// tighter than the millisecond-scale one a network round trip really gives
	// them. If the seed is not in here, it was not the clock.
	before := time.Now().UnixNano()
	r := NewRoom("REAL01")
	after := time.Now().UnixNano()

	for _, n := range nicknames {
		if err := r.Join(n); err != nil {
			t.Fatalf("Join(%q): %v", n, err)
		}
	}
	if err := r.Start(); err != nil {
		t.Fatalf("Start(): %v", err)
	}
	observed := deal{mapID: r.MapID, turn: r.State.CurrentTurn, hand: r.State.Hands[0].Cards}

	// The positive control. Without it this test passes for the wrong reason the
	// moment the replay above drifts out of step with dealRound: a search that
	// can no longer recognise the deal it is looking for reports "not found" for
	// every room, safe or not. So first prove the search works, by hiding a
	// clock-shaped seed in the same window and finding it.
	plantedSeed := before + (after-before)/2
	planted := dealFromSeed(t, plantedSeed, nicknames)
	if found, ok := searchClockSeeds(t, before, after, nicknames, planted); !ok || found != plantedSeed {
		t.Fatalf("the seed search is broken: planted %d, found %d (ok=%v) — this test proves nothing until it passes", plantedSeed, found, ok)
	}

	// The finding itself.
	if seed, ok := searchClockSeeds(t, before, after, nicknames, observed); ok {
		t.Fatalf("the room's deal was reproduced from clock seed %d: every opponent's hand and the whole draw order are derivable by anyone who timed create_room. Seed the room from crypto/rand (game.newRNG), never from time.Now()", seed)
	}
}

// TestNewRNG_DrawsDifferProcessWide guards the other half: a crypto seed is only
// worth having if each room gets its own. A constructor that read the entropy
// once into a package variable would pass the test above — no seed in the clock
// window — while dealing every table in the process the same cards.
func TestNewRNG_DrawsDifferProcessWide(t *testing.T) {
	const n = 64
	seen := make(map[int64]bool, n)
	for i := 0; i < n; i++ {
		v := newRNG().Int63()
		if seen[v] {
			t.Fatalf("newRNG() repeated its first draw within %d rooms: the seed is shared, so every table deals alike", n)
		}
		seen[v] = true
	}
}
