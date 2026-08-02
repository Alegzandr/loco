// The counters, and the numbers that say how close this process is to the load
// it can carry. A table owns its own goroutine (actor.go), so what they measure
// is the work rather than any one loop; see the fields for which is which.
package hub

import (
	"sync/atomic"
	"time"
)

// hubMetrics is every counter the Hub keeps. They live together rather than as
// seventeen fields on the Hub because they are one thing (what an operator
// reads) with one rule (safe from any goroutine), and because a struct with a
// hundred fields hides which of them are state and which are observations.
//
// Every field is atomic: /health and /metrics are served from HTTP goroutines
// while the event loop is writing.
type hubMetrics struct {
	rooms                atomic.Int32
	clients              atomic.Int32
	matchesStarted       atomic.Int32
	matchesFinished      atomic.Int32
	botsActive           atomic.Int32
	messagesRateLimited  atomic.Int64 // inbound messages dropped for exceeding the per-client token bucket
	messagesDroppedBusy  atomic.Int64 // inbound messages dropped because a queue was full: the hub's, or the table the message was for
	slowClientsClosed    atomic.Int64 // clients force-closed because their send buffer overflowed
	channelRetries       atomic.Int64 // botMove/expire/cleanup channel-pressure retries
	suspectedCheats      atomic.Int64 // gameplay validation rejections that look like exploit attempts
	reconnectExpirations atomic.Int64 // reconnect windows that expired without the player coming back
	matchmakingQueue     atomic.Int32 // players currently waiting for a 1v1 opponent (operator-only)
	matchesMatchmade     atomic.Int32 // matches created by pairing two queued players
	matchesInFlight      atomic.Int32 // matches a shutdown would interrupt; only maintained while draining
	handlerPanics        atomic.Int64 // handler panics the event loop recovered from; any value above 0 is a bug
	connsRefused         atomic.Int64 // upgrades refused by the global or per-network connection ceiling
	joinsThrottled       atomic.Int64 // join_room refused for burning through a network's wrong-code budget

	// Saturation. A table owns its own goroutine now (actor.go), so these
	// describe the work rather than the hub: loopSlowestUs is the longest a
	// single message has taken **anywhere** on this process, and loopQueuePeak
	// is the deepest any one table's box has been seen. That is where a backlog
	// shows now, and the hub's own queue depth is reported beside them as
	// loop_queue_depth. messages_dropped_busy is what the ceiling looks like
	// once it has already been hit, which is too late to be a warning; these are
	// the approach to it.
	//
	// Both marks are high-water rather than averages on purpose: a mean hides
	// exactly the event that matters, the one slow pass that let a queue build.
	// They are never reset, so they describe the worst this process has seen
	// since it started.
	loopQueuePeak  atomic.Int32
	loopSlowestUs  atomic.Int64
	loopEventCount atomic.Int64
}

// noteEvent records one job: how deep that table's box was when the job was
// taken, and how long it took. Called from a table's goroutine, of which there
// are many, so every field it touches is atomic for that reason as well as
// because /metrics reads them.
func (m *hubMetrics) noteEvent(queued int, took time.Duration) {
	m.loopEventCount.Add(1)
	raise32(&m.loopQueuePeak, int32(queued))
	raise64(&m.loopSlowestUs, took.Microseconds())
}

// raise32 lifts a high-water mark to v if v is higher.
//
// Load-then-store was enough while one goroutine wrote these. It is not any
// more: two tables reading the same old maximum and both storing loses the
// higher of the two, and the one that gets lost is the slow pass somebody is
// looking for. Not a data race, which is why nothing would have reported it.
func raise32(mark *atomic.Int32, v int32) {
	for {
		old := mark.Load()
		if v <= old || mark.CompareAndSwap(old, v) {
			return
		}
	}
}

func raise64(mark *atomic.Int64, v int64) {
	for {
		old := mark.Load()
		if v <= old || mark.CompareAndSwap(old, v) {
			return
		}
	}
}
