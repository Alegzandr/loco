package hub_test

import (
	"testing"

	"loco/server/protocol"
)

// A socket carries its seat in c.roomCode() / c.playerID(), but the table carries a
// pointer to that same socket in its members, indexed by seat. Nothing used
// to stop a seated client from sending create_room or join_room again: the two
// identities came apart, the pointer stayed in the old room at the old index,
// and every personalised broadcast for that room was then built from the *new*
// index. A player who had rebound to seat 0 elsewhere received seat 0's hand
// here, the whole hidden state of an opponent, on a socket that had done
// nothing more exotic than press "create room" twice.
//
// Both tests below fail without the guard in handleCreateRoom / handleJoinRoom.
// They are the refusal half; table_internal_test.go owns the other one, which
// is that binding a client to a seat leaves no pointer behind even when the
// refusal is not there to stop it.

func TestCreateRoom_RefusedWhileSeated_KeepsOpponentHandPrivate(t *testing.T) {
	t.Setenv("LOCO_E2E", "1")

	_, srv := newTestHub(t)
	alice := dialWS(t, srv)
	bob := dialWS(t, srv)
	t.Cleanup(func() { alice.Close(); bob.Close() })

	sendMsg(t, alice, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Alice"})
	created := readMsgOfType(t, alice, protocol.SMsgRoomCreated)
	code := created.RoomCode

	sendMsg(t, bob, protocol.ClientMsg{Type: protocol.CMsgJoinRoom, Nickname: "Bob", RoomCode: code})
	joined := readMsgOfType(t, bob, protocol.SMsgRoomJoined)
	bobSeat := joined.OwnSeat()
	if bobSeat != 1 {
		t.Fatalf("Bob joined second, expected seat 1, got %d", bobSeat)
	}
	aliceSeat := 0

	sendMsg(t, alice, protocol.ClientMsg{Type: protocol.CMsgStartGame})
	readMsgOfType(t, alice, protocol.SMsgGameStarted)
	readMsgOfType(t, bob, protocol.SMsgGameStarted)
	completeMapLoad(t, alice, bob)

	// The exploit: Bob, seated at 1 in this match, rebinds himself to seat 0 of
	// a throwaway room. His pointer stays at h.roomMembers[code][1].
	sendMsg(t, bob, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Mallory"})
	// Errorf, not Fatalf: the refusal and the disclosure are two separate
	// claims, and a regression that reopens the leak should say so rather than
	// stopping at the first symptom.
	if resp := readMsg(t, bob); resp.Type != protocol.SMsgError {
		t.Errorf("create_room while seated should be refused, got %q", resp.Type)
	}

	// Arm a Swap for Alice. A Swap is one of the two cards that force a
	// personalised game_state to the whole room (broadcastPersonalizedGameState),
	// which is the call that leaked. debug_set_state's own broadcast is not: it
	// has always indexed by slot, so routing the test through it would have
	// proved nothing.
	swap := protocol.CardDTO{Color: "red", Kind: "swap"}
	zero, dir := 0, 1
	sendMsg(t, alice, protocol.ClientMsg{
		Type: protocol.CMsgDebugSetState,
		Debug: &protocol.DebugStateDTO{
			Hand:        []protocol.CardDTO{swap, {Color: "red", Kind: "number", Value: 3}},
			Discard:     &protocol.CardDTO{Color: "red", Kind: "number", Value: 9},
			ActiveColor: "red",
			PendingDraw: &zero,
			CurrentTurn: &aliceSeat,
			Direction:   &dir,
		},
	})
	readMsgOfType(t, bob, protocol.SMsgGameState) // the debug broadcast, not under test

	// Alice swaps hands with Bob. Afterwards seat 0 holds Bob's 8 cards and
	// seat 1 holds Alice's remaining single card, so the two seats are telling
	// apart by hand size alone.
	sendMsg(t, alice, protocol.ClientMsg{
		Type: protocol.CMsgPlayCard, Card: &swap, ChosenPlayer: &bobSeat,
	})

	state := readMsgOfType(t, bob, protocol.SMsgGameState).State
	if state == nil {
		t.Fatal("missing state in game_state")
	}
	if state.YourIndex != bobSeat {
		t.Errorf("Bob's seat was rebound: your_index=%d, want %d", state.YourIndex, bobSeat)
	}
	// Receiving 8 cards here is receiving seat 0's hand: the disclosure itself.
	if len(state.Hand) != 1 {
		t.Fatalf("Bob was handed a %d-card hand; his own seat holds 1 after the swap: %+v",
			len(state.Hand), state.Hand)
	}
}

func TestJoinRoom_RefusedWhileSeated_KeepsHostSeat(t *testing.T) {
	_, srv := newTestHub(t)
	alice := dialWS(t, srv)
	bob := dialWS(t, srv)
	t.Cleanup(func() { alice.Close(); bob.Close() })

	sendMsg(t, alice, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Alice"})
	readMsgOfType(t, alice, protocol.SMsgRoomCreated)

	sendMsg(t, bob, protocol.ClientMsg{Type: protocol.CMsgCreateRoom, Nickname: "Bob"})
	other := readMsgOfType(t, bob, protocol.SMsgRoomCreated)

	// Alice, host of her own room, tries to take a seat in Bob's.
	sendMsg(t, alice, protocol.ClientMsg{
		Type: protocol.CMsgJoinRoom, Nickname: "Alice", RoomCode: other.RoomCode,
	})
	resp := readMsg(t, alice)
	if resp.Type != protocol.SMsgError {
		t.Fatalf("join_room while seated should be refused, got %q", resp.Type)
	}

	// She is still seat 0 of her own room, so a host-only action still works.
	// Rebinding would have made her seat 1 of Bob's room and this would come
	// back "only the room owner can add bots".
	sendMsg(t, alice, protocol.ClientMsg{Type: protocol.CMsgAddBot})
	if got := readMsg(t, alice); got.Type != protocol.SMsgPlayerJoined {
		t.Fatalf("Alice lost her host seat: add_bot answered %q (%s)", got.Type, got.Error)
	}
}
