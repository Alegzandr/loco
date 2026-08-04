package hub

import (
	"reflect"
	"testing"

	"loco/server/game"
)

// The recap is indexed by seat like everything else on a table, so it moves with
// every move that re-bases a seat. These are the two the black-box suite cannot
// reach cheaply: a swap (transfer_host in the lobby a rematch reopened) and the
// reset that must NOT touch it.

func historyTable() *table {
	room := game.NewRoom("HIST")
	_ = room.Join("alice")
	_ = room.Join("bob")
	_ = room.Join("carol")
	t := newTable("HIST", room)
	t.members = []*Client{nil, nil, nil}
	t.matchHistory = []matchRecord{
		{RoundsWon: []int{2, 1, 0}, Scores: []int{80, 40, 10}, Winner: 0},
		{RoundsWon: []int{0, 0, 2}, Scores: []int{5, 15, 70}, Winner: 2},
	}
	return t
}

func TestMatchHistory_SwapSeatsMovesTheColumns(t *testing.T) {
	tb := historyTable()
	tb.swapSeats(0, 2)

	want := []matchRecord{
		{RoundsWon: []int{0, 1, 2}, Scores: []int{10, 40, 80}, Winner: 2},
		{RoundsWon: []int{2, 0, 0}, Scores: []int{70, 15, 5}, Winner: 0},
	}
	if !reflect.DeepEqual(tb.matchHistory, want) {
		t.Errorf("matchHistory = %+v, want %+v", tb.matchHistory, want)
	}
}

func TestMatchHistory_DropSeatRemovesTheColumn(t *testing.T) {
	tb := historyTable()
	tb.dropSeat(0)

	want := []matchRecord{
		// Alice took the first match and has left: nobody owns that row now.
		{RoundsWon: []int{1, 0}, Scores: []int{40, 10}, Winner: -1},
		// Carol took the second and has slid from seat 2 to seat 1.
		{RoundsWon: []int{0, 2}, Scores: []int{15, 70}, Winner: 1},
	}
	if !reflect.DeepEqual(tb.matchHistory, want) {
		t.Errorf("matchHistory = %+v, want %+v", tb.matchHistory, want)
	}
}

// resetForNextMatch clears what belonged to the match that just ended. The recap
// is the one thing there that is about the matches before it, so it stays.
func TestMatchHistory_SurvivesResetForNextMatch(t *testing.T) {
	tb := historyTable()
	before := len(tb.matchHistory)
	tb.resetForNextMatch()
	if len(tb.matchHistory) != before {
		t.Errorf("matchHistory = %d rows after reset, want %d", len(tb.matchHistory), before)
	}
}

// The record copies the room's arrays rather than pointing at them: ResetForRematch
// nils those, and a row holding the live slice would read as the next match.
func TestMatchHistory_RecordCopiesTheScoreboard(t *testing.T) {
	room := game.NewRoom("COPY")
	_ = room.Join("alice")
	_ = room.Join("bob")
	room.Scores = []int{70, 20}
	room.RoundsWon = []int{2, 0}
	room.MatchWinner = "alice"
	tb := newTable("COPY", room)

	tb.recordFinishedMatch()
	room.Scores[0] = 999
	room.RoundsWon = nil

	if got := tb.matchHistory[0].Scores[0]; got != 70 {
		t.Errorf("recorded score followed the room: %d, want 70", got)
	}
	if got := tb.matchHistory[0].RoundsWon; len(got) != 2 || got[0] != 2 {
		t.Errorf("recorded rounds won = %v, want [2 0]", got)
	}
	if got := tb.matchHistory[0].Winner; got != 0 {
		t.Errorf("recorded winner = %d, want 0", got)
	}
}
