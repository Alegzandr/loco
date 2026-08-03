package hub_test

import (
	"testing"

	"loco/server/protocol"
)

// The host is seat 0 and nothing else, so handing the table over is a swap of
// two seats. Everything keyed by a seat moves with it, and the two players who
// moved are each told their own new index — a broadcast would leave them reading
// somebody else's row as their own.
func TestTransferHost_SwapsTheSeatsAndTheControls(t *testing.T) {
	_, srv := newTestHub(t)
	host, guests, _ := setupLobby(t, srv, "Bob", "Carol")

	sendMsg(t, host, protocol.ClientMsg{Type: protocol.CMsgTransferHost, TargetIndex: intPtrTest(1)})

	// The old host is seat 1 now, and hears so.
	mine := readMsgOfType(t, host, protocol.SMsgHostChanged)
	if mine.OwnSeat() != 1 {
		t.Errorf("Alice seat after the transfer = %d, want 1", mine.OwnSeat())
	}
	if mine.Nickname != "Bob" {
		t.Errorf("host_changed names %q, want Bob", mine.Nickname)
	}
	if len(mine.Players) != 3 || mine.Players[0].Nickname != "Bob" || mine.Players[1].Nickname != "Alice" {
		t.Fatalf("roster after the transfer = %+v, want Bob then Alice", mine.Players)
	}

	// The new host is seat 0, and hears the same message with their own index.
	theirs := readMsgOfType(t, guests[0], protocol.SMsgHostChanged)
	if theirs.OwnSeat() != 0 {
		t.Errorf("Bob seat after the transfer = %d, want 0", theirs.OwnSeat())
	}

	// A seat that did not move is told anyway: the badge moved on their screen
	// too, and Carol is still seat 2.
	carol := readMsgOfType(t, guests[1], protocol.SMsgHostChanged)
	if carol.OwnSeat() != 2 {
		t.Errorf("Carol seat after the transfer = %d, want 2", carol.OwnSeat())
	}

	// The controls went with the seat, both ways.
	sendMsg(t, host, protocol.ClientMsg{Type: protocol.CMsgAddBot})
	if got := readMsgOfType(t, host, protocol.SMsgError); got.Error != "only the room owner can add bots" {
		t.Errorf("the old host's add_bot answered %q, want the host-only refusal", got.Error)
	}
	sendMsg(t, guests[0], protocol.ClientMsg{Type: protocol.CMsgStartGame})
	if gs := readMsgOfType(t, guests[0], protocol.SMsgGameStarted); gs.State == nil {
		t.Fatal("game_started missing state — the new host cannot deal")
	}
}

// A bot cannot press start, so a table handed to one is a table that can never
// deal. This is the same invariant keepHostHuman exists for, on the one path
// that would otherwise walk straight past it.
func TestTransferHost_RefusedToABot(t *testing.T) {
	_, srv := newTestHub(t)
	host, _, _ := setupLobby(t, srv, "Bob")

	sendMsg(t, host, protocol.ClientMsg{Type: protocol.CMsgAddBot})
	readMsgOfType(t, host, protocol.SMsgPlayerJoined)

	sendMsg(t, host, protocol.ClientMsg{Type: protocol.CMsgTransferHost, TargetIndex: intPtrTest(2)})
	if got := readMsgOfType(t, host, protocol.SMsgError); got.Error != "a bot cannot host the table" {
		t.Errorf("error = %q, want the bot refusal", got.Error)
	}

	// And the table is still Alice's.
	sendMsg(t, host, protocol.ClientMsg{Type: protocol.CMsgStartGame})
	if gs := readMsgOfType(t, host, protocol.SMsgGameStarted); gs.State == nil {
		t.Fatal("game_started missing state — the refused transfer took the table anyway")
	}
}

// It is the host's table, and only the host's.
func TestTransferHost_RefusedForAGuest(t *testing.T) {
	_, srv := newTestHub(t)
	_, guests, _ := setupLobby(t, srv, "Bob", "Carol")

	sendMsg(t, guests[0], protocol.ClientMsg{Type: protocol.CMsgTransferHost, TargetIndex: intPtrTest(2)})
	if got := readMsgOfType(t, guests[0], protocol.SMsgError); got.Error != "only the room owner can hand over the table" {
		t.Errorf("error = %q, want the host-only refusal", got.Error)
	}
}

// Seat 0 is the sender's own by the host check, and a seat number off the end of
// the roster is a client inventing one. Both answer the same string, like every
// other index refusal on this table.
func TestTransferHost_RefusedOnAnImpossibleSeat(t *testing.T) {
	_, srv := newTestHub(t)
	host, _, _ := setupLobby(t, srv, "Bob")

	for _, seat := range []int{-1, 0, 2, 99} {
		sendMsg(t, host, protocol.ClientMsg{Type: protocol.CMsgTransferHost, TargetIndex: intPtrTest(seat)})
		if got := readMsgOfType(t, host, protocol.SMsgError); got.Error != "invalid player index" {
			t.Errorf("seat %d answered %q, want invalid player index", seat, got.Error)
		}
	}
	sendMsg(t, host, protocol.ClientMsg{Type: protocol.CMsgTransferHost})
	if got := readMsgOfType(t, host, protocol.SMsgError); got.Error != "invalid player index" {
		t.Errorf("a transfer naming nobody answered %q, want invalid player index", got.Error)
	}
}

// Once the cards are out a seat belongs to a match, not to the roster: swapping
// two would swap two hands. Same rule as the kick.
func TestTransferHost_RefusedOnceTheCardsAreOut(t *testing.T) {
	_, srv := newTestHub(t)
	host, guests, _ := setupLobby(t, srv, "Bob")

	sendMsg(t, host, protocol.ClientMsg{Type: protocol.CMsgStartGame})
	readMsgOfType(t, host, protocol.SMsgGameStarted)
	readMsgOfType(t, guests[0], protocol.SMsgGameStarted)
	completeMapLoad(t, host, guests[0])

	sendMsg(t, host, protocol.ClientMsg{Type: protocol.CMsgTransferHost, TargetIndex: intPtrTest(1)})
	if got := readMsgOfType(t, host, protocol.SMsgError); got.Error != "can only hand over the table in the lobby" {
		t.Errorf("error = %q, want the lobby-only refusal", got.Error)
	}
}

// The session token is the proof a seat is yours, so it travels with the player
// and not with the index. Left behind, it would hand a reloading player the
// other one's seat — which on this table is the host's.
func TestTransferHost_TheTokenFollowsThePlayer(t *testing.T) {
	_, srv := newTestHub(t)
	host, guests, code := setupLobby(t, srv, "Bob")

	sendMsg(t, host, protocol.ClientMsg{Type: protocol.CMsgTransferHost, TargetIndex: intPtrTest(1)})
	readMsgOfType(t, host, protocol.SMsgHostChanged)
	readMsgOfType(t, guests[0], protocol.SMsgHostChanged)

	// Bob owns the table now. Alice leaves and comes back: the seat she is given
	// is a fresh one at the end, and the table is still Bob's.
	sendMsg(t, host, protocol.ClientMsg{Type: protocol.CMsgLeaveRoom})
	readMsgOfType(t, host, protocol.SMsgLeftRoom)
	readMsgOfType(t, guests[0], protocol.SMsgPlayerLeft)

	back := dialWS(t, srv)
	defer back.Close()
	sendMsg(t, back, protocol.ClientMsg{Type: protocol.CMsgJoinRoom, Nickname: "Alice", RoomCode: code})
	joined := readMsgOfType(t, back, protocol.SMsgRoomJoined)
	if joined.OwnSeat() != 1 {
		t.Fatalf("Alice rejoined at seat %d, want 1", joined.OwnSeat())
	}
	if joined.Players[0].Nickname != "Bob" {
		t.Fatalf("roster = %+v, want Bob still hosting", joined.Players)
	}
	readMsgOfType(t, guests[0], protocol.SMsgPlayerJoined)

	sendMsg(t, guests[0], protocol.ClientMsg{Type: protocol.CMsgStartGame})
	if gs := readMsgOfType(t, guests[0], protocol.SMsgGameStarted); gs.State == nil {
		t.Fatal("game_started missing state — the new host lost the table to a rejoin")
	}
}

// A matchmade table has no host: nobody opened it and nobody owns it.
func TestTransferHost_RefusedInAMatchmadeRoom(t *testing.T) {
	_, srv := newTestHub(t)
	a, b := dialWS(t, srv), dialWS(t, srv)
	defer a.Close()
	defer b.Close()
	sendMsg(t, a, protocol.ClientMsg{Type: protocol.CMsgFindMatch, Nickname: "Alice"})
	readMsgOfType(t, a, protocol.SMsgMatchmakingQueued)
	sendMsg(t, b, protocol.ClientMsg{Type: protocol.CMsgFindMatch, Nickname: "Bob"})
	readMsgOfType(t, a, protocol.SMsgMatchFound)
	readMsgOfType(t, b, protocol.SMsgMatchFound)

	sendMsg(t, a, protocol.ClientMsg{Type: protocol.CMsgTransferHost, TargetIndex: intPtrTest(1)})
	if got := readMsgOfType(t, a, protocol.SMsgError); got.Error == "" {
		t.Fatal("a transfer in a matchmade room was accepted")
	}
}
