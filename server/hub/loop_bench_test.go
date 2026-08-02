// What one pass of the event loop actually costs.
//
// Every table on this process is served by one goroutine, so the question
// "should a table own its own goroutine" is not an architectural preference,
// it is a measurement: how long does the loop hold the lock on everybody else
// while it handles one message, and how many tables does it take before that
// wait is something a player can feel in a reaction window.
//
// These benchmarks are the number behind that decision. They are internal
// (package hub) because they call dispatch directly: going through a socket
// would measure the kernel, not the loop.
//
// Run: go test ./hub/ -run '^$' -bench 'Loop|Broadcast|Dispatch' -benchmem
package hub

import (
	"fmt"
	"io"
	"log"
	"os"
	"testing"
	"time"

	"loco/server/game"
	"loco/server/protocol"
)

// benchTable builds a table of n seated humans with a match already dealt, and
// returns it ready for dispatch. Nothing here goes through a socket: the
// clients are real *Client values whose send buffers are drained by a goroutine
// standing in for writePump.
func benchTable(b *testing.B, n int) (*Hub, *table, []*Client) {
	b.Helper()

	// The loop's own logging is real work, but it is Docker's json-file driver
	// on the other end in production and a test's stderr here. Measuring the
	// handler, not the terminal.
	prevOut := log.Writer()
	log.SetOutput(io.Discard)

	// scheduleTurnTimer arms a fresh AfterFunc on every play and never stops the
	// previous one (turnTimeoutTarget's stale check is what retires it). At
	// benchmark rates a 30 s timeout would hold millions of live timers, so the
	// clock is shortened and the channel drained by a goroutine standing in for
	// the event loop, which is not running here. That goroutine is deliberately
	// never stopped: a timer armed in the last iteration fires after the
	// benchmark has finished, and a drainer that had already gone would turn
	// that into a log line in the middle of the results.
	prevTimeout := TurnTimeout
	TurnTimeout = 100 * time.Millisecond

	h := New()
	h.turnTimeout = make(chan turnTimerMsg, 1<<15)
	go func() {
		for range h.turnTimeout { //nolint:revive // stands in for the event loop
		}
	}()
	code := "BENCH1"
	room := game.NewRoom(code)
	room.MaxPlayers = n
	for i := 0; i < n; i++ {
		if err := room.Join(fmt.Sprintf("player%d", i)); err != nil {
			b.Fatalf("join %d: %v", i, err)
		}
	}
	t := newTable(code, room)
	h.tables[code] = t

	clients := make([]*Client, n)
	for i := range clients {
		c := newClient(h, nil)
		// The production buffer is 256 and overflowing it force-closes the
		// socket, which here is nil. A benchmark produces messages far faster
		// than any real player consumes them, so the drainer below is given
		// enough slack that the slow-client path is never the thing measured.
		c.send = make(chan []byte, 1<<16)
		clients[i] = c
		h.clients[c] = struct{}{}
		t.seat(c, i)
		go func(ch <-chan []byte) {
			for range ch { //nolint:revive // draining stands in for writePump
			}
		}(c.send)
	}
	if err := room.Start(); err != nil {
		b.Fatalf("start: %v", err)
	}

	b.Cleanup(func() {
		for _, c := range clients {
			c.close()
		}
		TurnTimeout = prevTimeout
		log.SetOutput(prevOut)
	})
	return h, t, clients
}

// wildPlay is a card that is legal on any board, so an iteration never has to
// re-deal to find a move. It is also the cheap case on purpose: Swap and
// GlobalSwitch rearrange every hand and are measured separately by
// BenchmarkBroadcastPersonalizedGameState.
func wildPlay(color protocol.CardColor) protocol.ClientMsg {
	return protocol.ClientMsg{
		Type:        protocol.CMsgPlayCard,
		Card:        &protocol.CardDTO{Color: protocol.ColorWild, Kind: protocol.KindWild},
		ChosenColor: color,
	}
}

// BenchmarkDispatchPlayCard is the headline number: one whole pass of the event
// loop for the hottest message in the game, from the recover and the gate at
// the top of dispatch through the domain call, the marshal and the fan-out.
func BenchmarkDispatchPlayCard(b *testing.B) {
	for _, n := range []int{2, 4, 10} {
		b.Run(fmt.Sprintf("players=%d", n), func(b *testing.B) {
			h, t, clients := benchTable(b, n)
			state := t.room.State
			msg := wildPlay(protocol.ColorRed)
			b.ReportAllocs()
			for b.Loop() {
				b.StopTimer()
				seat := state.CurrentTurn
				// Keep the hand at its dealt size: one card in, one card out, so
				// nothing ever falls to one card (a catch window) or to none (a
				// round end), and the measurement stays the same play every time.
				state.Hands[seat].Add(game.Card{Kind: game.WildCard, Color: game.Wild})
				state.PendingDraw = 0
				c := clients[seat]
				b.StartTimer()

				h.dispatch(c, msg)
			}
		})
	}
}

// BenchmarkBroadcastPersonalizedGameState is the most expensive thing the loop
// ever does on a gameplay message: after a Swap or a GlobalSwitch every hand
// has changed, so each seat is sent a board only it may see and nothing can be
// marshalled once and shared.
func BenchmarkBroadcastPersonalizedGameState(b *testing.B) {
	for _, n := range []int{2, 4, 10} {
		b.Run(fmt.Sprintf("players=%d", n), func(b *testing.B) {
			h, t, _ := benchTable(b, n)
			b.ReportAllocs()
			for b.Loop() {
				h.broadcastPersonalizedGameState(t)
			}
		})
	}
}

// BenchmarkBroadcastCardPlayed isolates the ordinary fan-out: one marshal, one
// player list, the catch seats, and N buffered writes. RoundEnded takes the
// turn timer out of it through the function's own first branch, so what is left
// is the send and nothing else; the timer is measured in place by
// BenchmarkDispatchPlayCard.
func BenchmarkBroadcastCardPlayed(b *testing.B) {
	for _, n := range []int{2, 4, 10} {
		b.Run(fmt.Sprintf("players=%d", n), func(b *testing.B) {
			h, t, _ := benchTable(b, n)
			t.room.RoundEnded = true
			b.ReportAllocs()
			for b.Loop() {
				h.broadcastCardPlayed(t, 0, -1)
			}
		})
	}
}

// BenchmarkLogLine is the only synchronous I/O left on the event loop.
//
// Everything else the loop does is arithmetic on small slices and writes into
// buffered channels, so a log line is the one call in a handler that reaches a
// file descriptor and can therefore be made to wait by something outside this
// process. It is measured against the real stderr, not io.Discard, because
// that is the whole point of the number.
func BenchmarkLogLine(b *testing.B) {
	prevOut := log.Writer()
	log.SetOutput(os.Stderr)
	b.Cleanup(func() { log.SetOutput(prevOut) })
	b.ReportAllocs()
	for b.Loop() {
		log.Printf("bench room created code=%s host=%s", "BENCH1", "player0")
	}
}

// BenchmarkPlayerGameState is one recipient's snapshot on its own, which is
// what a reconnect and every state resync costs.
func BenchmarkPlayerGameState(b *testing.B) {
	h, t, _ := benchTable(b, 10)
	pl := h.playerList(t)
	b.ReportAllocs()
	for b.Loop() {
		_ = h.playerGameStateUsing(t, 0, pl)
	}
}
