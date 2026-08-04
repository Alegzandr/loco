package hub

import (
	"loco/server/game"
	"loco/server/protocol"
)

// The three things a player can say, and the whole vocabulary the game has.
//
// After a close 1v1 against a stranger there was no way to say anything at all
// — not "good game", not anything. Three fixed emotes is the smallest thing
// that fixes that, and the smallest is the point: free text would be a
// moderation surface, and "we collect nothing" is the compliance strategy
// rather than an accident.
//
// Five properties, and every one of them is a refusal:
//
//   - **The set is closed and server-side** (`protocol.AllEmotes`). An
//     identifier this server does not know is refused, never relayed, so a
//     client cannot invent a fourth.
//   - **Nothing is kept at all.** Not in the event log, not in the room, not in
//     the drain snapshot, and not here either: an emote is broadcast, shown and
//     forgotten, and this file holds no state of any kind.
//   - **The game-over screen and nowhere else.** Anywhere earlier it would be
//     something to do to somebody mid-round, which is the thing a reaction game
//     least needs.
//   - **A refusal answers its sender and nobody else.** Otherwise a refused
//     emote would be cheaper to send than an accepted one, which is the rule
//     every rate-limited message in this server is written to.
//   - **Never to or from a bot.** A seat the server plays does not have opinions
//     about the match, and it has no socket to receive one either.
//
// And one thing that is deliberately *not* a refusal: **a seat changes its mind
// as often as it likes.** There was a two-second per-seat cooldown here, and it
// was answering a problem the screen does not have — the client *replaces* what
// a seat is saying rather than adding to it, so a seat pressing all three in a
// second is one pill changing its word, never a feed growing under the two
// offers and the way out. What the cap actually cost was the one gesture the
// feature exists for: pressing "gg", thinking better of it, and pressing "close
// one". That is a change of mind, and it arrived as a refusal. The traffic is
// bounded where every other message on this socket is bounded, by the per-client
// token bucket (10/s, burst 20); a second, narrower ceiling said nothing the
// first one did not.

// handleSendEmote relays one of the three, or refuses to its sender alone.
func (h *Hub) handleSendEmote(t *table, c *Client, msg protocol.ClientMsg) {
	if t.room.Status != game.StatusFinished {
		c.sendError("emotes are only for the end of a match")
		return
	}
	if !protocol.ValidEmote(msg.Emote) {
		// Not a lost race and not a player mistake: a correct client only ever
		// sends one of three identifiers it did not choose.
		c.sendError("unknown emote")
		c.noteSuspect("unknown emote")
		return
	}
	seat := c.playerID()
	// Unreachable — a bot has no socket to send from — and written down because
	// the rule is about the seat rather than about the transport, and a future
	// bot that could talk should be refused by this line rather than by luck.
	if t.isBot(seat) {
		return
	}

	h.broadcastToRoomAll(t, protocol.ServerMsg{
		Type:        protocol.SMsgEmote,
		PlayerIndex: intPtr(seat),
		Emote:       msg.Emote,
	})
}
