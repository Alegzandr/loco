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
	// Every inbound message used to be handled on the single event-loop
	// goroutine, so a panic anywhere below this line was the whole process:
	// every match on it ended mid-turn, no drain, no snapshot, and the players
	// were told "room not found" when they came back. Two frames did it
	// (create_room then draw_card: room.State is nil in a lobby and
	// handleDrawCard read it before checking the status), and the next such bug
	// would have cost exactly the same.
	//
	// This recover now covers the routing and the handlers that stay on the hub;
	// runJob in actor.go is the same floor under the ones a table runs. Either
	// way the blast radius of a handler bug is one message and one WARN, and
	// neither is a licence to skip the guards below or the bounds checks in
	// playerGameStateUsing.
	defer func() {
		if r := recover(); r != nil {
			h.metrics.handlerPanics.Add(1)
			log.Printf("WARN handler panic recovered type=%s conn=%s code=%s player=%d panic=%v\n%s",
				msg.Type, c.connID, c.roomCode(), c.playerID(), r, debug.Stack())
			c.sendError("server error")
		}
	}()
	if h.dispatchProbe != nil {
		h.dispatchProbe()
	}

	// map_ready is the one message with no table behind it that is not a
	// mistake: a duplicate answer, or one that lost the race with the loading
	// timeout, is the client telling us something we no longer need. Refusing it
	// would be answering a correct client with an error. Everything else about
	// it is an ordinary table message.
	if msg.Type == protocol.CMsgMapReady && h.tableOf(c) == nil {
		return
	}

	// A message that acts on the sender's own table has that table resolved
	// once, here, and handed to the handler. Nothing below looks a table up:
	// a handler that could reach h.tables by code is a handler that can reach
	// somebody else's, which is the one thing the table object exists to make
	// unreachable rather than merely refused.
	if tableScoped(msg.Type) {
		t, ok := h.requireTable(c)
		if !ok {
			return // requireTable has already said which of the two it was
		}
		// The table runs it, not this goroutine. Full box means that one table
		// is behind, and only its own players are told so: the same policy the
		// hub's single inbound queue had, now scoped to the room it describes.
		if !t.post(tableJob{what: string(msg.Type), c: c, run: func() {
			h.dispatchAtTable(t, c, msg)
		}}) {
			h.metrics.messagesDroppedBusy.Add(1)
			log.Printf("table box full, dropping message type=%s conn=%s code=%s",
				msg.Type, c.connID, t.code)
			c.sendError("server busy, please retry")
		}
		return
	}
	h.dispatchWithoutTable(c, msg)
}

// dispatchAtTable routes the messages that act on one table, the sender's own.
// It runs on that table's goroutine.
func (h *Hub) dispatchAtTable(t *table, c *Client, msg protocol.ClientMsg) {
	if h.tableProbe != nil {
		h.tableProbe(t.code)
	}
	// The message was routed here while the sender was sitting at this table.
	// Between the routing and now the seat can have been given up, held or
	// re-based, and the socket can even be sitting somewhere else. So the claim
	// is re-checked against the table about to act on it: a playerID that means
	// one seat here and a different one there is the hidden-state guarantee
	// coming apart, and it is the reason a seat is one atomic value.
	if c.roomCode() != t.code {
		return
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
	gameplay := isGameplayMsg(msg.Type)
	if gameplay {
		if t.room.Status != game.StatusPlaying || t.room.State == nil {
			c.sendError("game not in progress")
			return
		}
		// And the seat has to be one this deal has a hand for.
		//
		// The gate above closed "State is nil"; this closes the other half of the
		// same class. handleDrawCard sizes a hand before it validates anything,
		// and DeclareLastCard, CatchUndeclared and InterruptPlayCards all index
		// State.Hands by the sender's seat on their way in, so a seat number that
		// outran the deal is a nil-adjacent panic in four places rather than one.
		// It is unreachable today — a seat is only ever dropped in a lobby or a
		// finished room — and that is exactly the argument the last gap here was
		// written on. Gating the class costs one comparison and does not have to
		// be re-derived every time a seat learns a new way to move.
		if seat := c.playerID(); seat < 0 || seat >= len(t.room.State.Hands) {
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

	// An action the server takes clears the seat's consecutive-timeout count.
	// One the server refuses does not, and that is the whole of the fix: this
	// used to run here, before the handler, on every gameplay message whatever
	// became of it. So one declare_uno per turn — refused every time, a seat
	// holding five cards cannot declare — bought permanent immunity from the AFK
	// threshold, and in a matchmade room the AFK threshold is the only thing
	// standing between a stranger and an opponent who has walked away. Sending a
	// message proves a socket is alive; it does not prove anybody is playing.
	//
	// The refusal count is read as a before/after pair rather than reported by
	// each handler, because sendError is already the single funnel every refusal
	// goes through and a handler added later cannot forget to use it.
	before := c.refusals.Load()
	defer func() {
		if gameplay && c.refusals.Load() == before {
			h.resetAFK(t, c)
		}
	}()

	switch msg.Type {
	case protocol.CMsgMapReady:
		h.handleMapReady(t, c)
	case protocol.CMsgStartGame:
		h.handleStartGame(t, c, msg)
	case protocol.CMsgAddBot:
		h.handleAddBot(t, c, msg)
	case protocol.CMsgSetMatchFormat:
		h.handleSetMatchFormat(t, c, msg)
	case protocol.CMsgSetMaxPlayers:
		h.handleSetMaxPlayers(t, c, msg)
	case protocol.CMsgSetStreamerMode:
		h.handleSetStreamerMode(t, c, msg)
	case protocol.CMsgKickPlayer:
		h.handleKickPlayer(t, c, msg)
	case protocol.CMsgTransferHost:
		h.handleTransferHost(t, c, msg)
	case protocol.CMsgRematch:
		h.handleRematch(t, c, msg)
	case protocol.CMsgSendEmote:
		h.handleSendEmote(t, c, msg)
	case protocol.CMsgPlayCard:
		h.handlePlayCard(t, c, msg)
	case protocol.CMsgDrawCard:
		h.handleDrawCard(t, c, msg)
	case protocol.CMsgPassTurn:
		h.handlePassTurn(t, c, msg)
	case protocol.CMsgDeclareUno:
		h.handleDeclareUno(t, c, msg)
	case protocol.CMsgCatchUno:
		h.handleCatchUno(t, c, msg)
	case protocol.CMsgCounterDraw:
		h.handleCounterDraw(t, c, msg)
	case protocol.CMsgInterruptPlay, protocol.CMsgInterruptPlayCard:
		h.handleInterruptPlay(t, c, msg)
	case protocol.CMsgDebugSetState:
		h.handleDebugSetState(t, c, msg)
	}
}

// dispatchWithoutTable routes the rest: the messages sent by somebody who has
// no table yet, and the ones that touch more than one thing the hub owns.
func (h *Hub) dispatchWithoutTable(c *Client, msg protocol.ClientMsg) {
	switch msg.Type {
	case protocol.CMsgCreateRoom:
		h.handleCreateRoom(c, msg)
	case protocol.CMsgJoinRoom:
		h.handleJoinRoom(c, msg)
	case protocol.CMsgFindMatch:
		h.handleFindMatch(c, msg)
	case protocol.CMsgPlayBot:
		h.handlePlayBot(c, msg)
	case protocol.CMsgCancelMatchmaking:
		h.handleCancelMatchmaking(c)
	case protocol.CMsgLeaveRoom:
		h.handleLeaveRoom(c)
	default:
		c.sendError("unknown message type")
	}
}

// tableScoped reports whether a message acts on the table its sender is already
// sitting at, and nothing else. Those are the ones the table resolves for.
//
// leave_room is deliberately not one of them: it empties the matchmaking queue
// as well as a seat, and create_room / join_room / find_match / play_bot are the
// messages sent by somebody who has no table for this to find.
func tableScoped(t protocol.ClientMsgType) bool {
	switch t {
	case protocol.CMsgMapReady,
		protocol.CMsgStartGame,
		protocol.CMsgAddBot,
		protocol.CMsgSetMatchFormat,
		protocol.CMsgSetMaxPlayers,
		protocol.CMsgSetStreamerMode,
		protocol.CMsgKickPlayer,
		protocol.CMsgTransferHost,
		protocol.CMsgRematch,
		protocol.CMsgSendEmote,
		protocol.CMsgDebugSetState:
		return true
	}
	return isGameplayMsg(t)
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
// A seat lives in two places at once: the socket knows it as c.roomCode() /
// c.playerID(), and the table knows it as the *Client pointer at index playerID
// in its members. Re-entering a room used to move only the first. The pointer
// stayed behind at the old index while c.playerID() named a seat in the new room,
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
	if c.roomCode() == "" {
		return false
	}
	if _, ok := h.tables[c.roomCode()]; !ok {
		c.leaveSeat()
		return false
	}
	return true
}
