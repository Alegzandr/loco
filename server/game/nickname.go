package game

import (
	"embed"
	"errors"
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Nickname validation.
//
// The nickname is the only string a player ever authors, and it is printed on a
// seat, in the score table, in the round summary and in a clip somebody is
// streaming. There is no account behind it, no uniqueness beyond the table and
// no way to change it mid-match, so this file is the whole of what the game
// knows about it: shape first, then meaning.
//
// Three properties this is built around:
//
//   - It is authoritative here. The client refuses the same shapes as it is
//     typed, purely so the refusal is instant; nothing on the wire is trusted,
//     and every entry point (create_room, join_room, find_match) goes through
//     ValidateNickname before a seat exists.
//   - The player is never told which rule fired. Every failure wraps
//     ErrNicknameRejected and reaches the socket as that one string. A refusal
//     that says "blocked word" is a hint, and the next attempt is the same
//     insult one letter apart; a refusal that says "1 to 20 characters" trains
//     nobody, because the field already stops at 20.
//   - The list costs nothing to run. It is a Go slice compiled into the binary,
//     matched against a string of at most 20 runes: no service, no network call,
//     no per-check price, nothing to renew. Extending it is a code change and a
//     test, which is the only maintenance it has.
const (
	// NicknameMaxRunes counts characters, not bytes. "Étienne" is 7 characters
	// and 8 bytes, and a byte limit told the second player they were too long.
	NicknameMaxRunes = 20
	// nicknameMaxMarks is how many combining marks may sit on one base letter.
	// One is how "Á" is written when it is not precomposed; a stack of them is
	// the Zalgo trick, which paints over the seat above and is unreadable at
	// 720p, which is the whole product.
	nicknameMaxMarks = 1
)

// ErrNicknameRejected is the only nickname refusal that reaches a player. The
// three below wrap it so the server can tell them apart in a test or a log line
// while the wire carries one string.
var (
	ErrNicknameRejected = errors.New("nickname not allowed")
	ErrNicknameLength   = fmt.Errorf("%w (length)", ErrNicknameRejected)
	ErrNicknameCharset  = fmt.Errorf("%w (charset)", ErrNicknameRejected)
	ErrNicknameBlocked  = fmt.Errorf("%w (blocked term)", ErrNicknameRejected)
)

// nicknameScripts is the alphabet a nickname may be written in: Latin, Greek,
// Cyrillic. An allowlist rather than unicode.IsLetter, because "letter" includes
// the Mathematical Alphanumeric Symbols block, whose 𝐟𝐮𝐜𝐤 is four letters as
// far as Unicode is concerned and renders as the word. Adding a script is
// adding a range here; the rest of the file needs no change.
var nicknameScripts = &unicode.RangeTable{
	R16: []unicode.Range16{
		{Lo: 0x0041, Hi: 0x005a, Stride: 1}, // A-Z
		{Lo: 0x0061, Hi: 0x007a, Stride: 1}, // a-z
		{Lo: 0x00c0, Hi: 0x024f, Stride: 1}, // Latin-1 letters + Latin Extended-A/B
		{Lo: 0x0370, Hi: 0x03ff, Stride: 1}, // Greek
		{Lo: 0x0400, Hi: 0x04ff, Stride: 1}, // Cyrillic
	},
}

// nicknamePunct is the punctuation a name legitimately contains: O'Brien,
// Anne-Marie, Mr. Bean, joueur_42. Everything else is refused, which is what
// keeps markup, emoji and the bidi controls out without naming them one by one.
const nicknamePunct = "-_.'"

// ValidateNickname canonicalises and checks an inbound nickname. It returns the
// form the room should store, or an error wrapping ErrNicknameRejected.
//
// Canonical means trimmed and with internal runs of spaces collapsed: "Jean
// Luc" and "Jean     Luc" are one player typing the same name, and the second
// one blows the seat label apart.
func ValidateNickname(raw string) (string, error) {
	n := collapseSpaces(raw)
	if c := utf8.RuneCountInString(n); c == 0 || c > NicknameMaxRunes {
		return "", ErrNicknameLength
	}
	if err := checkNicknameCharset(n); err != nil {
		return "", err
	}
	if blockedNickname(n) {
		return "", ErrNicknameBlocked
	}
	return n, nil
}

// collapseSpaces trims and squeezes runs of the one space character the charset
// allows. Every other space (NBSP, the zero-width ones, the ideographic space)
// is left alone here on purpose: it is not whitespace to be tidied, it is a
// character the nickname may not contain, and checkNicknameCharset says so.
func collapseSpaces(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	prevSpace := true // leading spaces are dropped by the same rule as doubles
	for _, r := range s {
		if r == ' ' {
			if prevSpace {
				continue
			}
			prevSpace = true
			b.WriteRune(r)
			continue
		}
		prevSpace = false
		b.WriteRune(r)
	}
	return strings.TrimSuffix(b.String(), " ")
}

func checkNicknameCharset(s string) error {
	hasAlnum := false
	marks := 0
	prevBase := false
	for _, r := range s {
		switch {
		case unicode.Is(unicode.Mn, r):
			// A combining mark is only ever a modification of the letter before
			// it, so it cannot open a nickname and it cannot pile up.
			if !prevBase || marks >= nicknameMaxMarks {
				return ErrNicknameCharset
			}
			marks++
		case r >= '0' && r <= '9':
			hasAlnum, prevBase, marks = true, true, 0
		case unicode.Is(nicknameScripts, r) && unicode.IsLetter(r):
			hasAlnum, prevBase, marks = true, true, 0
		case r == ' ' || strings.ContainsRune(nicknamePunct, r):
			prevBase, marks = false, 0
		default:
			return ErrNicknameCharset
		}
	}
	// "---" is inside the charset and is not a name. A seat needs something to
	// print that a viewer can read back.
	if !hasAlnum {
		return ErrNicknameCharset
	}
	return nil
}

// --- Normalisation ------------------------------------------------------
//
// Everything below exists so the word list can be short. A list is a losing
// game played character by character (f-u-c-k, fück, f.u.c.k, FUUUCK, 5h1t):
// normalising first means one entry answers all of them, and the entries stay
// readable.

// nicknameFold maps a precomposed accented letter onto its base. Go's standard
// library has no NFD, and pulling golang.org/x/text in for a 20-rune string
// would be a dependency in the server image for one table. Decomposed input is
// handled by the Mn branch below, so both spellings of "é" fold the same.
var nicknameFold = map[rune]string{
	'à': "a", 'á': "a", 'â': "a", 'ã': "a", 'ä': "a", 'å': "a", 'ā': "a", 'ă': "a", 'ą': "a",
	'ç': "c", 'ć': "c", 'ĉ': "c", 'ċ': "c", 'č': "c",
	'ď': "d", 'đ': "d", 'ð': "d",
	'è': "e", 'é': "e", 'ê': "e", 'ë': "e", 'ē': "e", 'ĕ': "e", 'ė': "e", 'ę': "e", 'ě': "e",
	'ĝ': "g", 'ğ': "g", 'ġ': "g", 'ģ': "g",
	'ĥ': "h", 'ħ': "h",
	'ì': "i", 'í': "i", 'î': "i", 'ï': "i", 'ĩ': "i", 'ī': "i", 'ĭ': "i", 'į': "i", 'ı': "i",
	'ĵ': "j", 'ķ': "k",
	'ĺ': "l", 'ļ': "l", 'ľ': "l", 'ł': "l",
	'ñ': "n", 'ń': "n", 'ņ': "n", 'ň': "n",
	'ò': "o", 'ó': "o", 'ô': "o", 'õ': "o", 'ö': "o", 'ø': "o", 'ō': "o", 'ŏ': "o", 'ő': "o",
	'ŕ': "r", 'ŗ': "r", 'ř': "r",
	'ś': "s", 'ŝ': "s", 'ş': "s", 'š': "s", 'ș': "s",
	'ţ': "t", 'ť': "t", 'ŧ': "t", 'ț': "t",
	'ù': "u", 'ú': "u", 'û': "u", 'ü': "u", 'ũ': "u", 'ū': "u", 'ŭ': "u", 'ů': "u", 'ű': "u", 'ų': "u",
	'ŵ': "w", 'ý': "y", 'ÿ': "y", 'ŷ': "y",
	'ź': "z", 'ż': "z", 'ž': "z",
	'þ': "th", 'ß': "ss", 'æ': "ae", 'œ': "oe",
}

// nicknameLeet undoes the substitutions that are meant to be read as letters.
// Conservative on purpose: every entry here is a way a legitimate name can also
// be mangled, and the cost of an aggressive map is a player refused for their
// own name. '2' is absent for that reason ("l33t" reads, "b2b" does not).
var nicknameLeet = map[rune]rune{
	'0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't',
	'@': 'a', '$': 's', '!': 'i', '+': 't', '|': 'i',
}

// normalizeNickname folds a nickname down to the form the word list is written
// in: lower case, no diacritics, no leet, no separators. Repeats are left
// alone; collapseRepeats is a second, narrower pass, because collapsing turns
// "nigger" into "niger" and Nigeria is a country.
func normalizeNickname(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		if unicode.Is(unicode.Mn, r) {
			continue // a stripped diacritic, decomposed spelling
		}
		r = unicode.ToLower(r)
		if folded, ok := nicknameFold[r]; ok {
			b.WriteString(folded)
			continue
		}
		if leet, ok := nicknameLeet[r]; ok {
			b.WriteRune(leet)
			continue
		}
		if unicode.IsLetter(r) || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		}
		// everything else is a separator and is dropped: "f.u.c.k" is "fuck"
	}
	return b.String()
}

// collapseRepeats squeezes runs of the same character to one, which is what
// answers "fuuuuck" and "salooope".
func collapseRepeats(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	var prev rune = -1
	for _, r := range s {
		if r != prev {
			b.WriteRune(r)
		}
		prev = r
	}
	return b.String()
}

// --- The list -----------------------------------------------------------
//
// The words themselves are not ours. wordlists/ is Shutterstock's "List of
// Dirty, Naughty, Obscene and Otherwise Bad Words" (LDNOOBW), CC BY 4.0, one
// file per language, vendored rather than fetched: it is embedded in the binary
// at compile time, so a match costs a map lookup and a walk over ~600 short
// strings, once, when a player takes a seat. No service, no key, no quota, and
// nothing that can fail at 3am because a third party changed a route. See
// NOTICE.md for the attribution and docs/notes/server.md for how to refresh it.
//
// What is ours is *how* the list is applied, because applied naively it refuses
// half a phone book. Three rules, in order of how much they can do damage:
//
//  1. Whole nickname, and every token in it, is matched against every term.
//     Tokens are cut on separators, on digit boundaries and on lower→upper case
//     transitions, so "Xx_Salope_xX" and "xXsalopeXx" both yield "salope"
//     without a single entry being written for the decoration.
//  2. Substring matching is limited to terms of 6 characters or more. That
//     threshold is the entire false-positive control: the list's short entries
//     are "ass", "con", "cul", "dick", "rape", "bite", "scat", and they live
//     inside Cassandra, Constance, Draper, Arbiter and Scatena. The cost is
//     that a 4-letter insult glued between letters with no case change gets
//     through; refusing somebody their own name is the worse of the two.
//  3. An allowlist for the collisions rule 2 still leaves (Scunthorpe, Niger).
//     Whole nickname only, so "scunthorpe" is a name and "scunthorpefuck" is
//     not.
//
//go:embed wordlists/*.txt
var wordlistFS embed.FS

// substringMinLen is rule 2. Below it, a term only matches a whole token.
const substringMinLen = 6

// nicknameAllowSeed is rule 3: real names and places whose normalised form
// carries a long entry. The only hand-written list in this file, and it is an
// *allow* list, so the failure mode of a missing entry is a refusal to be
// reported, never a slur that lands on a stream.
var nicknameAllowSeed = []string{
	"scunthorpe", "penistone", "cockburn", "lightwater", "clitheroe",
	"niger", "nigeria", "nigerian", "nigerien", "nigerienne",
	"shitake", "shiitake", "bordeleau", "matsushita", "assange",
}

var (
	badWords      map[string]struct{} // every term, matched whole
	badSubstrings []string            // the long ones, matched anywhere
	nicknameAllow map[string]struct{}
)

func init() {
	entries, err := wordlistFS.ReadDir("wordlists")
	if err != nil {
		panic("nickname wordlists: " + err.Error())
	}
	badWords = make(map[string]struct{}, 2048)
	seen := map[string]struct{}{}
	for _, e := range entries {
		raw, err := wordlistFS.ReadFile("wordlists/" + e.Name())
		if err != nil {
			panic("nickname wordlists: " + err.Error())
		}
		for _, line := range strings.Split(string(raw), "\n") {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			// The terms go through the same normalisation as the input, so a
			// list written the way people spell things matches the folded form.
			term := normalizeNickname(line)
			if term == "" {
				continue // an entry that is only punctuation or an emoji
			}
			badWords[term] = struct{}{}
			if len([]rune(term)) < substringMinLen {
				continue
			}
			for _, v := range []string{term, collapseRepeats(term)} {
				if _, dup := seen[v]; dup {
					continue
				}
				seen[v] = struct{}{}
				badSubstrings = append(badSubstrings, v)
			}
		}
	}
	nicknameAllow = make(map[string]struct{}, len(nicknameAllowSeed))
	for _, w := range nicknameAllowSeed {
		nicknameAllow[normalizeNickname(w)] = struct{}{}
	}
}

// blockedNickname reports whether the nickname carries a blocked term once
// normalised.
func blockedNickname(n string) bool {
	plain := normalizeNickname(n)
	if plain == "" {
		return false
	}
	if _, ok := nicknameAllow[plain]; ok {
		return false
	}
	squeezed := collapseRepeats(plain)
	// Whole nickname, then every token in it. The squeezed form answers
	// "salooope"; it is matched against the terms as written, never against a
	// squeezed list, because squeezing "nigger" produces the country.
	for _, cand := range append(nicknameTokens(n), plain, squeezed) {
		if _, ok := badWords[cand]; ok {
			return true
		}
		if _, ok := badWords[collapseRepeats(cand)]; ok {
			return true
		}
	}
	for _, term := range badSubstrings {
		if strings.Contains(plain, term) || strings.Contains(squeezed, term) {
			return true
		}
	}
	return false
}

// nicknameTokens cuts a nickname into the words a person reads in it, and
// returns them normalised. The cuts are structural, not lexical: separators,
// the boundary between digits and letters, and a lower→upper transition, which
// is how "xXsalopeXx" is written and read.
func nicknameTokens(s string) []string {
	var (
		out  []string
		cur  strings.Builder
		prev rune = -1
	)
	flush := func() {
		if t := normalizeNickname(cur.String()); t != "" {
			out = append(out, t)
		}
		cur.Reset()
	}
	for _, r := range s {
		switch {
		case r == ' ' || strings.ContainsRune(nicknamePunct, r):
			flush()
			prev = -1
			continue
		case unicode.IsDigit(r) != unicode.IsDigit(prev) && prev != -1:
			flush()
		case unicode.IsUpper(r) && unicode.IsLower(prev):
			flush()
		}
		cur.WriteRune(r)
		prev = r
	}
	flush()
	return out
}
