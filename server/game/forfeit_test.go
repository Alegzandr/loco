package game

import "testing"

// A forfeit ends the match on the spot and hands it to whoever is still there.
// It is the only way a match can finish without a round finishing, so it has to
// leave the room in exactly the state the finished path leaves it in: the hub
// broadcasts match_end from these fields and the client's game-over screen is
// built from them.
func TestForfeitTo_EndsMatchForTheRemainingPlayer(t *testing.T) {
	r := NewRoom("ABCDEF")
	mustJoin(t, r, "Alice")
	mustJoin(t, r, "Bob")
	if err := r.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}

	if err := r.ForfeitTo(1); err != nil {
		t.Fatalf("ForfeitTo: %v", err)
	}

	if !r.MatchOver {
		t.Error("MatchOver = false, want true")
	}
	if r.MatchWinner != "Bob" {
		t.Errorf("MatchWinner = %q, want Bob", r.MatchWinner)
	}
	if r.Status != StatusFinished {
		t.Errorf("Status = %v, want finished", r.Status)
	}
}

// The abandoned round scores nothing. A forfeit is not a win on points, and
// inventing points for it would put a round in the score table that nobody
// played to the end.
func TestForfeitTo_LeavesTheScoreboardAlone(t *testing.T) {
	r := NewRoom("ABCDEF")
	mustJoin(t, r, "Alice")
	mustJoin(t, r, "Bob")
	if err := r.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	r.Scores[0] = 40
	rounds := len(r.RoundHistory)

	if err := r.ForfeitTo(0); err != nil {
		t.Fatalf("ForfeitTo: %v", err)
	}

	if r.Scores[0] != 40 || r.Scores[1] != 0 {
		t.Errorf("Scores = %v, want [40 0] unchanged", r.Scores)
	}
	if len(r.RoundHistory) != rounds {
		t.Errorf("RoundHistory grew to %d rows, want %d", len(r.RoundHistory), rounds)
	}
	if r.RoundEnded {
		t.Error("RoundEnded = true: a forfeit ends the match, not a round")
	}
}

func TestForfeitTo_RejectsWhenNotPlaying(t *testing.T) {
	r := NewRoom("ABCDEF")
	mustJoin(t, r, "Alice")
	mustJoin(t, r, "Bob")

	if err := r.ForfeitTo(0); err == nil {
		t.Fatal("ForfeitTo in a lobby: want error, got nil")
	}
}

func TestForfeitTo_RejectsUnknownSeat(t *testing.T) {
	r := NewRoom("ABCDEF")
	mustJoin(t, r, "Alice")
	mustJoin(t, r, "Bob")
	if err := r.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}

	if err := r.ForfeitTo(2); err == nil {
		t.Fatal("ForfeitTo(2) with 2 seats: want error, got nil")
	}
	if r.MatchOver {
		t.Error("a refused forfeit must not end the match")
	}
}

func mustJoin(t *testing.T, r *Room, nickname string) {
	t.Helper()
	if err := r.Join(nickname); err != nil {
		t.Fatalf("Join(%q): %v", nickname, err)
	}
}
