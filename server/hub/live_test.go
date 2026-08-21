package hub_test

import (
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"loco/server/hub"
	"loco/server/protocol"
)

func liveRows(logins ...string) []protocol.LiveStreamDTO {
	out := make([]protocol.LiveStreamDTO, 0, len(logins))
	for i, l := range logins {
		out = append(out, protocol.LiveStreamDTO{Login: l, Name: l, Viewers: 100 - i})
	}
	return out
}

// readLive waits for the next live_streams and returns its rows. The second
// return says whether one arrived at all.
func readLive(t *testing.T, conn *websocket.Conn) ([]protocol.LiveStreamDTO, bool) {
	t.Helper()
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	defer func() { _ = conn.SetReadDeadline(time.Time{}) }()
	for i := 0; i < 20; i++ {
		var msg protocol.ServerMsg
		if err := conn.ReadJSON(&msg); err != nil {
			return nil, false
		}
		if msg.Type == protocol.SMsgLiveStreams {
			return msg.Live(), true
		}
	}
	return nil, false
}

// The strip is drawn on the home screen and nowhere else, so it goes to the
// sockets that are not sitting at a table — the same rule players_online
// follows, and the same reason.
func TestLiveStreams_ReachesASeatlessSocket(t *testing.T) {
	h, srv := newTestHub(t)
	conn := dialWS(t, srv)
	defer conn.Close()
	if n := readPlayersOnline(t, conn); n != 1 {
		t.Fatalf("players_online = %d", n)
	}

	h.PublishLive(liveRows("kisuke_", "someone"))

	rows, ok := readLive(t, conn)
	if !ok {
		t.Fatal("no live_streams arrived")
	}
	if len(rows) != 2 || rows[0].Login != "kisuke_" {
		t.Fatalf("rows = %+v", rows)
	}
}

// A publication that changes nothing sends nothing. Without the per-socket
// watermark, every poll would push the same list to every seatless socket for
// as long as the server is up.
func TestLiveStreams_SameVersionIsNotSentTwice(t *testing.T) {
	h, srv := newTestHub(t)
	conn := dialWS(t, srv)
	defer conn.Close()
	_ = readPlayersOnline(t, conn)

	h.PublishLive(liveRows("kisuke_"))
	if _, ok := readLive(t, conn); !ok {
		t.Fatal("the first publication never arrived")
	}

	// Nothing publishes again, so nothing should arrive. The read deadline in
	// readLive is what makes "nothing" observable.
	if rows, ok := readLive(t, conn); ok {
		t.Fatalf("a second copy arrived unasked: %+v", rows)
	}
}

// A socket that arrives after a publication is told on arrival, rather than
// waiting for somebody to go live or off air. On a quiet evening that wait is
// for ever, which is the same bug the per-socket watermark exists for.
func TestLiveStreams_SentOnConnect(t *testing.T) {
	h, srv := newTestHub(t)
	h.PublishLive(liveRows("kisuke_"))
	// The publication crosses to the loop through the router box, so give it
	// the moment that takes before opening a socket.
	time.Sleep(100 * time.Millisecond)

	conn := dialWS(t, srv)
	defer conn.Close()

	rows, ok := readLive(t, conn)
	if !ok {
		t.Fatal("a socket arriving after a publication was told nothing")
	}
	if len(rows) != 1 || rows[0].Login != "kisuke_" {
		t.Fatalf("rows = %+v", rows)
	}
}

// Six on the wire. The strip draws three; the rest is slack for the rows the
// screen drops, and it is capped because this message reaches every seatless
// socket at once.
func TestLiveStreams_CappedForTheWire(t *testing.T) {
	h, srv := newTestHub(t)
	conn := dialWS(t, srv)
	defer conn.Close()
	_ = readPlayersOnline(t, conn)

	many := make([]string, 0, hub.LiveWireMax+4)
	for i := 0; i < hub.LiveWireMax+4; i++ {
		many = append(many, "chan"+string(rune('a'+i)))
	}
	h.PublishLive(liveRows(many...))

	rows, ok := readLive(t, conn)
	if !ok {
		t.Fatal("no live_streams arrived")
	}
	if len(rows) != hub.LiveWireMax {
		t.Fatalf("wire carried %d rows, want %d", len(rows), hub.LiveWireMax)
	}
}

// An empty list is a real answer: it says nobody is live any more. It has to
// survive the wire, which is why the field is a pointer.
func TestLiveStreams_EmptyListIsTold(t *testing.T) {
	h, srv := newTestHub(t)
	conn := dialWS(t, srv)
	defer conn.Close()
	_ = readPlayersOnline(t, conn)

	h.PublishLive(liveRows("kisuke_"))
	if _, ok := readLive(t, conn); !ok {
		t.Fatal("the first publication never arrived")
	}

	h.PublishLive(nil)
	rows, ok := readLive(t, conn)
	if !ok {
		t.Fatal("emptying the list told nobody")
	}
	if len(rows) != 0 {
		t.Fatalf("rows = %+v, want none", rows)
	}
}

// PublishLive is called from a goroutine that must never wait on this loop.
// postToRouter is non-blocking by construction; this is the assertion that
// says so, because the failure is a poller wedged behind a busy server.
func TestPublishLive_NeverBlocks(t *testing.T) {
	h, _ := newTestHub(t)

	done := make(chan struct{})
	go func() {
		for i := 0; i < 2000; i++ {
			h.PublishLive(liveRows("kisuke_"))
		}
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("PublishLive blocked")
	}
}

// A server with no gateway key installs no stats reader, and /metrics still
// answers rather than panicking on a nil function.
func TestLiveStats_DefaultToZero(t *testing.T) {
	h, _ := newTestHub(t)
	if got := h.GetMetrics().Live; got != (hub.LiveStats{}) {
		t.Fatalf("live stats = %+v, want zeroes", got)
	}
}
