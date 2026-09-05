package hub

import (
	"testing"
	"time"

	"loco/server/game"
)

// twoSeatTable deals Alice (seat 0, human) and Bot1 (seat 1, bot) and hands the
// table back unstarted, which is enough for the handlers that never cross a
// goroutine.
func twoSeatTable(t *testing.T) (*Hub, *table) {
	t.Helper()
	h := New()
	room := game.NewRoom("AAAAAA")
	for _, n := range []string{"Alice", "Bot1"} {
		if err := room.Join(n); err != nil {
			t.Fatalf("Join(%s): %v", n, err)
		}
	}
	if err := room.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	tbl := newTable("AAAAAA", room)
	tbl.members = []*Client{{send: make(chan []byte, 64)}, nil}
	tbl.bots[1] = struct{}{}
	return h, tbl
}

// A bot's turn used to be able to end nowhere: the domain refused the move it
// chose, botPlay logged it and returned, and nothing rescheduled the seat — no
// turn clock runs for a bot, so the table sat in front of a board that would
// never move again. A refusal is a bug in the bot, but the table must not pay
// for it: the recovery draws if it may and passes otherwise.
func TestBotRecover_PassesWhenItHasAlreadyDrawn(t *testing.T) {
	h, tbl := twoSeatTable(t)
	state := tbl.room.State
	state.CurrentTurn = 1
	state.HasDrawn = true

	h.botRecover(tbl, 1)

	if state.CurrentTurn != 0 {
		t.Fatalf("turn = %d after the recovery, want 0: the seat has to move on", state.CurrentTurn)
	}
}

func TestBotRecover_DrawsFirstWhenItStillMay(t *testing.T) {
	h, tbl := twoSeatTable(t)
	state := tbl.room.State
	state.CurrentTurn = 1
	state.HasDrawn = false
	before := state.Hands[1].Size()

	h.botRecover(tbl, 1)

	if state.Hands[1].Size() != before+1 {
		t.Fatalf("hand = %d cards, want %d: the recovery draws before it passes", state.Hands[1].Size(), before+1)
	}
	// Either the drawn card is playable and a move is rescheduled — the seat
	// keeps the turn with the draw spent — or it is not and the turn has passed.
	// Both are a turn that ends; a turn that stalls is neither.
	if state.CurrentTurn == 1 && !state.HasDrawn {
		t.Fatalf("the bot kept the turn without having drawn")
	}
}

// A personalised snapshot carries who is on the hook and until when, so a tab
// that reloads into somebody's window, or is corrected mid-window, is told what
// every other seat was told on card_played.
func TestPlayerGameState_CarriesTheOpenCatchWindows(t *testing.T) {
	h, tbl := twoSeatTable(t)
	state := tbl.room.State
	state.Hands[1].Cards = state.Hands[1].Cards[:1]
	state.LastCardDeclared[1] = false
	state.LastCardAt[1] = time.Now()

	dto := h.playerGameStateUsing(tbl, 0, h.playerList(tbl))
	if len(dto.CatchSeats) != 1 || dto.CatchSeats[0].PlayerIndex != 1 {
		t.Fatalf("catch_seats = %+v, want seat 1 on the hook", dto.CatchSeats)
	}
	if dto.CatchSeats[0].EndsAt <= time.Now().UnixMilli() {
		t.Errorf("ends_at = %d is already past", dto.CatchSeats[0].EndsAt)
	}
}

// Nothing runs a clock or a bot behind the map gate: the match begins at
// match_ready, and openTable arms both. A departure during the gate used to
// reach scheduleTurnTimer through retireSeat and start the first turn's thirty
// seconds over a loading screen.
func TestScheduleTurnTimer_RefusesWhileTheTableIsLoading(t *testing.T) {
	h, tbl := twoSeatTable(t)
	tbl.room.State.CurrentTurn = 0
	tbl.loading = &mapLoadState{ready: map[int]bool{}, startedAt: time.Now()}

	h.scheduleTurnTimer(tbl)

	if !tbl.turnStartedAt.IsZero() {
		t.Fatalf("a turn clock was armed behind the map gate")
	}
}
