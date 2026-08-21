package janus

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func testClient(t *testing.T, h http.HandlerFunc) (*Client, *httptest.Server) {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	return New(Config{BaseURL: srv.URL, AppID: "app-1", APIKey: "jns_test"}), srv
}

// The two headers are the whole of the contract, and the third is the one
// JANUS.md asks for by name. What matters as much is what is absent:
// Authorization and Cookie are stripped by the gateway, so sending either is
// sending a secret somewhere it was never needed.
func TestGetSendsTheGatewayHeadersAndNothingElse(t *testing.T) {
	var got http.Header
	var path, query string
	c, _ := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		got = r.Header.Clone()
		path, query = r.URL.Path, r.URL.RawQuery
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	})

	resp, err := c.Get(context.Background(), Request{
		Slug:  "twitch-helix",
		Path:  "/streams",
		Query: url.Values{"game_id": {"1372128809"}},
	})
	if err != nil {
		t.Fatalf("Get: %v", err)
	}

	if got.Get("X-Janus-Application-Id") != "app-1" {
		t.Errorf("application id = %q", got.Get("X-Janus-Application-Id"))
	}
	if got.Get("X-Janus-Api-Key") != "jns_test" {
		t.Errorf("api key = %q", got.Get("X-Janus-Api-Key"))
	}
	if got.Get("X-Janus-Identity") != IdentityApp {
		t.Errorf("identity = %q, want %q", got.Get("X-Janus-Identity"), IdentityApp)
	}
	if got.Get("Authorization") != "" || got.Get("Cookie") != "" {
		t.Errorf("sent an Authorization or Cookie header: %v", got)
	}
	// The path after the slug is forwarded as is, which is the addressing rule
	// the whole gateway rests on.
	if path != "/gateway/twitch-helix/streams" {
		t.Errorf("path = %q", path)
	}
	if query != "game_id=1372128809" {
		t.Errorf("query = %q", query)
	}
	if string(resp.Body) != `{"ok":true}` {
		t.Errorf("body = %q", resp.Body)
	}
}

// The distinction this package exists to draw. A 404 from the gateway means
// there is no API at that slug; a 404 from the API means it has no such
// resource. Reading the first as the second is how "the CDN was never
// registered" would come back as "nobody is streaming".
func TestGetTellsAGatewayRefusalFromAnUpstreamAnswer(t *testing.T) {
	t.Run("problem+json is the gateway", func(t *testing.T) {
		c, _ := testClient(t, func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/problem+json")
			w.Header().Set("X-Janus-Correlation-Id", "corr-1")
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"code":"provider_unavailable","detail":"Provider is not available"}`))
		})
		_, err := c.Get(context.Background(), Request{Slug: "nope", Path: "/x"})
		var g *GatewayError
		if !errors.As(err, &g) {
			t.Fatalf("err = %v, want *GatewayError", err)
		}
		if g.Code != "provider_unavailable" || g.Correlation != "corr-1" {
			t.Errorf("gateway error = %+v", g)
		}
	})

	t.Run("any other media type is the API", func(t *testing.T) {
		c, _ := testClient(t, func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json;charset=utf-8")
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":"Not Found","status":404}`))
		})
		_, err := c.Get(context.Background(), Request{Slug: "twitch-helix", Path: "/nope"})
		var u *UpstreamError
		if !errors.As(err, &u) {
			t.Fatalf("err = %v, want *UpstreamError", err)
		}
		if u.Status != http.StatusNotFound {
			t.Errorf("status = %d", u.Status)
		}
	})
}

// A non-2xx is an error, never an empty result. The caller above turns an
// error into "publish nothing"; if this returned a zero value with no error it
// would turn an outage into "nobody is live", which is the same screen as the
// truth and a lie.
func TestGetTreatsAServerErrorAsAnError(t *testing.T) {
	c, _ := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
	})
	if _, err := c.Get(context.Background(), Request{Slug: "twitch-helix", Path: "/streams"}); err == nil {
		t.Fatal("a 502 came back as success")
	}
}

// The only pacing signal honoured here. Everything else about retrying is the
// gateway's, per JANUS.md.
func TestRetryAfterIsCarriedOnA429(t *testing.T) {
	c, _ := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/problem+json")
		w.Header().Set("Retry-After", "42")
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(`{"code":"rate_limited"}`))
	})
	_, err := c.Get(context.Background(), Request{Slug: "twitch-helix", Path: "/streams"})
	if got := RetryAfter(err); got != 42*time.Second {
		t.Fatalf("RetryAfter = %s, want 42s", got)
	}
}

// What a third party can make this process decode is bounded by the caller,
// per call, because a JSON list and a preview image are not the same size.
func TestGetBoundsTheBody(t *testing.T) {
	c, _ := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(strings.Repeat("a", 4096)))
	})
	resp, err := c.Get(context.Background(), Request{Slug: "s", Path: "/p", Limit: 64})
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if len(resp.Body) != 64 {
		t.Fatalf("read %d bytes, want the 64 the caller allowed", len(resp.Body))
	}
}

// Refused here rather than by the gateway: being told 400 costs a call against
// a quota shared with everything else this service does.
func TestGetRefusesAPathTheGatewayWouldRefuse(t *testing.T) {
	called := false
	c, _ := testClient(t, func(w http.ResponseWriter, r *http.Request) { called = true })
	for _, p := range []string{"/../secret", "//double", "/a%2Fb", "no-leading-slash"} {
		if _, err := c.Get(context.Background(), Request{Slug: "s", Path: p}); !errors.Is(err, ErrBadPath) {
			t.Errorf("Path %q: err = %v, want ErrBadPath", p, err)
		}
	}
	if called {
		t.Error("a refused path still reached the gateway")
	}
}

// A feature with no key does not half-start.
func TestGetWithoutConfigurationDoesNotCall(t *testing.T) {
	c := New(Config{BaseURL: "https://example.invalid", AppID: "app-1"}) // no key
	if c.cfg.Valid() {
		t.Fatal("a config with no key reported itself valid")
	}
	if _, err := c.Get(context.Background(), Request{Slug: "s", Path: "/p"}); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("err = %v, want ErrNotConfigured", err)
	}
}
