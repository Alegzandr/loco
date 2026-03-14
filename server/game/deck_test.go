package game

import "testing"

func TestNewDeck_Size(t *testing.T) {
	d := NewDeck()
	// Standard UNO deck: 108 cards
	// 4 colors × (1 zero + 2×nine numbers + 2 Skip + 2 Reverse + 2 DrawTwo) = 4×(1+18+2+2+2) = 4×25 = 100
	// Plus 4 Wild + 4 WildDrawFour = 8
	// Total = 108
	if len(d.Cards) != 108 {
		t.Errorf("NewDeck() len = %d, want 108", len(d.Cards))
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
			t.Errorf("Color %v count = %d, want 25", col, counts[col])
		}
	}
}

func TestNewDeck_WildCount(t *testing.T) {
	d := NewDeck()
	wilds, wildDrawFours := 0, 0
	for _, c := range d.Cards {
		if c.Kind == WildCard {
			wilds++
		}
		if c.Kind == WildDrawFour {
			wildDrawFours++
		}
	}
	if wilds != 4 {
		t.Errorf("Wild count = %d, want 4", wilds)
	}
	if wildDrawFours != 4 {
		t.Errorf("WildDrawFour count = %d, want 4", wildDrawFours)
	}
}

func TestDeck_Shuffle(t *testing.T) {
	d1 := NewDeck()
	d2 := NewDeck()
	d2.Shuffle()
	// With 108 cards, the probability all are in identical order after shuffle is negligible
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
	card, ok := d.Draw()
	if !ok {
		t.Fatal("Draw() on full deck returned ok=false")
	}
	_ = card
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
	cards, ok := d.DrawN(7)
	if !ok {
		t.Fatal("DrawN(7) on full deck returned ok=false")
	}
	if len(cards) != 7 {
		t.Errorf("DrawN(7) returned %d cards, want 7", len(cards))
	}
	if len(d.Cards) != 101 {
		t.Errorf("After DrawN(7), deck len = %d, want 101", len(d.Cards))
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
	d.Shuffle()
	// Draw down to 3 cards
	drawn, _ := d.DrawN(105)
	discard := drawn[:104]

	d.Replenish(discard, drawn[104])
	// deck should have 104 cards again (the discards minus the top of discard)
	if len(d.Cards) != 104 {
		t.Errorf("After Replenish(), deck len = %d, want 104", len(d.Cards))
	}
}
