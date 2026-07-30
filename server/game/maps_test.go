package game

import "testing"

func startedRoom(t *testing.T, players ...string) *Room {
	t.Helper()
	r := NewRoom("MAPTST")
	for _, name := range players {
		if err := r.Join(name); err != nil {
			t.Fatalf("Join(%q): %v", name, err)
		}
	}
	if err := r.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	return r
}

func TestStart_DrawsAValidMap(t *testing.T) {
	r := startedRoom(t, "Alice", "Bob")
	if !r.MapID.Valid() {
		t.Fatalf("MapID = %q, want one of %v", r.MapID, MapIDs)
	}
}

// A lobby has no map. The client falls back to the built-in felt for an empty
// id, and the loading gate has nothing to wait for before a match exists.
func TestNewRoom_HasNoMapUntilStarted(t *testing.T) {
	r := NewRoom("MAPTST")
	if r.MapID != "" {
		t.Errorf("MapID = %q on a fresh lobby, want empty", r.MapID)
	}
}

// The map is the room the whole match is played in. Redrawing it between rounds
// would move the table under the players mid-match and read as a bug.
func TestBeginNextRound_KeepsTheMap(t *testing.T) {
	r := NewRoom("MAPTST")
	for _, name := range []string{"Alice", "Bob"} {
		if err := r.Join(name); err != nil {
			t.Fatalf("Join(%q): %v", name, err)
		}
	}
	// BO3: the default BO1 ends the match on the round we are about to finish,
	// and there would be no next round to check.
	if err := r.SetFormat(BO3); err != nil {
		t.Fatalf("SetFormat: %v", err)
	}
	if err := r.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	first := r.MapID
	// Force a round end so the room is allowed to deal the next one.
	r.endRound(0)
	if r.MatchOver {
		t.Fatal("BO3 should not be over after one round")
	}
	if err := r.BeginNextRound(); err != nil {
		t.Fatalf("BeginNextRound: %v", err)
	}
	if r.MapID != first {
		t.Errorf("MapID = %q after round 2, want it to stay %q", r.MapID, first)
	}
}

// A rematch is a new match, so it gets a new room, and just as importantly a
// map the clients may not have downloaded yet, which is what re-arms the loading
// gate. Keeping the old id would silently skip that.
func TestResetForRematch_ClearsTheMap(t *testing.T) {
	r := startedRoom(t, "Alice", "Bob")
	r.Status = StatusFinished
	if err := r.ResetForRematch(); err != nil {
		t.Fatalf("ResetForRematch: %v", err)
	}
	if r.MapID != "" {
		t.Errorf("MapID = %q after a rematch reset, want empty", r.MapID)
	}
	if err := r.Start(); err != nil {
		t.Fatalf("Start after rematch: %v", err)
	}
	if !r.MapID.Valid() {
		t.Errorf("MapID = %q after restarting, want a fresh valid map", r.MapID)
	}
}

func TestMapID_Valid(t *testing.T) {
	for _, id := range MapIDs {
		if !id.Valid() {
			t.Errorf("%q is in MapIDs but reports invalid", id)
		}
	}
	for _, id := range []MapID{"", "atlantis", "Neon", "neon "} {
		if id.Valid() {
			t.Errorf("%q reports valid", id)
		}
	}
}

// Every registered map must actually be drawable: an id listed but never
// returned would be a room nobody ever plays in, and the miss would be silent.
func TestPickMap_ReachesEveryMap(t *testing.T) {
	seen := make(map[MapID]bool, len(MapIDs))
	r := NewRoom("MAPTST")
	for i := 0; i < 400; i++ {
		seen[r.pickMap()] = true
	}
	for _, id := range MapIDs {
		if !seen[id] {
			t.Errorf("pickMap never returned %q in 400 draws", id)
		}
	}
	if len(seen) != len(MapIDs) {
		t.Errorf("pickMap returned %d distinct maps, want %d", len(seen), len(MapIDs))
	}
}
