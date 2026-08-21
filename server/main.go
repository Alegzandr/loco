package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"loco/server/game"
	"loco/server/hub"
	"loco/server/twitch"
)

// defaultDrainTimeout is how long a shutdown waits for the matches in flight to
// finish before it stops waiting and writes a snapshot instead. Overridden by
// LOCO_DRAIN_TIMEOUT (a Go duration, e.g. "90s" or "15m").
//
// The value is a deploy policy, not a game rule, and it is deliberately short:
// a deploy must never wait on the tables that happen to be up. It was 15m in
// production so a best-of-7 could finish, which made the length of a pipeline
// a function of how long strangers played. A hand near its end still finishes
// inside 90s; past that the snapshot below is what carries the match across
// the restart, which is the whole reason it exists. See deploy/app.env.
const defaultDrainTimeout = 90 * time.Second

// shutdownGrace is how long the HTTP server is given to close its connections
// once there is nothing left to protect. Short on purpose: by this point every
// match has either ended or been written to the snapshot.
const shutdownGrace = 5 * time.Second

func main() {
	// First, before anything has a line to write. From here on log.Printf hands
	// its line to a goroutine instead of writing it: a log line was the most
	// expensive call in any handler and the only one a process on the other end
	// of the pipe could make wait, which meant a slow log consumer stalled the
	// event loop and therefore every table on the server. See hub/logsink.go.
	logSink := hub.NewAsyncLog(os.Stderr, hub.LogQueueDepth)
	log.SetOutput(logSink)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	// Before the hub starts, so no bot is ever scheduled on the shipped timing
	// and then rescheduled on the overridden one.
	hub.ApplyBotTimingEnv()

	h := hub.New()
	h.SetLogSink(logSink)
	go h.Run()

	// Before the listener is up, so no socket can arrive into a half-restored
	// room. An empty LOCO_SNAPSHOT_PATH disables the whole mechanism, which is
	// what local dev and the E2E suite run with.
	snapshotPath := os.Getenv("LOCO_SNAPSHOT_PATH")
	if err := h.LoadSnapshot(snapshotPath); err != nil {
		log.Printf("WARN snapshot restore failed, starting empty err=%v", err)
	}

	// The one thing in this process that talks to anybody outside it, and it
	// never touches the event loop: what it produces reaches the hub through
	// PublishLive, which posts to the router like every other job crossing
	// that boundary. Off, silently, wherever no gateway key is set — which is
	// local dev and the E2E suite. See docs/notes/live.md and JANUS.md.
	liveCtx, stopLive := context.WithCancel(context.Background())
	defer stopLive()
	// Nil unless the feature is on, and every method it is asked for below is
	// safe on a nil receiver: /live.json answers an empty list either way, so
	// the nginx block, the dev proxy and what an operator curls are the same in
	// every environment.
	var poller *twitch.Poller
	if p, on := twitch.NewPoller(os.Getenv, game.ContainsBlockedTerm); on {
		poller = p
		h.SetLiveStatsFunc(func() hub.LiveStats {
			s := p.Stats()
			return hub.LiveStats{
				Polls:        s.Polls,
				Errors:       s.Errors,
				RowsScreened: s.RowsScreened,
				ThumbErrors:  s.ThumbErrors,
				StreamsLive:  s.StreamsLive,
			}
		})
		// Previews only exist when there is a poller behind them, so this one is
		// registered here. It answers from the snapshot on an ordinary net/http
		// goroutine, exactly like /health and /metrics: the event loop is never
		// touched and no page load ever waits on the gateway.
		http.HandleFunc(twitch.ThumbPrefix, p.ServeThumb)
		go p.Run(liveCtx, h.PublishLive)
	}
	http.HandleFunc("/live.json", poller.ServeJSON)

	http.HandleFunc("/ws", h.ServeWS)
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		stats := h.GetStats()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(stats)
	})
	http.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
		m := h.GetMetrics()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(m)
	})

	srv := &http.Server{
		Addr: ":" + port,
		// ReadHeaderTimeout guards against Slowloris attacks and stale HTTP connections.
		// WebSocket connections are hijacked before this applies to the WS body.
		ReadHeaderTimeout: 10 * time.Second,
		// IdleTimeout reclaims keep-alive HTTP connections that are no longer active.
		IdleTimeout: 60 * time.Second,
	}
	if os.Getenv("LOCO_E2E") == "1" {
		log.Printf("WARN debug mode enabled (LOCO_E2E=1) — debug_set_state is unauthenticated; do NOT use in production")
	}

	// SIGTERM is what `docker compose up -d` sends the container it is
	// replacing. Before this existed it killed the process where it stood:
	// every match in flight died mid-turn, and the clients that came back two
	// hundred milliseconds later were told "room not found", which reads to a
	// player like they mistyped their own table code.
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, os.Interrupt)
	defer stop()

	// Closed once the shutdown has run to the end. ListenAndServe returns the
	// moment srv.Shutdown is *called*, not when it is finished, so main used to
	// be free to return — and take the process with it — while the drain, the
	// snapshot and h.Stop were still going. It was survivable while all three
	// were fast and in memory; it stops being survivable the moment the last
	// thing a shutdown does is flush a log queue.
	shutdownDone := make(chan struct{})
	go func() {
		defer close(shutdownDone)
		<-ctx.Done()
		// Restores the default handlers: a second signal from here on kills the
		// process the old way, which is the escape hatch an operator needs if a
		// drain is taking longer than they are willing to give it.
		stop()
		// Before the drain: a request to the gateway still in flight while the
		// tables are being let finish has no reason to exist, and the poller
		// has nothing to hand over.
		stopLive()
		shutdown(srv, h, snapshotPath)
	}()

	log.Printf("loco server listening on :%s", port)
	err := srv.ListenAndServe()
	if err != nil && !errors.Is(err, http.ErrServerClosed) {
		// Not log.Fatal: os.Exit would leave this line sitting in the sink's
		// queue, and the line saying why the server never came up is the one
		// line an operator cannot do without.
		log.Printf("FATAL listen failed err=%v", err)
		_ = logSink.Close()
		os.Exit(1)
	}
	<-shutdownDone
	_ = logSink.Close()
}

// shutdown drains, then snapshots whatever the drain did not finish, then
// closes.
//
// The two halves are complementary rather than alternative: the drain is what
// gets the number of interrupted matches to zero in the ordinary case, and the
// snapshot is what makes the case where it runs out of time survivable instead
// of fatal. Neither is enough on its own, so both run every time.
//
// None of this is worth anything without `stop_grace_period` on the compose
// service: Docker's default is to wait 10s after SIGTERM and then SIGKILL, and
// a SIGKILL lands in the middle of all of it. See deploy/compose.yml.
func shutdown(srv *http.Server, h *hub.Hub, snapshotPath string) {
	timeout := drainTimeout()
	log.Printf("shutdown signal received, draining timeout=%s", timeout)

	h.BeginDrain()
	select {
	case <-h.DrainDone():
		log.Printf("drain finished, no match was interrupted")
	case <-time.After(timeout):
		log.Printf("WARN drain timed out after %s with %d match(es) still in flight",
			timeout, h.GetMetrics().MatchesInFlight)
	}

	if err := h.SaveSnapshot(snapshotPath); err != nil {
		log.Printf("WARN snapshot write failed, matches in flight will be lost err=%v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), shutdownGrace)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("WARN http shutdown err=%v", err)
	}
	h.Stop()
}

// drainTimeout reads LOCO_DRAIN_TIMEOUT. A malformed or absent value leaves the
// shipped default rather than falling back to zero: a typo must not silently
// turn a graceful deploy back into the abrupt one this exists to replace.
func drainTimeout() time.Duration {
	return parseDrainTimeout(os.Getenv("LOCO_DRAIN_TIMEOUT"))
}

func parseDrainTimeout(raw string) time.Duration {
	if raw == "" {
		return defaultDrainTimeout
	}
	if d, err := time.ParseDuration(raw); err == nil && d > 0 {
		return d
	}
	// Bare seconds are what an env file tends to grow, so they are accepted
	// rather than rejected on a technicality.
	if secs, err := strconv.Atoi(raw); err == nil && secs > 0 {
		return time.Duration(secs) * time.Second
	}
	log.Printf("WARN LOCO_DRAIN_TIMEOUT=%q is not a duration, using %s", raw, defaultDrainTimeout)
	return defaultDrainTimeout
}
