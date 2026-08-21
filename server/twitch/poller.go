package twitch

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync/atomic"
	"time"

	"loco/server/janus"
	"loco/server/protocol"
)

var (
	errTooBig     = errors.New("preview over the size limit")
	errNotAnImage = errors.New("preview is not an image")
)

// Poller asks the gateway who is live, on a timer, and keeps the answer.
//
// It is the only thing in this process that talks to anybody outside it, and
// it never touches the event loop: what it produces reaches the hub through
// the publish callback Run is handed, which posts to the router like every
// other job crossing that boundary.
type Poller struct {
	cfg   Config
	janus *janus.Client
	// blocked is the wordlist predicate, injected rather than imported so this
	// package stays independent of the domain and a test can screen nothing.
	blocked func(string) bool

	snap   atomic.Pointer[snapshot]
	gameID string

	// lastSig is what was last published, so a poll that changed nothing
	// publishes nothing: the hub would otherwise bump its version and send the
	// same list to every seatless socket once a minute, for ever.
	lastSig string

	// pauseUntil honours a 429's Retry-After by skipping ticks. It is the only
	// pacing this package does; retries, backoff and the circuit breaker are
	// the gateway's, and JANUS.md says not to build a second set.
	pauseUntil time.Time

	// tickC lets a test drive the clock. Nil in production, where Run makes
	// its own ticker.
	tickC <-chan time.Time

	polls        atomic.Int64
	pollErrors   atomic.Int64
	rowsScreened atomic.Int64
	thumbErrors  atomic.Int64
	streamsLive  atomic.Int64
}

// NewPoller builds the poller, or reports that this feature is switched off.
//
// screen is the wordlist predicate (game.ContainsBlockedTerm in production).
// The caller wires it, so this package depends on no other.
func NewPoller(getenv func(string) string, screen func(string) bool) (*Poller, bool) {
	cfg, ok := configFromEnv(getenv)
	if !ok {
		return nil, false
	}
	return &Poller{cfg: cfg, janus: janus.New(cfg.Janus), blocked: screen}, true
}

// Run polls until the context is cancelled.
//
// The game id is resolved once, here, before the first poll: an unresolvable
// category switches the whole thing off rather than falling through to a query
// that would ask Helix about every live channel on Twitch.
func (p *Poller) Run(ctx context.Context, publish func([]protocol.LiveStreamDTO)) {
	gameID, err := p.resolveGameID(ctx)
	if err != nil {
		log.Printf("WARN twitch live is off: %v", err)
		return
	}
	p.gameID = gameID

	// The one line written when it switches on. Nothing is logged when it is
	// off: a line at every startup about a feature nobody configured is noise.
	log.Printf("twitch live on game_id=%s poll=%s previews=%t", gameID, p.cfg.Poll, p.cfg.CDNSlug != "")

	ticks := p.tickC
	if ticks == nil {
		t := time.NewTicker(p.cfg.Poll)
		defer t.Stop()
		ticks = t.C
	}

	p.tick(ctx, publish)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticks:
			p.tick(ctx, publish)
		}
	}
}

func (p *Poller) tick(ctx context.Context, publish func([]protocol.LiveStreamDTO)) {
	if time.Now().Before(p.pauseUntil) {
		return
	}
	p.polls.Add(1)

	raw, cache, err := p.fetchStreams(ctx, p.gameID)
	if err != nil {
		p.pollErrors.Add(1)
		if d := janus.RetryAfter(err); d > 0 {
			p.pauseUntil = time.Now().Add(d)
			log.Printf("WARN twitch live paused for %s: %v", d, err)
		} else {
			log.Printf("WARN twitch live poll failed: %v", err)
		}
		p.expire(publish)
		return
	}

	rows, dropped := p.screen(raw)
	if dropped > 0 {
		p.rowsScreened.Add(int64(dropped))
	}

	prev := p.current()
	rows, thumbs := p.withThumbs(ctx, rows, raw, prev)

	next := &snapshot{streams: rows, thumbs: thumbs, at: time.Now()}
	next.jsonBody = encodeLive(rows, next.at)
	p.snap.Store(next)
	p.streamsLive.Store(int64(len(rows)))

	if cache == "HIT" {
		// Worth knowing rather than guessing: on a HIT the freshness of this
		// list is the gateway's, not our poll period.
		log.Printf("twitch live cache=HIT streams=%d", len(rows))
	}

	if sig := signature(rows); sig != p.lastSig {
		p.lastSig = sig
		publish(rows)
	}
}

// expire is what a failing poll does about the list already on screen.
//
// Nothing, until the last good answer is older than LiveMaxAge — and then it
// publishes an empty one. A stale list is wrong in the only direction that
// costs anything: somebody clicks and lands on a channel that is off air.
func (p *Poller) expire(publish func([]protocol.LiveStreamDTO)) {
	snap := p.current()
	if snap == nil || time.Since(snap.at) < LiveMaxAge {
		return
	}
	empty := &snapshot{streams: nil, thumbs: nil, at: snap.at}
	empty.jsonBody = encodeLive(nil, snap.at)
	p.snap.Store(empty)
	p.streamsLive.Store(0)
	if p.lastSig != "" {
		p.lastSig = ""
		publish(nil)
	}
}

// current is nil-safe: /live.json is registered whether or not this feature is
// switched on, so that a server with no gateway key answers "nobody is live"
// rather than "no such resource". The page reads the two the same way, but the
// nginx configuration and the dev proxy are then identical everywhere, and an
// operator checking the endpoint is told which of the two they are looking at.
func (p *Poller) current() *snapshot {
	if p == nil {
		return nil
	}
	return p.snap.Load()
}

// Streams is what the page and the socket are both drawn from, capped by the
// caller: the wire wants fewer than the page does.
func (p *Poller) Streams(max int) []protocol.LiveStreamDTO {
	snap := p.current()
	if snap == nil {
		return nil
	}
	if max > 0 && len(snap.streams) > max {
		return snap.streams[:max]
	}
	return snap.streams
}

func (p *Poller) liveJSON() []byte {
	if snap := p.current(); snap != nil {
		return snap.jsonBody
	}
	return encodeLive(nil, time.Time{})
}

// Stats is what /metrics reads. Read from HTTP goroutines while the poller
// writes, hence the atomics.
type Stats struct {
	Polls        int64
	Errors       int64
	RowsScreened int64
	ThumbErrors  int64
	StreamsLive  int64
}

func (p *Poller) Stats() Stats {
	if p == nil {
		return Stats{}
	}
	return Stats{
		Polls:        p.polls.Load(),
		Errors:       p.pollErrors.Load(),
		RowsScreened: p.rowsScreened.Load(),
		ThumbErrors:  p.thumbErrors.Load(),
		StreamsLive:  p.streamsLive.Load(),
	}
}

func encodeLive(rows []protocol.LiveStreamDTO, at time.Time) []byte {
	if rows == nil {
		rows = []protocol.LiveStreamDTO{}
	}
	var updated int64
	if !at.IsZero() {
		updated = at.Unix()
	}
	body, err := json.Marshal(struct {
		Streams []protocol.LiveStreamDTO `json:"streams"`
		Updated int64                    `json:"updated"`
	}{rows, updated})
	if err != nil {
		return []byte(`{"streams":[],"updated":0}`)
	}
	return body
}

// signature is what "nothing changed" means here: the same channels, in the
// same order, with the same viewer counts and the same pictures.
func signature(rows []protocol.LiveStreamDTO) string {
	if len(rows) == 0 {
		return ""
	}
	var b strings.Builder
	for _, r := range rows {
		fmt.Fprintf(&b, "%s|%d|%s;", r.Login, r.Viewers, r.Thumb)
	}
	return b.String()
}
