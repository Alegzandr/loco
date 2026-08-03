// debug_set_state, the fixture the Playwright suite deals a table with. Gated
// on LOCO_E2E and reported by /metrics as debug_mode_active. Name the variable
// correctly here: this line is what an auditor reads to find the gate, and it
// said LOCO_DEBUG — a variable nothing in the server has ever read — which
// sends anyone checking whether the gate is closed in production to grep for
// the wrong string and find it absent everywhere, including where it is set.
package hub

import (
	"fmt"
	"os"

	"loco/server/game"
	"loco/server/protocol"
)

// handleDebugSetState is a dev-only handler that lets E2E tests inject specific game
// state (hand, discard, pending draw, active color, turn, direction) without relying
// on deck randomness or on what the bots happened to play first.
//
// It is only active when the LOCO_E2E environment variable is set to "1".  In all
// other environments the message is rejected with an error, making it impossible to
// exploit in production.
//
// Any combination of the debug fields may be provided; omitted fields are left
// unchanged.  After applying the overrides the handler broadcasts a personalised
// game_state message to every connected player in the room so all clients reflect
// the new state.
func (h *Hub) handleDebugSetState(t *table, c *Client, msg protocol.ClientMsg) {
	if os.Getenv("LOCO_E2E") != "1" {
		c.sendError("debug commands are not enabled")
		return
	}
	room := t.room
	if room.Status != game.StatusPlaying {
		c.sendError("debug_set_state requires an active game")
		return
	}

	// A message with no debug object at all is not an error: every field is
	// optional, so an empty payload means "change nothing and resend the state",
	// which is a legitimate way for a fixture to force a resync.
	d := msg.Debug
	if d == nil {
		d = &protocol.DebugStateDTO{}
	}

	playerID := c.playerID()
	state := room.State
	parseHand := func(cards []protocol.CardDTO) (game.Hand, error) {
		newHand := game.Hand{}
		for _, dto := range cards {
			col, err := parseColor(dto.Color)
			if err != nil {
				return game.Hand{}, fmt.Errorf("bad color %q: %w", dto.Color, err)
			}
			kind, err := parseKind(dto.Kind)
			if err != nil {
				return game.Hand{}, fmt.Errorf("bad kind %q: %w", dto.Kind, err)
			}
			newHand.Add(game.Card{Color: col, Kind: kind, Value: dto.Value})
		}
		return newHand, nil
	}

	// Replace this player's hand.
	if len(d.Hand) > 0 {
		newHand, err := parseHand(d.Hand)
		if err != nil {
			c.sendError(fmt.Sprintf("debug.hand: %v", err))
			return
		}
		state.Hands[playerID] = newHand
	}

	// Replace any explicitly targeted players' hands.
	if len(d.Hands) > 0 {
		for _, override := range d.Hands {
			if override.PlayerIndex < 0 || override.PlayerIndex >= len(state.Hands) {
				c.sendError(fmt.Sprintf("debug.hands: invalid player_index %d", override.PlayerIndex))
				return
			}
			newHand, err := parseHand(override.Hand)
			if err != nil {
				c.sendError(fmt.Sprintf("debug.hands[%d]: %v", override.PlayerIndex, err))
				return
			}
			state.Hands[override.PlayerIndex] = newHand
		}
	}

	// Replace top of discard pile and optionally the active color.
	if d.Discard != nil {
		col, err := parseColor(d.Discard.Color)
		if err != nil {
			c.sendError(fmt.Sprintf("debug.discard: bad color %q: %v", d.Discard.Color, err))
			return
		}
		kind, err := parseKind(d.Discard.Kind)
		if err != nil {
			c.sendError(fmt.Sprintf("debug.discard: bad kind %q: %v", d.Discard.Kind, err))
			return
		}
		card := game.Card{Color: col, Kind: kind, Value: d.Discard.Value}
		if len(state.Discard) == 0 {
			state.Discard = []game.Card{card}
		} else {
			state.Discard[len(state.Discard)-1] = card
		}
		// Active color: use explicit override if provided; otherwise derive from card.
		if d.ActiveColor != "" {
			activeCol, err := parseColor(d.ActiveColor)
			if err != nil {
				c.sendError(fmt.Sprintf("debug.active_color: %v", err))
				return
			}
			state.ActiveColor = activeCol
		} else if col != game.Wild {
			state.ActiveColor = col
		}
	}

	// Override pending draw count.
	if d.PendingDraw != nil {
		state.PendingDraw = *d.PendingDraw
	}

	// Override the play direction. A test that reasons about "the next seat" has
	// no other way to pin it: the bots play before the local player's first turn,
	// and one Reverse among them silently mirrors the whole table.
	if d.Direction != nil {
		if *d.Direction != 1 && *d.Direction != -1 {
			c.sendError(fmt.Sprintf("debug.direction: must be 1 or -1, got %d", *d.Direction))
			return
		}
		state.Direction = *d.Direction
	}

	// Override current turn.
	if d.CurrentTurn != nil {
		if *d.CurrentTurn < 0 || *d.CurrentTurn >= len(state.Hands) {
			c.sendError(fmt.Sprintf("debug.current_turn: invalid index %d", *d.CurrentTurn))
			return
		}
		state.CurrentTurn = *d.CurrentTurn
		state.HasDrawn = false
	}

	// Broadcast personalised game_state to every connected player.
	pl := h.playerList(t)
	for i, member := range t.members {
		if member != nil {
			member.Send(protocol.ServerMsg{
				Type:  protocol.SMsgGameState,
				State: h.playerGameStateUsing(t, i, pl),
			})
		}
	}
}
