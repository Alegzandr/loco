//! The wire enums are a second spelling of the domain's own, and a second
//! spelling is a mirror. These tests pin the mirror.
//!
//! They walk the domain instead of listing it. A hand-written list here would
//! be a third copy, and it would go on passing the day somebody adds a colour
//! to `loco-game`'s `card.rs`.

use std::collections::BTreeSet;

use loco_game::{Color, Kind, MatchFormat, Room};
use loco_protocol::{ALL_CARD_COLORS, ALL_CARD_KINDS, ALL_MATCH_FORMATS};
use serde::de::DeserializeOwned;

/// Bounds the walks below so a domain enum that stops refusing past its end
/// fails the test rather than hanging it.
const PROBE_CEILING: i32 = 64;

/// Walks a domain enum up from zero through its integer spelling (the one the
/// snapshot uses) until it stops recognising a value: how the domain says
/// "past the end".
fn domain_walk<T: DeserializeOwned>(what: &str, name: impl Fn(&T) -> String) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    for i in 0..PROBE_CEILING {
        match serde_json::from_value::<T>(serde_json::json!(i)) {
            Ok(v) => {
                out.insert(name(&v));
            }
            Err(_) => {
                assert!(
                    !out.is_empty(),
                    "{what}: nothing at all was recognised, the walk is reading the wrong enum"
                );
                return out;
            }
        }
    }
    panic!("{what}: no value below {PROBE_CEILING} fell off the end");
}

/// Two-directional on purpose. A wire value the domain cannot produce is dead
/// weight in front of every client; a domain value with no wire spelling is
/// the one that costs a match, because the server writes it and the generated
/// client refuses the whole message.
fn assert_same_set(what: &str, domain: BTreeSet<String>, wire: BTreeSet<String>) {
    let unspelled: Vec<_> = domain.difference(&wire).collect();
    assert!(
        unspelled.is_empty(),
        "{what}: the domain produces {unspelled:?} and no wire value carries it"
    );
    let dead: Vec<_> = wire.difference(&domain).collect();
    assert!(
        dead.is_empty(),
        "{what}: wire values {dead:?} are not values the domain can produce"
    );
}

#[test]
fn card_colors_cover_the_domain() {
    let domain = domain_walk::<Color>("color", |c| c.as_str().to_owned());
    let wire = ALL_CARD_COLORS
        .iter()
        .map(|c| c.as_str().to_owned())
        .collect();
    assert_same_set("color", domain, wire);
}

#[test]
fn card_kinds_cover_the_domain() {
    let domain = domain_walk::<Kind>("kind", |k| k.as_str().to_owned());
    let wire = ALL_CARD_KINDS
        .iter()
        .map(|k| k.as_str().to_owned())
        .collect();
    assert_same_set("kind", domain, wire);
}

/// The formats are not contiguous (1, 3, 5, 7), so the domain half is derived
/// from the one rule that decides which are real: what a room agrees to be set
/// to.
#[test]
fn match_formats_cover_the_domain() {
    let mut domain = BTreeSet::new();
    for n in 0..PROBE_CEILING {
        let mut room = Room::from_u64_seed("TEST12", 1);
        if let Ok(f) = MatchFormat::try_from(i64::from(n))
            && room.set_format(f).is_ok()
        {
            domain.insert(format!("BO{n}"));
        }
    }
    assert!(
        !domain.is_empty(),
        "match format: set_format accepted nothing"
    );
    let wire = ALL_MATCH_FORMATS
        .iter()
        .map(|f| f.as_str().to_owned())
        .collect();
    assert_same_set("match format", domain, wire);
}
