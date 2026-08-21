// The one name this package is asked about that is not a nickname.
package game

// ContainsBlockedTerm reports whether a name written by somebody outside this
// game carries a blocked term.
//
// It is the nickname matcher, exported and nothing more: the same wordlists,
// the same folding and leet, the same whole-token-then-substring-from-six
// rules, the same allowlist for the collisions those rules leave. Sharing the
// matcher is the whole point — a second list would drift from this one on its
// own schedule, and what a drifted list produces is a slur on the home screen.
//
// What it deliberately does not share is ValidateNickname. That function owns
// a character allowlist written for a 20-rune seat label, and the names asked
// about here belong to people on another service: refusing every login outside
// Latin, Greek and Cyrillic would drop honest channels by the handful, and
// this gate is not the one that decides what a name may be made of.
func ContainsBlockedTerm(name string) bool { return blockedNickname(name) }
