// The counters, and the three numbers that say whether one event loop is still
// enough for what this process is being asked to do.
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
	messagesDroppedBusy  atomic.Int64 // inbound messages dropped because h.inbound was full
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

	// Loop saturation. Every room on this server is served by one goroutine, so
	// the ceiling on how many tables it can carry is not MaxRooms, it is how
	// long one pass through dispatch takes and how deep the queue gets behind
	// it. messages_dropped_busy is what that ceiling looks like once it has
	// already been hit, which is too late to be a warning; these two are the
	// approach to it.
	//
	// Both are high-water marks rather than averages on purpose: a mean hides
	// exactly the event that matters, the one slow pass that let the queue
	// build. They are never reset, so they describe the worst this process has
	// seen since it started.
	loopQueuePeak  atomic.Int32
	loopSlowestUs  atomic.Int64
	loopEventCount atomic.Int64
}

// noteEvent records one pass of the event loop: how deep the inbound queue was
// when the event was taken, and how long handling it took. Called from the loop
// goroutine only, but the fields are atomic because /metrics reads them.
func (m *hubMetrics) noteEvent(queued int, took time.Duration) {
	m.loopEventCount.Add(1)
	if d := int32(queued); d > m.loopQueuePeak.Load() {
		m.loopQueuePeak.Store(d)
	}
	if us := took.Microseconds(); us > m.loopSlowestUs.Load() {
		m.loopSlowestUs.Store(us)
	}
}
