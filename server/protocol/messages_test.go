package protocol

import (
	"encoding/json"
	"strings"
	"testing"
)

func seat(v int) *int { return &v }

// Seat 0 is the host's seat — the most occupied seat in the game — and it used
// to vanish on the wire: `PlayerIndex int` carried `omitempty`, which drops a
// zero. The client closes the catch window on the seat named by uno_declared,
// so a missing player_index closed nothing: Contre-LOCO! stayed armed for the
// full 5 s on a player who had already called it, and every tap came back
// "player already declared".
//
// Same trap the PendingDraw/HasDrawn pointers exist for.
func TestServerMsg_SeatZeroSurvivesTheWire(t *testing.T) {
	types := []ServerMsgType{
		SMsgUnoDeclared,
		SMsgUnoCaught,
		SMsgCardPlayed,
		SMsgCardDrawn,
		SMsgInterruptSuccess,
		SMsgPlayerDisconnected,
		SMsgPlayerReconnected,
	}
	for _, typ := range types {
		data, err := json.Marshal(ServerMsg{Type: typ, PlayerIndex: seat(0)})
		if err != nil {
			t.Fatalf("marshal %s: %v", typ, err)
		}
		if !strings.Contains(string(data), `"player_index":0`) {
			t.Errorf("%s dropped seat 0 from the wire: %s", typ, data)
		}
	}
}

// A message that names no seat must not claim seat 0 either — the client reads
// an absent player_index as "this message is not about a player".
func TestServerMsg_NoSeatStaysAbsent(t *testing.T) {
	data, err := json.Marshal(ServerMsg{Type: SMsgError, Error: "not your turn"})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if strings.Contains(string(data), "player_index") {
		t.Errorf("seatless message carries a player_index: %s", data)
	}
}

func TestServerMsg_Seat(t *testing.T) {
	if got := (ServerMsg{Type: SMsgError}).Seat(); got != -1 {
		t.Errorf("Seat() on a seatless message = %d, want -1", got)
	}
	if got := (ServerMsg{Type: SMsgUnoDeclared, PlayerIndex: seat(0)}).Seat(); got != 0 {
		t.Errorf("Seat() = %d, want 0", got)
	}
}
