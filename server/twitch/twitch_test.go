package twitch

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"loco/server/janus"
	"loco/server/protocol"
)

// ── a gateway to talk to ────────────────────────────────────────────────────

type fakeGateway struct {
	srv      *httptest.Server
	games    string // body for /games
	streams  string // body for /streams
	thumb    []byte // body for any CDN path
	status   int    // upstream status for /streams, 0 = 200
	retryAft string
	calls    map[string]int
}

func newGateway(t *testing.T) *fakeGateway {
	t.Helper()
	g := &fakeGateway{calls: map[string]int{}}
	g.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		g.calls[p]++
		switch {
		case strings.HasSuffix(p, "/games"):
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(g.games))
		case strings.HasSuffix(p, "/streams"):
			w.Header().Set("Content-Type", "application/json")
			if g.retryAft != "" {
				w.Header().Set("Retry-After", g.retryAft)
			}
			if g.status != 0 {
				w.WriteHeader(g.status)
				return
			}
			_, _ = w.Write([]byte(g.streams))
		default: // the CDN
			w.Header().Set("Content-Type", "text/plain") // deliberately wrong: ours is written from the bytes
			_, _ = w.Write(g.thumb)
		}
	}))
	t.Cleanup(g.srv.Close)
	return g
}

func (g *fakeGateway) env(extra map[string]string) func(string) string {
	base := map[string]string{
		"JANUS_URL":            g.srv.URL,
		"JANUS_APPLICATION_ID": "app-1",
		"JANUS_API_KEY":        "jns_test",
		"LOCO_TWITCH_GAME_ID":  "1372128809",
	}
	for k, v := range extra {
		base[k] = v
	}
	return func(k string) string { return base[k] }
}

// screenFuck stands in for game.ContainsBlockedTerm without importing the
// domain: this package must stay independent of it.
func screenFuck(s string) bool { return strings.Contains(strings.ToLower(s), "fuck") }

func newTestPoller(t *testing.T, g *fakeGateway, extra map[string]string) *Poller {
	t.Helper()
	p, ok := NewPoller(g.env(extra), screenFuck)
	if !ok {
		t.Fatal("NewPoller reported the feature off with a full environment")
	}
	p.gameID = "1372128809"
	return p
}

func streamsJSON(rows ...string) string {
	return `{"data":[` + strings.Join(rows, ",") + `],"pagination":{}}`
}

func row(login, name string, viewers int) string {
	b, _ := json.Marshal(map[string]any{
		"user_login":    login,
		"user_name":     name,
		"viewer_count":  viewers,
		"language":      "fr",
		"thumbnail_url": "https://" + thumbHost + "/previews-ttv/live_user_" + login + "-{width}x{height}.jpg",
	})
	return string(b)
}

var jpeg = append([]byte{0xFF, 0xD8, 0xFF}, make([]byte, 64)...)

// ── configuration ───────────────────────────────────────────────────────────

func TestConfigFromEnv(t *testing.T) {
	t.Run("no gateway key is off, and off is the default", func(t *testing.T) {
		if _, ok := configFromEnv(func(string) string { return "" }); ok {
			t.Fatal("the feature switched itself on with no key")
		}
	})

	t.Run("a key with no URL is a typo, not an intention", func(t *testing.T) {
		env := map[string]string{"JANUS_API_KEY": "jns_x"}
		if _, ok := configFromEnv(func(k string) string { return env[k] }); ok {
			t.Fatal("ran with a key but no gateway URL")
		}
	})

	t.Run("defaults", func(t *testing.T) {
		env := map[string]string{"JANUS_API_KEY": "k", "JANUS_URL": "u", "JANUS_APPLICATION_ID": "a"}
		cfg, ok := configFromEnv(func(k string) string { return env[k] })
		if !ok {
			t.Fatal("a full environment did not switch it on")
		}
		if cfg.HelixSlug != defaultHelixSlug || cfg.GameName != defaultGameName {
			t.Errorf("slug/name = %q/%q", cfg.HelixSlug, cfg.GameName)
		}
		// Previews are off until the CDN is registered in Janus, and that is a
		// state this ships in rather than an error.
		if cfg.CDNSlug != "" {
			t.Errorf("CDN slug = %q, want empty by default", cfg.CDNSlug)
		}
		if cfg.Poll != LivePollPeriod {
			t.Errorf("poll = %s", cfg.Poll)
		}
	})

	t.Run("a malformed poll period keeps the shipped one", func(t *testing.T) {
		env := map[string]string{
			"JANUS_API_KEY": "k", "JANUS_URL": "u", "JANUS_APPLICATION_ID": "a",
			"LOCO_TWITCH_POLL": "soon",
		}
		cfg, _ := configFromEnv(func(k string) string { return env[k] })
		if cfg.Poll != LivePollPeriod {
			t.Fatalf("poll = %s, want the shipped %s rather than zero", cfg.Poll, LivePollPeriod)
		}
	})
}

// The failure mode that matters most in this whole package: /streams with no
// game_id is a request for every live channel on Twitch. An unresolvable
// category switches the feature off; it never widens the query.
func TestNoGameIDSwitchesItOffRatherThanWideningTheQuery(t *testing.T) {
	g := newGateway(t)
	g.games = `{"data":[]}`
	p, _ := NewPoller(g.env(map[string]string{"LOCO_TWITCH_GAME_ID": ""}), screenFuck)

	if _, err := p.resolveGameID(context.Background()); err == nil {
		t.Fatal("an empty lookup resolved to something")
	}

	// And the guard below it, in case a caller ever skips the resolution.
	if _, _, err := p.fetchStreams(context.Background(), ""); err == nil {
		t.Fatal("polled with no game id")
	}
	if n := g.calls["/gateway/twitch-helix/streams"]; n != 0 {
		t.Fatalf("the streams endpoint was called %d times with no game id", n)
	}
}

// ── screening ───────────────────────────────────────────────────────────────

func TestScreenDropsWhatAPlayerMustNotBeShown(t *testing.T) {
	g := newGateway(t)
	p := newTestPoller(t, g, map[string]string{"LOCO_TWITCH_BLOCKLIST": "quietone, OtherOne"})

	in := []helixStream{
		{UserLogin: "kisuke_", UserName: "Kisuke", ViewerCount: 1200},
		{UserLogin: "bad/login", UserName: "Sneaky", ViewerCount: 900},
		{UserLogin: "fuckery", UserName: "Fuckery", ViewerCount: 800},
		{UserLogin: "unofan", UserName: "UNO fan", ViewerCount: 700},
		{UserLogin: "quietone", UserName: "Quiet One", ViewerCount: 600},
		{UserLogin: "otherone", UserName: "Other One", ViewerCount: 500},
		{UserLogin: "normal2", UserName: "Norm‮l", ViewerCount: 400},
	}
	out, dropped := p.screen(in)

	if len(out) != 2 {
		t.Fatalf("kept %d rows, want 2: %+v", len(out), out)
	}
	if out[0].Login != "kisuke_" || out[1].Login != "normal2" {
		t.Errorf("kept the wrong rows: %+v", out)
	}
	if dropped != 5 {
		t.Errorf("dropped = %d, want 5", dropped)
	}
	// A bidi override flips the text around it on the home screen. It is taken
	// out of the name, not made a reason to drop the channel.
	if strings.ContainsRune(out[1].Name, 0x202E) {
		t.Errorf("a bidi override survived into %q", out[1].Name)
	}
	// Order is Helix's, biggest first, and nothing here re-sorts it.
	if out[0].Viewers < out[1].Viewers {
		t.Errorf("the order was changed: %+v", out)
	}
}

func TestScreenKeepsAtMostAPageful(t *testing.T) {
	g := newGateway(t)
	p := newTestPoller(t, g, nil)
	in := make([]helixStream, LivePageMax+5)
	for i := range in {
		in[i] = helixStream{UserLogin: "chan" + string(rune('a'+i)), UserName: "C", ViewerCount: 100 - i}
	}
	if out, _ := p.screen(in); len(out) != LivePageMax {
		t.Fatalf("kept %d rows, want %d", len(out), LivePageMax)
	}
}

// The mark is matched as a word of its own, the same rule nickname.go applies
// to any short term. A channel called Unolingo keeps its name.
func TestMentionsUNO(t *testing.T) {
	for _, s := range []string{"uno", "UNO fan", "team-uno", "uno_king", "play UNO now"} {
		if !mentionsUNO(s) {
			t.Errorf("mentionsUNO(%q) = false", s)
		}
	}
	for _, s := range []string{"unolingo", "unopar", "kisuke", "junot", ""} {
		if mentionsUNO(s) {
			t.Errorf("mentionsUNO(%q) = true", s)
		}
	}
}

// ── polling ─────────────────────────────────────────────────────────────────

func TestPollPublishesOnceAndThenOnlyOnChange(t *testing.T) {
	g := newGateway(t)
	g.streams = streamsJSON(row("kisuke_", "Kisuke", 1200))
	p := newTestPoller(t, g, nil)

	var published [][]protocol.LiveStreamDTO
	publish := func(rows []protocol.LiveStreamDTO) { published = append(published, rows) }

	p.tick(context.Background(), publish)
	p.tick(context.Background(), publish)
	if len(published) != 1 {
		t.Fatalf("published %d times for an unchanged list, want 1", len(published))
	}

	g.streams = streamsJSON(row("kisuke_", "Kisuke", 1300))
	p.tick(context.Background(), publish)
	if len(published) != 2 {
		t.Fatalf("a changed viewer count published %d times, want 2", len(published))
	}
}

// An outage is an error, and an error leaves the list alone — until it is old
// enough to be wrong, and then it is emptied rather than kept.
func TestAFailingPollKeepsTheListUntilItIsTooOldToBeTrue(t *testing.T) {
	g := newGateway(t)
	g.streams = streamsJSON(row("kisuke_", "Kisuke", 1200))
	p := newTestPoller(t, g, nil)

	var published [][]protocol.LiveStreamDTO
	publish := func(rows []protocol.LiveStreamDTO) { published = append(published, rows) }
	p.tick(context.Background(), publish)

	g.status = http.StatusBadGateway
	p.tick(context.Background(), publish)
	if len(published) != 1 {
		t.Fatalf("a failed poll published something: %v", published)
	}
	if len(p.Streams(0)) != 1 {
		t.Fatal("a failed poll dropped a list that was still fresh")
	}

	// Age the snapshot past the point where it is still true.
	snap := p.current()
	aged := &snapshot{streams: snap.streams, thumbs: snap.thumbs, at: time.Now().Add(-LiveMaxAge - time.Minute)}
	aged.jsonBody = snap.jsonBody
	p.snap.Store(aged)

	p.tick(context.Background(), publish)
	if len(published) != 2 || len(published[1]) != 0 {
		t.Fatalf("a stale list was not emptied: %v", published)
	}
	if len(p.Streams(0)) != 0 {
		t.Fatal("Streams still answers with the stale list")
	}
}

// The only pacing this package does. Retries and backoff belong to the
// gateway, per JANUS.md.
func TestA429PausesTheNextTicksInstead(t *testing.T) {
	g := newGateway(t)
	g.status = http.StatusTooManyRequests
	g.retryAft = "60"
	p := newTestPoller(t, g, nil)

	p.tick(context.Background(), func([]protocol.LiveStreamDTO) {})
	before := g.calls["/gateway/twitch-helix/streams"]
	p.tick(context.Background(), func([]protocol.LiveStreamDTO) {})
	if after := g.calls["/gateway/twitch-helix/streams"]; after != before {
		t.Fatalf("the tick after a 429 called anyway (%d then %d)", before, after)
	}
}

func TestRunResolvesOnceThenStopsWithTheContext(t *testing.T) {
	g := newGateway(t)
	g.games = `{"data":[{"id":"42"}]}`
	g.streams = streamsJSON()
	p, _ := NewPoller(g.env(map[string]string{"LOCO_TWITCH_GAME_ID": ""}), screenFuck)

	ticks := make(chan time.Time)
	p.tickC = ticks

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { p.Run(ctx, func([]protocol.LiveStreamDTO) {}); close(done) }()

	ticks <- time.Now()
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Run did not return when its context was cancelled")
	}
	if g.calls["/gateway/twitch-helix/games"] != 1 {
		t.Fatalf("the game id was resolved %d times, want once", g.calls["/gateway/twitch-helix/games"])
	}
}

// ── previews ────────────────────────────────────────────────────────────────

// The host is checked rather than followed: a response naming somewhere else
// yields a row with no picture, not a fetch of whatever it pointed at.
func TestThumbPathRefusesAnyOtherHost(t *testing.T) {
	ok := "https://" + thumbHost + "/previews-ttv/live_user_x-{width}x{height}.jpg"
	if p, good := thumbPath(ok); !good || !strings.Contains(p, "440x248") {
		t.Fatalf("thumbPath(%q) = %q,%v", ok, p, good)
	}
	for _, bad := range []string{
		"https://evil.example/previews-ttv/x.jpg",
		"http://" + thumbHost + "/x.jpg",
		"not a url at all",
	} {
		if _, good := thumbPath(bad); good {
			t.Errorf("thumbPath(%q) was accepted", bad)
		}
	}
}

func TestPreviewsAreFetchedScreenedAndServedFromMemory(t *testing.T) {
	g := newGateway(t)
	g.streams = streamsJSON(row("kisuke_", "Kisuke", 1200))
	g.thumb = jpeg
	p := newTestPoller(t, g, map[string]string{"LOCO_TWITCH_CDN_SLUG": "twitch-cdn"})
	p.tick(context.Background(), func([]protocol.LiveStreamDTO) {})

	rows := p.Streams(0)
	if len(rows) != 1 || !strings.HasPrefix(rows[0].Thumb, ThumbPrefix) {
		t.Fatalf("row = %+v, want a path on this origin", rows)
	}

	rec := httptest.NewRecorder()
	p.ServeThumb(rec, httptest.NewRequest(http.MethodGet, rows[0].Thumb, nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	// Ours, from the magic bytes. The gateway said text/plain.
	if ct := rec.Header().Get("Content-Type"); ct != "image/jpeg" {
		t.Errorf("Content-Type = %q, want image/jpeg written by us", ct)
	}
	etag := rec.Header().Get("ETag")
	if etag == "" {
		t.Fatal("no ETag")
	}

	req := httptest.NewRequest(http.MethodGet, rows[0].Thumb, nil)
	req.Header.Set("If-None-Match", etag)
	rec2 := httptest.NewRecorder()
	p.ServeThumb(rec2, req)
	if rec2.Code != http.StatusNotModified {
		t.Errorf("a matching ETag got %d, want 304", rec2.Code)
	}
}

func TestServeThumbAnswers404ToAnythingNotInTheSnapshot(t *testing.T) {
	g := newGateway(t)
	g.streams = streamsJSON(row("kisuke_", "Kisuke", 1200))
	g.thumb = jpeg
	p := newTestPoller(t, g, map[string]string{"LOCO_TWITCH_CDN_SLUG": "twitch-cdn"})
	p.tick(context.Background(), func([]protocol.LiveStreamDTO) {})

	for _, path := range []string{ThumbPrefix + "deadbeefdeadbeef", ThumbPrefix, ThumbPrefix + "a/b"} {
		rec := httptest.NewRecorder()
		p.ServeThumb(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != http.StatusNotFound {
			t.Errorf("%s: status = %d, want 404", path, rec.Code)
		}
	}
}

func TestAPreviewThatIsTooBigOrNotAnImageLeavesTheRowWithoutOne(t *testing.T) {
	t.Run("too big", func(t *testing.T) {
		g := newGateway(t)
		g.streams = streamsJSON(row("kisuke_", "Kisuke", 1200))
		g.thumb = append(jpeg, make([]byte, maxThumbBytes)...)
		p := newTestPoller(t, g, map[string]string{"LOCO_TWITCH_CDN_SLUG": "twitch-cdn"})
		p.tick(context.Background(), func([]protocol.LiveStreamDTO) {})
		rows := p.Streams(0)
		if len(rows) != 1 || rows[0].Thumb != "" {
			t.Fatalf("row = %+v, want the row kept with no picture", rows)
		}
	})

	t.Run("not an image", func(t *testing.T) {
		g := newGateway(t)
		g.streams = streamsJSON(row("kisuke_", "Kisuke", 1200))
		g.thumb = []byte("<html>nope</html>")
		p := newTestPoller(t, g, map[string]string{"LOCO_TWITCH_CDN_SLUG": "twitch-cdn"})
		p.tick(context.Background(), func([]protocol.LiveStreamDTO) {})
		rows := p.Streams(0)
		if len(rows) != 1 || rows[0].Thumb != "" {
			t.Fatalf("row = %+v, want the row kept with no picture", rows)
		}
	})
}

// Without a registered CDN the rows are listed without pictures, and nothing
// about that path is a special case anywhere else.
func TestNoCDNSlugMeansRowsWithoutPictures(t *testing.T) {
	g := newGateway(t)
	g.streams = streamsJSON(row("kisuke_", "Kisuke", 1200))
	p := newTestPoller(t, g, nil)
	p.tick(context.Background(), func([]protocol.LiveStreamDTO) {})

	rows := p.Streams(0)
	if len(rows) != 1 || rows[0].Thumb != "" {
		t.Fatalf("row = %+v", rows)
	}
	for path, n := range g.calls {
		if strings.Contains(path, "previews") && n > 0 {
			t.Errorf("fetched a preview with no CDN slug configured: %s", path)
		}
	}
}

// ── the page's surface ──────────────────────────────────────────────────────

func TestServeJSONAnswersBeforeTheFirstPoll(t *testing.T) {
	g := newGateway(t)
	p := newTestPoller(t, g, nil)
	rec := httptest.NewRecorder()
	p.ServeJSON(rec, httptest.NewRequest(http.MethodGet, "/live.json", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	var payload struct {
		Streams []protocol.LiveStreamDTO `json:"streams"`
		Updated int64                    `json:"updated"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("body %q: %v", rec.Body.String(), err)
	}
	if payload.Streams == nil {
		t.Error("streams came back null; the page reads a list, and an empty one is a list")
	}
}

func TestStreamsCapsForTheWire(t *testing.T) {
	g := newGateway(t)
	rows := make([]string, 0, 8)
	for i := 0; i < 8; i++ {
		rows = append(rows, row("chan"+string(rune('a'+i)), "C", 100-i))
	}
	g.streams = streamsJSON(rows...)
	p := newTestPoller(t, g, nil)
	p.tick(context.Background(), func([]protocol.LiveStreamDTO) {})

	if n := len(p.Streams(6)); n != 6 {
		t.Fatalf("Streams(6) returned %d", n)
	}
	if n := len(p.Streams(0)); n != 8 {
		t.Fatalf("Streams(0) returned %d, want everything", n)
	}
}

// A server with no gateway key registers /live.json all the same, so that it
// answers "nobody is live" rather than "no such resource": the nginx block, the
// dev proxy and what an operator curls are then the same everywhere. Every
// method reached on that path has to survive a nil receiver.
func TestANilPollerStillAnswers(t *testing.T) {
	var p *Poller

	if got := p.Stats(); got != (Stats{}) {
		t.Fatalf("Stats() = %+v", got)
	}
	if rows := p.Streams(0); len(rows) != 0 {
		t.Fatalf("Streams() = %+v", rows)
	}

	rec := httptest.NewRecorder()
	p.ServeJSON(rec, httptest.NewRequest(http.MethodGet, "/live.json", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if body := strings.TrimSpace(rec.Body.String()); !strings.Contains(body, `"streams":[]`) {
		t.Fatalf("body = %s, want an empty list rather than an error", body)
	}

	rec = httptest.NewRecorder()
	p.ServeThumb(rec, httptest.NewRequest(http.MethodGet, ThumbPrefix+"abc", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("thumb status = %d, want 404", rec.Code)
	}
}

var _ = janus.IdentityApp // the identity this package always sends
