package twitch

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"unicode"

	"loco/server/janus"
	"loco/server/protocol"
)

const (
	// helixFirst is what is asked of the API. Helix already returns the list
	// ordered by viewer count, biggest first, so nothing here or on the client
	// ever re-sorts: "the biggest streamers" is the API's own order.
	helixFirst = 12

	// LivePageMax is what /live.json carries. Twelve is also what the preview
	// cache is willing to hold.
	LivePageMax = 12

	// helixBodyMax bounds what a third party can make this process decode. A
	// twelve-entry stream list is a few kilobytes.
	helixBodyMax = 256 << 10
)

// loginOK is the alphabet of a Twitch login.
//
// A row whose login falls outside it is dropped rather than escaped, and that
// is what makes the outgoing link safe to assemble on the client: nothing
// reaching twitch.tv/<login> can carry a slash, a question mark or a scheme.
func loginOK(s string) bool {
	if s == "" || len(s) > 25 {
		return false
	}
	for _, r := range s {
		if r == '_' || unicode.IsDigit(r) || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') {
			continue
		}
		return false
	}
	return true
}

type helixStream struct {
	UserLogin    string `json:"user_login"`
	UserName     string `json:"user_name"`
	ViewerCount  int    `json:"viewer_count"`
	ThumbnailURL string `json:"thumbnail_url"`
	Language     string `json:"language"`
}

// resolveGameID answers with the category's Twitch id, and an empty answer is
// a hard stop rather than a shrug.
//
// The failure mode this guards is the one that matters: GET /streams with no
// game_id returns the whole of Twitch. So a lookup that finds nothing returns
// an error, the poller refuses to start, and the feature stays off — which is
// the same outcome as never configuring it, and the only safe one.
func (p *Poller) resolveGameID(ctx context.Context) (string, error) {
	if p.cfg.GameID != "" {
		return p.cfg.GameID, nil
	}

	try := []url.Values{}
	if p.cfg.IGDBID != "" {
		try = append(try, url.Values{"igdb_id": {p.cfg.IGDBID}})
	}
	if p.cfg.GameName != "" {
		try = append(try, url.Values{"name": {p.cfg.GameName}})
	}

	var last error
	for _, q := range try {
		resp, err := p.janus.Get(ctx, janus.Request{
			Slug: p.cfg.HelixSlug, Path: "/games", Query: q, Limit: helixBodyMax,
		})
		if err != nil {
			last = err
			continue
		}
		var payload struct {
			Data []struct {
				ID string `json:"id"`
			} `json:"data"`
		}
		if err := json.Unmarshal(resp.Body, &payload); err != nil {
			last = err
			continue
		}
		if len(payload.Data) > 0 && payload.Data[0].ID != "" {
			return payload.Data[0].ID, nil
		}
	}
	if last != nil {
		return "", fmt.Errorf("resolving the game id: %w", last)
	}
	return "", errors.New("no Twitch category matched: pin LOCO_TWITCH_GAME_ID")
}

// fetchStreams asks for the channels live in the category right now.
func (p *Poller) fetchStreams(ctx context.Context, gameID string) ([]helixStream, string, error) {
	if gameID == "" {
		// Belt and braces over resolveGameID: this query without a game id is
		// a request for every live channel on Twitch.
		return nil, "", errors.New("refusing to poll with no game id")
	}
	resp, err := p.janus.Get(ctx, janus.Request{
		Slug: p.cfg.HelixSlug,
		Path: "/streams",
		Query: url.Values{
			"game_id": {gameID},
			"type":    {"live"},
			"first":   {strconv.Itoa(helixFirst)},
		},
		Limit: helixBodyMax,
	})
	if err != nil {
		return nil, "", err
	}
	var payload struct {
		Data []helixStream `json:"data"`
	}
	if err := json.Unmarshal(resp.Body, &payload); err != nil {
		return nil, resp.Cache, fmt.Errorf("decoding the stream list: %w", err)
	}
	return payload.Data, resp.Cache, nil
}

// screen turns what Twitch said into what a player may be shown.
//
// It runs here rather than on the event loop: this is text written by
// strangers, and folding a couple of hundred runes through a wordlist is work
// the poller's own goroutine can do while the tables get on with the game.
//
// A dropped row is never logged with the text that caused it. The counter says
// how many went; the words themselves have no business in a log file.
func (p *Poller) screen(in []helixStream) (out []protocol.LiveStreamDTO, dropped int) {
	for _, s := range in {
		if len(out) >= LivePageMax {
			break
		}
		login := s.UserLogin
		if !loginOK(login) {
			dropped++
			continue
		}
		if _, blocked := p.cfg.Blocked[strings.ToLower(login)]; blocked {
			dropped++
			continue
		}
		name := cleanName(s.UserName)
		if name == "" {
			name = login
		}
		// The name is the link, so there is nothing left to show once it is
		// refused: the row goes rather than being masked. Both spellings are
		// asked, because a display name and a login differ by more than case
		// on a channel that is not written in Latin script.
		if p.screenName(login) || p.screenName(name) {
			dropped++
			continue
		}
		if mentionsUNO(login) || mentionsUNO(name) {
			// NOTICE.md: nothing in the client renders the word UNO, and if
			// that stops being true it is a bug rather than a decision. The
			// whole trademark position rests on that sentence, and a channel
			// name is the one string here this game does not write.
			dropped++
			continue
		}
		out = append(out, protocol.LiveStreamDTO{
			Login:   login,
			Name:    name,
			Lang:    cleanLang(s.Language),
			Viewers: s.ViewerCount,
			Thumb:   "", // filled in by the thumbnail pass, when there is one
		})
	}
	return out, dropped
}

// screenName is the injected wordlist predicate, guarded for a nil screen so
// the package is usable without one in a test.
func (p *Poller) screenName(s string) bool {
	return p.blocked != nil && p.blocked(s)
}

// cleanName strips what a display name has no business carrying onto a home
// screen: control characters, line breaks, and the bidi overrides that flip
// the text around them. Same class of problem as the nickname's mark limit.
func cleanName(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r == '\n' || r == '\r' || r == '\t':
			continue
		case unicode.IsControl(r):
			continue
		case r >= 0x202A && r <= 0x202E, r >= 0x2066 && r <= 0x2069:
			continue
		}
		b.WriteRune(r)
	}
	name := strings.TrimSpace(b.String())
	if len([]rune(name)) > 25 {
		name = string([]rune(name)[:25])
	}
	return name
}

// cleanLang keeps a BCP-47 tag only if it looks like one. Presentation only:
// the list is never filtered on the reader's language, because an English
// stream is a stream.
func cleanLang(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	if len(s) < 2 || len(s) > 5 {
		return ""
	}
	for _, r := range s {
		if r != '-' && !(r >= 'a' && r <= 'z') {
			return ""
		}
	}
	return s
}

// mentionsUNO reports whether a name carries the mark as a word of its own.
//
// A whole token, not a substring, which is the same rule nickname.go applies
// to any term under six characters and for the same reason: "unopar" and
// "Unolingo" are words that are not the mark, and refusing somebody their own
// channel name is the worse of the two failures.
func mentionsUNO(s string) bool {
	for _, tok := range strings.FieldsFunc(strings.ToLower(s), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	}) {
		if tok == "uno" {
			return true
		}
	}
	return false
}
