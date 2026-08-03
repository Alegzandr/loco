// Room codes and session tokens. Both come from crypto/rand and neither has a
// math/rand fallback: the code is the only thing guarding a private lobby and
// the token the only proof behind a seat reclaim.
package hub

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
)

// generateSessionToken produces a cryptographically random 32-hex-char token.
//
// There is no math/rand fallback, and there must not be one: this token is the
// only thing proving that whoever claims a held seat is the player who left it.
// Degrading it to a predictable source on an error path would turn the one
// authentication check in the game into a guessable number, and it was dead
// code besides: since Go 1.24 rand.Read never returns an error, it panics if
// the OS entropy source is genuinely broken, which is the correct outcome for a
// server that can no longer issue a trustworthy token.
func generateSessionToken() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// randIndex returns a uniformly distributed index in [0, n) drawn from
// crypto/rand. The mask-and-retry keeps the distribution flat for any n; for
// the 32-character room alphabet the mask is exact and nothing is ever redrawn.
func randIndex(n int) int {
	if n <= 1 {
		return 0
	}
	mask := 1
	for mask < n {
		mask <<= 1
	}
	mask--
	var b [1]byte
	for {
		_, _ = rand.Read(b[:])
		if v := int(b[0]) & mask; v < n {
			return v
		}
	}
}

// issueToken creates and stores a session token for the given player slot.
func (t *table) issueToken(playerID int) string {
	tok := generateSessionToken()
	t.tokens[playerID] = tok
	return tok
}

// validateToken checks the provided token against the stored one for the slot.
//
// subtle.ConstantTimeCompare, not ==: a network timing attack on 128 bits of
// hex is not a realistic threat, but this is the only identity check the game
// has, the replacement is one line, and the equality operator returning early on
// the first differing byte is the kind of thing that is only ever noticed after
// it matters.
func (t *table) validateToken(playerID int, token string) bool {
	stored, ok := t.tokens[playerID]
	if !ok || stored == "" || token == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(stored), []byte(token)) == 1
}

// generateCode produces a unique 6-character room code and guarantees no collision.
//
// crypto/rand, not math/rand: the code is the only thing standing between a
// private lobby and a stranger: there is no login and no invite to check
// behind it. math/rand is a predictable sequence, and an attacker who creates
// rooms in a loop is reading that sequence's output directly, which is exactly
// the observation needed to infer its state and name the codes handed to
// everyone else in between. A 32-character alphabet is 5 bits per byte, so the
// rejection loop below keeps the draw uniform rather than folding 256 values
// onto 32 and skewing the first eight letters.
func (h *Hub) generateCode() string {
	const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	for {
		code := make([]byte, 6)
		for i := range code {
			code[i] = chars[randIndex(len(chars))]
		}
		s := string(code)
		if _, exists := h.tables[s]; !exists {
			return s
		}
	}
}
