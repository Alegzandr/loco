package game

import "testing"

// The match format, since rounds won started deciding it.
//
// Two rules live here and they are separate: who wins a match that has run its
// course (the tiebreak chain), and when a match stops running (decisiveLeader).
// Both used to be one line of endRound and neither was tested on its own.

// playRound drives one round to a win by seatIdx, exactly the way the hub does:
// the domain ends the round, the caller clears RoundEnded and deals the next one
// unless the match is over. loserCards is what every other seat is left holding,
// which is what the winner scores.
func playRound(t *testing.T, r *Room, seatIdx int, loserCards []Card) {
	t.Helper()
	top := Card{Color: Red, Kind: Number, Value: 1}
	r.State.Discard = []Card{top}
	r.State.ActiveColor = Red
	r.State.CurrentTurn = seatIdx
	r.State.PendingDraw = 0
	for i := range r.State.Hands {
		if i == seatIdx {
			r.State.Hands[i].Cards = []Card{top}
			continue
		}
		r.State.Hands[i].Cards = append([]Card(nil), loserCards...)
	}
	declareLast(t, r, seatIdx)
	if err := r.PlayCard(seatIdx, top, Red, -1); err != nil {
		t.Fatalf("PlayCard: %v", err)
	}
	r.RoundEnded = false
	if !r.MatchOver {
		if err := r.BeginNextRound(); err != nil {
			t.Fatalf("BeginNextRound: %v", err)
		}
	}
}

func matchRoom(t *testing.T, code string, format MatchFormat, nicknames ...string) *Room {
	t.Helper()
	r := NewRoom(code)
	for _, n := range nicknames {
		if err := r.Join(n); err != nil {
			t.Fatalf("Join(%q): %v", n, err)
		}
	}
	r.Format = format
	if err := r.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	return r
}

// The headline rule: rounds won decide, points only measure the gap. Before the
// change the score was filtered first, so the seat that took one expensive round
// beat the seat that took two cheap ones.
func TestDetermineMatchWinner_RoundsWonBeatsScore(t *testing.T) {
	r := matchRoom(t, "MW1", BO3, "alice", "bob")
	r.RoundNumber = 3
	r.RoundsWon = []int{2, 1}
	r.Scores = []int{10, 500}
	r.LostHandTotal = []int{0, 0}

	if got := r.determineMatchWinner(); got != "alice" {
		t.Errorf("winner = %q, want alice (2 rounds beats 500 points)", got)
	}
}

func TestDetermineMatchWinner_ScoreBreaksRoundsTie(t *testing.T) {
	r := matchRoom(t, "MW2", BO3, "alice", "bob")
	r.RoundNumber = 3
	r.RoundsWon = []int{1, 1}
	r.Scores = []int{40, 90}
	r.LostHandTotal = []int{0, 0}

	if got := r.determineMatchWinner(); got != "bob" {
		t.Errorf("winner = %q, want bob (level on rounds, ahead on points)", got)
	}
}

func TestDetermineMatchWinner_LostHandBreaksScoreTie(t *testing.T) {
	r := matchRoom(t, "MW3", BO3, "alice", "bob")
	r.RoundNumber = 3
	r.RoundsWon = []int{1, 1}
	r.Scores = []int{60, 60}
	r.LostHandTotal = []int{12, 40}

	if got := r.determineMatchWinner(); got != "alice" {
		t.Errorf("winner = %q, want alice (smallest pile of leftovers)", got)
	}
}

func TestDetermineMatchWinner_SuddenDeathWhenNothingSeparates(t *testing.T) {
	r := matchRoom(t, "MW4", BO3, "alice", "bob")
	r.RoundNumber = 3
	r.RoundsWon = []int{1, 1}
	r.Scores = []int{60, 60}
	r.LostHandTotal = []int{20, 20}

	if got := r.determineMatchWinner(); got != "" {
		t.Errorf("winner = %q, want \"\" (sudden death)", got)
	}
}

// A match stops the moment the rounds left cannot close the gap. One case per
// format, plus the round before it, so the test fails both on a match that runs
// too long and on one that stops too early.
func TestRoom_MatchStopsOnceTheLeadIsUncatchable(t *testing.T) {
	cases := []struct {
		name       string
		format     MatchFormat
		wins       []int // rounds alice must win, in order, to take the match
		stopsAfter int   // how many rounds the match should last
	}{
		{"BO1 ends on its only round", BO1, []int{0}, 1},
		{"BO3 stops at two nil", BO3, []int{0, 0}, 2},
		{"BO5 stops at three nil", BO5, []int{0, 0, 0}, 3},
		{"BO7 stops at four nil", BO7, []int{0, 0, 0, 0}, 4},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := matchRoom(t, "STOP", tc.format, "alice", "bob")
			for i, seat := range tc.wins {
				if r.MatchOver {
					t.Fatalf("match over after %d rounds, want %d", i, tc.stopsAfter)
				}
				playRound(t, r, seat, []Card{{Kind: Number, Color: Blue, Value: 5}})
			}
			if !r.MatchOver {
				t.Fatalf("match still open after %d rounds of %s", tc.stopsAfter, tc.name)
			}
			if r.RoundNumber != tc.stopsAfter {
				t.Errorf("RoundNumber = %d, want %d", r.RoundNumber, tc.stopsAfter)
			}
			if r.MatchWinner != "alice" {
				t.Errorf("MatchWinner = %q, want alice", r.MatchWinner)
			}
		})
	}
}

// The other half of the same rule: a lead that is still catchable does not stop
// anything, however large the points gap is.
func TestRoom_MatchRunsOnWhileTheLeadIsCatchable(t *testing.T) {
	r := matchRoom(t, "OPEN", BO7, "alice", "bob")
	// 3–1 with three rounds left: bob can still reach 4.
	playRound(t, r, 0, []Card{{Kind: WildDrawFour, Color: Wild}})
	playRound(t, r, 0, []Card{{Kind: WildDrawFour, Color: Wild}})
	playRound(t, r, 1, []Card{{Kind: Number, Color: Blue, Value: 1}})
	playRound(t, r, 0, []Card{{Kind: WildDrawFour, Color: Wild}})

	if r.MatchOver {
		t.Fatalf("match over at 3-1 in a BO7 (round %d)", r.RoundNumber)
	}
	if r.RoundsWon[0] != 3 || r.RoundsWon[1] != 1 {
		t.Fatalf("RoundsWon = %v, want [3 1]", r.RoundsWon)
	}
}

// Past two seats the majority is the wrong number — six players sharing a BO7
// never reach four — so the rule is a lead nobody can catch, not a threshold.
func TestRoom_UncatchableLeadAtMoreThanTwoSeats(t *testing.T) {
	r := matchRoom(t, "MANY", BO3, "alice", "bob", "carol")
	playRound(t, r, 0, []Card{{Kind: Number, Color: Blue, Value: 3}})
	if r.MatchOver {
		t.Fatal("match over after one round of a BO3")
	}
	playRound(t, r, 0, []Card{{Kind: Number, Color: Blue, Value: 3}})
	if !r.MatchOver {
		t.Fatalf("2-0-0 with one round left should end a BO3 (round %d)", r.RoundNumber)
	}
	if r.MatchWinner != "alice" {
		t.Errorf("MatchWinner = %q, want alice", r.MatchWinner)
	}
}

// A perfectly level last round keeps the room dealing rather than crowning
// anybody: the format runs out, the chain separates nobody, sudden death.
func TestRoom_SuddenDeathDealsAnotherRound(t *testing.T) {
	r := matchRoom(t, "SUD", BO3, "alice", "bob")
	loser := []Card{{Kind: Number, Color: Blue, Value: 5}}
	playRound(t, r, 0, loser)
	playRound(t, r, 1, loser)
	playRound(t, r, 0, loser)
	// 2–1 after three rounds: decisive, and no sudden death to reach.
	if !r.MatchOver {
		t.Fatal("2-1 after the last round of a BO3 should end it")
	}

	// Now the level case, built directly: identical rounds, points and leftovers.
	r2 := matchRoom(t, "SUD2", BO3, "alice", "bob")
	r2.RoundNumber = 3
	r2.RoundsWon = []int{1, 1}
	r2.Scores = []int{30, 30}
	r2.LostHandTotal = []int{30, 30}
	if r2.decisiveLeader() >= 0 {
		t.Errorf("decisiveLeader = %d on a level table, want -1", r2.decisiveLeader())
	}
	if got := r2.determineMatchWinner(); got != "" {
		t.Errorf("winner = %q, want \"\"", got)
	}
	if err := r2.BeginNextRound(); err != nil {
		t.Fatalf("BeginNextRound: %v", err)
	}
	if r2.RoundNumber != 4 {
		t.Errorf("RoundNumber = %d, want 4 (sudden death)", r2.RoundNumber)
	}
	// And the extra round settles it: the winner is a round ahead of everyone.
	playRound(t, r2, 1, []Card{{Kind: Number, Color: Blue, Value: 5}})
	if !r2.MatchOver || r2.MatchWinner != "bob" {
		t.Errorf("sudden death: over=%t winner=%q, want true/bob", r2.MatchOver, r2.MatchWinner)
	}
}

// A forfeit hands the match over whatever the board said, and leaves the board
// alone. Worth pinning against the uncatchable-lead rule: the seat that walks
// out is the one that was about to win.
func TestRoom_ForfeitDuringAnUncatchableLead(t *testing.T) {
	r := matchRoom(t, "FF", BO7, "alice", "bob")
	playRound(t, r, 0, []Card{{Kind: WildDrawFour, Color: Wild}})
	playRound(t, r, 0, []Card{{Kind: WildDrawFour, Color: Wild}})
	playRound(t, r, 0, []Card{{Kind: WildDrawFour, Color: Wild}})
	scores := append([]int(nil), r.Scores...)
	roundsWon := append([]int(nil), r.RoundsWon...)

	if err := r.ForfeitTo(1); err != nil {
		t.Fatalf("ForfeitTo: %v", err)
	}
	if r.MatchWinner != "bob" {
		t.Errorf("MatchWinner = %q, want bob", r.MatchWinner)
	}
	for i := range scores {
		if r.Scores[i] != scores[i] || r.RoundsWon[i] != roundsWon[i] {
			t.Errorf("forfeit moved the scoreboard: scores=%v roundsWon=%v, want %v/%v",
				r.Scores, r.RoundsWon, scores, roundsWon)
		}
	}
}

// The next round's opener is still the seat with the fewest points, on purpose:
// rounds won is too coarse a signal — most of the table sits on zero.
func TestRoom_BiggestLoserStaysOnPoints(t *testing.T) {
	r := matchRoom(t, "BL", BO7, "alice", "bob", "carol")
	r.Scores = []int{80, 5, 40}
	r.RoundsWon = []int{0, 3, 0}
	if got := r.biggestLoser(); got != 1 {
		t.Errorf("biggestLoser = %d, want 1 (fewest points, whatever the rounds say)", got)
	}
}
