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
// Most of what the feature is, is a refusal: a closed set, one screen, and a
// refusal that costs its sender a message and everybody else nothing. What is
// deliberately *not* refused is a seat changing its mind — as often as it likes.

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

// A seat changes its mind as often as it likes, and the table sees every change.
//
// This used to be the cooldown test. The screen never needed one — a seat's pill
// is replaced rather than added to, so three presses in a second are one pill
// changing its word — and what the cap actually cost was the gesture the feature
// exists for: press "gg", think better of it, press "close one". The traffic is
// bounded by the per-client token bucket, like every other message on the socket.
func TestEmote_ChangesAsOftenAsTheSeatLikes(t *testing.T) {
	conn1, conn2, _ := winBO1(t)

	for _, want := range []protocol.Emote{protocol.EmoteGG, protocol.EmoteLucky, protocol.EmoteClose, protocol.EmoteGG} {
		sendMsg(t, conn1, protocol.ClientMsg{Type: protocol.CMsgSendEmote, Emote: want})
		for i, conn := range []*websocket.Conn{conn1, conn2} {
			got := readMsgOfType(t, conn, protocol.SMsgEmote)
			if got.Seat() != 0 || got.Emote != want {
				t.Errorf("client %d: emote = seat %d %q, want seat 0 %q", i, got.Seat(), got.Emote, want)
			}
		}
	}
}

// Two seats, back to back: neither is ever waiting on the other.
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
