//! Port of `server/hub/converter_test.go`.
//!
//! Go parsed the wire's strings in `parseColor` / `parseKind` /
//! `parseMatchFormat`; here the wire enums' own (forgiving) deserialisers do
//! that job, so the cases below are read through `serde_json` exactly as a
//! client message is. The tables stay strings on purpose: half their cases are
//! values the wire types cannot hold ("purple", "BO2", ""), and refusing those
//! is the whole job under test.

use crate::router::rooms::ROOM_CODE_CHARS;
use crate::table::convert;
use loco_protocol::{CardColor, CardKind, MatchFormat};
use serde::de::DeserializeOwned;

fn parse<T: DeserializeOwned>(s: &str) -> Result<T, serde_json::Error> {
    serde_json::from_value(serde_json::Value::String(s.to_owned()))
}

#[test]
fn parse_color() {
    let cases = [
        ("red", false),
        ("RED", false),
        ("yellow", false),
        ("green", false),
        ("blue", false),
        ("wild", false),
        ("", false),
        ("purple", true),
        ("unknown", true),
    ];
    for (input, want_err) in cases {
        let got = parse::<CardColor>(input);
        assert_eq!(got.is_err(), want_err, "parse_color({input:?}): {got:?}");
    }
}

#[test]
fn parse_kind() {
    let cases = [
        ("number", false),
        ("skip", false),
        ("reverse", false),
        ("draw_two", false),
        ("wild", false),
        ("wild_draw_four", false),
        ("WILD_DRAW_FOUR", false),
        ("invalid", true),
        ("", true),
    ];
    for (input, want_err) in cases {
        let got = parse::<CardKind>(input);
        assert_eq!(got.is_err(), want_err, "parse_kind({input:?}): {got:?}");
    }
}

#[test]
fn valid_room_code() {
    let cases = [
        ("ABCDEF", true),
        ("ABC234", true),   // digits 2-9 are valid
        ("ABC123", false),  // '1' is excluded from the charset
        ("abcdef", true),   // upper-casing normalises valid chars
        ("ABCDE", false),   // 5 chars
        ("ABCDEFG", false), // 7 chars
        ("ABCDE0", false),  // contains '0' (excluded)
        ("ABCDEI", false),  // contains 'I' (excluded)
        ("ABCDE1", false),  // contains '1' (excluded)
        ("ABCDEO", false),  // contains 'O' (excluded)
        ("", false),
    ];
    for (input, want) in cases {
        assert_eq!(
            crate::ids::RoomCode::parse(input).is_ok(),
            want,
            "valid_room_code({input:?})"
        );
    }
}

#[test]
fn parse_match_format() {
    for s in ["BO1", "BO3", "BO5", "BO7", "bo1", "bo3"] {
        assert!(
            parse::<MatchFormat>(s).is_ok(),
            "parse_match_format({s:?}) unexpected error"
        );
    }
    for s in ["BO2", "BO4", "BO9", "", "best-of-3"] {
        assert!(
            parse::<MatchFormat>(s).is_err(),
            "parse_match_format({s:?}) expected an error"
        );
    }
}

#[test]
fn match_format_string() {
    for (input, want) in [
        ("BO1", "BO1"),
        ("BO3", "BO3"),
        ("BO5", "BO5"),
        ("BO7", "BO7"),
    ] {
        let f = convert::match_format_of(parse::<MatchFormat>(input).unwrap());
        assert_eq!(
            convert::match_format_string(f).as_str(),
            want,
            "match_format_string({input})"
        );
    }
}

#[test]
fn valid_room_code_charset() {
    // Every excluded character fails.
    for ch in ["0", "O", "1", "I"] {
        let code = format!("ABCDE{ch}");
        assert!(
            crate::ids::RoomCode::parse(&code).is_err(),
            "valid_room_code({code:?}) should be false (excluded char {ch:?})"
        );
    }
    // The charset's characters pass when padded.
    let first = &ROOM_CODE_CHARS[..1];
    assert!(
        crate::ids::RoomCode::parse(&first.repeat(6)).is_ok(),
        "valid_room_code with valid chars should be true"
    );
    assert_eq!(ROOM_CODE_CHARS, "ABCDEFGHJKLMNPQRSTUVWXYZ23456789");
}
