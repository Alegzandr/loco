package hub_test

import (
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"loco/server/protocol"
)

// assertNoMessage is the negative read every "refused to its sender alone" test
// in this suite ends on. It ends the test on purpose: a read that times out
// leaves a gorilla connection permanently broken.
func assertNoMessage(t *testing.T, conn *websocket.Conn) {
	t.Helper()
	conn.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
	if _, _, err := conn.ReadMessage(); err == nil {
		t.Error("a refusal reached the rest of the table")
	}
}

// Three fixed things, on the game-over screen and nowhere else.
//
// Every test here is a refusal, which is most of what the feature is: a closed
// set, one screen, one at a time, and a refusal that costs its sender a message
// and everybody else nothing.

func TestEmote_ReachesTheWholeTableOnceTheMatchIsOver(t *testing.T) {
	conn1, conn2, _ := winBO1(t)

	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgSendEmote, Emote: protocol.EmoteGG})
	for i, conn := range []*websocket.Conn{conn1, conn2} {
		got := readMsgOfType(t, conn, protocol.SMsgEmote)
		if got.Seat() != 0 {
			t.Errorf("client %d: emote seat = %d, want 0", i, got.Seat())
		}
		if got.Emote != protocol.EmoteGG {
			t.Errorf("client %d: emote = %q, want gg", i, got.Emote)
		}
	}
}

// The set is the server's. A client cannot invent a fourth, and the one it made
// up is refused rather than relayed.
func TestEmote_RefusesAnIdentifierItDoesNotKnow(t *testing.T) {
	conn1, conn2, _ := winBO1(t)

	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgSendEmote, Emote: "ez"})
	if got := readMsgOfType(t, conn1, protocol.SMsgError); got.Error != "unknown emote" {
		t.Errorf("error = %q, want the unknown-emote refusal", got.Error)
	}
	// And the table hears nothing at all. The negative read ends this test on
	// purpose: a read that times out leaves a gorilla connection broken.
	assertNoMessage(t, conn2)
}

// Mid-round it would be something to do to somebody, which is the thing a
// reaction game least needs.
func TestEmote_RefusedBeforeTheMatchIsOver(t *testing.T) {
	conns, _ := openTable(t, "Alice", "Bob", "Carol")

	sendMsg(t, conns[0], protocol.ClientMsg{Type: protocol.CMsgSendEmote, Emote: protocol.EmoteGG})
	if got := readMsgOfType(t, conns[0], protocol.SMsgError); got.Error != "emotes are only for the end of a match" {
		t.Errorf("error = %q, want the wrong-screen refusal", got.Error)
	}
	assertNoMessage(t, conns[1])
}

// A refused emote must not be cheaper to send than an accepted one: the cap
// answers its sender and broadcasts nothing.
func TestEmote_ThrottledPerSeat(t *testing.T) {
	conn1, conn2, _ := winBO1(t)

	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgSendEmote, Emote: protocol.EmoteGG})
	readMsgOfType(t, conn1, protocol.SMsgEmote)
	readMsgOfType(t, conn2, protocol.SMsgEmote)

	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgSendEmote, Emote: protocol.EmoteNice})
	if got := readMsgOfType(t, conn1, protocol.SMsgError); got.Error != "one at a time" {
		t.Errorf("error = %q, want the cooldown refusal", got.Error)
	}
	assertNoMessage(t, conn2)
}

// The other seat is not throttled by the first one's press: the cap is per seat,
// not per table.
func TestEmote_TheOtherSeatIsNotThrottledByIt(t *testing.T) {
	conn1, conn2, _ := winBO1(t)

	sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgSendEmote, Emote: protocol.EmoteGG})
	readMsgOfType(t, conn1, protocol.SMsgEmote)
	readMsgOfType(t, conn2, protocol.SMsgEmote)

	sendMsg(t, conn2, protocol.ClientMsg{Type: protocol.CMsgSendEmote, Emote: protocol.EmoteClose})
	got := readMsgOfType(t, conn2, protocol.SMsgEmote)
	if got.Seat() != 1 || got.Emote != protocol.EmoteClose {
		t.Errorf("emote = seat %d %q, want seat 1 close", got.Seat(), got.Emote)
	}
	readMsgOfType(t, conn1, protocol.SMsgEmote)
}
