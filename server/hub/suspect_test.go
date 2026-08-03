package hub

import (
	"errors"
	"fmt"
	"testing"

	"loco/server/game"
)

// suspected_cheats is a pointer for an operator, not a scoreboard of how
// contested the table was. LOCO decides interrupts by arrival order and catches
// on a five-second window, so a good player loses those races constantly.
func TestNoteRejection_LostRacesAreNotSuspicious(t *testing.T) {
	h := New()
	c := &Client{hub: h}

	lost := []error{
		game.ErrAlreadyDrawn,
		game.ErrMustDrawBeforePass,
		game.ErrInterruptWindowClosed,
		game.ErrInterruptMismatch,
		game.ErrInterruptNotADrawCard,
		game.ErrAlreadyDeclared,
	}
	// Well past suspectThreshold, several times over.
	for i := 0; i < suspectThreshold*3; i++ {
		c.noteRejection(lost[i%len(lost)])
	}
	if got := h.metrics.suspectedCheats.Load(); got != 0 {
		t.Errorf("suspected_cheats = %d after %d lost races, want 0", got, suspectThreshold*3)
	}
}

// The metric must still do its job. An illegal card is not a race: the client
// decides legality before it sends, so a stream of them is a client that is not
// ours.
func TestNoteRejection_StillCatchesRealRejections(t *testing.T) {
	h := New()
	c := &Client{hub: h}

	for i := 0; i < suspectThreshold; i++ {
		c.noteRejection(errors.New("illegal card play"))
	}
	if got := h.metrics.suspectedCheats.Load(); got != 1 {
		t.Errorf("suspected_cheats = %d, want 1", got)
	}
}

// A wrapped sentinel is the same sentinel. Anything that reaches for the error
// string instead breaks the first time a message is reworded.
func TestNoteRejection_MatchesWrappedSentinels(t *testing.T) {
	h := New()
	c := &Client{hub: h}

	for i := 0; i < suspectThreshold*2; i++ {
		c.noteRejection(fmt.Errorf("play_card: %w", game.ErrInterruptMismatch))
	}
	if got := h.metrics.suspectedCheats.Load(); got != 0 {
		t.Errorf("suspected_cheats = %d, want 0 for a wrapped lost race", got)
	}
}

func TestNoteRejection_NilIsNotARejection(t *testing.T) {
	h := New()
	c := &Client{hub: h}
	for i := 0; i < suspectThreshold*2; i++ {
		c.noteRejection(nil)
	}
	if got := h.metrics.suspectedCheats.Load(); got != 0 {
		t.Errorf("suspected_cheats = %d, want 0", got)
	}
}
