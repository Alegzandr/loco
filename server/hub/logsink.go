// The log, off the event loop.
//
// The number that matters here is not how slow a log line is, it is who decides.
// Measured by hub/loop_bench_test.go: one log.Printf costs 0.9 µs when the far
// side of stderr is keeping up and 7.3 µs when it is not, and it costs whatever
// the reader wants once the pipe's 64 KB have filled, because at that point the
// write simply waits. A whole card play at a four-player table costs 8.6 µs, so
// even the good case was a line as expensive as the game it described, and the
// bad case was a process nobody in this repo controls holding the event loop,
// which is every table on the server at once.
//
// Through this sink the same line is 0.15 µs and, far more to the point, a
// constant: nothing a handler does depends on the log's reader any more.
//
// Nothing at the call sites changes. log.Printf stays exactly where it is in
// all two hundred of them; main swaps the writer underneath, and the line is a
// channel send from then on.
package hub

import (
	"errors"
	"fmt"
	"io"
	"sync"
	"sync/atomic"
	"time"
)

// LogQueueDepth is how many formatted lines may be in flight before the sink
// starts dropping. Sized for the burst that follows a deploy, when every client
// reconnects at once and each one is a line: a few thousand is milliseconds of
// writing and half a megabyte of memory, and being generous here costs nothing
// next to what a dropped line costs an operator reading around an incident.
const LogQueueDepth = 4096

// logCloseGrace bounds the flush at shutdown. Var so tests can shorten it.
var logCloseGrace = 2 * time.Second

// ErrLogNotFlushed is what Close answers when the sink did not take everything
// queued inside logCloseGrace. It means lines were lost, not that anything else
// went wrong.
var ErrLogNotFlushed = errors.New("log sink did not flush before the deadline")

// AsyncLog is an io.Writer that copies a formatted line into a queue and
// returns. One goroutine takes lines off that queue and writes them for real.
//
// The queue is bounded and overflow is dropped rather than waited on, because
// waiting is the exact failure this type exists to remove. What is dropped is
// counted, reported on /metrics, and announced in the log itself: a gap nobody
// is told about is worse than a slow log.
type AsyncLog struct {
	out   io.Writer
	lines chan []byte
	quit  chan struct{}
	done  chan struct{}
	once  sync.Once

	dropped atomic.Int64
	// reported is how many drops the log has already been told about. Only the
	// writer goroutine touches it, so it needs no lock.
	reported int64
}

// NewAsyncLog starts a sink writing to out. Close it to flush.
func NewAsyncLog(out io.Writer, capacity int) *AsyncLog {
	if capacity < 1 {
		capacity = 1
	}
	a := &AsyncLog{
		out:   out,
		lines: make(chan []byte, capacity),
		quit:  make(chan struct{}),
		done:  make(chan struct{}),
	}
	go a.run()
	return a
}

// Write queues one formatted line. It never blocks and never fails: a logging
// call that can return an error is a logging call every site has to decide what
// to do about.
//
// The copy is not defensive tidiness. log.Logger formats into a buffer it owns
// and reuses on the very next call, so a queue holding the caller's slice hands
// the writer goroutine whatever the following line overwrote it with.
func (a *AsyncLog) Write(p []byte) (int, error) {
	line := make([]byte, len(p))
	copy(line, p)
	select {
	case a.lines <- line:
	default:
		a.dropped.Add(1)
	}
	return len(p), nil
}

// Dropped is how many lines the sink has thrown away since it started.
func (a *AsyncLog) Dropped() int64 { return a.dropped.Load() }

// Close stops the sink, flushes what is queued, and waits for the writer
// goroutine. Safe to call more than once: a shutdown runs on a signal and a
// second signal is the escape hatch an operator is told to use.
func (a *AsyncLog) Close() error {
	a.once.Do(func() { close(a.quit) })
	select {
	case <-a.done:
		return nil
	case <-time.After(logCloseGrace):
		return ErrLogNotFlushed
	}
}

func (a *AsyncLog) run() {
	defer close(a.done)
	for {
		select {
		case line := <-a.lines:
			a.emit(line)
		case <-a.quit:
			a.flush()
			return
		}
	}
}

// flush writes what is already queued and stops.
//
// It is bounded by the queue's own capacity rather than by the channel going
// empty. A goroutine that has not noticed the shutdown yet is still logging
// (readPump logs its own exit), so a flush that waited for silence would be
// waiting on the very thing the process is trying to stop.
func (a *AsyncLog) flush() {
	for i := 0; i <= cap(a.lines); i++ {
		select {
		case line := <-a.lines:
			a.emit(line)
		default:
			a.note()
			return
		}
	}
	a.note()
}

func (a *AsyncLog) emit(line []byte) {
	a.note()
	_, _ = a.out.Write(line)
}

// note admits the gap when lines have been lost since the last one.
//
// It goes to a.out directly instead of through the log package, which would put
// this line back in the queue that is full by definition at the moment it is
// needed. The timestamp is formatted like log.LstdFlags so the notice reads as
// part of the same stream.
func (a *AsyncLog) note() {
	d := a.dropped.Load()
	if d <= a.reported {
		return
	}
	n := d - a.reported
	a.reported = d
	_, _ = fmt.Fprintf(a.out, "%s WARN log sink overflowed, %d line(s) dropped\n",
		time.Now().Format("2006/01/02 15:04:05"), n)
}
