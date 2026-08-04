package hub

import (
	"time"

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
//   - **Nothing is kept.** Not in the event log, not in the room, not in the
//     drain snapshot. An emote is broadcast, shown for a few seconds and
//     forgotten. The only state here is the last-sent stamp the throttle needs,
//     and it goes with the match.
//   - **The game-over screen and nowhere else.** Anywhere earlier it would be
//     something to do to somebody mid-round, which is the thing a reaction game
//     least needs.
//   - **A refusal answers its sender and nobody else.** Otherwise a refused
//     emote would be cheaper to send than an accepted one, which is the rule
//     every rate-limited message in this server is written to.
//   - **Never to or from a bot.** A seat the server plays does not have opinions
//     about the match, and it has no socket to receive one either.

// EmoteCooldown is how long a seat waits between two of them.
//
// The per-socket token bucket already bounds the traffic; this bounds the
// *screen*. Ten a second inside the bucket's budget would be a wall of pills
// over a scoreboard somebody is reading, which is spam whatever the byte count
// says. Two seconds is slower than anybody types and faster than anybody
// notices.
var EmoteCooldown = 2 * time.Second

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

	now := time.Now()
	if last, ok := t.emoteAt[seat]; ok && now.Sub(last) < EmoteCooldown {
		// Refused to its sender and to nobody else: a broadcast here would make
		// the refused emote the cheaper of the two.
		c.sendError("one at a time")
		return
	}
	t.emoteAt[seat] = now

	h.broadcastToRoomAll(t, protocol.ServerMsg{
		Type:        protocol.SMsgEmote,
		PlayerIndex: intPtr(seat),
		Emote:       msg.Emote,
	})
}
