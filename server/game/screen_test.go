package game

import "testing"

// The matcher itself is covered by nickname_test.go. What this file owns is
// the part that is new: that the exported door answers for a name this game
// did not create, and that it is the *matcher* it shares rather than the seat
// label's charset — which is the mistake that would have refused half of
// Twitch.
func TestContainsBlockedTerm(t *testing.T) {
	cases := []struct {
		name    string
		in      string
		blocked bool
	}{
		{"a plain channel name", "kisuke_sama", false},
		{"a blocked term on its own", "fuck", true},
		{"a blocked term dressed up", "xXfuckXx", true},
		{"the Scunthorpe allowlist still applies", "scunthorpe", false},
		{"a real surname carrying a long entry", "Bordeleau", false},
		{"empty", "", false},
		// The reason this is not ValidateNickname: none of these is a legal
		// seat label, and all three are legal Twitch logins.
		{"digits and underscores", "l0co_9000", false},
		{"twenty-five characters", "abcdefghijklmnopqrstuvwxy", false},
		{"a login that is only digits", "123456", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := ContainsBlockedTerm(c.in); got != c.blocked {
				t.Fatalf("ContainsBlockedTerm(%q) = %v, want %v", c.in, got, c.blocked)
			}
		})
	}
}
