package hub

import (
	"bytes"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"
)

// recordingWriter collects whole writes, safely, so a test can assert on what
// actually reached the far side of the sink.
type recordingWriter struct {
	mu      sync.Mutex
	written []string

	// entered is signalled once per Write, before blocking on gate. A nil gate
	// never blocks. Together they let a test hold the writer goroutine inside
	// the sink at a known point instead of guessing with a sleep.
	entered chan struct{}
	gate    chan struct{}
}

func (w *recordingWriter) Write(p []byte) (int, error) {
	if w.entered != nil {
		select {
		case w.entered <- struct{}{}:
		default:
		}
	}
	if w.gate != nil {
		<-w.gate
	}
	w.mu.Lock()
	w.written = append(w.written, string(p))
	w.mu.Unlock()
	return len(p), nil
}

func (w *recordingWriter) lines() []string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return append([]string(nil), w.written...)
}

func (w *recordingWriter) joined() string { return strings.Join(w.lines(), "") }

// TestAsyncLog_WriteDoesNotWaitOnTheSink is the whole point of this type.
//
// A log line was the most expensive call in any handler (7 µs against a pipe,
// nine times an entire card play) and the only one something outside the
// process could make wait: a slow log consumer stalled the event loop, which
// is every table at once. Write must hand the line off and return, whatever
// the far side is doing.
func TestAsyncLog_WriteDoesNotWaitOnTheSink(t *testing.T) {
	gate := make(chan struct{})
	sink := &recordingWriter{gate: gate}
	a := NewAsyncLog(sink, 64)

	start := time.Now()
	for i := 0; i < 32; i++ {
		if _, err := a.Write([]byte("line\n")); err != nil {
			t.Fatalf("write %d: %v", i, err)
		}
	}
	took := time.Since(start)
	close(gate)
	_ = a.Close()

	if took > 50*time.Millisecond {
		t.Fatalf("32 writes took %v against a sink that was not moving; they must not wait on it", took)
	}
}

func TestAsyncLog_DeliversEveryLineInOrder(t *testing.T) {
	sink := &recordingWriter{}
	a := NewAsyncLog(sink, 64)
	for _, s := range []string{"one\n", "two\n", "three\n"} {
		if _, err := a.Write([]byte(s)); err != nil {
			t.Fatalf("write %q: %v", s, err)
		}
	}
	if err := a.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
	if got, want := sink.joined(), "one\ntwo\nthree\n"; got != want {
		t.Fatalf("sink got %q, want %q", got, want)
	}
}

// TestAsyncLog_CopiesTheCallersBuffer pins the detail that would corrupt every
// line in the log without any test failing anywhere else: log.Logger formats
// into a buffer it owns and reuses on the next call, so a queue holding the
// caller's slice hands the writer goroutine whatever the *next* line happened
// to overwrite it with.
func TestAsyncLog_CopiesTheCallersBuffer(t *testing.T) {
	entered := make(chan struct{}, 1)
	gate := make(chan struct{})
	sink := &recordingWriter{entered: entered, gate: gate}
	a := NewAsyncLog(sink, 8)

	// The writer goroutine is parked inside the sink for the whole of what
	// follows, so both lines are provably still in the queue when the buffer is
	// overwritten. Without that, a sink quick enough to drain the first line
	// before the mutation would let a missing copy pass.
	if _, err := a.Write([]byte("hold\n")); err != nil {
		t.Fatalf("write: %v", err)
	}
	<-entered

	buf := []byte("first\n")
	if _, err := a.Write(buf); err != nil {
		t.Fatalf("write: %v", err)
	}
	copy(buf, "secnd") // same length, exactly what log.Logger does to its own buffer
	if _, err := a.Write(buf); err != nil {
		t.Fatalf("write: %v", err)
	}

	close(gate)
	if err := a.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	if got, want := sink.joined(), "hold\nfirst\nsecnd\n"; got != want {
		t.Fatalf("sink got %q, want %q", got, want)
	}
}

// TestAsyncLog_DropsRatherThanBlocks holds the writer goroutine inside the sink
// so the queue is provably full, then checks that the overflow is counted and
// the caller still returns.
func TestAsyncLog_DropsRatherThanBlocks(t *testing.T) {
	entered := make(chan struct{}, 1)
	gate := make(chan struct{})
	sink := &recordingWriter{entered: entered, gate: gate}
	a := NewAsyncLog(sink, 1)

	if _, err := a.Write([]byte("held\n")); err != nil {
		t.Fatalf("write: %v", err)
	}
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		t.Fatal("the writer goroutine never reached the sink")
	}

	// One slot free, so the next line queues and the three after it are lost.
	for i := 0; i < 4; i++ {
		if _, err := a.Write([]byte("flood\n")); err != nil {
			t.Fatalf("write %d: %v", i, err)
		}
	}
	if got := a.Dropped(); got != 3 {
		t.Fatalf("dropped %d lines, want 3", got)
	}

	close(gate)
	if err := a.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
}

// TestAsyncLog_SaysWhatItDropped: a gap nobody is told about is worse than a
// slow log. An operator reading around an incident has to be able to see that
// lines are missing, and how many.
func TestAsyncLog_SaysWhatItDropped(t *testing.T) {
	entered := make(chan struct{}, 1)
	gate := make(chan struct{})
	sink := &recordingWriter{entered: entered, gate: gate}
	a := NewAsyncLog(sink, 1)

	if _, err := a.Write([]byte("held\n")); err != nil {
		t.Fatalf("write: %v", err)
	}
	<-entered
	for i := 0; i < 4; i++ {
		if _, err := a.Write([]byte("flood\n")); err != nil {
			t.Fatalf("write %d: %v", i, err)
		}
	}
	close(gate)
	if err := a.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	out := sink.joined()
	if !strings.Contains(out, "3 line(s) dropped") {
		t.Fatalf("the log never admits the gap:\n%s", out)
	}
}

func TestAsyncLog_CloseFlushesWhatIsQueued(t *testing.T) {
	sink := &recordingWriter{}
	a := NewAsyncLog(sink, 64)
	for i := 0; i < 20; i++ {
		if _, err := a.Write([]byte("x\n")); err != nil {
			t.Fatalf("write %d: %v", i, err)
		}
	}
	if err := a.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
	if got := len(sink.lines()); got != 20 {
		t.Fatalf("sink got %d lines, want 20: Close must not lose what was queued", got)
	}
}

// TestAsyncLog_CloseIsIdempotent: shutdown runs on a signal, and a second
// signal is the escape hatch an operator is told to use. Closing twice must not
// take the process down with a panic on a closed channel.
func TestAsyncLog_CloseIsIdempotent(t *testing.T) {
	sink := &recordingWriter{}
	a := NewAsyncLog(sink, 8)
	if err := a.Close(); err != nil {
		t.Fatalf("first close: %v", err)
	}
	if err := a.Close(); err != nil {
		t.Fatalf("second close: %v", err)
	}
}

// TestAsyncLog_WriteAfterCloseIsHarmless: a goroutine that has not noticed the
// shutdown yet still logs its own exit. readPump does exactly this.
func TestAsyncLog_WriteAfterCloseIsHarmless(t *testing.T) {
	sink := &recordingWriter{}
	a := NewAsyncLog(sink, 8)
	if err := a.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
	if _, err := a.Write([]byte("late\n")); err != nil {
		t.Fatalf("write after close: %v", err)
	}
}

// TestAsyncLog_CloseGivesUpOnAWedgedSink: the whole reason this type exists is
// that the far side can stop moving, so the flush cannot be the thing that
// keeps a container alive past its stop_grace_period.
func TestAsyncLog_CloseGivesUpOnAWedgedSink(t *testing.T) {
	prev := logCloseGrace
	logCloseGrace = 50 * time.Millisecond
	t.Cleanup(func() { logCloseGrace = prev })

	gate := make(chan struct{})
	defer close(gate)
	sink := &recordingWriter{gate: gate}
	a := NewAsyncLog(sink, 8)
	if _, err := a.Write([]byte("stuck\n")); err != nil {
		t.Fatalf("write: %v", err)
	}

	start := time.Now()
	err := a.Close()
	took := time.Since(start)
	if !errors.Is(err, ErrLogNotFlushed) {
		t.Fatalf("close on a wedged sink returned %v, want ErrLogNotFlushed", err)
	}
	if took > time.Second {
		t.Fatalf("close waited %v on a sink that never moves", took)
	}
}

// TestHub_ReportsLogDropsOnMetrics: messages_dropped_busy has an operator
// counterpart for every other thing this server throws away, and a log that
// silently shortens itself under load is exactly the condition somebody reading
// /metrics during an incident needs to know about.
func TestHub_ReportsLogDropsOnMetrics(t *testing.T) {
	h := New()
	if got := h.GetMetrics().LogLinesDropped; got != 0 {
		t.Fatalf("a hub with no sink reports %d drops, want 0", got)
	}

	gate := make(chan struct{})
	sink := &recordingWriter{entered: make(chan struct{}, 1), gate: gate}
	a := NewAsyncLog(sink, 1)
	h.SetLogSink(a)

	_, _ = a.Write([]byte("held\n"))
	<-sink.entered
	for i := 0; i < 4; i++ {
		_, _ = a.Write([]byte("flood\n"))
	}
	close(gate)
	_ = a.Close()

	if got := h.GetMetrics().LogLinesDropped; got != 3 {
		t.Fatalf("/metrics reports %d dropped log lines, want 3", got)
	}
}

// TestAsyncLog_SurvivesConcurrentWriters is the -race case: the event loop and
// every connection pump log at the same time.
func TestAsyncLog_SurvivesConcurrentWriters(t *testing.T) {
	sink := &recordingWriter{}
	a := NewAsyncLog(sink, 1024)

	var wg sync.WaitGroup
	for w := 0; w < 8; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < 50; i++ {
				_, _ = a.Write([]byte("concurrent\n"))
			}
		}()
	}
	wg.Wait()
	if err := a.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	got := int64(len(sink.lines())) + a.Dropped()
	// The dropped-lines notice is a line of its own, so allow for it.
	if got < 400 {
		t.Fatalf("%d lines written plus %d dropped, want at least 400 accounted for", len(sink.lines()), a.Dropped())
	}
	if bytes.Contains([]byte(sink.joined()), []byte("concurrentconcurrent")) {
		t.Fatal("two lines were spliced together: a write must reach the sink whole")
	}
}
