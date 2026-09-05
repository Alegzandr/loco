// One table, as one thing.
package hub

import (
	"sync"
	"sync/atomic"
	"time"

	"loco/server/game"
)

// table is everything the hub knows about one room code.
//
// It used to be eleven maps all keyed by that same string, which meant a table
// was not an object at all. Opening one was eleven writes, deleting one was
// eleven deletes, and every one of those lists had to be kept complete by hand:
// deleteRoom was the only place they were all named together, and a map added
// without being added there leaks per-match state into the next match at the
// same code. The bug that shape produces is never a crash. It is a rematch
// dealing on a gate belonging to the match before it, or a turn timer checked
// against a timestamp from a round that is over.
//
// Nothing here is exported, and nothing here is touched by any goroutine but
// this table's own, which is why none of it is locked. The two exceptions are
// declared as such: box and quit are how work gets in, and phase is the one
// value the hub reads without asking. See actor.go.
type table struct {
	code string
	room *game.Room

	// box is this table's mailbox and the only way work reaches it. quit ends
	// the goroutine, done says it has gone, and stopOnce is what lets the hub
	// delete a room twice without closing a channel twice.
	box      chan tableJob
	quit     chan struct{}
	done     chan struct{}
	stopOnce sync.Once
	started  atomic.Bool

	// phase is "would a shutdown interrupt something here", published after
	// every job so the drain can count without reading a table it does not own.
	// See publishPhase.
	phase atomic.Int32

	// members is indexed by seat, and a nil entry is a seat whose socket has
	// gone: held for the reconnect window during a match, removed and re-based
	// in a lobby. Never write it directly — seat() and dropSeat() are the two
	// ways in, and the reason is in seat()'s comment.
	members []*Client

	// tokens[seat] is the proof a returning player has to produce. Spent and
	// reissued on every reclaim, so a token is only ever good once.
	tokens map[int]string

	// awayAt[seat] is when that seat's socket went. Set during a match, and on a
	// finished ordinary table, where the rematch is still to come: in a lobby the
	// seat is removed instead of held.
	awayAt map[int]time.Time

	// gone is the set of seats whose reconnect window closed while the match was
	// still running.
	//
	// A held seat is absent because it is in awayAt, and the entry is deleted the
	// moment the window shuts — so the seat that had just provably left was the
	// one the roster reported as connected, from the player_left announcing its
	// departure onwards. It cannot simply be removed instead: the hands, the
	// scores and the turn order are indexed by it until the round ends. So the
	// seat stays and the absence is recorded here.
	//
	// Only a match needs it. Every other status removes the seat outright, which
	// is why a rematch's reset and every re-basing move clear it.
	gone map[int]struct{}

	// bots is the set of seats nobody is sitting in.
	bots map[int]struct{}

	// afk[seat] counts consecutive turn timeouts, and any voluntary action
	// clears it.
	afk map[int]int

	// rematchOffers is the set of seats that have asked for another match. The
	// whole set is broadcast rather than the increment; see rematch.go.
	rematchOffers map[int]struct{}

	// (An emote leaves no state here at all — not what was said and not when. It
	// is relayed and forgotten; see emotes.go.)

	// matchHistory is every match this table has finished, oldest first.
	//
	// It is the one thing here that outlives a match on purpose: a rematch nils
	// the room's scores, so six matches on one code used to leave nobody able to
	// say who won the evening. It is cleared when the table stops existing and at
	// no other moment, which is why it sits beside the seats rather than beside
	// the per-match state resetForNextMatch wipes.
	//
	// Indexed by seat like everything else here, so it moves with dropSeat and
	// swapSeats. A slice of records, deliberately not a twelfth map.
	matchHistory []matchRecord

	// matchStartedAt is when the turn clock started for the match in progress:
	// openTable stamps it, and it is what the duration on the match's record is
	// measured from. Zero means no match has been opened, which is also what a
	// match still behind the loading gate looks like — a forfeit there records
	// no duration, because nothing was played.
	matchStartedAt time.Time

	// turnStartedAt is what a turn timer re-checks itself against on the way in.
	// Zero means no turn is being timed, which is also what a bot's turn looks
	// like: they keep their own time and the client draws no bar for them.
	turnStartedAt time.Time

	// emptyAt is when the last socket left, and what a cleanup timer re-checks
	// itself against. Zero means somebody is here.
	emptyAt time.Time

	// matchmadeAt is when the queue paired this table. Zero means a player
	// opened it.
	matchmadeAt time.Time

	// solo marks a 1v1 against the server: one human, one bot, dealt on the spot
	// with no code and no waiting room. It is hostless for the same reason a
	// matchmade table is — there is nothing to configure and nobody to configure
	// it for — but it deliberately keeps the *ordinary* table's timing: the 15 s
	// hold and the two-timeout AFK threshold exist because a stranger will not
	// wait for you, and the seat opposite this player is not a stranger. See
	// solo.go.
	solo bool

	// streamerMode is the host saying nobody's screen may show this table's code.
	//
	// It is the one preference in this game that is not purely local, and it is a
	// property of the table rather than of a seat: the code is one string, shared
	// by everyone who can see it, so a host who is streaming is exposing it no
	// matter which client draws it. Set by seat 0 and by nobody else, and it
	// survives resetForNextMatch like the seats do — the stream does not end
	// because the match did.
	streamerMode bool

	// loading is the map-loading gate. Non-nil means the table is shut: no turn
	// timer, no bots, no gameplay message accepted. See maploading.go.
	loading *mapLoadState
}

// matchRecord is one finished match at this table: what each seat won it or lost
// it by, and who took it.
//
// Both numbers are kept because both are read. RoundsWon is what decided the
// match; Scores is the gap it was decided by, and a recap that showed only the
// winner would be a scoreboard with the game taken out of it. The fields are
// exported so the drain snapshot carries them.
type matchRecord struct {
	RoundsWon []int `json:"rounds_won"`
	Scores    []int `json:"scores"`
	// Winner is the seat that took the match, or -1 once that seat has left the
	// table. A departure re-bases every seat above it, and a winner that quietly
	// followed the shift would credit the match to whoever slid into the index.
	Winner int `json:"winner"`
	// DurationMs is how long the match was played, measured from
	// matchStartedAt. Zero means the server cannot say, and it is omitted from
	// the wire rather than shown as a match that took no time.
	DurationMs int64 `json:"duration_ms,omitempty"`
}

// recordFinishedMatch appends the match that has just ended. Called once per
// match, from every path that can end one: the last round, and a forfeit.
//
// The room's own arrays are copied rather than referenced — ResetForRematch nils
// them and Start reallocates them, so a record holding the live slice would be
// the next match's scoreboard by the time anybody read it.
//
// now is when the match ended. It is handed in rather than read here so the
// duration is a difference between two stamps a test can choose.
func (t *table) recordFinishedMatch(now time.Time) {
	room := t.room
	n := len(room.Players)
	rec := matchRecord{
		RoundsWon:  make([]int, n),
		Scores:     make([]int, n),
		Winner:     -1,
		DurationMs: matchDurationMs(t.matchStartedAt, now),
	}
	copy(rec.RoundsWon, room.RoundsWon)
	copy(rec.Scores, room.Scores)
	for i, p := range room.Players {
		if p.Nickname == room.MatchWinner {
			rec.Winner = i
			break
		}
	}
	t.matchHistory = append(t.matchHistory, rec)
}

// matchDurationMs is how long a match that opened at startedAt and ended at now
// was played, in whole milliseconds, rounded up.
//
// Rounded up and not down because zero is the "cannot say" value on the wire:
// a match that opened is reported as at least one millisecond, however fast
// the table went, so the client never reads a played match as an unknown one.
// A zero startedAt is a match that never opened (a forfeit inside the loading
// gate, a snapshot from a process that did not stamp it) and answers zero.
func matchDurationMs(startedAt, now time.Time) int64 {
	if startedAt.IsZero() || !now.After(startedAt) {
		return 0
	}
	d := now.Sub(startedAt)
	return int64((d + time.Millisecond - 1) / time.Millisecond)
}

// dropSeatFromHistory removes one seat from every recorded match, so a table
// whose roster shrinks keeps a recap that still lines up with it.
func dropSeatFromHistory(history []matchRecord, removed int) {
	for i := range history {
		history[i].RoundsWon = dropInt(history[i].RoundsWon, removed)
		history[i].Scores = dropInt(history[i].Scores, removed)
		switch {
		case history[i].Winner == removed:
			history[i].Winner = -1
		case history[i].Winner > removed:
			history[i].Winner--
		}
	}
}

// swapSeatsInHistory exchanges two seats in every recorded match, so a
// transfer_host moves what a player won along with the player.
func swapSeatsInHistory(history []matchRecord, a, b int) {
	for i := range history {
		swapInt(history[i].RoundsWon, a, b)
		swapInt(history[i].Scores, a, b)
		switch history[i].Winner {
		case a:
			history[i].Winner = b
		case b:
			history[i].Winner = a
		}
	}
}

// dropInt returns xs without the element at i. Out-of-range is a no-op: a record
// written before a seat existed is shorter than the roster is now.
func dropInt(xs []int, i int) []int {
	if i < 0 || i >= len(xs) {
		return xs
	}
	return append(xs[:i], xs[i+1:]...)
}

// swapInt exchanges two elements, ignoring indices the slice does not have.
func swapInt(xs []int, a, b int) {
	if a < 0 || b < 0 || a >= len(xs) || b >= len(xs) {
		return
	}
	xs[a], xs[b] = xs[b], xs[a]
}

// newTable builds a table but does not start it. The caller finishes filling it
// in (matchmaking sets matchmadeAt, the snapshot restore sets most of it) and
// then calls start: a goroutine reading fields somebody is still writing is the
// one race this split exists to make impossible.
func newTable(code string, room *game.Room) *table {
	return &table{
		code:          code,
		room:          room,
		tokens:        make(map[int]string),
		awayAt:        make(map[int]time.Time),
		gone:          make(map[int]struct{}),
		bots:          make(map[int]struct{}),
		afk:           make(map[int]int),
		rematchOffers: make(map[int]struct{}),
		box:           make(chan tableJob, tableBoxDepth),
		quit:          make(chan struct{}),
		done:          make(chan struct{}),
	}
}

// client returns the socket at a seat, or nil for a seat that is empty, held or
// out of range. Bounds-checked because seat numbers arrive from the wire.
// handSize is how many cards `seat` holds, or 0 when there is no board or no
// such seat. A bounds answer rather than a panic: it is read before a message
// has been validated, which is exactly when the seat may be nonsense.
func (t *table) handSize(seat int) int {
	if t.room == nil || t.room.State == nil || seat < 0 || seat >= len(t.room.State.Hands) {
		return 0
	}
	return t.room.State.Hands[seat].Size()
}

func (t *table) client(seat int) *Client {
	if seat < 0 || seat >= len(t.members) {
		return nil
	}
	return t.members[seat]
}

// hasLeft reports whether a seat's reconnect window closed without the player
// coming back. See the gone field: it is the half of "is anybody there" that
// awayAt stops answering the moment the window shuts.
func (t *table) hasLeft(seat int) bool {
	_, ok := t.gone[seat]
	return ok
}

// addEmptySeat appends a seat with no socket behind it — a bot. members is the
// table's, and growing it is a seat move like any other, so it goes through a
// method here rather than an append at the call site: see seat().
func (t *table) addEmptySeat() {
	t.members = append(t.members, nil)
}

// isBot reports whether a seat is played by the server.
func (t *table) isBot(seat int) bool {
	_, ok := t.bots[seat]
	return ok
}

// isMatchmade reports whether this table came out of the 1v1 queue.
func (t *table) isMatchmade() bool { return !t.matchmadeAt.IsZero() }

// hostless reports whether this table has nobody with standing over it: the
// format is fixed, the size is fixed, the match starts by itself and there is
// nobody to remove. Two shapes answer yes — a matchmade pair and a solo game —
// and every host control asks this question rather than either of them.
func (t *table) hostless() bool { return t.isMatchmade() || t.solo }

// isLoading reports whether the table is still shut behind the map gate.
func (t *table) isLoading() bool { return t.loading != nil }

// allSeatsEmpty reports whether every seat's socket has gone.
func (t *table) allSeatsEmpty() bool {
	for _, m := range t.members {
		if m != nil {
			return false
		}
	}
	return true
}

// abandonedBy reports whether every seat other than this one is an absent
// human: no socket at it and no bot behind it.
//
// It is what tells a lone survivor apart from a quitter. Leaving a match in
// progress is refused at an ordinary table on purpose — walking out is not a
// move — but the refusal assumes there is somebody being walked out on. Once
// the other seat's socket is gone and its hold has expired, nothing at that
// seat will ever act again: the turn clock auto-draws and auto-passes for it
// every thirty seconds until the round runs out, and the survivor's only way
// out of the game is closing the tab. That is the one state in the game with no
// in-game action available, and this is the question that ends it.
func (t *table) abandonedBy(seat int) bool {
	for i := range t.room.Players {
		if i == seat {
			continue
		}
		if t.isBot(i) || t.client(i) != nil {
			return false
		}
		if _, held := t.awayAt[i]; held {
			// Away, not gone. The hold is the whole reason leaving is refused
			// here: a drop is not a departure until the window says so.
			return false
		}
	}
	return true
}

// playableSeats counts the seats that can still act in the match: a bot, or a
// human who is either here or inside their reconnect window.
//
// It is what "is there still a game here" means, and it is the question
// leave_room asks mid-match. A seat whose hold has expired is not one of them —
// nothing at it will ever move again — and neither is one that has already
// walked out.
func (t *table) playableSeats() int {
	n := 0
	for seat := range t.room.Players {
		switch {
		case t.isBot(seat):
			n++
		case t.room.IsRetired(seat):
			// Gone on purpose, and not coming back.
		case t.client(seat) != nil:
			n++
		default:
			if _, held := t.awayAt[seat]; held {
				n++
			}
		}
	}
	return n
}

// connected counts the sockets still at the table.
func (t *table) connected() int {
	n := 0
	for _, m := range t.members {
		if m != nil {
			n++
		}
	}
	return n
}

// seat binds a client to a seat.
//
// A seat lives in two places — the client's own playerID and the pointer at
// that index in members — and the whole point of this method is that there is
// no way to move one without the other. Re-entering a room used to move only
// the first, leaving the pointer behind at the old index while personalised
// broadcasts were built from the new one, and a player who rebound to seat 0
// elsewhere was handed seat 0's *hand* in the table they had left. That is why
// the sweep below is unconditional: whatever index this client was at here, it
// is not there any more.
//
// It is the caller's job to take the client off any *other* table first, which
// is what Hub.seatClient does.
func (t *table) seat(c *Client, id int) {
	for i, m := range t.members {
		if m == c && i != id {
			t.members[i] = nil
		}
	}
	for len(t.members) <= id {
		t.members = append(t.members, nil)
	}
	t.members[id] = c
	c.sitAt(t.code, id)
	// Somebody is sitting here, so whatever this seat's last departure recorded
	// is over. A reclaim inside the window never reaches this, but a seat reused
	// by a re-index would.
	delete(t.gone, id)
	// Somebody is here, so any cleanup timer counting this table down is stale.
	// It used to be a delete() the four seating paths each had to remember.
	t.emptyAt = time.Time{}
}

// hold empties a seat without removing it: the match is running and the player
// has the reconnect window to come back into it.
func (t *table) hold(seat int, at time.Time) {
	if seat >= 0 && seat < len(t.members) {
		t.members[seat] = nil
	}
	t.awayAt[seat] = at
}

// reseat rewrites every seated client's playerID from where it actually sits,
// and reports whether anybody is still there. Run after any removal.
func (t *table) reseat() (hasHuman bool) {
	for i, m := range t.members {
		if m != nil {
			m.sitAt(t.code, i)
			hasHuman = true
		}
	}
	return hasHuman
}

// dropSeat removes a seat entirely and re-bases everything keyed above it: the
// members slice, the surviving clients' own playerID, the bot set and the
// session tokens, all in one move. A seat number that means one thing in one of
// those and something else in the next is the class of bug this type exists to
// close, so they are never shifted apart.
//
// The caller owns room.RemoveLobbyPlayer: this is the hub's half only.
func (t *table) dropSeat(id int) (hasHuman bool) {
	if id >= 0 && id < len(t.members) {
		t.members = append(t.members[:id], t.members[id+1:]...)
	}
	t.bots = shiftIntKeySet(t.bots, id)
	t.tokens = shiftIntKeyMap(t.tokens, id)
	t.gone = shiftIntKeySet(t.gone, id)
	dropSeatFromHistory(t.matchHistory, id)
	return t.reseat()
}

// dropClient is dropSeat for a departure identified by socket rather than by
// index. The two are the same seat in every case the code can produce, and the
// pointer is the one of the pair that cannot be stale.
func (t *table) dropClient(c *Client, id int) (hasHuman bool) {
	kept := make([]*Client, 0, len(t.members))
	for _, m := range t.members {
		if m != c {
			kept = append(kept, m)
		}
	}
	t.members = kept
	t.bots = shiftIntKeySet(t.bots, id)
	t.tokens = shiftIntKeyMap(t.tokens, id)
	t.gone = shiftIntKeySet(t.gone, id)
	dropSeatFromHistory(t.matchHistory, id)
	return t.reseat()
}

// swapSeats exchanges two seats and everything keyed by them: the sockets, the
// clients' own playerID, the bot set and the session tokens, in one move — the
// same rule dropSeat is written to, for the same reason.
//
// The token travels with the player, not with the index: it is the proof that
// seat is theirs, and leaving it behind would hand a returning player the other
// one's seat. awayAt and gone are not swapped because this is lobby-only and a
// lobby has neither: a seat whose socket goes is removed there, not held.
func (t *table) swapSeats(a, b int) {
	if a == b {
		return
	}
	for len(t.members) <= max(a, b) {
		t.members = append(t.members, nil)
	}
	t.members[a], t.members[b] = t.members[b], t.members[a]

	_, aBot := t.bots[a]
	_, bBot := t.bots[b]
	setMembership(t.bots, a, bBot)
	setMembership(t.bots, b, aBot)

	aTok, aHad := t.tokens[a]
	bTok, bHad := t.tokens[b]
	setToken(t.tokens, a, bTok, bHad)
	setToken(t.tokens, b, aTok, aHad)

	swapSeatsInHistory(t.matchHistory, a, b)

	t.reseat()
}

// setMembership makes a set say yes or no about one key. Written out because a
// swap has to be able to move an *absence* as readily as a presence: assigning
// only the true side leaves the other key claiming a bot that has moved.
func setMembership(m map[int]struct{}, key int, present bool) {
	if present {
		m[key] = struct{}{}
		return
	}
	delete(m, key)
}

// setToken is setMembership for the session tokens.
func setToken(m map[int]string, key int, val string, present bool) {
	if present {
		m[key] = val
		return
	}
	delete(m, key)
}

// resetForNextMatch clears everything that belonged to the match that has just
// ended. It is one call rather than five deletes at each of the three places a
// table starts over, and the gate is the one that bites: a mapLoadState left
// behind keeps the next match shut forever, because its timeout has already
// fired and nothing is left to reopen it.
//
// The seats, the tokens and the bot set survive on purpose: those describe who
// is at the table, not what they were playing. So does matchHistory, which is
// the one thing here that is *about* the matches before this one — see its
// field.
func (t *table) resetForNextMatch() {
	t.rematchOffers = make(map[int]struct{})
	t.afk = make(map[int]int)
	t.awayAt = make(map[int]time.Time)
	t.gone = make(map[int]struct{})
	t.matchStartedAt = time.Time{}
	t.turnStartedAt = time.Time{}
	t.emptyAt = time.Time{}
	t.loading = nil
}

// tableOf returns the table a client is sitting at, or nil.
func (h *Hub) tableOf(c *Client) *table {
	if c.roomCode() == "" {
		return nil
	}
	return h.tables[c.roomCode()]
}

// requireTable is tableOf for a message handler: it answers the client itself
// when there is no table to act on, so every handler opens with three lines
// instead of its own pair of error strings.
func (h *Hub) requireTable(c *Client) (*table, bool) {
	if c.roomCode() == "" {
		c.sendError("not in a room")
		return nil, false
	}
	t, ok := h.tables[c.roomCode()]
	if !ok {
		c.sendError("room not found")
		return nil, false
	}
	return t, true
}

// seatClient is the only way a client is bound to a seat. It takes them off
// whatever table they were at first, so the stale-pointer case cannot be
// reached even if a future handler forgets the alreadySeated check that is
// supposed to make it unreachable in the first place.
// The sweep of the old table is asked of that table rather than done here: its
// members are its own, and this runs on whichever goroutine is doing the
// seating. It is belt and braces for a case alreadySeated is supposed to make
// unreachable, so a hop's delay costs nothing.
func (h *Hub) seatClient(t *table, c *Client, id int) {
	if old := c.roomCode(); old != "" && old != t.code {
		h.postToRouter("sweep_old_seat", func() {
			if ot := h.tables[old]; ot != nil {
				ot.postFromTimer("sweep_old_seat", func() { ot.sweep(c) })
			}
		})
	}
	t.seat(c, id)
}

// sweep takes a socket out of this table's members without touching anything
// else. Only seatClient uses it, for a client that has turned up elsewhere.
func (t *table) sweep(c *Client) {
	for i, m := range t.members {
		if m == c {
			t.members[i] = nil
		}
	}
}

// shiftIntKeySet returns a copy of m with the entry at `removed` dropped and
// every key > removed shifted down by 1. Returns nil when the input is nil.
func shiftIntKeySet(m map[int]struct{}, removed int) map[int]struct{} {
	if m == nil {
		return nil
	}
	out := make(map[int]struct{}, len(m))
	for k := range m {
		if k == removed {
			continue
		}
		if k > removed {
			k--
		}
		out[k] = struct{}{}
	}
	return out
}

// shiftIntKeyMap is shiftIntKeySet for map[int]string (session tokens).
func shiftIntKeyMap(m map[int]string, removed int) map[int]string {
	if m == nil {
		return nil
	}
	out := make(map[int]string, len(m))
	for k, v := range m {
		if k == removed {
			continue
		}
		if k > removed {
			k--
		}
		out[k] = v
	}
	return out
}
