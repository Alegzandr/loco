// Who is streaming this game right now, asked through the gateway.
//
// This package holds no Twitch credential and knows no Twitch address beyond
// the one the CDN hands back: everything leaves through Janus, which owns the
// secret and the OAuth2 token (JANUS.md). It never imports hub — the only way
// anything here reaches the event loop is the publish callback Run is given.
package twitch

import (
	"log"
	"strings"
	"time"

	"loco/server/janus"
)

// Defaults, and the reasoning for the two that are decisions rather than
// spellings.
const (
	// defaultHelixSlug is the gateway slug the API is registered under. The
	// path after it is forwarded as is, and the registered base address
	// already ends in /helix — so the endpoint here is "/streams", not
	// "/helix/streams". Confirmed against the live gateway, not assumed: the
	// other spelling comes back as a 404 from Twitch itself.
	defaultHelixSlug = "twitch-helix"

	// defaultGameName is what the category is called on Twitch. Only used when
	// no game id was pinned, and the id is what production runs on.
	defaultGameName = "LOCO!"

	// LivePollPeriod is the freshness of the list, not a rate.
	//
	// The Helix quota does not constrain it: that is a token bucket of 800
	// points per minute per client id and /streams costs one point, so this
	// spends 0.125% of it. What constrains it is what a server whose first
	// priority is latency should be made to pay for a list nobody plays with,
	// and a minute-old answer costs a home screen nothing. Note also that the
	// real freshness may be the gateway's rather than ours: Janus caches
	// upstream responses, and X-Janus-Cache says which it was.
	//
	// Exported so tests can shorten it, like every other period on this
	// server.
	LivePollPeriod = 60 * time.Second

	// LiveMaxAge is when the last good answer stops being true.
	//
	// Past it, an empty list is published rather than the last one known. A
	// twenty-minute-old list is wrong in the only direction that costs
	// anything: somebody clicks and lands on a channel that went off air while
	// they were reading it.
	LiveMaxAge = 10 * time.Minute

	// LiveThumbTTL is how long a preview is kept before it is fetched again.
	// Twitch regenerates them every few minutes, so asking more often buys a
	// picture that has not changed.
	LiveThumbTTL = 5 * time.Minute
)

// thumbHost is the only host a preview may come from.
//
// The path of a thumbnail URL is forwarded to the CDN slug; the host is
// checked rather than followed, so a Twitch response naming somewhere else
// yields a row with no picture instead of this process fetching whatever it
// was pointed at.
const thumbHost = "static-cdn.jtvnw.net"

// Config is what the environment says about this feature.
type Config struct {
	Janus janus.Config

	// HelixSlug and CDNSlug are the two gateway slugs. CDNSlug is empty until
	// the preview CDN is registered in Janus, and an empty one is not an
	// error: the rows are listed without their pictures, which is the state
	// this shipped in.
	HelixSlug string
	CDNSlug   string

	// GameID is pinned in production. Resolving by name costs a call and, far
	// worse, can resolve to nothing — and a poll with no game id would ask
	// Helix about the whole of Twitch. See resolveGameID.
	GameID   string
	IGDBID   string
	GameName string

	Poll time.Duration

	// Blocked is the manual list of logins, lowercased. It is the operational
	// escape hatch, and it is needed because nothing screens the *contents* of
	// a preview image.
	Blocked map[string]struct{}
}

// configFromEnv reads the environment and says whether the feature runs.
//
// A pure function over an injected getenv, like botTimingOverride in hub: the
// precedence rules are the part worth testing, and they are not worth an
// environment variable in a test process to test.
//
// Three outcomes, and the difference between the last two matters:
//   - no gateway key at all: off, silently. That is local dev and the E2E
//     suite, and a line at every startup about a feature nobody switched on is
//     noise.
//   - a key with no URL or no application id: off, with a WARN. That is a typo
//     in an env file, not an intention.
//   - everything present: on.
func configFromEnv(getenv func(string) string) (Config, bool) {
	key := strings.TrimSpace(getenv("JANUS_API_KEY"))
	base := strings.TrimSpace(getenv("JANUS_URL"))
	app := strings.TrimSpace(getenv("JANUS_APPLICATION_ID"))

	if key == "" {
		return Config{}, false
	}
	if base == "" || app == "" {
		log.Printf("WARN twitch live is off: JANUS_API_KEY is set but JANUS_URL or JANUS_APPLICATION_ID is empty")
		return Config{}, false
	}

	cfg := Config{
		Janus:     janus.Config{BaseURL: base, AppID: app, APIKey: key},
		HelixSlug: or(strings.TrimSpace(getenv("LOCO_TWITCH_SLUG")), defaultHelixSlug),
		CDNSlug:   strings.TrimSpace(getenv("LOCO_TWITCH_CDN_SLUG")),
		GameID:    strings.TrimSpace(getenv("LOCO_TWITCH_GAME_ID")),
		IGDBID:    strings.TrimSpace(getenv("LOCO_TWITCH_IGDB_ID")),
		GameName:  or(strings.TrimSpace(getenv("LOCO_TWITCH_GAME_NAME")), defaultGameName),
		Poll:      pollPeriod(getenv("LOCO_TWITCH_POLL")),
		Blocked:   parseBlocklist(getenv("LOCO_TWITCH_BLOCKLIST")),
	}
	return cfg, true
}

// pollPeriod parses LOCO_TWITCH_POLL. A malformed value leaves the shipped
// default rather than falling back to zero, for the reason parseDrainTimeout
// gives: a typo must not turn a poll into a spin.
func pollPeriod(raw string) time.Duration {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return LivePollPeriod
	}
	if d, err := time.ParseDuration(raw); err == nil && d >= time.Second {
		return d
	}
	log.Printf("WARN LOCO_TWITCH_POLL=%q is not a duration of at least 1s, using %s", raw, LivePollPeriod)
	return LivePollPeriod
}

func parseBlocklist(raw string) map[string]struct{} {
	out := map[string]struct{}{}
	for _, entry := range strings.Split(raw, ",") {
		if e := strings.ToLower(strings.TrimSpace(entry)); e != "" {
			out[e] = struct{}{}
		}
	}
	return out
}

func or(v, fallback string) string {
	if v == "" {
		return fallback
	}
	return v
}
