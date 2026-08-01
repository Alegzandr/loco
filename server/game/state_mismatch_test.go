package game

import (
	"errors"
	"testing"
)

// The wire strings are what a player reads, resolved to localised copy by the
// client. Marking an error as a state mismatch must not touch a character of
// them, or serverErrors.ts stops recognising the refusal it was written for.
func TestStateMismatchErrors_KeepTheirWireText(t *testing.T) {
	cases := []struct {
		err  error
		want string
	}{
		{ErrNotYourTurn, "not your turn"},
		{ErrIllegalPlay, "illegal card play"},
		{ErrCardNotInHand, "card not in hand"},
		{ErrMustAnswerPenalty, "must counter or draw pending penalty cards first"},
	}
	for _, tc := range cases {
		if got := tc.err.Error(); got != tc.want {
			t.Errorf("error text = %q, want %q", got, tc.want)
		}
		if !IsStateMismatch(tc.err) {
			t.Errorf("IsStateMismatch(%q) = false, want true", tc.err)
		}
	}
}

// A lost race is not a mismatch: the client's board was right, it simply lost.
// Answering one with a personalised snapshot would put a full game_state on the
// wire every time an interject or a second draw arrives a beat late, which is
// exactly when the table is busiest.
func TestIsStateMismatch_ExcludesLostRaces(t *testing.T) {
	for _, err := range []error{
		ErrAlreadyDrawn,
		ErrMustDrawBeforePass,
		ErrInterruptWindowClosed,
		ErrInterruptMismatch,
		ErrInterruptNotADrawCard,
		ErrAlreadyDeclared,
		ErrCatchWindowExpired,
		ErrTargetNotSingleCard,
		errors.New("game not in progress"),
	} {
		if IsStateMismatch(err) {
			t.Errorf("IsStateMismatch(%q) = true, want false", err)
		}
	}
}

// The mismatch marker must not swallow the sentinel identity underneath it:
// callers still match on the specific error, and IsLostRace must keep working.
func TestStateMismatchErrors_StillMatchThemselves(t *testing.T) {
	if !errors.Is(ErrCardNotInHand, ErrCardNotInHand) {
		t.Error("ErrCardNotInHand no longer matches itself")
	}
	if IsLostRace(ErrIllegalPlay) {
		t.Error("IsLostRace(ErrIllegalPlay) = true, want false")
	}
}

// PlayCard's own refusals are what the hub reads to decide on a resync, so pin
// them to the sentinels rather than to their text.
func TestPlayCard_RefusalsAreStateMismatches(t *testing.T) {
	r := setupTwoPlayerGame(t)
	me := r.State.CurrentTurn
	other := (me + 1) % len(r.State.Hands)

	if err := r.PlayCard(other, r.State.Hands[other].Cards[0], Wild, -1); !errors.Is(err, ErrNotYourTurn) {
		t.Errorf("out-of-turn play = %v, want ErrNotYourTurn", err)
	}

	// A card that is in nobody's hand: the deck ships one coloured Swap per
	// colour, so a second copy of the same one cannot be held.
	ghost := Card{Color: Red, Kind: Number, Value: 9}
	r.State.Hands[me] = Hand{Cards: []Card{{Color: Blue, Kind: Number, Value: 1}}}
	if err := r.PlayCard(me, ghost, Wild, -1); !errors.Is(err, ErrCardNotInHand) {
		t.Errorf("playing a card we do not hold = %v, want ErrCardNotInHand", err)
	}

	// Blue 1 on a red 3 with red active: no colour, no kind, no value.
	r.State.Discard = []Card{{Color: Red, Kind: Number, Value: 3}}
	r.State.ActiveColor = Red
	if err := r.PlayCard(me, r.State.Hands[me].Cards[0], Wild, -1); !errors.Is(err, ErrIllegalPlay) {
		t.Errorf("off-colour play = %v, want ErrIllegalPlay", err)
	}

	r.State.PendingDraw = 2
	if err := r.PlayCard(me, r.State.Hands[me].Cards[0], Wild, -1); !errors.Is(err, ErrMustAnswerPenalty) {
		t.Errorf("play under a pending stack = %v, want ErrMustAnswerPenalty", err)
	}
}
