// Rematch is an ask, not a decision: every seat gets the same button, and two
// asks — one player offering, another accepting — deal the next match.
package hub

import (
	"log"
	"sort"

	"loco/server/game"
	"loco/server/protocol"
)

// handleRematch records this seat's ask for another match, and deals one as
// soon as RematchQuorum asks are in.
//
// It used to be the host's decision, and it is an agreement in every room now,
// for the reason it already was one between two strangers: nobody at a table
// owes anybody else another twenty minutes. The host has standing over the
// format and the size, which are things about a table that has not dealt yet;
// they have none over whether four people want to keep playing. So the button
// is an offer on every screen, the offers are public, and the ask is what the
// next match is dealt from. See openRematchedLobby / startRematchedMatch for
// the two shapes that deal takes.
func (h *Hub) handleRematch(t *table, c *Client, msg protocol.ClientMsg) {
	room := t.room
	// A matchmade rematch deals immediately, and an ordinary one leads to a
	// start_game the drain is going to refuse anyway. Refusing here is the
	// honest version of both.
	if h.refuseWhileDraining(c) {
		return
	}
	if room.Status != game.StatusFinished {
		c.sendError("rematch is only available once the match is over")
		return
	}
	// The one table where the ask has no addressee. A solo game is one human and
	// one bot: the quorum would be one, so the "agreement" would be a decision
	// wearing an agreement's clothes, and the deal it triggered would drop the
	// player into a lobby this mode has no host to start. Another one is another
	// play_bot, which is what the game-over screen sends.
	if t.solo {
		c.sendError("not available in this game")
		return
	}
	// A matchmade table is two strangers and nothing else. Once one of them has
	// gone there is nobody to agree with, and the survivor's client requeues
	// rather than waiting on an answer that cannot come. An ordinary table has
	// no such floor: whoever is left may reopen the room and wait there.
	if t.isMatchmade() && (len(room.Players) < 2 || t.connected() < 2) {
		c.sendError("your opponent has left the table")
		return
	}

	// An ask is a set membership, so asking twice changes nothing — but it used
	// to be republished anyway, which turned one socket at the rate limit into
	// ten broadcasts a second to every seat at the table. Answered the same way
	// map_ready is: the second one is not an error, it is simply already true.
	if _, already := t.rematchOffers[c.playerID()]; already {
		return
	}
	t.rematchOffers[c.playerID()] = struct{}{}
	h.broadcastRematchOffers(t, intPtr(c.playerID()))
	if len(t.rematchOffers) < t.rematchQuorum() {
		return
	}
	h.dealAgreedRematch(t)
}

// RematchQuorum is how many asks deal the next match: one offers, another
// accepts, and that is two people who want to keep playing.
//
// It used to be every human still connected, which at a table of five handed
// the evening to whoever was slowest to look at their screen: four players
// ready, one silent, and the button read "waiting on the table" until they
// answered or their socket dropped. Two is what a match needs in order to be a
// match — WalkOutFloor says the same thing about one already running — so two
// is what it takes to deal one. **Nobody is left out by it**: an ordinary table
// reopens as its lobby with everybody still sitting at it, so the players who
// had not answered are in the waiting room rather than out of the game, and the
// deal is still the host's press.
const RematchQuorum = 2

// rematchQuorum is how many asks it takes at this table: two, or everybody
// there is when the table is smaller than that. Bots are not asked, and a seat
// inside its reconnect window is not waited for — it left a room that is over,
// and holding the others there until a timer expires would be the one thing
// this screen must never do.
func (t *table) rematchQuorum() int {
	n := t.connected()
	if n < 1 {
		return 1
	}
	if n < RematchQuorum {
		return n
	}
	return RematchQuorum
}

// broadcastRematchOffers publishes the whole offer state. The list travels
// rather than the increment because a seat leaving retires its offer and
// re-bases the rest: a client accumulating names would keep a departed player's
// ask forever. seat names whoever just asked, and is nil when the change was a
// departure.
func (h *Hub) broadcastRematchOffers(t *table, seat *int) {
	offers := make([]int, 0, len(t.rematchOffers))
	for id := range t.rematchOffers {
		offers = append(offers, id)
	}
	sort.Ints(offers)
	h.broadcastToRoomAll(t, protocol.ServerMsg{
		Type:          protocol.SMsgRematchOffered,
		PlayerIndex:   seat,
		RematchOffers: &offers,
		RematchNeeded: t.rematchQuorum(),
	})
}

// dealAgreedRematch runs the deal everybody has now asked for. The two shapes
// are genuinely different: a matchmade pair goes straight back into a match
// through the pairing path, and an ordinary table returns to its lobby, where
// the host still owns the format, the size and the start.
func (h *Hub) dealAgreedRematch(t *table) {
	if t.isMatchmade() {
		h.startRematchedMatch(t)
		return
	}
	h.openRematchedLobby(t)
}

// openRematchedLobby reopens a finished room as a lobby so the same group can
// play again without recreating the room and re-sharing the code. Players who
// never came back from a mid-match disconnect are pruned first, so the next
// match is dealt only to people who are actually present.
func (h *Hub) openRematchedLobby(t *table) {
	code, room := t.code, t.room
	// Read before the prune and before the reset, both of which re-base the
	// seats these asks are keyed by: what the promotion below needs is the
	// people who asked, not the seat numbers they had when they pressed.
	askers := t.rematchAskers()
	h.pruneAbsentPlayers(t)

	if err := room.ResetForRematch(); err != nil {
		log.Printf("WARN rematch reset failed code=%s err=%v", code, err)
		return
	}
	h.promoteRematchHost(t, askers)
	// The prune can slide a bot into seat 0 on its own when nobody who asked is
	// still here, and the host must be somebody who can press start.
	h.keepHostHuman(t)
	t.resetForNextMatch()

	log.Printf("rematch opened code=%s players=%d format=%s",
		code, len(room.Players), matchFormatString(room.Format))

	// Sent per-recipient: pruning may have shifted playerIDs, and each client
	// needs its own new index to render the waiting room correctly.
	for _, member := range t.members {
		if member == nil {
			continue
		}
		member.Send(protocol.ServerMsg{
			Type:        protocol.SMsgRematchStarted,
			RoomCode:    code,
			PlayerID:    intPtr(member.playerID()),
			Players:     h.playerList(t),
			MatchFormat: matchFormatString(room.Format),
			MaxPlayers:  room.MaxPlayers,
		})
	}
}

// rematchAskers is the sockets behind the current asks, in seat order — which
// at a table is the order they arrived in. Seats with nobody behind them are
// left out: an ask whose socket has gone cannot host anything.
func (t *table) rematchAskers() []*Client {
	seats := make([]int, 0, len(t.rematchOffers))
	for id := range t.rematchOffers {
		seats = append(seats, id)
	}
	sort.Ints(seats)
	askers := make([]*Client, 0, len(seats))
	for _, id := range seats {
		if c := t.client(id); c != nil {
			askers = append(askers, c)
		}
	}
	return askers
}

// promoteRematchHost hands the reopened table to somebody who asked for it.
//
// Two asks deal a match now, so the lobby that reopens is easily one seat 0
// never asked for: the host said nothing, or they left mid-match and the prune
// took their seat, or what slid into 0 behind them is a bot. Seat 0 owns the
// format, the size and the press that starts the match, so leaving it there is
// a room full of players who agreed to play again waiting on the one person who
// did not — the exact wait this quorum exists to end.
//
// The new host is the earliest-seated asker, so the badge lands on whoever has
// been at this table longest rather than on whoever happened to press first.
// Nothing moves when the host asked, which is the ordinary case.
func (h *Hub) promoteRematchHost(t *table, askers []*Client) {
	room := t.room
	if len(room.Players) == 0 {
		return
	}
	if host := t.client(0); host != nil && !t.isBot(0) {
		for _, c := range askers {
			if c == host {
				return
			}
		}
	}
	for _, c := range askers {
		seat := c.playerID()
		if seat <= 0 || seat >= len(room.Players) || t.isBot(seat) {
			continue
		}
		nickname := room.Players[seat].Nickname
		if err := room.SwapLobbyPlayers(0, seat); err != nil {
			log.Printf("WARN rematch host promotion failed code=%s seat=%d err=%v", t.code, seat, err)
			return
		}
		// The seat-keyed halves move together, tokens included, exactly as they
		// do for transfer_host: the players are swapped, not renamed.
		t.swapSeats(0, seat)
		log.Printf("rematch host promoted code=%s seat=%d nickname=%s", t.code, seat, nickname)
		return
	}
}

// releaseRematchOffer retires the offer of a seat that has just left a finished
// room and re-bases the seats above it, exactly as every other playerID-keyed
// structure is re-based. Called after the departure has been applied.
//
// The deal it can trigger is the point rather than a side effect: a table of
// four where three had asked was waiting on one player, and that player leaving
// answers the question. Nobody is left staring at a button that will never
// complete.
func (h *Hub) releaseRematchOffer(t *table, seat int) {
	if len(t.rematchOffers) == 0 {
		return
	}
	t.rematchOffers = shiftIntKeySet(t.rematchOffers, seat)

	// A matchmade table cannot fill the gap: there is no lobby to wait in and
	// the survivor's client goes back to the queue. Nothing to publish.
	if t.room.Status != game.StatusFinished || t.isMatchmade() {
		t.rematchOffers = make(map[int]struct{})
		return
	}
	h.broadcastRematchOffers(t, nil)
	if n := len(t.rematchOffers); n > 0 && n >= t.rematchQuorum() {
		h.dealAgreedRematch(t)
	}
}

// retireRematchOffer drops the ask of a seat that is still at the table but no
// longer connected: a socket that went on the game-over screen, whose seat is
// being held rather than removed.
//
// Nothing is re-based here, and that is the whole difference from
// releaseRematchOffer: the seat keeps its index, because it is coming back or
// it is not, and the expiry decides. What goes is the ask and the quorum it was
// part of — a seat that is not there is not waited on — which is why this can
// complete an agreement on the spot exactly as a departure does.
func (h *Hub) retireRematchOffer(t *table, seat int) {
	if len(t.rematchOffers) == 0 {
		return
	}
	delete(t.rematchOffers, seat)
	if t.room.Status != game.StatusFinished || t.isMatchmade() {
		return
	}
	h.broadcastRematchOffers(t, nil)
	if n := len(t.rematchOffers); n > 0 && n >= t.rematchQuorum() {
		h.dealAgreedRematch(t)
	}
}

// pruneAbsentPlayers drops every seat with neither a live connection nor a bot
// behind it, re-indexing all playerID-keyed structures. Iterates high→low so
// each removal only shifts indices already processed.
func (h *Hub) pruneAbsentPlayers(t *table) {
	for id := len(t.members) - 1; id >= 0; id-- {
		if t.members[id] != nil || t.isBot(id) {
			continue
		}
		if _, err := t.room.RemoveLobbyPlayer(id); err != nil {
			log.Printf("WARN prune failed code=%s player=%d err=%v", t.code, id, err)
			continue
		}
		t.dropSeat(id)
		log.Printf("pruned absent player code=%s player=%d", t.code, id)
	}
}
