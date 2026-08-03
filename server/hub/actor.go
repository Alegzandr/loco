// One table, one goroutine, and the two ways work crosses between them.
//
// Every room used to be served by the hub's single event loop. What that cost
// is measured in hub/loop_bench_test.go and it was never throughput: at 8.6 µs
// for a whole card play the loop absorbs more than the rate limiter admits. What
// it cost was independence. One table's slowest message was every other table's
// wait, one handler's panic was recovered on a goroutine every match shared, and
// nothing could be said about a table without saying it about all of them.
//
// So a table owns its own goroutine now, and the hub owns what is genuinely
// between tables: the map of them, the matchmaking queue, the connected sockets,
// the wrong-code budgets and the drain. Nothing else is shared, and the two
// directions are deliberately the same shape:
//
//   - t.post(job)          run this on that table
//   - h.postToRouter(fn)   run this on the hub
//
// **Both are non-blocking, and that is not an optimisation.** A blocking send in
// either direction deadlocks the moment the other end is trying to send back,
// which is a state two busy tables can reach on their own. What cannot be
// delivered is dropped and counted, and the two cases where a drop would leak
// (a room nobody deletes, a seat nobody frees) retry exactly as the channel
// pressure they replaced did.
package hub

import (
	"log"
	"runtime/debug"
	"time"

	"loco/server/game"
)

// tableBoxDepth is how many jobs may wait for one table.
//
// The hub's single inbound queue was 256 for the whole server. Per table that
// would be absurd, and the number means something different now: it is how far
// one table may fall behind before its own players are told to retry, and it no
// longer says anything about anybody else's table.
const tableBoxDepth = 64

// routerBoxDepth is the hub's own queue for work handed back by a table.
// Generous, because overflowing it is the one thing here that can lose a room:
// the retry below is what makes that survivable, not this number.
const routerBoxDepth = 1024

// tableJob is one unit of work for a table's goroutine.
type tableJob struct {
	// what names the job in the line a recovered panic writes. A message type
	// for anything a player sent, the timer's own name otherwise.
	what string
	// c is the socket the job came from, and nil for a timer. It is who the
	// refusal goes to when the job panics.
	c   *Client
	run func()
}

// start gives this table its goroutine. Called once, by whoever put the table
// in h.tables, and **after** the table is fully built: matchmaking sets
// matchmadeAt and the snapshot restore fills half the struct, and neither may
// be racing a goroutine that is already reading it.
func (t *table) start(h *Hub) {
	// Published before the goroutine exists, so a table restored from a
	// snapshot mid-match counts against the drain from its first instant
	// rather than from its first message.
	t.publishPhase()
	t.started.Store(true)
	go t.run(h)
}

func (t *table) run(h *Hub) {
	defer close(t.done)
	for {
		select {
		case job := <-t.box:
			// Timed here, because here is where the work is. loop_slowest_us
			// used to mean "the longest one message took" because one goroutine
			// did all of it; leaving it on the hub would have quietly turned it
			// into "the longest a map lookup took", which is a number nobody
			// can act on. See metrics.go.
			queued := len(t.box)
			start := time.Now()
			h.runJob(t, job)
			h.metrics.noteEvent(queued, time.Since(start))
			// After every job, not hooked onto the handful that can end a
			// match: a match stops being in flight through several paths and
			// the one that gets forgotten is the one that leaves a deploy
			// hanging. See drain.go, which reads this and never the table.
			t.publishPhase()
		case <-t.quit:
			return
		}
	}
}

// runJob is the floor under every handler, and it is the same floor dispatch
// used to be: a panic costs one message and one WARN.
//
// It matters more here, not less. A panic on the old single loop took every
// match on the process with it, which is why the recover was put there; a panic
// on a table's own goroutine would take only that table, but it would take it
// **silently and permanently** — the goroutine would be gone and every message
// to that room would queue behind nothing forever.
func (h *Hub) runJob(t *table, job tableJob) {
	defer func() {
		r := recover()
		if r == nil {
			return
		}
		h.metrics.handlerPanics.Add(1)
		conn, player := "", -1
		if job.c != nil {
			conn, player = job.c.connID, job.c.playerID()
		}
		log.Printf("WARN handler panic recovered job=%s conn=%s code=%s player=%d panic=%v\n%s",
			job.what, conn, t.code, player, r, debug.Stack())
		if job.c != nil {
			job.c.sendError("server error")
		}
	}()
	job.run()
}

// post hands a job to this table and reports whether it was taken. It never
// waits: see the file comment.
func (t *table) post(job tableJob) bool {
	select {
	case t.box <- job:
		return true
	default:
		return false
	}
}

// postFromTimer is post for a deferred callback, which has nobody to tell.
//
// A dropped timer is not the same kind of loss as a dropped message: nobody is
// waiting for an answer, so it fails quietly, and the ones that would leak
// something retry through postCritical instead.
func (t *table) postFromTimer(what string, run func()) {
	if !t.post(tableJob{what: what, run: run}) {
		log.Printf("table box full, dropping %s code=%s", what, t.code)
	}
}

// postCritical is postFromTimer for the two timers whose loss leaks: a
// reconnect window that never closes holds a seat for a player who is not
// coming back, and a cleanup that never fires leaves an empty room in memory
// until the process restarts. Retried once, on the same delays the hub's own
// channel pressure used.
func (h *Hub) postCritical(t *table, what string, retry time.Duration, run func()) {
	if t.post(tableJob{what: what, run: run}) {
		return
	}
	h.metrics.channelRetries.Add(1)
	log.Printf("table box full, retrying %s in %s code=%s", what, retry, t.code)
	time.AfterFunc(retry, func() {
		if !t.post(tableJob{what: what, run: run}) {
			log.Printf("WARN %s retry dropped code=%s", what, t.code)
		}
	})
}

// postToRouter asks the hub to run something on its own loop. It is how a table
// reaches the things no table owns: the map of tables, the matchmaking queue,
// the connected sockets.
//
// Retried rather than dropped, because the two callers that matter are deleting
// a room and putting a player back in the queue, and losing either is a leak
// somebody notices much later.
func (h *Hub) postToRouter(what string, fn func()) {
	select {
	case h.routerBox <- fn:
		return
	default:
	}
	h.metrics.channelRetries.Add(1)
	log.Printf("router box full, retrying %s in 1s", what)
	time.AfterFunc(time.Second, func() {
		select {
		case h.routerBox <- fn:
		default:
			log.Printf("WARN router job dropped what=%s", what)
		}
	})
}

// stop ends this table's goroutine and waits for it. Only the hub calls it, and
// only from deleteRoom: a table stops existing and stops running at the same
// moment, which is what keeps "is this table alive" a single question.
//
// Jobs still in the box are abandoned on purpose. They are all addressed to a
// room that no longer exists, and running them would broadcast to seats that
// have already been told the room is gone.
func (t *table) stop() {
	t.stopOnce.Do(func() { close(t.quit) })
	if !t.started.Load() {
		// A table that was built but never started has no goroutine to wait
		// for. Only a white-box test reaches this, and waiting forever would be
		// a poor way for one to find out.
		return
	}
	<-t.done
}

// The two values table.phase can hold. A table is "in flight" when a shutdown
// would interrupt something: a match being played, or a matchmade pair whose
// reveal is running and whose deal is already scheduled. An ordinary lobby is
// not, because a drain refuses start_game, so it can never become one.
const (
	phaseIdle int32 = iota
	phaseInFlight
)

// publishPhase is how the hub asks "is a match running here" without reading a
// table it does not own. Written by the table's goroutine after every job it
// runs, read by the drain from the hub's.
func (t *table) publishPhase() {
	p := phaseIdle
	switch {
	case t.room.Status == game.StatusPlaying:
		p = phaseInFlight
	case t.room.Status == game.StatusLobby && t.isMatchmade():
		p = phaseInFlight
	}
	t.phase.Store(p)
}
