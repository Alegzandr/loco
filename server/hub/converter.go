package hub

import (
	"fmt"
	"regexp"
	"strings"

	"loco/server/game"
	"loco/server/protocol"
)

// --- DTO conversion ---

func cardToDTO(c game.Card) *protocol.CardDTO {
	return &protocol.CardDTO{
		Color: colorName(c.Color),
		Kind:  c.Kind.String(),
		Value: c.Value,
	}
}

func dtoToCard(dto *protocol.CardDTO, chosenColorStr string) (game.Card, game.Color, error) {
	col, err := parseColor(dto.Color)
	if err != nil {
		return game.Card{}, 0, err
	}
	kind, err := parseKind(dto.Kind)
	if err != nil {
		return game.Card{}, 0, err
	}
	chosen := col
	if dto.Color == "wild" || dto.Color == "" {
		chosen, err = parseColor(chosenColorStr)
		if err != nil {
			return game.Card{}, 0, fmt.Errorf("chosen_color required for wild: %w", err)
		}
	}
	return game.Card{Color: col, Kind: kind, Value: dto.Value}, chosen, nil
}

func colorName(c game.Color) string { return c.String() }

func parseColor(s string) (game.Color, error) {
	switch strings.ToLower(s) {
	case "red":
		return game.Red, nil
	case "yellow":
		return game.Yellow, nil
	case "green":
		return game.Green, nil
	case "blue":
		return game.Blue, nil
	case "wild", "":
		return game.Wild, nil
	}
	return 0, fmt.Errorf("unknown color: %q", s)
}

func parseKind(s string) (game.Kind, error) {
	switch strings.ToLower(s) {
	case "number":
		return game.Number, nil
	case "skip":
		return game.Skip, nil
	case "reverse":
		return game.Reverse, nil
	case "draw_two":
		return game.DrawTwo, nil
	case "wild":
		return game.WildCard, nil
	case "wild_draw_four":
		return game.WildDrawFour, nil
	}
	return 0, fmt.Errorf("unknown kind: %q", s)
}

func matchFormatString(f game.MatchFormat) string {
	switch f {
	case game.BO1:
		return "BO1"
	case game.BO3:
		return "BO3"
	case game.BO5:
		return "BO5"
	case game.BO7:
		return "BO7"
	}
	return "BO1"
}

func parseMatchFormat(s string) (game.MatchFormat, error) {
	switch strings.ToUpper(s) {
	case "BO1":
		return game.BO1, nil
	case "BO3":
		return game.BO3, nil
	case "BO5":
		return game.BO5, nil
	case "BO7":
		return game.BO7, nil
	}
	return 0, fmt.Errorf("invalid match format %q: must be BO1, BO3, BO5, or BO7", s)
}

// --- Broadcast helpers ---

// broadcastCardPlayed sends a card_played event for the top discard card to all room members.
func (h *Hub) broadcastCardPlayed(code string, playerID int, state *game.GameState) {
	top := state.Discard[len(state.Discard)-1]
	h.broadcastToRoomAll(code, protocol.ServerMsg{
		Type:        protocol.SMsgCardPlayed,
		PlayerIndex: playerID,
		Card:        cardToDTO(top),
		Turn:        state.CurrentTurn,
		PendingDraw: state.PendingDraw,
	})
}

// --- Validation helpers ---

var roomCodeRe = regexp.MustCompile(`^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$`)

// validRoomCode returns true if code matches the 6-character room code alphabet.
func validRoomCode(code string) bool { return roomCodeRe.MatchString(strings.ToUpper(code)) }
