package hub

import (
	"net/http"
	"testing"
)

func req(origin, host string) *http.Request {
	r := &http.Request{Host: host, Header: http.Header{}}
	if origin != "" {
		r.Header.Set("Origin", origin)
	}
	return r
}

func TestOriginAllowed_DefaultIsSameHost(t *testing.T) {
	t.Cleanup(func() { AllowedOrigins = nil })
	AllowedOrigins = nil

	cases := []struct {
		name   string
		origin string
		host   string
		want   bool
	}{
		{"same host and port", "https://loco.example.com", "loco.example.com", true},
		// The dev client is served by Vite on another port and talks to the Go
		// server directly. Matching on the port would break that with no gain:
		// a different port on the same host is not another party.
		{"same host, different port", "http://localhost:5173", "localhost:8080", true},
		{"e2e vite port", "http://localhost:4173", "localhost:8080", true},
		{"another site entirely", "https://evil.example", "loco.example.com", false},
		// The one that reads as same-origin and is not: a subdomain.
		{"subdomain", "https://evil.loco.example.com", "loco.example.com", false},
		{"garbage origin", "not a url", "loco.example.com", false},
		{"null origin", "null", "loco.example.com", false},
		// No Origin at all is not a browser, and nothing here is authenticated
		// by something a non-browser client could be tricked into replaying.
		{"no origin header", "", "loco.example.com", true},
		{"ipv6 host", "http://[::1]:5173", "[::1]:8080", true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := originAllowed(req(tc.origin, tc.host)); got != tc.want {
				t.Errorf("originAllowed(%q, host=%q) = %v, want %v", tc.origin, tc.host, got, tc.want)
			}
		})
	}
}

func TestOriginAllowed_ExplicitAllowlistWins(t *testing.T) {
	t.Cleanup(func() { AllowedOrigins = nil })
	AllowedOrigins = []string{"https://loco.example.com", "https://loco-d.example.com"}

	if !originAllowed(req("https://loco-d.example.com", "internal-lb")) {
		t.Error("a listed origin was refused")
	}
	// Once a list is configured it is the whole rule: same-host is no longer a
	// fallback, or the list could not be used to narrow anything.
	if originAllowed(req("https://other.example.com", "other.example.com")) {
		t.Error("same-host origin slipped past a configured allowlist")
	}
}

func TestSplitOrigins(t *testing.T) {
	got := splitOrigins(" https://a.example , ,https://b.example ")
	want := []string{"https://a.example", "https://b.example"}
	if len(got) != len(want) {
		t.Fatalf("splitOrigins = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("splitOrigins[%d] = %q, want %q", i, got[i], want[i])
		}
	}
	if splitOrigins("") != nil {
		t.Error("splitOrigins(\"\") should be nil, so the default same-host rule applies")
	}
}
