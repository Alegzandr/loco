package game

import "testing"

func TestCardIsWild(t *testing.T) {
	tests := []struct {
		card Card
		want bool
	}{
		{Card{Color: Wild, Kind: WildCard}, true},
		{Card{Color: Wild, Kind: WildDrawFour}, true},
		{Card{Color: Red, Kind: Number, Value: 5}, false},
		{Card{Color: Blue, Kind: Skip}, false},
		{Card{Color: Green, Kind: Reverse}, false},
		{Card{Color: Yellow, Kind: DrawTwo}, false},
	}
	for _, tt := range tests {
		got := tt.card.IsWild()
		if got != tt.want {
			t.Errorf("Card{%v,%v,%d}.IsWild() = %v, want %v", tt.card.Color, tt.card.Kind, tt.card.Value, got, tt.want)
		}
	}
}

func TestCardIsAction(t *testing.T) {
	tests := []struct {
		card Card
		want bool
	}{
		{Card{Color: Red, Kind: Number, Value: 3}, false},
		{Card{Color: Blue, Kind: Skip}, true},
		{Card{Color: Green, Kind: Reverse}, true},
		{Card{Color: Yellow, Kind: DrawTwo}, true},
		{Card{Color: Wild, Kind: WildCard}, true},
		{Card{Color: Wild, Kind: WildDrawFour}, true},
	}
	for _, tt := range tests {
		got := tt.card.IsAction()
		if got != tt.want {
			t.Errorf("Card{%v,%v}.IsAction() = %v, want %v", tt.card.Color, tt.card.Kind, got, tt.want)
		}
	}
}

func TestCardValue(t *testing.T) {
	tests := []struct {
		card Card
		want int
	}{
		{Card{Kind: Number, Value: 0}, 0},
		{Card{Kind: Number, Value: 7}, 7},
		{Card{Kind: Number, Value: 9}, 9},
		{Card{Kind: Skip}, 20},
		{Card{Kind: Reverse}, 20},
		{Card{Kind: DrawTwo}, 20},
		{Card{Kind: WildCard}, 50},
		{Card{Kind: WildDrawFour}, 50},
	}
	for _, tt := range tests {
		got := CardValue(tt.card)
		if got != tt.want {
			t.Errorf("CardValue(%v/%v/%d) = %d, want %d", tt.card.Color, tt.card.Kind, tt.card.Value, got, tt.want)
		}
	}
}

func TestColorString(t *testing.T) {
	cases := []struct {
		c    Color
		want string
	}{
		{Red, "red"}, {Yellow, "yellow"}, {Green, "green"}, {Blue, "blue"}, {Wild, "wild"},
	}
	for _, tc := range cases {
		if tc.c.String() != tc.want {
			t.Errorf("Color(%d).String() = %q, want %q", tc.c, tc.c.String(), tc.want)
		}
	}
}
