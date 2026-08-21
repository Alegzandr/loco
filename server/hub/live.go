// Who is streaming this game, told to the ones who are not playing yet.
package hub

import (
	"encoding/json"
	"log"

	"loco/server/protocol"
)

// LiveWireMax is what goes on the socket.
//
// The home screen draws three rows; six is two spare, so the strip does not go
// short when a row is dropped by the screen. The message reaches every seatless
// socket, which is the only reason it is not twelve — the content page reads
// the longer list over HTTP, where it costs one reader one response.
const LiveWireMax = 6

// PublishLive is the only point of contact between the outside world and this
// event loop.
//
// Non-blocking by construction (postToRouter), one retry, and nothing else
// crosses that boundary: the poller runs on its own goroutine, has already
// screened the rows and fetched the pictures, and hands over a finished list.
func (h *Hub) PublishLive(rows []protocol.LiveStreamDTO) {
	h.postToRouter("live_streams", func() { h.setLiveStreams(rows) })
}

// setLiveStreams runs on the event loop. It caps the list, marshals it once
// and hands it to every socket that has not been told this version.
func (h *Hub) setLiveStreams(rows []protocol.LiveStreamDTO) {
	if len(rows) > LiveWireMax {
		rows = rows[:LiveWireMax]
	}
	// Copied rather than kept: the slice belongs to the poller's snapshot, and
	// nothing on this loop may hold a reference into another goroutine's data.
	list := make([]protocol.LiveStreamDTO, len(rows))
	copy(list, rows)

	msg := protocol.ServerMsg{Type: protocol.SMsgLiveStreams, LiveStreams: &list}
	// Marshalled once, like every other broadcast on this server.
	body, err := json.Marshal(msg)
	if err != nil {
		log.Printf("WARN live_streams marshal failed err=%v", err)
		return
	}

	h.liveVersion++
	h.liveBytes = body
	h.metrics.liveStreams.Store(int64(len(list)))
	h.broadcastLiveStreams()
}

// broadcastLiveStreams is broadcastPlayersOnline with a different payload, and
// deliberately so.
//
// Seatless only: the list is drawn on the home screen and nowhere else, so a
// table in progress has no use for it. What each socket was last told is kept
// per socket rather than once for the hub, which is what makes a player coming
// back from a match pick the list up instead of waiting for it to change again.
//
// There is no ticker behind this one. Unlike players_online, nothing here moves
// on its own: the poller publishes when the answer changed, and a timer in the
// select would be a wake-up for nothing.
func (h *Hub) broadcastLiveStreams() {
	if h.liveBytes == nil {
		return
	}
	for c := range h.clients {
		if c.roomCode() != "" || c.liveSent == h.liveVersion {
			continue
		}
		c.liveSent = h.liveVersion
		c.SendBytes(h.liveBytes)
	}
}

// sendLiveStreams answers one socket, on arrival. Waiting for the next change
// would leave the home screen without its strip until somebody went live,
// which on a quiet evening is never.
func (h *Hub) sendLiveStreams(c *Client) {
	if h.liveBytes == nil {
		return
	}
	c.liveSent = h.liveVersion
	c.SendBytes(h.liveBytes)
}

// LiveStats is what /metrics reports about the poller.
//
// Declared here and filled by main so the hub keeps knowing nothing about the
// gateway or about Twitch: this package holds the numbers an operator reads,
// not the thing that produces them.
type LiveStats struct {
	Polls        int64 `json:"twitch_polls"`
	Errors       int64 `json:"twitch_poll_errors"`
	RowsScreened int64 `json:"live_rows_screened"`
	ThumbErrors  int64 `json:"twitch_thumb_errors"`
	StreamsLive  int64 `json:"twitch_streams_live"`
}

// SetLiveStatsFunc installs the reader /metrics calls. Call it once at startup.
// Nil, which is what a server with no gateway key leaves it as, reports zeroes.
func (h *Hub) SetLiveStatsFunc(fn func() LiveStats) { h.liveStatsFn.Store(&fn) }

func (h *Hub) liveStats() LiveStats {
	if fn := h.liveStatsFn.Load(); fn != nil && *fn != nil {
		return (*fn)()
	}
	return LiveStats{}
}
