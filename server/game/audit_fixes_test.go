package game

import "testing"

// A replenish adds the pile to what is left of the deck; it never replaces
// it. The deck is reshuffled when it is *short*, which is exactly when it is
// not empty: replacing it threw the unseen cards away, and a +6 against a
// two-card deck cost the round two cards for good.
func TestEnsureDeck_KeepsTheCardsStillInTheDeck(t *testing.T) {
	r := NewRoom("DECK")
	for _, n := range []string{"a", "b"} {
		if err := r.Join(n); err != nil {
			t.Fatal(err)
		}
	}
	if err := r.Start(); err != nil {
		t.Fatal(err)
	}
	// Two cards left in the deck, a pile of twenty under the top card.
	kept := []Card{{Color: Red, Kind: Number, Value: 1}, {Color: Blue, Kind: Number, Value: 2}}
	r.State.Deck.Cards = append([]Card(nil), kept...)
	pile := make([]Card, 0, 21)
	for v := 0; v < 21; v++ {
		pile = append(pile, Card{Color: Green, Kind: Number, Value: v % 10})
	}
	r.State.Discard = pile

	r.ensureDeck(6)

	if got := len(r.State.Deck.Cards); got != 22 {
		t.Fatalf("deck after replenish = %d cards, want 22 (2 kept + 20 from the pile)", got)
	}
	if got := len(r.State.Discard); got != 1 {
		t.Errorf("discard after replenish = %d cards, want the top card alone", got)
	}
	for _, k := range kept {
		found := false
		for _, c := range r.State.Deck.Cards {
			if c == k {
				found = true
			}
		}
		if !found {
			t.Errorf("card %v that was still in the deck is gone after the replenish", k)
		}
	}
}

// A finished room keeps its scores for the game-over screen, and everything
// the scoreboard is drawn from is indexed by seat: removing a seat re-bases
// them with the roster, or the leaver's column shows under the seat above it.
func TestRoom_RemoveLobbyPlayer_RebasesTheScores(t *testing.T) {
	r := NewRoom("RBSC")
	for _, n := range []string{"alice", "bob", "carol"} {
		if err := r.Join(n); err != nil {
			t.Fatal(err)
		}
	}
	r.Status = StatusFinished
	r.Scores = []int{10, 20, 30}
	r.RoundsWon = []int{1, 0, 2}
	r.LostHandTotal = []int{5, 6, 7}
	r.Retired = []bool{false, true, false}
	r.RoundHistory = [][]int{{1, 2, 3}, {4, 5, 6}}

	if _, err := r.RemoveLobbyPlayer(1); err != nil {
		t.Fatal(err)
	}
	want := func(name string, got, exp []int) {
		if len(got) != len(exp) {
			t.Fatalf("%s = %v, want %v", name, got, exp)
		}
		for i := range exp {
			if got[i] != exp[i] {
				t.Errorf("%s = %v, want %v", name, got, exp)
				return
			}
		}
	}
	want("Scores", r.Scores, []int{10, 30})
	want("RoundsWon", r.RoundsWon, []int{1, 2})
	want("LostHandTotal", r.LostHandTotal, []int{5, 7})
	want("RoundHistory[0]", r.RoundHistory[0], []int{1, 3})
	want("RoundHistory[1]", r.RoundHistory[1], []int{4, 6})
	if len(r.Retired) != 2 || r.Retired[0] || r.Retired[1] {
		t.Errorf("Retired = %v, want [false false]", r.Retired)
	}
}

// A one-card interject off a one-card hand was declared before the message,
// and the log used to carry the call twice.
func TestInterruptPlayCards_SingleCardFinishLogsOneDeclaration(t *testing.T) {
	r := NewRoom("ONED")
	for _, n := range []string{"a", "b"} {
		if err := r.Join(n); err != nil {
			t.Fatal(err)
		}
	}
	if err := r.Start(); err != nil {
		t.Fatal(err)
	}
	top := Card{Color: Red, Kind: Number, Value: 5}
	r.State.Discard = []Card{top}
	r.State.ActiveColor = Red
	r.State.Hands[1] = Hand{Cards: []Card{top}}
	r.State.CurrentTurn = 0
	r.State.LastPlayBy = 0
	r.State.InterruptOpen = true
	r.State.updateLastCardState(1)
	if err := r.DeclareLastCard(1); err != nil {
		t.Fatal(err)
	}
	before := 0
	for _, ev := range r.State.EventLog {
		if ev.Kind == EventUnoDeclared {
			before++
		}
	}
	if err := r.InterruptPlayCards(1, []Card{top}, Red, -1, false); err != nil {
		t.Fatal(err)
	}
	after := 0
	for _, ev := range r.State.EventLog {
		if ev.Kind == EventUnoDeclared {
			after++
		}
	}
	if after != before {
		t.Errorf("declarations in the log went %d -> %d on a one-card finish, want unchanged", before, after)
	}
}
