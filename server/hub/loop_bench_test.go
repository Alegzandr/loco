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
	// clock is shortened and the table's box drained by a goroutine standing in
	// for its own, which is deliberately not started here: the benchmark runs
	// the handlers itself, on its own goroutine, so that what is timed is one
	// pass and not a channel round trip. The drainer only reads the channel and
	// never touches the table. It is never stopped either, because a timer armed
	// in the last iteration fires after the benchmark has finished and a drainer
	// that had already gone would put a log line in the middle of the results.
	prevTimeout := TurnTimeout
	TurnTimeout = 100 * time.Millisecond

	h := New()
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
	go func() {
		for range t.box { //nolint:revive // stands in for the table's own goroutine
		}
	}()

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

// BenchmarkDispatchPlayCard is the headline number: one whole pass of a table's
// goroutine for the hottest message in the game, from the gate at the top of
// dispatchAtTable through the domain call, the marshal and the fan-out.
//
// It calls dispatchAtTable rather than dispatch on purpose. What the hub does
// with a gameplay message is look the table up and hand it over, and timing a
// channel send would say more about the runtime's scheduler than about the
// game; everything that costs anything happens on the far side of that hop.
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

				h.dispatchAtTable(t, c, msg)
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

// BenchmarkLogLineSync is what a log line used to cost the event loop: a write
// straight to the process's stderr, which in a container is a pipe with the
// Docker daemon on the other end. It is measured against the real stderr, not
// io.Discard, because the far side is the whole point of the number, and the
// number moves with it: about 0.9 µs when that reader keeps up, 7 µs when it
// does not, unbounded once the pipe buffer fills and the write starts waiting.
//
// Everything else the loop does is arithmetic on small slices and sends into
// buffered channels, so this was the one call in a handler that reached a file
// descriptor and could therefore be made to wait by something outside this
// process. Run it both ways to see it:
//
//	go test ./hub/ -run '^$' -bench LogLine 2>/dev/null      # a fast reader
//	go test ./hub/ -run '^$' -bench LogLine                  # whatever is attached
func BenchmarkLogLineSync(b *testing.B) {
	prevOut := log.Writer()
	log.SetOutput(os.Stderr)
	b.Cleanup(func() { log.SetOutput(prevOut) })
	b.ReportAllocs()
	for b.Loop() {
		log.Printf("bench room created code=%s host=%s", "BENCH1", "player0")
	}
}

// BenchmarkLogLineAsync is the same line through the sink main installs. The
// gap between the two is the reason logsink.go exists, and running them side by
// side is what keeps that claim honest as the code changes.
func BenchmarkLogLineAsync(b *testing.B) {
	sink := NewAsyncLog(os.Stderr, LogQueueDepth)
	prevOut := log.Writer()
	log.SetOutput(sink)
	b.Cleanup(func() {
		log.SetOutput(prevOut)
		_ = sink.Close()
	})
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
