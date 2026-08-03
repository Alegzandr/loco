package hub

import (
	"path/filepath"
	"testing"
	"time"

	"loco/server/game"
)

// A seat lives in two places: the client's own playerID and the pointer at that
// index in the table's members. handleCreateRoom and handleJoinRoom refuse a
// client that is already seated, and seat_rebind_test.go proves that refusal
// through the socket. This proves the other half: even with the refusal gone,
// binding a client to a seat takes it off wherever it was sitting before, so
// there is no arrangement of handlers that can leave the pointer behind.
//
// That pointer is what personalised broadcasts index by, so a stale one is not
// a bookkeeping wart: it is one player being handed another's hand.
// The sweep of the old table is asked of that table now rather than reached
// into, so this goes through the hub and both goroutines exactly as production
// does. Reading either table's members from the test goroutine would be the
// very race the hand-off exists to remove, so every read below is posted too.
func TestSeatClient_LeavesNoPointerBehind(t *testing.T) {
	h := New()
	go h.Run()
	defer h.Stop()

	first := newTable("AAAAAA", game.NewRoom("AAAAAA"))
	first.members = []*Client{nil, nil}
	second := newTable("BBBBBB", game.NewRoom("BBBBBB"))

	c := &Client{}
	// Before either table is running, which is where every production caller
	// does its own filling in. See table.start.
	h.seatClient(first, c, 1)
	if first.members[1] != c || c.playerID() != 1 || c.roomCode() != first.code {
		t.Fatalf("first seating did not take: members=%v playerID=%d code=%q",
			first.members, c.playerID(), c.roomCode())
	}
	h.tables[first.code] = first
	h.tables[second.code] = second
	first.start(h)
	second.start(h)

	onTable(t, second, func() { h.seatClient(second, c, 0) })

	if got := onTableValue(t, second, func() any { return second.members[0] }); got != c {
		t.Errorf("the new table does not point at the client: %v", got)
	}
	if c.playerID() != 0 || c.roomCode() != second.code {
		t.Errorf("the client's own record disagrees: playerID=%d code=%q", c.playerID(), c.roomCode())
	}
	// Two hops away: the new table asks the hub, the hub asks the old table.
	waitOnTable(t, first, func() bool { return first.members[1] == nil },
		"the old table still points at the client")
}

// onTable runs fn on a table's goroutine and waits for it.
func onTable(t *testing.T, tbl *table, fn func()) {
	t.Helper()
	done := make(chan struct{})
	if !tbl.post(tableJob{what: "test", run: func() { fn(); close(done) }}) {
		t.Fatal("table box full")
	}
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("the table never ran the job")
	}
}

// onTableValue reads something off a table's goroutine.
func onTableValue(t *testing.T, tbl *table, fn func() any) any {
	t.Helper()
	var out any
	onTable(t, tbl, func() { out = fn() })
	return out
}

// waitOnTable polls a condition on a table's goroutine until it holds.
func waitOnTable(t *testing.T, tbl *table, cond func() bool, msg string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if onTableValue(t, tbl, func() any { return cond() }).(bool) {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Error(msg)
}

// Re-seating inside one table is the same rule with one table: the client must
// be at exactly one index when it is over.
func TestSeat_MovesRatherThanDuplicates(t *testing.T) {
	tbl := newTable("AAAAAA", game.NewRoom("AAAAAA"))
	c := &Client{}
	tbl.seat(c, 2)
	tbl.seat(c, 0)

	seen := 0
	for _, m := range tbl.members {
		if m == c {
			seen++
		}
	}
	if seen != 1 {
		t.Fatalf("client sits at %d indices, want 1: %v", seen, tbl.members)
	}
	if tbl.members[0] != c {
		t.Errorf("client is not at the seat it was moved to: %v", tbl.members)
	}
}

// Seating somebody means the table is not empty, so a cleanup timer counting it
// down is stale. It used to be a delete() each of the four seating paths had to
// remember, and forgetting it in one of them deletes a table somebody is at.
func TestSeat_CancelsThePendingCleanup(t *testing.T) {
	h := New()
	tbl := newTable("AAAAAA", game.NewRoom("AAAAAA"))
	h.tables[tbl.code] = tbl
	h.scheduleRoomCleanup(tbl)
	if tbl.emptyAt.IsZero() {
		t.Fatal("scheduleRoomCleanup did not stamp the table")
	}

	h.seatClient(tbl, &Client{}, 0)

	if !tbl.emptyAt.IsZero() {
		t.Error("a seated table is still counting down to deletion")
	}
}

// Removing a seat shifts the members slice, the surviving clients' own playerID,
// the bot set and the session tokens in one move. Shifting one of those without
// the others is the class of bug the table type exists to close: a seat number
// that means one thing in one structure and something else in the next.
func TestDropSeat_ShiftsEverythingTogether(t *testing.T) {
	tbl := newTable("AAAAAA", game.NewRoom("AAAAAA"))
	a, c := &Client{}, &Client{}
	tbl.seat(a, 0)
	tbl.members = append(tbl.members, nil) // seat 1: a bot
	tbl.bots[1] = struct{}{}
	tbl.seat(c, 2)
	tbl.tokens[0] = "tok-a"
	tbl.tokens[1] = "tok-bot"
	tbl.tokens[2] = "tok-c"

	// Seat 0 leaves: the bot becomes seat 0 and c becomes seat 1.
	if hasHuman := tbl.dropSeat(0); !hasHuman {
		t.Fatal("dropSeat reported nobody left, but c is still seated")
	}

	if len(tbl.members) != 2 || tbl.members[0] != nil || tbl.members[1] != c {
		t.Fatalf("members did not shift: %v", tbl.members)
	}
	if c.playerID() != 1 {
		t.Errorf("the client's own playerID did not follow: %d, want 1", c.playerID())
	}
	if !tbl.isBot(0) || tbl.isBot(1) {
		t.Errorf("the bot set did not shift: %v", tbl.bots)
	}
	if tbl.tokens[0] != "tok-bot" || tbl.tokens[1] != "tok-c" {
		t.Errorf("the tokens did not shift: %v", tbl.tokens)
	}
	if _, stale := tbl.tokens[2]; stale {
		t.Error("the removed seat's token survived the shift")
	}
}

// deleteRoom is one delete because a table is one object. It used to be eleven,
// and the failure mode of eleven is a twelfth map added without being added
// here, leaking the match that just ended into the next one at the same code.
func TestDeleteRoom_ForgetsTheTableWhole(t *testing.T) {
	h := New()
	tbl := newTable("AAAAAA", game.NewRoom("AAAAAA"))
	tbl.bots[0] = struct{}{}
	h.tables[tbl.code] = tbl
	h.metrics.rooms.Add(1)
	h.metrics.botsActive.Add(1)

	h.deleteRoom(tbl.code)

	if _, ok := h.tables[tbl.code]; ok {
		t.Error("the table survived deleteRoom")
	}
	if got := h.metrics.botsActive.Load(); got != 0 {
		t.Errorf("bots_active = %d after deleting the only table's bot, want 0", got)
	}
	if got := h.metrics.rooms.Load(); got != 0 {
		t.Errorf("rooms_active = %d, want 0", got)
	}
}

// A rematch deals on a table that has just finished a match, so everything the
// old match left has to go. The gate is the one that bites: a mapLoadState left
// behind keeps the next match shut forever, because its own timeout has already
// fired and nothing is left to reopen it.
func TestResetForNextMatch_ClearsTheGate(t *testing.T) {
	tbl := newTable("AAAAAA", game.NewRoom("AAAAAA"))
	c := &Client{}
	tbl.seat(c, 0)
	tbl.tokens[0] = "tok"
	tbl.bots[1] = struct{}{}
	tbl.loading = &mapLoadState{ready: map[int]bool{}}
	tbl.afk[0] = 3
	tbl.awayAt[0] = tbl.matchmadeAt
	tbl.rematchOffers[0] = struct{}{}

	tbl.resetForNextMatch()

	if tbl.loading != nil {
		t.Error("the map gate survived into the next match")
	}
	if len(tbl.afk) != 0 || len(tbl.awayAt) != 0 || len(tbl.rematchOffers) != 0 {
		t.Errorf("per-match bookkeeping survived: afk=%v away=%v offers=%v",
			tbl.afk, tbl.awayAt, tbl.rematchOffers)
	}
	// Who is at the table is not per-match and must survive.
	if tbl.members[0] != c || tbl.tokens[0] != "tok" || !tbl.isBot(1) {
		t.Error("resetForNextMatch emptied the table instead of the match")
	}
}

// Stop waits for the loop to be gone rather than merely asking it to go.
//
// It used to close the channel and return, which meant everything after Stop
// ran alongside a loop still dispatching. In production that is a process
// exiting mid-handler; in the tests it was a real data race, reported by
// `go test -race ./hub/` on fourteen tests at once, because every timing test
// narrows a package-level tunable (BotThinkDelay and a dozen others) and
// restores it in a `t.Cleanup` that the loop was still reading underneath.
//
// The loop is parked here inside a handler on purpose: a snapshot request whose
// reply nobody is reading yet holds the loop in saveSnapshot, so what this
// asserts is the part that matters — Stop does not return mid-handler.
func TestStop_WaitsForTheLoopToLeaveTheHandler(t *testing.T) {
	h := New()
	go h.Run()

	// Unbuffered on purpose: the send below only completes once the loop has
	// taken it, and the loop then blocks handing the result back.
	done := make(chan error)
	h.snapshotSave <- snapshotReq{path: filepath.Join(t.TempDir(), "snap.json"), done: done}

	stopped := make(chan struct{})
	go func() {
		h.Stop()
		close(stopped)
	}()

	select {
	case <-stopped:
		t.Fatal("Stop returned while the loop was still inside a handler")
	case <-time.After(100 * time.Millisecond):
	}

	<-done // release the loop; it goes back to the select and sees quit closed

	select {
	case <-stopped:
	case <-time.After(2 * time.Second):
		t.Fatal("Stop never returned after the loop was released")
	}
}
