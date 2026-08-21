package twitch

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/url"
	"strings"
	"time"

	"loco/server/janus"
	"loco/server/protocol"
)

// What the preview cache is allowed to be.
const (
	// maxThumbs is one per row on the page, and no more.
	maxThumbs = LivePageMax

	// maxThumbBytes: a 440x248 preview weighs 25 to 45 kB. Anything past this
	// is abandoned rather than truncated — the row stays, without a picture —
	// so the hard ceiling on this cache is twelve times this, plus the
	// generation still being swapped out. Under two megabytes, and it is the
	// only reason this process holds bytes for a reason unrelated to the game.
	maxThumbBytes = 80 << 10

	// thumbWidth and thumbHeight replace the {width}x{height} Twitch leaves in
	// the URL. The strip draws them at 96px wide; 440x248 is the size Twitch
	// actually generates, so asking for anything smaller buys nothing.
	thumbWidth  = "440"
	thumbHeight = "248"

	// ThumbPrefix is the path previews are served under, on this origin. The
	// page and the strip only ever see a path, never a Twitch URL: img-src is
	// 'self' and a player's browser must not tell Twitch it opened this page.
	ThumbPrefix = "/live-thumb/"
)

type thumb struct {
	bytes   []byte
	ctype   string
	etag    string
	fetched time.Time
}

// snapshot is one poll's worth of answer, replaced whole and read through an
// atomic pointer: the poller writes it on its own goroutine, the two HTTP
// handlers read it on theirs, and neither is ever on the event loop.
type snapshot struct {
	streams []protocol.LiveStreamDTO
	thumbs  map[string]thumb
	at      time.Time
	// jsonBody is what /live.json answers with, encoded once when the
	// snapshot is built rather than per request: the page is served to
	// crawlers and to everyone who opens it, and none of them changes it.
	jsonBody []byte
}

// thumbKey is opaque and ours.
//
// This is the whole of the access control on the preview route, and it is
// worth being explicit about why it is enough: the map is written from the
// last poll's answers, so only a URL Twitch returned to us can be in it, and
// it is fetched by us on a timer rather than on anybody's request. Nothing a
// visitor sends chooses a URL, so there is no open proxy to close — the
// allowlist is a list rather than a regular expression.
func thumbKey(rawURL string) string {
	sum := sha256.Sum256([]byte(rawURL))
	return hex.EncodeToString(sum[:])[:16]
}

// thumbPath turns a Twitch thumbnail URL into the path to ask the CDN slug
// for, and refuses anything not on the host previews come from. The host is
// checked rather than followed: a response naming somewhere else yields a row
// with no picture, not a fetch of whatever it pointed at.
func thumbPath(rawURL string) (string, bool) {
	sized := strings.NewReplacer("{width}", thumbWidth, "{height}", thumbHeight).Replace(rawURL)
	u, err := url.Parse(sized)
	if err != nil || u.Scheme != "https" || u.Host != thumbHost || u.Path == "" {
		return "", false
	}
	if u.RawQuery != "" {
		return u.Path + "?" + u.RawQuery, true
	}
	return u.Path, true
}

// withThumbs fetches what the rows point at, reusing anything the previous
// snapshot already holds and has not outlived.
//
// An empty CDN slug is not an error and not a special case anywhere else: the
// rows simply keep an empty Thumb, and both surfaces already draw a row
// without a picture. That is the state this shipped in, until the preview CDN
// is registered in Janus.
func (p *Poller) withThumbs(ctx context.Context, rows []protocol.LiveStreamDTO, raw []helixStream, prev *snapshot) (
	[]protocol.LiveStreamDTO, map[string]thumb,
) {
	out := make(map[string]thumb, len(rows))
	if p.cfg.CDNSlug == "" {
		return rows, out
	}

	// The screened rows are a subset of what Helix sent, so the URL for a row
	// is looked up by login rather than by position.
	urls := make(map[string]string, len(raw))
	for _, s := range raw {
		urls[strings.ToLower(s.UserLogin)] = s.ThumbnailURL
	}

	for i := range rows {
		if len(out) >= maxThumbs {
			break
		}
		rawURL := urls[strings.ToLower(rows[i].Login)]
		if rawURL == "" {
			continue
		}
		key := thumbKey(rawURL)

		if prev != nil {
			if have, ok := prev.thumbs[key]; ok && time.Since(have.fetched) < LiveThumbTTL {
				out[key] = have
				rows[i].Thumb = ThumbPrefix + key
				continue
			}
		}

		path, ok := thumbPath(rawURL)
		if !ok {
			continue
		}
		got, err := p.fetchThumb(ctx, path)
		if err != nil {
			// A missing picture is a row without one. It is not worth failing
			// a poll over, and it is not worth a log line per channel either.
			p.thumbErrors.Add(1)
			continue
		}
		out[key] = got
		rows[i].Thumb = ThumbPrefix + key
	}
	return rows, out
}

func (p *Poller) fetchThumb(ctx context.Context, path string) (thumb, error) {
	resp, err := p.janus.Get(ctx, janus.Request{
		Slug:  p.cfg.CDNSlug,
		Path:  path,
		Limit: maxThumbBytes + 1, // one over, so an oversized image is seen rather than trimmed
	})
	if err != nil {
		return thumb{}, err
	}
	if len(resp.Body) > maxThumbBytes {
		return thumb{}, errTooBig
	}
	ctype, ok := imageType(resp.Body)
	if !ok {
		return thumb{}, errNotAnImage
	}
	sum := sha256.Sum256(resp.Body)
	return thumb{
		bytes: resp.Body,
		// Ours, written from the magic bytes. The upstream Content-Type is
		// never copied: this origin serves it, so this origin says what it is.
		ctype:   ctype,
		etag:    `"` + hex.EncodeToString(sum[:])[:16] + `"`,
		fetched: time.Now(),
	}, nil
}

// imageType reads the magic bytes. A preview that is not a picture is not
// served at all, whatever the response called itself.
func imageType(b []byte) (string, bool) {
	switch {
	case bytes.HasPrefix(b, []byte{0xFF, 0xD8, 0xFF}):
		return "image/jpeg", true
	case bytes.HasPrefix(b, []byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A}):
		return "image/png", true
	}
	return "", false
}

// ServeThumb answers one preview, from memory.
//
// It runs on an ordinary net/http goroutine, exactly like /health and
// /metrics: the event loop is never touched, and no page load ever waits on
// the gateway — the fetching happened on a timer, minutes ago.
func (p *Poller) ServeThumb(w http.ResponseWriter, r *http.Request) {
	key := strings.TrimPrefix(r.URL.Path, ThumbPrefix)
	snap := p.current()
	if snap == nil || key == "" || strings.Contains(key, "/") {
		http.NotFound(w, r)
		return
	}
	t, ok := snap.thumbs[key]
	if !ok {
		http.NotFound(w, r)
		return
	}
	// The URL is stable per channel while the picture behind it changes every
	// poll, so the ETag is computed over the bytes and not over the key.
	if match := r.Header.Get("If-None-Match"); match != "" && strings.Contains(match, t.etag) {
		w.Header().Set("ETag", t.etag)
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Type", t.ctype)
	w.Header().Set("ETag", t.etag)
	w.Header().Set("Cache-Control", "public, max-age=60, stale-while-revalidate=120")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write(t.bytes)
}

// ServeJSON is what the content page reads. The game does not: it is told over
// the socket it already holds, like every other thing that changes.
func (p *Poller) ServeJSON(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=30")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write(p.liveJSON())
}
