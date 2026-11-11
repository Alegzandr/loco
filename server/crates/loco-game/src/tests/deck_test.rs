//! The deck: its composition, the shuffle, the draw and the replenish.

use super::support::*;
use crate::card::{COLORS, Card, Color, Kind};
use crate::deck::Deck;
use std::collections::HashMap;

#[test]
fn new_deck_size() {
    // 4 colours × (2×9 numbers + 2 Skip + 2 Reverse + 2 DrawTwo + 1 Swap) = 100
    // + 4 Wild + 4 WildDrawFour + 4 GlobalSwitch = 12; total 112.
    assert_eq!(Deck::standard().cards.len(), 112);
}

#[test]
fn new_deck_no_zero_cards() {
    for c in Deck::standard().cards {
        assert!(
            !(c.kind == Kind::Number && c.value == 0),
            "deck should not contain a 0 number card; found {c:?}"
        );
    }
}

#[test]
fn new_deck_color_distribution() {
    let mut counts: HashMap<Color, usize> = HashMap::new();
    for c in Deck::standard().cards {
        if !c.is_wild() {
            *counts.entry(c.color).or_default() += 1;
        }
    }
    for col in COLORS {
        assert_eq!(counts.get(&col).copied().unwrap_or(0), 25, "colour {col}");
    }
}

#[test]
fn new_deck_wild_and_global_counts() {
    let (mut wilds, mut w4s, mut swaps, mut gswaps) = (0, 0, 0, 0);
    for c in Deck::standard().cards {
        match c.kind {
            Kind::WildCard => wilds += 1,
            Kind::WildDrawFour => w4s += 1,
            Kind::GlobalSwitch => gswaps += 1,
            Kind::Swap => swaps += 1,
            _ => {}
        }
    }
    assert_eq!(wilds, 4, "WildCard count");
    assert_eq!(w4s, 4, "WildDrawFour count");
    assert_eq!(gswaps, 4, "GlobalSwitch count");
    assert_eq!(swaps, 4, "Swap count (1 per colour)");
}

#[test]
fn new_deck_swap_is_colored() {
    for c in Deck::standard().cards {
        assert!(
            !(c.kind == Kind::Swap && c.color == Color::Wild),
            "Swap should be a coloured card, found Wild-coloured {c:?}"
        );
    }
}

#[test]
fn new_deck_full_composition_breakdown() {
    // Exact per-kind composition of the 112-card deck per docs/rules.md §2.
    let d = Deck::standard();
    let mut counts: HashMap<Kind, usize> = HashMap::new();
    for c in &d.cards {
        *counts.entry(c.kind).or_default() += 1;
    }
    let want = [
        (Kind::Number, 72),
        (Kind::Skip, 8),
        (Kind::Reverse, 8),
        (Kind::DrawTwo, 8),
        (Kind::Swap, 4),
        (Kind::GlobalSwitch, 4),
        (Kind::WildCard, 4),
        (Kind::WildDrawFour, 4),
    ];
    let mut total = 0;
    for (kind, n) in want {
        assert_eq!(counts.get(&kind).copied().unwrap_or(0), n, "kind {kind}");
        total += n;
    }
    assert_eq!(total, 112, "expected counts sum");

    // Each (colour, value) number appears exactly twice.
    let mut by_cv: HashMap<(Color, i32), usize> = HashMap::new();
    for c in d.cards.iter().filter(|c| c.kind == Kind::Number) {
        *by_cv.entry((c.color, c.value)).or_default() += 1;
    }
    for col in COLORS {
        for v in 1..=9 {
            assert_eq!(
                by_cv.get(&(col, v)).copied().unwrap_or(0),
                2,
                "Number {col} {v}"
            );
        }
    }
}

#[test]
fn deck_shuffle() {
    let d1 = Deck::standard();
    let mut d2 = Deck::standard();
    d2.shuffle(&mut test_rng(1));
    assert_ne!(d1.cards, d2.cards, "Shuffle did not change order");
}

#[test]
fn deck_draw() {
    let mut d = Deck::standard();
    let initial = d.cards.len();
    assert!(d.draw().is_some(), "draw() on full deck returned None");
    assert_eq!(d.cards.len(), initial - 1);
}

#[test]
fn deck_draw_empty() {
    let mut d = Deck { cards: vec![] };
    assert!(
        d.draw().is_none(),
        "draw() on empty deck should return None"
    );
}

#[test]
fn deck_draw_n() {
    let mut d = Deck::standard();
    let cards = d.draw_n(8).expect("draw_n(8) on full deck");
    assert_eq!(cards.len(), 8);
    assert_eq!(d.cards.len(), 104);
}

#[test]
fn deck_draw_n_insufficient_cards() {
    let mut d = Deck {
        cards: vec![num(Color::Red, 1)],
    };
    assert!(d.draw_n(5).is_none(), "draw_n(5) on a 1-card deck");
}

#[test]
fn deck_replenish() {
    let mut rng = test_rng(2);
    let mut d = Deck::standard();
    d.shuffle(&mut rng);
    let drawn = d.draw_n(110).unwrap();
    let discard = &drawn[..109];
    d.replenish(discard, &mut rng);
    // The two cards still in the deck stay in it: a replenish adds the pile to
    // what is left, it does not replace it.
    assert_eq!(d.cards.len(), 111);
}

// The pile going back into the deck is the second half of a long round, and
// every card in it has been seen by the table: an attacker who can predict its
// order knows the rest of the round outright. It takes the room's own source,
// like the deal.
//
// The test says both halves: two rooms' sources give two orders, and the same
// room source given again gives the same one (the shuffle reads nothing but it).
#[test]
fn replenish_uses_the_rooms_own_source() {
    let pile: Vec<Card> = Deck::standard().cards[..60].to_vec();
    let order_of = |seed: u64| {
        let mut r = crate::room::Room::from_u64_seed("AAAAAA", seed);
        let mut d = Deck::default();
        d.replenish(&pile, r.rng_mut());
        d.cards
    };
    assert_ne!(
        order_of(1),
        order_of(2),
        "two rooms replenished the same pile into the same order"
    );
    assert_eq!(
        order_of(3),
        order_of(3),
        "the shuffle read something but the room's source"
    );
}
