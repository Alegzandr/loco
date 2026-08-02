package hub

import (
	"strings"
	"testing"

	"loco/server/protocol"
)

// The tables below stay `string` rather than the wire types on purpose: half
// their cases are values the wire types cannot hold ("purple", "BO2", ""), and
// refusing those is the whole job of the functions under test. The conversion
// happens at the call site, which is also where it happens in production.

func TestParseColor(t *testing.T) {
	cases := []struct {
		in      string
		wantErr bool
	}{
		{"red", false},
		{"RED", false},
		{"yellow", false},
		{"green", false},
		{"blue", false},
		{"wild", false},
		{"", false},
		{"purple", true},
		{"unknown", true},
	}
	for _, c := range cases {
		_, err := parseColor(protocol.CardColor(c.in))
		if (err != nil) != c.wantErr {
			t.Errorf("parseColor(%q): got err=%v, wantErr=%v", c.in, err, c.wantErr)
		}
	}
}

func TestParseKind(t *testing.T) {
	cases := []struct {
		in      string
		wantErr bool
	}{
		{"number", false},
		{"skip", false},
		{"reverse", false},
		{"draw_two", false},
		{"wild", false},
		{"wild_draw_four", false},
		{"WILD_DRAW_FOUR", false},
		{"invalid", true},
		{"", true},
	}
	for _, c := range cases {
		_, err := parseKind(protocol.CardKind(c.in))
		if (err != nil) != c.wantErr {
			t.Errorf("parseKind(%q): got err=%v, wantErr=%v", c.in, err, c.wantErr)
		}
	}
}

func TestValidRoomCode(t *testing.T) {
	cases := []struct {
		in   string
		want bool
	}{
		{"ABCDEF", true},
		{"ABC234", true},   // digits 2-9 are valid
		{"ABC123", false},  // '1' is excluded from charset
		{"abcdef", true},   // ToUpper normalizes valid chars
		{"ABCDE", false},   // 5 chars
		{"ABCDEFG", false}, // 7 chars
		{"ABCDE0", false},  // contains '0' (excluded)
		{"ABCDEI", false},  // contains 'I' (excluded)
		{"ABCDE1", false},  // contains '1' (excluded)
		{"ABCDEO", false},  // contains 'O' (excluded)
		{"", false},
	}
	for _, c := range cases {
		got := validRoomCode(c.in)
		if got != c.want {
			t.Errorf("validRoomCode(%q) = %v, want %v", c.in, got, c.want)
		}
	}
}

func TestParseMatchFormat(t *testing.T) {
	valid := []string{"BO1", "BO3", "BO5", "BO7", "bo1", "bo3"}
	for _, s := range valid {
		if _, err := parseMatchFormat(protocol.MatchFormat(s)); err != nil {
			t.Errorf("parseMatchFormat(%q) unexpected error: %v", s, err)
		}
	}
	invalid := []string{"BO2", "BO4", "BO9", "", "best-of-3"}
	for _, s := range invalid {
		if _, err := parseMatchFormat(protocol.MatchFormat(s)); err == nil {
			t.Errorf("parseMatchFormat(%q) expected error, got nil", s)
		}
	}
}

func TestMatchFormatString(t *testing.T) {
	cases := []struct{ in, want string }{
		{"BO1", "BO1"},
		{"BO3", "BO3"},
		{"BO5", "BO5"},
		{"BO7", "BO7"},
	}
	for _, c := range cases {
		f, _ := parseMatchFormat(protocol.MatchFormat(c.in))
		if got := matchFormatString(f); string(got) != c.want {
			t.Errorf("matchFormatString(%v) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestValidRoomCode_Charset(t *testing.T) {
	// All excluded chars should fail
	excluded := []string{"0", "O", "1", "I"}
	for _, ch := range excluded {
		code := "ABCDE" + ch
		if validRoomCode(code) {
			t.Errorf("validRoomCode(%q) should be false (excluded char %q)", code, ch)
		}
	}
	// All 32 valid chars should pass when padded
	charset := "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	if !validRoomCode(strings.Repeat(string(charset[0]), 6)) {
		t.Errorf("validRoomCode with valid chars should be true")
	}
}
