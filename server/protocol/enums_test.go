package protocol_test

import (
	"fmt"
	"slices"
	"testing"

	"loco/server/game"
	"loco/server/protocol"
)

// The wire enums in enums.go are a second spelling of the domain's own, and a
// second spelling is a mirror. They exist because messages.go is the source the
// TypeScript client is generated from: a bare `string` there generates a bare
// `string`, throwing away a narrowing the hand-written client always had.
//
// These tests walk the domain instead of listing it. A hand-written list here
// would be a third copy, and it would go on passing the day somebody adds a
// colour to game/card.go.

// enumProbeCeiling bounds the walks below so a String() that stops saying
// "unknown" fails the test rather than hanging it.
const enumProbeCeiling = 64

// domainStrings walks a domain enum up from zero until String() stops
// recognising a value, which is how game/card.go spells "past the end".
func domainStrings(t *testing.T, what string, str func(int) string) []string {
	t.Helper()
	var out []string
	for i := 0; i < enumProbeCeiling; i++ {
		s := str(i)
		if s == "unknown" {
			if len(out) == 0 {
				t.Fatalf("%s: nothing at all was recognised, the walk is reading the wrong enum", what)
			}
			return out
		}
		out = append(out, s)
	}
	t.Fatalf("%s: no value below %d fell off the end; String() no longer returns %q past the last one",
		what, enumProbeCeiling, "unknown")
	return nil
}

// assertSameSet is deliberately two-directional. A wire value the domain cannot
// produce is dead weight the generator would put in front of every client; a
// domain value with no wire constant is the one that costs a match, because the
// server marshals it anyway and the generated client refuses the whole message.
func assertSameSet(t *testing.T, what string, domain, wire []string) {
	t.Helper()
	for _, d := range domain {
		if !slices.Contains(wire, d) {
			t.Errorf("%s: the domain produces %q and no wire constant carries it: "+
				"the server will marshal it and a generated client will refuse the message", what, d)
		}
	}
	for _, w := range wire {
		if !slices.Contains(domain, w) {
			t.Errorf("%s: wire constant %q is not a value the domain can produce", what, w)
		}
	}
}

func TestCardColors_CoverTheDomain(t *testing.T) {
	domain := domainStrings(t, "color", func(i int) string { return game.Color(i).String() })

	wire := make([]string, len(protocol.AllCardColors))
	for i, c := range protocol.AllCardColors {
		wire[i] = string(c)
	}
	assertSameSet(t, "color", domain, wire)
}

func TestCardKinds_CoverTheDomain(t *testing.T) {
	domain := domainStrings(t, "kind", func(i int) string { return game.Kind(i).String() })

	wire := make([]string, len(protocol.AllCardKinds))
	for i, k := range protocol.AllCardKinds {
		wire[i] = string(k)
	}
	assertSameSet(t, "kind", domain, wire)
}

// MatchFormat has no String() and its values are not contiguous (1, 3, 5, 7),
// so the domain half is derived from the one rule that decides which of them
// are real: what Room.SetFormat agrees to accept.
func TestMatchFormats_CoverTheDomain(t *testing.T) {
	var domain []string
	for i := 0; i < enumProbeCeiling; i++ {
		r := game.NewRoom("TEST12")
		if err := r.SetFormat(game.MatchFormat(i)); err != nil {
			continue
		}
		domain = append(domain, fmt.Sprintf("BO%d", i))
	}
	if len(domain) == 0 {
		t.Fatal("match format: SetFormat accepted nothing, the probe is reading the wrong enum")
	}

	wire := make([]string, len(protocol.AllMatchFormats))
	for i, f := range protocol.AllMatchFormats {
		wire[i] = string(f)
	}
	assertSameSet(t, "match format", domain, wire)
}

// A constant left out of its All* slice would be invisible here, because the
// wire half of every check above is built from the slice. That case is caught
// by the generator instead: it reads the const block, reads the slice, and
// refuses to emit anything if the two disagree. Both halves are Go, so the
// comparison is exact rather than a count somebody has to keep up to date.
