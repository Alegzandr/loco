package protocol

// The wire enums.
//
// The domain owns these values (game.Color.String(), game.Kind.String(), and
// the formats Room.SetFormat accepts); this file is the spelling they travel
// under, and enums_test.go pins one to the other in both directions.
//
// They exist because messages.go is the single source the TypeScript client is
// generated from. A field typed `string` there generates a field typed `string`,
// which would have thrown away a narrowing the hand-written client always had:
// a colour off the wire is one of five things, and the client's pickers, its
// suit shapes and its active-colour chip are all written against that. Typing
// the fields here also gives the server a compile-time check it did not have,
// since a colour used to be any string at all right up to parseColor.
//
// These are string types, so nothing about the bytes on the wire changes.

// CardColor is a card colour, or the table's active colour, as it travels.
// ColorWild is what a wild card carries before its owner names a real one; it
// must never reach a game state's active colour.
type CardColor string

const (
	ColorRed    CardColor = "red"
	ColorYellow CardColor = "yellow"
	ColorGreen  CardColor = "green"
	ColorBlue   CardColor = "blue"
	ColorWild   CardColor = "wild"
)

// AllCardColors is what enums_test.go checks the domain against, and what the
// generator checks the const block against. Keep it in declaration order.
var AllCardColors = []CardColor{ColorRed, ColorYellow, ColorGreen, ColorBlue, ColorWild}

// CardKind is a card's kind as it travels. KindWild is the plain wild card;
// KindGlobalSwitch is LOCO's own, a wild that rotates every hand.
type CardKind string

const (
	KindNumber       CardKind = "number"
	KindSkip         CardKind = "skip"
	KindReverse      CardKind = "reverse"
	KindDrawTwo      CardKind = "draw_two"
	KindWild         CardKind = "wild"
	KindWildDrawFour CardKind = "wild_draw_four"
	KindSwap         CardKind = "swap"
	KindGlobalSwitch CardKind = "global_switch"
)

// AllCardKinds mirrors AllCardColors' contract.
var AllCardKinds = []CardKind{
	KindNumber, KindSkip, KindReverse, KindDrawTwo,
	KindWild, KindWildDrawFour, KindSwap, KindGlobalSwitch,
}

// MatchFormat is the best-of-N format a table is playing.
type MatchFormat string

const (
	FormatBO1 MatchFormat = "BO1"
	FormatBO3 MatchFormat = "BO3"
	FormatBO5 MatchFormat = "BO5"
	FormatBO7 MatchFormat = "BO7"
)

// AllMatchFormats mirrors AllCardColors' contract.
var AllMatchFormats = []MatchFormat{FormatBO1, FormatBO3, FormatBO5, FormatBO7}

// Emote is one of the three things a player can say at the end of a match, and
// the whole vocabulary the game has.
//
// A closed set, decided here and travelling as an identifier, because the
// alternative is free text — and free text is a moderation surface, which is a
// promise this game cannot keep: "we collect nothing" is the compliance
// strategy, not an accident. Three is enough to react to a match and too few to
// be abusive, which is the only property that matters.
//
// The words themselves are the client's (`t.emotes`), in the player's own
// language. Nothing here is stored, logged or snapshotted: an emote is
// broadcast, shown for a few seconds, and forgotten.
type Emote string

const (
	// EmoteGG — the one this exists for: a close 1v1 against a stranger and no
	// way to say anything at all about it.
	EmoteGG Emote = "gg"
	// EmoteClose — that was close.
	EmoteClose Emote = "close"
	// EmoteLucky — you got lucky, addressed to the table rather than to a seat:
	// the needling one, and a closed set is what keeps it needling rather than
	// abusive.
	EmoteLucky Emote = "lucky"
)

// AllEmotes mirrors AllCardColors' contract, and is what the server validates
// an inbound identifier against: a fourth one cannot be invented by a client.
var AllEmotes = []Emote{EmoteGG, EmoteClose, EmoteLucky}

// ValidEmote reports whether an inbound identifier is one of the three.
func ValidEmote(e Emote) bool {
	for _, known := range AllEmotes {
		if known == e {
			return true
		}
	}
	return false
}
