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
func (c Card) IsWild() bool {
	return c.Kind == WildCard || c.Kind == WildDrawFour
}

// IsAction returns true if the card is an action card.
func (c Card) IsAction() bool {
	return c.Kind != Number
}

// CardValue returns the scoring point value of a card.
// Number cards = face value (0-9), action cards = 20, wilds = 50.
func CardValue(c Card) int {
	switch c.Kind {
	case Number:
		return c.Value
	case Skip, Reverse, DrawTwo:
		return 20
	case WildCard, WildDrawFour:
		return 50
	}
	return 0
}
