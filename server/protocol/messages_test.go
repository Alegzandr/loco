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

// The same trap on the field naming the recipient's OWN seat, which this test
// did not cover the first time round. It hid for longer because the client's
// `?? 0` fallback agreed with the dropped value in every case that existed then:
// the host is seat 0 on room_created, so absent and default said the same thing.
// A tab reloading straight into a match has no earlier value to fall back on, so
// a dropped player_id seats the restored client at -1 with a hand it cannot
// match to anything on the board.
func TestServerMsg_OwnSeatZeroSurvivesTheWire(t *testing.T) {
	types := []ServerMsgType{
		SMsgRoomCreated,
		SMsgRoomJoined,
		SMsgPlayerReconnected,
		SMsgRematchStarted,
	}
	for _, typ := range types {
		data, err := json.Marshal(ServerMsg{Type: typ, PlayerID: seat(0)})
		if err != nil {
			t.Fatalf("marshal %s: %v", typ, err)
		}
		if !strings.Contains(string(data), `"player_id":0`) {
			t.Errorf("%s dropped own seat 0 from the wire: %s", typ, data)
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

// The same trap, one field over. A zero turn is seat 0's turn, and a zero
// drawn_count is a draw against exhausted piles — which the client's fallback
// would have read as one card, growing a hand the server never grew.
func TestServerMsg_ZeroTurnAndDrawnCountSurviveTheWire(t *testing.T) {
	data, err := json.Marshal(ServerMsg{Type: SMsgCardDrawn, PlayerIndex: seat(0), Turn: 0, DrawnCount: 0})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	for _, want := range []string{`"turn":0`, `"drawn_count":0`} {
		if !strings.Contains(string(data), want) {
			t.Errorf("card_drawn dropped %s from the wire: %s", want, data)
		}
	}
}

// TurnDeadline is the one field here where a zero really is an absence, and it
// must stay omitempty for that reason: the client reads `turn_deadline ?? null`
// and mounts its countdown bar on any non-null value, so a zero left on the wire
// would render a bar counting down from 1970. A bot's turn has no clock and is
// broadcast exactly this way: see TestTurnDeadline_AbsentDuringBotTurn.
func TestServerMsg_ZeroTurnDeadlineStaysOffTheWire(t *testing.T) {
	data, err := json.Marshal(ServerMsg{Type: SMsgCardPlayed, PlayerIndex: seat(0), Turn: 1, TurnDeadline: 0})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if strings.Contains(string(data), `"turn_deadline"`) {
		t.Errorf("a zero turn_deadline reached the wire, so the client's null fallback never fires: %s", data)
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

func TestServerMsg_OwnSeat(t *testing.T) {
	if got := (ServerMsg{Type: SMsgError}).OwnSeat(); got != -1 {
		t.Errorf("OwnSeat() on a message assigning no seat = %d, want -1", got)
	}
	if got := (ServerMsg{Type: SMsgRoomCreated, PlayerID: seat(0)}).OwnSeat(); got != 0 {
		t.Errorf("OwnSeat() = %d, want 0", got)
	}
}
