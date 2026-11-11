//! Cards: the deck's values, spellings and predicates.

use super::support::*;
use crate::card::{Card, Color, Kind};

#[test]
fn card_is_wild() {
    let cases = [
        (wild(Kind::WildCard), true),
        (wild(Kind::WildDrawFour), true),
        (wild(Kind::GlobalSwitch), true),
        (num(Color::Red, 5), false),
        (act(Color::Blue, Kind::Skip), false),
        (act(Color::Green, Kind::Reverse), false),
        (act(Color::Yellow, Kind::DrawTwo), false),
        (act(Color::Red, Kind::Swap), false), // Swap is coloured
    ];
    for (card, want) in cases {
        assert_eq!(card.is_wild(), want, "{card:?}.is_wild()");
    }
}

#[test]
fn card_is_action() {
    let cases = [
        (num(Color::Red, 3), false),
        (act(Color::Blue, Kind::Skip), true),
        (act(Color::Green, Kind::Reverse), true),
        (act(Color::Yellow, Kind::DrawTwo), true),
        (wild(Kind::WildCard), true),
        (wild(Kind::WildDrawFour), true),
    ];
    for (card, want) in cases {
        assert_eq!(card.is_action(), want, "{card:?}.is_action()");
    }
}

#[test]
fn card_value() {
    let k = |kind| Card::new(Color::Red, kind, 0);
    let cases = [
        (Card::number(Color::Red, 0), 0),
        (Card::number(Color::Red, 7), 7),
        (Card::number(Color::Red, 9), 9),
        (k(Kind::Reverse), 10),
        (k(Kind::Skip), 20),
        (k(Kind::DrawTwo), 30),
        (act(Color::Red, Kind::Swap), 30),
        (k(Kind::GlobalSwitch), 40),
        (k(Kind::WildCard), 40),
        (k(Kind::WildDrawFour), 50),
    ];
    for (card, want) in cases {
        assert_eq!(crate::card::card_value(card), want, "card_value({card:?})");
    }
}

#[test]
fn color_string() {
    let cases = [
        (Color::Red, "red"),
        (Color::Yellow, "yellow"),
        (Color::Green, "green"),
        (Color::Blue, "blue"),
        (Color::Wild, "wild"),
    ];
    for (c, want) in cases {
        assert_eq!(c.to_string(), want);
        assert_eq!(c.as_str(), want);
    }
}
