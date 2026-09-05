package hub

import (
	"fmt"
	"strings"

	"loco/server/game"
	"loco/server/protocol"
)

func cardToDTO(c game.Card) *protocol.CardDTO {
	return &protocol.CardDTO{
		Color: colorName(c.Color),
		Kind:  kindName(c.Kind),
		Value: c.Value,
	}
}

// cardDTOs converts a run of cards for the wire's value-slice fields
// (ServerMsg.Cards). Three callers built this loop by hand, and one of them
// sized the slice from a count while filling it from a different slice, which
// would have put a null on the wire the day the two stopped agreeing.
func cardDTOs(cards []game.Card) []protocol.CardDTO {
	out := make([]protocol.CardDTO, len(cards))
	for i, c := range cards {
		out[i] = *cardToDTO(c)
	}
	return out
}

func dtoToCard(dto *protocol.CardDTO, chosenColorStr protocol.CardColor) (game.Card, game.Color, error) {
	col, err := parseColor(dto.Color)
	if err != nil {
		return game.Card{}, 0, err
	}
	kind, err := parseKind(dto.Kind)
	if err != nil {
		return game.Card{}, 0, err
	}
	chosen := col
	// Every wild requires a chosen_color, GlobalSwitch included. Swap is
	// coloured and carries its own.
	if kind == game.WildCard || kind == game.WildDrawFour || kind == game.GlobalSwitch {
		chosen, err = parseColor(chosenColorStr)
		if err != nil {
			return game.Card{}, 0, fmt.Errorf("chosen_color required for wild: %w", err)
		}
	}
	return game.Card{Color: col, Kind: kind, Value: dto.Value}, chosen, nil
}

// The four functions below are the only crossing between the domain's enums and
// the wire's. They name protocol constants rather than string literals so that
// the set they translate is the set enums_test.go pins to the domain: a literal
// here would have been a third spelling, agreeing with nothing.

func colorName(c game.Color) protocol.CardColor { return protocol.CardColor(c.String()) }

func kindName(k game.Kind) protocol.CardKind { return protocol.CardKind(k.String()) }

func parseColor(s protocol.CardColor) (game.Color, error) {
	// An empty chosen_color reads as Wild, which is what a card carries before
	// its owner names a colour. Every entry point still refuses a wild that
	// reaches a play without one.
	switch protocol.CardColor(strings.ToLower(string(s))) {
	case protocol.ColorRed:
		return game.Red, nil
	case protocol.ColorYellow:
		return game.Yellow, nil
	case protocol.ColorGreen:
		return game.Green, nil
	case protocol.ColorBlue:
		return game.Blue, nil
	case protocol.ColorWild, "":
		return game.Wild, nil
	}
	return 0, fmt.Errorf("unknown color: %q", s)
}

func parseKind(s protocol.CardKind) (game.Kind, error) {
	switch protocol.CardKind(strings.ToLower(string(s))) {
	case protocol.KindNumber:
		return game.Number, nil
	case protocol.KindSkip:
		return game.Skip, nil
	case protocol.KindReverse:
		return game.Reverse, nil
	case protocol.KindDrawTwo:
		return game.DrawTwo, nil
	case protocol.KindWild:
		return game.WildCard, nil
	case protocol.KindWildDrawFour:
		return game.WildDrawFour, nil
	case protocol.KindSwap:
		return game.Swap, nil
	case protocol.KindGlobalSwitch:
		return game.GlobalSwitch, nil
	}
	return 0, fmt.Errorf("unknown kind: %q", s)
}

func matchFormatString(f game.MatchFormat) protocol.MatchFormat {
	switch f {
	case game.BO1:
		return protocol.FormatBO1
	case game.BO3:
		return protocol.FormatBO3
	case game.BO5:
		return protocol.FormatBO5
	case game.BO7:
		return protocol.FormatBO7
	}
	return protocol.FormatBO1
}

func parseMatchFormat(s protocol.MatchFormat) (game.MatchFormat, error) {
	switch protocol.MatchFormat(strings.ToUpper(string(s))) {
	case protocol.FormatBO1:
		return game.BO1, nil
	case protocol.FormatBO3:
		return game.BO3, nil
	case protocol.FormatBO5:
		return game.BO5, nil
	case protocol.FormatBO7:
		return game.BO7, nil
	}
	return 0, fmt.Errorf("invalid match format %q: must be BO1, BO3, BO5, or BO7", s)
}

// interruptOpenPtr is the interrupt window as the wire carries it: a pointer,
// so that "shut" survives omitempty. See protocol.ServerMsg.InterruptOpen.
func interruptOpenPtr(state *game.GameState) *bool {
	if state == nil {
		return nil
	}
	return boolPtr(state.InterruptOpen)
}

// intPtr / boolPtr wrap a value for the pointer-typed wire fields whose zero
// value must survive `omitempty` (see protocol.ServerMsg.PendingDraw).
func intPtr(v int) *int    { return &v }
func boolPtr(v bool) *bool { return &v }
