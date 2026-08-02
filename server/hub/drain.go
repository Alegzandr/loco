package hub

import (
	"log"

	"loco/server/game"
	"loco/server/protocol"
)

// Draining: what a deploy does to a server people are playing on.
//
// The old behaviour was that a deploy killed every match in flight. Nothing
// caught SIGTERM, so the process died mid-turn, and the clients that came back
// two hundred milliseconds later were told "room not found": the player lost
// the match and was shown a message that reads like they mistyped the code.
//
// A drain splits the shutdown in two. Nothing new starts, and everything
// already running is left completely alone: same turn clock, same reaction
// windows, same bots, same reconnects. When the last match ends, the process
// is free to go.
//
// **The drain has to terminate**, which is what decides the exact list below.
// A refusal is placed on every action that would add a match to the set being
// waited on: create_room, start_game, rematch, find_match, and a join_room
// aimed at a table this process does not have. Joining a lobby that already
// exists is not on the list, because a lobby cannot deal during a drain, so
// sitting down in one costs the deploy nothing. Were start_game allowed, two
// players could hold the deploy open indefinitely by rematching, and the
// timeout in main would be the only thing ending it, which is the outcome the
// drain exists to avoid.
//
// The snapshot in snapshot.go is what covers the matches still running when
// that timeout does fire. The two are meant to be read together: the drain
// gets the number of interrupted matches to zero in the ordinary case, and the
// snapshot makes the extraordinary case survivable rather than fatal.

// drainRefusal is the wire string every drained-away action answers with.
// The client maps it in i18n/serverErrors.ts; keep the two in step.
const drainRefusal = "server updating, try again in a moment"

// BeginDrain puts the hub into draining mode. Safe to call from any goroutine,
// and safe to call more than once.
//
// It goes through the event loop rather than flipping a flag directly, for the
// same reason every other cross-goroutine signal here does: the work it starts
// touches the queue and every room, and those belong to Run.
func (h *Hub) BeginDrain() {
	select {
	case h.drain <- struct{}{}:
	case <-h.quit:
	case <-h.drained:
	}
}

// DrainDone is closed once no match is in flight. Reading it before BeginDrain
// tells you nothing: it is only ever closed while draining.
func (h *Hub) DrainDone() <-chan struct{} {
	return h.drained
}

// Draining reports whether this process is on its way out. Safe from any
// goroutine; /health and /metrics read it.
func (h *Hub) Draining() bool {
	return h.draining.Load()
}

// beginDrain runs in the event loop.
func (h *Hub) beginDrain() {
	if h.draining.Load() {
		return
	}
	h.draining.Store(true)
	log.Printf("drain started rooms=%d clients=%d", h.metrics.rooms.Load(), h.metrics.clients.Load())

	// The queue goes first. Nobody in it is in a match, so there is nothing to
	// protect, and leaving them there would be the cruellest possible outcome:
	// waiting for an opponent that this process has already stopped pairing.
	// They are told why and taken back to the table screen, where the private
	// table their friend can join still works.
	queued := h.queue
	h.queue = nil
	h.metrics.matchmakingQueue.Store(0)
	for _, q := range queued {
		q.client.sendError(drainRefusal)
		q.client.Send(protocol.ServerMsg{Type: protocol.SMsgMatchmakingCancelled})
	}

	// Everyone at a table in progress is told once. Not a countdown and not a
	// warning: there is nothing for them to do, and the match they are in is
	// going to finish.
	for _, t := range h.tables {
		if t.room.Status != game.StatusPlaying {
			continue
		}
		h.broadcastToRoomAll(t, protocol.ServerMsg{Type: protocol.SMsgServerUpdating})
	}

	h.checkDrained()
}

// refuseWhileDraining answers an action that would extend the drain, and
// reports whether it did.
func (h *Hub) refuseWhileDraining(c *Client) bool {
	if !h.draining.Load() {
		return false
	}
	c.sendError(drainRefusal)
	return true
}

// checkDrained closes h.drained once nothing is in flight. Runs in the event
// loop after every event.
func (h *Hub) checkDrained() {
	inFlight := h.matchesInFlight()
	h.metrics.matchesInFlight.Store(int32(inFlight))
	if h.drainedClosed || inFlight > 0 {
		return
	}
	h.drainedClosed = true
	close(h.drained)
	log.Printf("drain complete, no match left in flight")
}

// matchesInFlight counts the matches a shutdown would interrupt.
//
// A matchmade room still on its versus reveal counts, even though it is
// formally a lobby: the pair has been made, the deal is already scheduled, and
// shutting down on top of it would break a match that had effectively started.
// An ordinary lobby does not count, because a drain refuses start_game, so it
// can never become one.
func (h *Hub) matchesInFlight() int {
	n := 0
	for _, t := range h.tables {
		switch {
		case t.room.Status == game.StatusPlaying:
			n++
		case t.room.Status == game.StatusLobby && t.isMatchmade():
			n++
		}
	}
	return n
}
