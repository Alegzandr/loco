package game

// Color represents a card color.
type Color int

const (
	Red Color = iota
	Yellow
	Green
	Blue
	Wild // used for wild cards that have no inherent color
)

func (c Color) String() string {
	switch c {
	case Red:
		return "red"
	case Yellow:
		return "yellow"
	case Green:
		return "green"
	case Blue:
		return "blue"
	case Wild:
		return "wild"
	}
	return "unknown"
}

// Kind represents the kind of a card.
type Kind int

const (
	Number Kind = iota
	Skip
	Reverse
	DrawTwo
	WildCard
	WildDrawFour
	Swap         // swap entire hands with a chosen opponent
	GlobalSwitch // all players rotate hands in the current game direction
)

func (k Kind) String() string {
	switch k {
	case Number:
		return "number"
	case Skip:
		return "skip"
	case Reverse:
		return "reverse"
	case DrawTwo:
		return "draw_two"
	case WildCard:
		return "wild"
	case WildDrawFour:
		return "wild_draw_four"
	case Swap:
		return "swap"
	case GlobalSwitch:
		return "global_switch"
	}
	return "unknown"
}

// Card is a single playing card.
type Card struct {
	Color Color
	Kind  Kind
	Value int // 0-9 for number cards, 0 for action cards
}

// IsWild returns true if the card has no inherent color.
// Swap is now a colored card (one per color) and is NOT wild.
func (c Card) IsWild() bool {
	return c.Kind == WildCard || c.Kind == WildDrawFour || c.Kind == GlobalSwitch
}

// IsAction returns true if the card is an action card.
func (c Card) IsAction() bool {
	return c.Kind != Number
}

// CardValue returns the scoring point value of a card.
// Per docs/rules.md §10: Number = face value, Reverse=10, Skip=20,
// DrawTwo=30, Swap=30, GlobalSwitch=40, Wild=40, WildDrawFour=50.
func CardValue(c Card) int {
	switch c.Kind {
	case Number:
		return c.Value
	case Reverse:
		return 10
	case Skip:
		return 20
	case DrawTwo, Swap:
		return 30
	case GlobalSwitch, WildCard:
		return 40
	case WildDrawFour:
		return 50
	}
	return 0
}
