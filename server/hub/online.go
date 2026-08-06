// How many people are here, told to the ones who are not playing yet.
package hub

import (
	"time"

	"loco/server/protocol"
)

// PlayersOnlineBroadcastPeriod is how often the hub checks whether the number
// of connected sockets has moved. Nothing is sent to a socket already holding
// the current number, so this is the freshness of a sign of life rather than a
// rate: a home screen showing a count five seconds old costs nobody anything,
// and sending on every connect and disconnect would turn a page-refresh storm
// into O(n) sends per socket. Exported so tests can shorten it.
var PlayersOnlineBroadcastPeriod = 5 * time.Second

// playersOnline is what the count says: every socket this process is holding,
// seated or not. Sockets rather than seats on purpose — somebody reading the
// rules with the tab open is as much a sign that the lights are on as somebody
// mid-match, and a seat count would read as an attendance figure for tables
// this player cannot join.
func (h *Hub) playersOnline() int { return len(h.clients) }

// broadcastPlayersOnline tells the seatless sockets how many of us there are.
//
// Seatless only: the count is drawn on the home screen and nowhere else, so a
// table in progress has no use for it, and this is the one message on this
// server that would otherwise reach every socket at once on a timer.
//
// What each socket was last told is kept per socket rather than once for the
// hub, which is what makes a player coming back from a match — leaving a seat,
// or being kicked out of one — pick the number up on the next tick. A single
// hub-wide watermark would have skipped them until the count happened to move
// again, and "happened to move" on a quiet server is never.
//
// Runs on the event loop, which is what makes reading h.clients and writing
// c.onlineSent here safe.
func (h *Hub) broadcastPlayersOnline() {
	n := h.playersOnline()
	msg := protocol.ServerMsg{Type: protocol.SMsgPlayersOnline, PlayersOnline: intPtr(n)}
	for c := range h.clients {
		if c.roomCode() != "" || c.onlineSent == n {
			continue
		}
		c.onlineSent = n
		c.Send(msg)
	}
}

// sendPlayersOnline answers one socket, on arrival. Waiting for the next tick
// would leave the home screen without its count for up to a period on every
// first load, which is exactly the visit it exists for.
func (h *Hub) sendPlayersOnline(c *Client) {
	n := h.playersOnline()
	c.onlineSent = n
	c.Send(protocol.ServerMsg{Type: protocol.SMsgPlayersOnline, PlayersOnline: intPtr(n)})
}
