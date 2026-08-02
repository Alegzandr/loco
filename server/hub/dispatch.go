// Inbound routing: the recover and the not-playing gate every message passes,
// the nickname gate, and the budget a wrong table code is spent from.
package hub

import (
	"log"
	"runtime/debug"
	"time"

	"loco/server/game"
	"loco/server/protocol"
)

// failedJoinWindow is the span MaxFailedJoins is counted over.
var failedJoinWindow = time.Minute

// maxJoinBudgets is when the budget map is swept of expired entries. One entry
// per network that has ever missed, so it is bounded by the sweep, not by the
// number of networks.
const maxJoinBudgets = 4096

// dispatch routes a client message to the appropriate handler.
//
// Replay protection: the protocol carries no nonces or sequence numbers.
// Replay defense is implicit in every gameplay handler — they validate
// against current authoritative state (CurrentTurn, top discard, PendingDraw,
// Hands[*].Contains, LastCardTime catch window, RoundEnded, MatchOver). A
// captured-and-replayed message will fail one of these checks the moment
// state has advanced past it, with the existing "not your turn" / "card not
// in hand" / "catch window expired" / "game not in progress" error responses.
// All identity fields (playerID, roomCode) are server-assigned at registration
// and never sourced from msg, so a replayed envelope cannot impersonate.
func (h *Hub) dispatch(c *Client, msg protocol.ClientMsg) {
	// One message must never be able to cost the server.
	//
	// Every inbound message is handled on the single event-loop goroutine, so a
	// panic anywhere below this line was the whole process: every match on it
	// ended mid-turn, no drain, no snapshot, and the players were told "room not
	// found" when they came back. Two frames did it (create_room then draw_card:
	// room.State is nil in a lobby and handleDrawCard read it before checking the
	// status), and the next such bug would have cost exactly the same.
	//
	// So the blast radius of a handler bug is one message and one WARN. This is
	// not a licence to skip the guard below or the bounds checks in
	// playerGameStateUsing: it is the floor under them.
	defer func() {
		if r := recover(); r != nil {
			h.metrics.handlerPanics.Add(1)
			log.Printf("WARN handler panic recovered type=%s conn=%s code=%s player=%d panic=%v\n%s",
				msg.Type, c.connID, c.roomCode, c.playerID, r, debug.Stack())
			c.sendError("server error")
		}
	}()
	if h.dispatchProbe != nil {
		h.dispatchProbe()
	}

	// A gameplay message only means something at a table that has dealt.
	//
	// room.State is nil in a lobby (game.NewRoom) and again after a rematch
	// (Room.ResetForRematch). Most handlers delegate straight to a domain call
	// that checks Status first, but handleDrawCard and handleCatchUno both read
	// State to size a hand *before* refusing, which is a nil dereference an
	// unauthenticated stranger could reach in two messages. Gating the whole
	// class here rather than patching those two is deliberate: the next handler
	// to read State before validating is covered without anybody remembering.
	if isGameplayMsg(msg.Type) {
		t, ok := h.requireTable(c)
		if !ok {
			return // requireTable has already said which of the two it was
		}
		if t.room.Status != game.StatusPlaying || t.room.State == nil {
			c.sendError("game not in progress")
			return
		}
		// The table is shut while the room downloads its map. Refusing gameplay
		// here rather than trusting the client's own loading screen is the whole
		// point of the gate: a client that skipped it would otherwise be the only
		// one able to act, in a game whose reaction windows are decided by
		// arrival order.
		if t.isLoading() {
			c.sendError("waiting for every player to load the table")
			return
		}
	}

	switch msg.Type {
	case protocol.CMsgMapReady:
		h.handleMapReady(c)
	case protocol.CMsgCreateRoom:
		h.handleCreateRoom(c, msg)
	case protocol.CMsgJoinRoom:
		h.handleJoinRoom(c, msg)
	case protocol.CMsgStartGame:
		h.handleStartGame(c, msg)
	case protocol.CMsgAddBot:
		h.handleAddBot(c, msg)
	case protocol.CMsgSetMatchFormat:
		h.handleSetMatchFormat(c, msg)
	case protocol.CMsgSetMaxPlayers:
		h.handleSetMaxPlayers(c, msg)
	case protocol.CMsgKickPlayer:
		h.handleKickPlayer(c, msg)
	case protocol.CMsgRematch:
		h.handleRematch(c, msg)
	case protocol.CMsgFindMatch:
		h.handleFindMatch(c, msg)
	case protocol.CMsgCancelMatchmaking:
		h.handleCancelMatchmaking(c)
	case protocol.CMsgLeaveRoom:
		h.handleLeaveRoom(c)
	case protocol.CMsgPlayCard:
		h.resetAFK(c)
		h.handlePlayCard(c, msg)
	case protocol.CMsgDrawCard:
		h.resetAFK(c)
		h.handleDrawCard(c, msg)
	case protocol.CMsgPassTurn:
		h.resetAFK(c)
		h.handlePassTurn(c, msg)
	case protocol.CMsgDeclareUno:
		h.resetAFK(c)
		h.handleDeclareUno(c, msg)
	case protocol.CMsgCatchUno:
		h.resetAFK(c)
		h.handleCatchUno(c, msg)
	case protocol.CMsgCounterDraw:
		h.resetAFK(c)
		h.handleCounterDraw(c, msg)
	case protocol.CMsgInterruptPlay, protocol.CMsgInterruptPlayCard:
		h.resetAFK(c)
		h.handleInterruptPlay(c, msg)
	case protocol.CMsgDebugSetState:
		h.handleDebugSetState(c, msg)
	default:
		c.sendError("unknown message type")
	}
}

// validateNickname canonicalises and checks an inbound nickname through
// game.ValidateNickname. Returns the canonical form on success, or sends an
// error to the client and returns "".
//
// The refusal is one string for every rule the domain has (length, charset,
// blocked term) because the player is deliberately never told which one fired:
// see server/game/nickname.go. The reason is kept for the log line, without the
// nickname itself, which is a string somebody chose and no operator needs.
func validateNickname(c *Client, raw string) string {
	n, err := game.ValidateNickname(raw)
	if err != nil {
		log.Printf("nickname refused conn=%s reason=%v", c.connID, err)
		c.sendError(game.ErrNicknameRejected.Error())
		return ""
	}
	return n
}

// joinBudget is one network's recent tally of table codes that led nowhere.
type joinBudget struct {
	count       int
	windowStart time.Time
}

// joinThrottled reports whether this connection's network has spent its
// wrong-code budget for the current window.
//
// Keyed by network prefix rather than by socket, because a socket is free: a
// sweeper reconnects between attempts and a per-connection counter would only
// have measured its patience. The prefix is the same truncated one the logs
// carry (truncateAddr), so nothing here holds an address the rest of the server
// has already decided not to keep.
func (h *Hub) joinThrottled(c *Client) bool {
	b, ok := h.joinBudgets[c.netKey]
	if !ok {
		return false
	}
	if time.Since(b.windowStart) > failedJoinWindow {
		delete(h.joinBudgets, c.netKey)
		return false
	}
	return b.count >= MaxFailedJoins
}

// noteFailedJoin charges one wrong code against this connection's network.
func (h *Hub) noteFailedJoin(c *Client) {
	now := time.Now()
	b, ok := h.joinBudgets[c.netKey]
	if !ok || now.Sub(b.windowStart) > failedJoinWindow {
		if len(h.joinBudgets) >= maxJoinBudgets {
			h.sweepJoinBudgets(now)
		}
		h.joinBudgets[c.netKey] = &joinBudget{count: 1, windowStart: now}
		return
	}
	b.count++
	if b.count == MaxFailedJoins {
		log.Printf("WARN table code sweep suspected conn=%s addr=%s attempts=%d",
			c.connID, c.netKey, b.count)
	}
}

// sweepJoinBudgets drops the windows that have expired. Called only when the
// map has grown past maxJoinBudgets, so the ordinary path stays a single lookup.
func (h *Hub) sweepJoinBudgets(now time.Time) {
	for key, b := range h.joinBudgets {
		if now.Sub(b.windowStart) > failedJoinWindow {
			delete(h.joinBudgets, key)
		}
	}
}

// alreadySeated reports whether this socket already holds a seat, and is the
// guard on both room-entry handlers.
//
// A seat lives in two places at once: the socket knows it as c.roomCode /
// c.playerID, and the table knows it as the *Client pointer at index playerID
// in its members. Re-entering a room used to move only the first. The pointer
// stayed behind at the old index while c.playerID named a seat in the new room,
// and every personalised broadcast for the old room
// (broadcastPersonalizedGameState, the per-recipient game_started of a new
// round) was then built from the wrong index. A player seated at 1 who rebound
// to 0 elsewhere was handed seat 0's hand here, which is the entire hidden
// state the server exists to keep.
//
// table.seat is what makes that unreachable now rather than merely refused, so
// this check is the polite half: it answers the client instead of silently
// moving them. See table_internal_test.go.
//
// The stale slot also never empties, so the room outlives its players and the
// abandoned seat never opens its reconnect window.
//
// Reconnects do not come through here: they arrive on a fresh socket, whose
// roomCode is still "". A room that no longer exists is not a seat, so a client
// left pointing at a deleted room is released rather than locked out.
func (h *Hub) alreadySeated(c *Client) bool {
	if c.roomCode == "" {
		return false
	}
	if _, ok := h.tables[c.roomCode]; !ok {
		c.roomCode = ""
		c.playerID = 0
		return false
	}
	return true
}
