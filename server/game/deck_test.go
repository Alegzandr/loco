package game

import "testing"

func TestNewDeck_Size(t *testing.T) {
	d := NewDeck()
	// 4 colors × (2×9 numbers + 2 Skip + 2 Reverse + 2 DrawTwo + 1 Swap) = 4×25 = 100
	// + 4 Wild + 4 WildDrawFour + 4 GlobalSwitch = 12
	// total = 112
	if len(d.Cards) != 112 {
		t.Errorf("NewDeck() len = %d, want 112", len(d.Cards))
	}
}

func TestNewDeck_NoZeroCards(t *testing.T) {
	d := NewDeck()
	for _, c := range d.Cards {
		if c.Kind == Number && c.Value == 0 {
			t.Errorf("deck should not contain a 0 number card; found %+v", c)
		}
	}
}

func TestNewDeck_ColorDistribution(t *testing.T) {
	d := NewDeck()
	counts := map[Color]int{}
	for _, c := range d.Cards {
		if !c.IsWild() {
			counts[c.Color]++
		}
	}
	for _, col := range []Color{Red, Yellow, Green, Blue} {
		if counts[col] != 25 {
			t.Errorf("color %v count = %d, want 25", col, counts[col])
		}
	}
}

func TestNewDeck_WildAndGlobalCounts(t *testing.T) {
	d := NewDeck()
	var wilds, w4s, swaps, gswaps int
	for _, c := range d.Cards {
		switch c.Kind {
		case WildCard:
			wilds++
		case WildDrawFour:
			w4s++
		case GlobalSwitch:
			gswaps++
		case Swap:
			swaps++
		}
	}
	if wilds != 4 {
		t.Errorf("WildCard count = %d, want 4", wilds)
	}
	if w4s != 4 {
		t.Errorf("WildDrawFour count = %d, want 4", w4s)
	}
	if gswaps != 4 {
		t.Errorf("GlobalSwitch count = %d, want 4", gswaps)
	}
	if swaps != 4 {
		t.Errorf("Swap count = %d, want 4 (1 per color)", swaps)
	}
}

func TestNewDeck_SwapIsColored(t *testing.T) {
	d := NewDeck()
	for _, c := range d.Cards {
		if c.Kind == Swap && c.Color == Wild {
			t.Errorf("Swap should be a colored card, found Wild-colored %+v", c)
		}
	}
}

func TestNewDeck_FullCompositionBreakdown(t *testing.T) {
	// Exact per-kind composition of the 112-card deck per docs/rules.md §2.
	// Number: 72 (4 colors × 9 values × 2 copies)
	// Skip / Reverse / DrawTwo: 8 each (4 colors × 2 copies)
	// Swap: 4 (1 per color, colored)
	// GlobalSwitch / Wild / WildDrawFour: 4 each (LOCO §14.1: GlobalSwitch is wild)
	d := NewDeck()
	counts := map[Kind]int{}
	for _, c := range d.Cards {
		counts[c.Kind]++
	}
	want := map[Kind]int{
		Number:       72,
		Skip:         8,
		Reverse:      8,
		DrawTwo:      8,
		Swap:         4,
		GlobalSwitch: 4,
		WildCard:     4,
		WildDrawFour: 4,
	}
	total := 0
	for kind, n := range want {
		if counts[kind] != n {
			t.Errorf("kind %v count = %d, want %d", kind, counts[kind], n)
		}
		total += n
	}
	if total != 112 {
		t.Fatalf("expected counts sum = %d, want 112", total)
	}

	// Per-color, per-value Number distribution: each (color, value) appears exactly twice.
	numByCV := map[[2]int]int{}
	for _, c := range d.Cards {
		if c.Kind != Number {
			continue
		}
		numByCV[[2]int{int(c.Color), c.Value}]++
	}
	for _, col := range []Color{Red, Yellow, Green, Blue} {
		for v := 1; v <= 9; v++ {
			if got := numByCV[[2]int{int(col), v}]; got != 2 {
				t.Errorf("Number %v %d count = %d, want 2", col, v, got)
			}
		}
	}
}

func TestDeck_Shuffle(t *testing.T) {
	d1 := NewDeck()
	d2 := NewDeck()
	d2.Shuffle(nil)
	same := true
	for i := range d1.Cards {
		if d1.Cards[i] != d2.Cards[i] {
			same = false
			break
		}
	}
	if same {
		t.Error("Shuffle did not change order (statistically extremely unlikely)")
	}
}

func TestDeck_Draw(t *testing.T) {
	d := NewDeck()
	initial := len(d.Cards)
	_, ok := d.Draw()
	if !ok {
		t.Fatal("Draw() on full deck returned ok=false")
	}
	if len(d.Cards) != initial-1 {
		t.Errorf("After Draw(), len = %d, want %d", len(d.Cards), initial-1)
	}
}

func TestDeck_DrawEmpty(t *testing.T) {
	d := &Deck{Cards: []Card{}}
	_, ok := d.Draw()
	if ok {
		t.Error("Draw() on empty deck should return ok=false")
	}
}

func TestDeck_DrawN(t *testing.T) {
	d := NewDeck()
	cards, ok := d.DrawN(8)
	if !ok {
		t.Fatal("DrawN(8) on full deck returned ok=false")
	}
	if len(cards) != 8 {
		t.Errorf("DrawN(8) returned %d cards, want 8", len(cards))
	}
	if len(d.Cards) != 104 {
		t.Errorf("After DrawN(8), deck len = %d, want 104", len(d.Cards))
	}
}

func TestDeck_DrawN_InsufficientCards(t *testing.T) {
	d := &Deck{Cards: []Card{{Color: Red, Kind: Number, Value: 1}}}
	_, ok := d.DrawN(5)
	if ok {
		t.Error("DrawN(5) on 1-card deck should return ok=false")
	}
}

func TestDeck_Replenish(t *testing.T) {
	d := NewDeck()
	d.Shuffle(nil)
	drawn, _ := d.DrawN(110)
	discard := drawn[:109]
	d.Replenish(discard)
	if len(d.Cards) != 109 {
		t.Errorf("After Replenish(), deck len = %d, want 109", len(d.Cards))
	}
}
