// The gateway every third-party call leaves through.
//
// This package holds no API's secret and knows no API's address: it puts two
// headers on a request and sends it to Janus, which adds the secret on the way
// out. See JANUS.md at the repository root.
//
// What it deliberately does not contain is a cache, a retry loop, a backoff, a
// circuit breaker or a token store. Janus does all five for every caller, and
// JANUS.md names them one by one as things not to build here. A second layer
// of any of them would not be redundancy, it would be two policies disagreeing
// about the same upstream.
package janus

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// clientTimeout is above the 30s Janus waits upstream, as JANUS.md requires: a
// client that gives up first turns the gateway's own timeout, which comes back
// as a readable 502, into a cancelled request nobody can explain. It is long
// because nothing on the event loop ever waits on it; every caller here is a
// poller on its own goroutine.
const clientTimeout = 40 * time.Second

// The X-Janus-Identity header, always stated rather than left off: leaving it
// off costs an extra round trip against the API's quota and makes the first
// call to an endpoint behave differently from every call after it (JANUS.md,
// "Two identities").
const (
	// IdentityApp is this service asking for an API's own public data: a
	// catalogue, a search, a public resource.
	IdentityApp = "app"
	// IdentityAccount is data belonging to the person who connected their
	// account. Nothing in this game has one, so nothing here sends it.
	IdentityAccount = "account"
)

// Config is what the environment says about the gateway. All three are
// required; APIKey is the secret and never appears in a file of this
// repository.
type Config struct {
	BaseURL string
	AppID   string
	APIKey  string
}

// Valid reports whether the gateway can be called at all. A missing key is how
// a feature stays switched off; a key with no URL or no application id is a
// typo in an env file, and the caller says so rather than trying.
func (c Config) Valid() bool {
	return c.BaseURL != "" && c.AppID != "" && c.APIKey != ""
}

// Client is one client for this service, with both headers set here and never
// at a call site (JANUS.md).
type Client struct {
	cfg  Config
	http *http.Client
}

// New builds the one client. Callers keep it for the life of the process.
func New(cfg Config) *Client {
	return &Client{
		cfg: cfg,
		http: &http.Client{
			Timeout: clientTimeout,
			Transport: &http.Transport{
				MaxIdleConnsPerHost:   2,
				TLSHandshakeTimeout:   5 * time.Second,
				ResponseHeaderTimeout: 35 * time.Second,
			},
		},
	}
}

// Request is one call to one API, addressed the way JANUS.md describes: the
// path after the slug is forwarded as is.
type Request struct {
	Slug  string     // the API, e.g. "twitch-helix"
	Path  string     // forwarded unchanged, leading slash included
	Query url.Values // unchanged
	// Limit bounds what a third party can make this process decode. It is per
	// call because a JSON list and a preview image are not the same size, and
	// the honest bound is the one the caller can state.
	Limit int64
}

// Response is what came back, plus the headers worth keeping.
type Response struct {
	Status      int
	ContentType string
	Body        []byte
	// Cache is X-Janus-Cache (HIT, MISS, STALE and so on). Worth reading
	// rather than guessing: a HIT means the freshness of this data is the
	// gateway's, not the poll period of whoever asked for it.
	Cache string
	// Correlation is X-Janus-Correlation-Id, logged beside our own errors so a
	// line here and a line in the gateway's audit trail can be put together.
	Correlation string
	// RetryAfter is set on a 429 and is the only pacing signal honoured here.
	RetryAfter time.Duration
}

// GatewayError is Janus refusing, recognised by its media type rather than by
// its status: a 404 carrying problem+json means there is no API at that slug,
// while a 404 carrying anything else means the API itself has no such
// resource. Confusing the two is how a misconfigured gateway reads as an empty
// catalogue.
type GatewayError struct {
	Status      int
	Code        string
	Detail      string
	Correlation string
	RetryAfter  time.Duration
}

func (e *GatewayError) Error() string {
	return fmt.Sprintf("janus refused status=%d code=%s detail=%q correlation=%s",
		e.Status, e.Code, e.Detail, e.Correlation)
}

// UpstreamError is the API itself answering with something that is not a 2xx.
// It is an error and never an empty result: an outage that reads as "nobody is
// live" is the silent version of the bug.
type UpstreamError struct {
	Status      int
	Correlation string
	RetryAfter  time.Duration
}

func (e *UpstreamError) Error() string {
	return fmt.Sprintf("upstream api status=%d correlation=%s", e.Status, e.Correlation)
}

// RetryAfter returns the pause a 429 asked for, from either error, or zero.
func RetryAfter(err error) time.Duration {
	var g *GatewayError
	if errors.As(err, &g) {
		return g.RetryAfter
	}
	var u *UpstreamError
	if errors.As(err, &u) {
		return u.RetryAfter
	}
	return 0
}

// ErrBadPath is refused here rather than by the gateway. Janus answers 400 to
// a dot segment, a double slash or an encoded separator; spending a call to be
// told so is a call spent against a quota shared with everything else.
var ErrBadPath = errors.New("janus: path may not contain a dot segment, // or an encoded separator")

// ErrNotConfigured is what a call gets when the gateway was never configured.
// It exists so a caller cannot half-start: a feature with no key does not run.
var ErrNotConfigured = errors.New("janus: not configured")

// Get sends one GET.
//
// Only GET, because that is all this service asks of anyone and because
// JANUS.md is explicit that POST and PATCH are not retried by the gateway: a
// method this package does not offer cannot be retried by mistake.
func (c *Client) Get(ctx context.Context, req Request) (*Response, error) {
	if !c.cfg.Valid() {
		return nil, ErrNotConfigured
	}
	if err := checkPath(req.Path); err != nil {
		return nil, err
	}

	addr := strings.TrimSuffix(c.cfg.BaseURL, "/") + "/gateway/" + req.Slug + req.Path
	if len(req.Query) > 0 {
		addr += "?" + req.Query.Encode()
	}

	hreq, err := http.NewRequestWithContext(ctx, http.MethodGet, addr, nil)
	if err != nil {
		return nil, err
	}
	// The two headers, plus the identity. Nothing else: Janus strips
	// Authorization and cookies, and sending an API's own key is exactly what
	// this gateway exists to make unnecessary.
	hreq.Header.Set("X-Janus-Application-Id", c.cfg.AppID)
	hreq.Header.Set("X-Janus-Api-Key", c.cfg.APIKey)
	hreq.Header.Set("X-Janus-Identity", IdentityApp)

	resp, err := c.http.Do(hreq)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()

	limit := req.Limit
	if limit <= 0 {
		limit = 1 << 20
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, limit))
	if err != nil {
		return nil, err
	}

	out := &Response{
		Status:      resp.StatusCode,
		ContentType: resp.Header.Get("Content-Type"),
		Body:        body,
		Cache:       resp.Header.Get("X-Janus-Cache"),
		Correlation: resp.Header.Get("X-Janus-Correlation-Id"),
		RetryAfter:  parseRetryAfter(resp.Header.Get("Retry-After")),
	}

	if isProblem(out.ContentType) {
		return nil, gatewayError(out)
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, &UpstreamError{
			Status:      resp.StatusCode,
			Correlation: out.Correlation,
			RetryAfter:  out.RetryAfter,
		}
	}
	return out, nil
}

// isProblem is the whole of "who answered". A media type of
// application/problem+json means the gateway; anything else means the API.
func isProblem(ct string) bool {
	return strings.HasPrefix(strings.TrimSpace(strings.ToLower(ct)), "application/problem+json")
}

func gatewayError(r *Response) *GatewayError {
	var p struct {
		Code   string `json:"code"`
		Detail string `json:"detail"`
		Title  string `json:"title"`
	}
	_ = json.Unmarshal(r.Body, &p)
	detail := p.Detail
	if detail == "" {
		detail = p.Title
	}
	return &GatewayError{
		Status:      r.Status,
		Code:        p.Code,
		Detail:      detail,
		Correlation: r.Correlation,
		RetryAfter:  r.RetryAfter,
	}
}

// checkPath refuses the three shapes JANUS.md says the gateway answers 400 to.
func checkPath(p string) error {
	if p != "" && !strings.HasPrefix(p, "/") {
		return ErrBadPath
	}
	if strings.Contains(p, "//") || strings.Contains(strings.ToLower(p), "%2f") {
		return ErrBadPath
	}
	for _, seg := range strings.Split(p, "/") {
		if seg == "." || seg == ".." {
			return ErrBadPath
		}
	}
	return nil
}

// parseRetryAfter reads the header in both spellings the RFC allows. A value
// that is neither is no pause rather than a guessed one.
func parseRetryAfter(raw string) time.Duration {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0
	}
	if secs, err := strconv.Atoi(raw); err == nil {
		if secs <= 0 {
			return 0
		}
		return time.Duration(secs) * time.Second
	}
	if when, err := http.ParseTime(raw); err == nil {
		if d := time.Until(when); d > 0 {
			return d
		}
	}
	return 0
}
