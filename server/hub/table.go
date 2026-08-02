// One table, as one thing.
package hub

import (
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
// Nothing here is exported and nothing here is read off the event loop, which is
// why none of it is locked. See metrics.go for the one part of the Hub that is.
type table struct {
	code string
	room *game.Room

	// members is indexed by seat, and a nil entry is a seat whose socket has
	// gone: held for the reconnect window during a match, removed and re-based
	// in a lobby. Never write it directly — seat() and dropSeat() are the two
	// ways in, and the reason is in seat()'s comment.
	members []*Client

	// tokens[seat] is the proof a returning player has to produce. Spent and
	// reissued on every reclaim, so a token is only ever good once.
	tokens map[int]string

	// awayAt[seat] is when that seat's socket went. Only ever set during a
	// match: in a lobby the seat is removed instead of held.
	awayAt map[int]time.Time

	// bots is the set of seats nobody is sitting in.
	bots map[int]struct{}

	// afk[seat] counts consecutive turn timeouts, and any voluntary action
	// clears it.
	afk map[int]int

	// rematchOffers is the set of seats that have asked for another match. The
	// whole set is broadcast rather than the increment; see rematch.go.
	rematchOffers map[int]struct{}

	// turnStartedAt is what a turn timer re-checks itself against on the way in.
	// Zero means no turn is being timed, which is also what a bot's turn looks
	// like: they keep their own time and the client draws no bar for them.
	turnStartedAt time.Time

	// emptyAt is when the last socket left, and what a cleanup timer re-checks
	// itself against. Zero means somebody is here.
	emptyAt time.Time

	// matchmadeAt is when the queue paired this table. Zero means a player
	// opened it, which is what every host control is gated on.
	matchmadeAt time.Time

	// loading is the map-loading gate. Non-nil means the table is shut: no turn
	// timer, no bots, no gameplay message accepted. See maploading.go.
	loading *mapLoadState
}

func newTable(code string, room *game.Room) *table {
	return &table{
		code:          code,
		room:          room,
		tokens:        make(map[int]string),
		awayAt:        make(map[int]time.Time),
		bots:          make(map[int]struct{}),
		afk:           make(map[int]int),
		rematchOffers: make(map[int]struct{}),
	}
}

// client returns the socket at a seat, or nil for a seat that is empty, held or
// out of range. Bounds-checked because seat numbers arrive from the wire.
func (t *table) client(seat int) *Client {
	if seat < 0 || seat >= len(t.members) {
		return nil
	}
	return t.members[seat]
}

// isBot reports whether a seat is played by the server.
func (t *table) isBot(seat int) bool {
	_, ok := t.bots[seat]
	return ok
}

// isMatchmade reports whether this table came out of the 1v1 queue.
func (t *table) isMatchmade() bool { return !t.matchmadeAt.IsZero() }

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
	c.roomCode = t.code
	c.playerID = id
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
			m.playerID = i
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
	return t.reseat()
}

// resetForNextMatch clears everything that belonged to the match that has just
// ended. It is one call rather than five deletes at each of the three places a
// table starts over, and the gate is the one that bites: a mapLoadState left
// behind keeps the next match shut forever, because its timeout has already
// fired and nothing is left to reopen it.
//
// The seats, the tokens and the bot set survive on purpose: those describe who
// is at the table, not what they were playing.
func (t *table) resetForNextMatch() {
	t.rematchOffers = make(map[int]struct{})
	t.afk = make(map[int]int)
	t.awayAt = make(map[int]time.Time)
	t.turnStartedAt = time.Time{}
	t.emptyAt = time.Time{}
	t.loading = nil
}

// tableOf returns the table a client is sitting at, or nil.
func (h *Hub) tableOf(c *Client) *table {
	if c.roomCode == "" {
		return nil
	}
	return h.tables[c.roomCode]
}

// requireTable is tableOf for a message handler: it answers the client itself
// when there is no table to act on, so every handler opens with three lines
// instead of its own pair of error strings.
func (h *Hub) requireTable(c *Client) (*table, bool) {
	if c.roomCode == "" {
		c.sendError("not in a room")
		return nil, false
	}
	t, ok := h.tables[c.roomCode]
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
func (h *Hub) seatClient(t *table, c *Client, id int) {
	if c.roomCode != "" && c.roomCode != t.code {
		if old := h.tables[c.roomCode]; old != nil {
			for i, m := range old.members {
				if m == c {
					old.members[i] = nil
				}
			}
		}
	}
	t.seat(c, id)
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
