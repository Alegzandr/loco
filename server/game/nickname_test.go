package game

import (
	"errors"
	"strings"
	"testing"
)

func TestValidateNickname_Canonicalises(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"Alice", "Alice"},
		{"  Alice  ", "Alice"},
		{"Jean   Luc", "Jean Luc"},
		{"Étienne", "Étienne"},
		{"O'Brien", "O'Brien"},
		{"Anne-Marie", "Anne-Marie"},
		{"joueur_42", "joueur_42"},
		{"Ω-player", "Ω-player"},
		{"Дима", "Дима"},
	}
	for _, tc := range cases {
		got, err := ValidateNickname(tc.in)
		if err != nil {
			t.Errorf("ValidateNickname(%q) = error %v, want accepted", tc.in, err)
			continue
		}
		if got != tc.want {
			t.Errorf("ValidateNickname(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestValidateNickname_Length(t *testing.T) {
	cases := []struct {
		name string
		in   string
	}{
		{"empty", ""},
		{"spaces only", "   "},
		{"21 runes", strings.Repeat("a", 21)},
	}
	for _, tc := range cases {
		if _, err := ValidateNickname(tc.in); !errors.Is(err, ErrNicknameLength) {
			t.Errorf("%s: err = %v, want ErrNicknameLength", tc.name, err)
		}
	}
	// 20 accented runes are 40 bytes: the limit counts characters, not the
	// bytes they happen to encode to.
	if _, err := ValidateNickname(strings.Repeat("é", 20)); err != nil {
		t.Errorf("20 accented runes: err = %v, want accepted", err)
	}
}

func TestValidateNickname_Charset(t *testing.T) {
	cases := []struct {
		name string
		in   string
	}{
		{"zero-width space", "Ali​ce"},
		{"zero-width joiner", "Ali‍ce"},
		{"zero-width non-joiner", "Ali‌ce"},
		{"byte order mark", "Ali\ufeffce"},
		{"soft hyphen", "Ali­ce"},
		{"RTL override", "Ali‮ce"},
		{"LTR embedding", "‪Alice"},
		{"bidi isolate", "⁦Alice⁩"},
		{"newline", "Ali\nce"},
		{"tab", "Ali\tce"},
		{"NUL", "Ali\x00ce"},
		{"non-breaking space", "Ali ce"},
		{"emoji", "Alice\U0001f525"},
		{"stacked diacritics", "Á́́lice"},
		{"leading combining mark", "́Alice"},
		{"mathematical bold", "\U0001d41f\U0001d42e\U0001d41c\U0001d424"},
		{"markup", "<script>"},
		{"symbol", "Ali©e"},
		{"no letter or digit", "---"},
	}
	for _, tc := range cases {
		if _, err := ValidateNickname(tc.in); !errors.Is(err, ErrNicknameCharset) {
			t.Errorf("%s (%q): err = %v, want ErrNicknameCharset", tc.name, tc.in, err)
		}
	}
	// One mark on a base letter is a legitimate way to write a name; it is the
	// stack that is not.
	if _, err := ValidateNickname("Álice"); err != nil {
		t.Errorf("single combining mark: err = %v, want accepted", err)
	}
}

func TestValidateNickname_BlocksInsults(t *testing.T) {
	// The point is the normalisation, not the list: each of these reaches the
	// same entry through a different disguise.
	blocked := []string{
		"fuck",
		"FUCK",
		"Fuuuuck",
		"f u c k",
		"f.u.c.k",
		"f-u-c-k",
		"fück",        // diacritic
		"5h1t",        // leet s/i
		"n1gg3r",      // leet i/e
		"n i g g e r", // separators
		"nÍgger",      // case + diacritic
		"niiiigger",   // repeats
		"encule",
		"enculé",
		"3ncul3",
		"salope",
		"xXsalopeXx",
		"con",           // whole-word entry
		"c0n",           // leet, still whole-word
		"Nique ta mère", // a multi-word entry, matched on the whole nickname
		"niquetamere",
		"Хуй", // the Russian list: the alphabet is allowed, so the list must be
	}
	for _, n := range blocked {
		if _, err := ValidateNickname(n); !errors.Is(err, ErrNicknameBlocked) {
			t.Errorf("ValidateNickname(%q) = %v, want ErrNicknameBlocked", n, err)
		}
	}
}

func TestValidateNickname_AcceptsLegitimateNames(t *testing.T) {
	// The false-positive set. Every one of these contains a blocked term as a
	// substring once normalised, or reads like one.
	ok := []string{
		"Constance",
		"Connor",
		"Concepcion",
		"Bacon",
		"Falcon",
		"Deacon",
		"Dominique",
		"Monique",
		"Députe",
		"Réputation",
		"Scunthorpe",
		"Penistone",
		"Cockburn",
		"Nigeria",
		"Niger",
		"Nigerian",
		"Shitake",
		"Anna",
		"Cassandra",
		"Étienne",
		"Chloé",
		"Iñigo",
		"As",
		"Mr. Bean",
		"D'Artagnan",
		// The fixtures the test suites are written with. A filter that refused
		// one of these would take the E2E suite down with it.
		"Alice", "Bob", "Carol", "Host", "MobileAlice", "Player1", "Bot1",
	}
	for _, n := range ok {
		if _, err := ValidateNickname(n); err != nil {
			t.Errorf("ValidateNickname(%q) = %v, want accepted", n, err)
		}
	}
}

func TestNormalizeNickname(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"Alice", "alice"},
		{"Étienne", "etienne"},
		{"Álice", "alice"},
		{"J-e_a.n Luc", "jeanluc"},
		{"5h1t", "shit"},
		{"@rn4ud", "arnaud"},
	}
	for _, tc := range cases {
		if got := normalizeNickname(tc.in); got != tc.want {
			t.Errorf("normalizeNickname(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

// The embedded lists are the filter. An embed that resolved to nothing would
// leave every insult accepted and every other test in this file still passing.
func TestWordlistsAreEmbedded(t *testing.T) {
	if len(badWords) < 500 {
		t.Fatalf("badWords = %d entries, want the vendored LDNOOBW lists", len(badWords))
	}
	if len(badSubstrings) < 200 {
		t.Errorf("badSubstrings = %d entries, want the long terms of those lists", len(badSubstrings))
	}
}

// Every rejection reaches the player as one string, so the reason a nickname
// was refused stays on the server: a player who learns *which* rule fired
// learns how to walk around it.
func TestNicknameErrorsAreOneWireString(t *testing.T) {
	for _, err := range []error{ErrNicknameLength, ErrNicknameCharset, ErrNicknameBlocked} {
		if !errors.Is(err, ErrNicknameRejected) {
			t.Errorf("%v does not wrap ErrNicknameRejected", err)
		}
	}
}
