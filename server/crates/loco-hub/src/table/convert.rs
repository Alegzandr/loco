//! DTO conversion, and nothing else.
//!
//! The wire enums are `loco-protocol`'s and the domain's are `loco-game`'s; the
//! two are pinned to each other by `loco-protocol/tests/enums.rs`, so these
//! are spellings, never decisions.

use loco_game::{Card, Color, Kind, room::MatchFormat};
use loco_protocol::{CardColor, CardDTO, CardKind, MatchFormat as WireFormat};

pub fn color_name(c: Color) -> CardColor {
    match c {
        Color::Red => CardColor::Red,
        Color::Yellow => CardColor::Yellow,
        Color::Green => CardColor::Green,
        Color::Blue => CardColor::Blue,
        Color::Wild => CardColor::Wild,
    }
}

pub fn color_of(c: CardColor) -> Color {
    match c {
        CardColor::Red => Color::Red,
        CardColor::Yellow => Color::Yellow,
        CardColor::Green => Color::Green,
        CardColor::Blue => Color::Blue,
        CardColor::Wild => Color::Wild,
    }
}

pub fn kind_name(k: Kind) -> CardKind {
    match k {
        Kind::Number => CardKind::Number,
        Kind::Skip => CardKind::Skip,
        Kind::Reverse => CardKind::Reverse,
        Kind::DrawTwo => CardKind::DrawTwo,
        Kind::WildCard => CardKind::Wild,
        Kind::WildDrawFour => CardKind::WildDrawFour,
        Kind::Swap => CardKind::Swap,
        Kind::GlobalSwitch => CardKind::GlobalSwitch,
    }
}

pub fn kind_of(k: CardKind) -> Kind {
    match k {
        CardKind::Number => Kind::Number,
        CardKind::Skip => Kind::Skip,
        CardKind::Reverse => Kind::Reverse,
        CardKind::DrawTwo => Kind::DrawTwo,
        CardKind::Wild => Kind::WildCard,
        CardKind::WildDrawFour => Kind::WildDrawFour,
        CardKind::Swap => Kind::Swap,
        CardKind::GlobalSwitch => Kind::GlobalSwitch,
    }
}

pub fn card_to_dto(c: Card) -> CardDTO {
    CardDTO {
        color: color_name(c.color),
        kind: kind_name(c.kind),
        value: c.value,
    }
}

pub fn card_dtos(cards: &[Card]) -> Vec<CardDTO> {
    cards.iter().copied().map(card_to_dto).collect()
}

/// A card off the wire, and the colour it names. Only a wild reads
/// `chosen_color`; anything else names its own. A missing colour reads as
/// `Wild`, and every domain entry point refuses a colourless wild.
pub fn dto_to_card(dto: &CardDTO, chosen: Option<CardColor>) -> (Card, Color) {
    let color = color_of(dto.color);
    let kind = kind_of(dto.kind);
    let named = if matches!(
        kind,
        Kind::WildCard | Kind::WildDrawFour | Kind::GlobalSwitch
    ) {
        color_of(chosen.unwrap_or(CardColor::Wild))
    } else {
        color
    };
    (
        Card {
            color,
            kind,
            value: dto.value,
        },
        named,
    )
}

pub fn match_format_string(f: MatchFormat) -> WireFormat {
    match f {
        MatchFormat::Bo1 => WireFormat::BO1,
        MatchFormat::Bo3 => WireFormat::BO3,
        MatchFormat::Bo5 => WireFormat::BO5,
        MatchFormat::Bo7 => WireFormat::BO7,
    }
}

pub fn match_format_of(f: WireFormat) -> MatchFormat {
    match f {
        WireFormat::BO1 => MatchFormat::Bo1,
        WireFormat::BO3 => MatchFormat::Bo3,
        WireFormat::BO5 => MatchFormat::Bo5,
        WireFormat::BO7 => MatchFormat::Bo7,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Every colour and kind survives the round
    // trip, and a wild names the colour it was played as.
    #[test]
    fn every_card_round_trips() {
        for c in [
            Color::Red,
            Color::Yellow,
            Color::Green,
            Color::Blue,
            Color::Wild,
        ] {
            assert_eq!(color_of(color_name(c)), c);
        }
        for k in [
            Kind::Number,
            Kind::Skip,
            Kind::Reverse,
            Kind::DrawTwo,
            Kind::WildCard,
            Kind::WildDrawFour,
            Kind::Swap,
            Kind::GlobalSwitch,
        ] {
            assert_eq!(kind_of(kind_name(k)), k);
        }
        let seven = Card {
            color: Color::Blue,
            kind: Kind::Number,
            value: 7,
        };
        assert_eq!(dto_to_card(&card_to_dto(seven), None), (seven, Color::Blue));
    }

    #[test]
    fn a_wild_names_the_chosen_colour_and_a_number_ignores_it() {
        let wild = CardDTO {
            color: CardColor::Wild,
            kind: CardKind::Wild,
            value: 0,
        };
        assert_eq!(dto_to_card(&wild, Some(CardColor::Green)).1, Color::Green);
        assert_eq!(
            dto_to_card(&wild, None).1,
            Color::Wild,
            "a colourless wild stays wild for the domain to refuse"
        );
        let red = CardDTO {
            color: CardColor::Red,
            kind: CardKind::Number,
            value: 3,
        };
        assert_eq!(dto_to_card(&red, Some(CardColor::Green)).1, Color::Red);
    }

    #[test]
    fn formats_round_trip() {
        for f in [
            MatchFormat::Bo1,
            MatchFormat::Bo3,
            MatchFormat::Bo5,
            MatchFormat::Bo7,
        ] {
            assert_eq!(match_format_of(match_format_string(f)), f);
        }
    }
}
