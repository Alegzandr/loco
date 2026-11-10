//! The wire enums are a second spelling of the domain's own, and a second
//! spelling is a mirror. These tests pin the mirror.
//!
//! Two halves, because the domain is moving house:
//!
//! - **Until `loco-game` is merged**, the Go server is the domain, and its
//!   `server/protocol/enums.go` is already pinned to `server/game` by
//!   `enums_test.go`. So the Rust spellings are pinned to that file, value for
//!   value and in order: Go's generated client and this crate's must not
//!   disagree about what a colour is while both servers exist.
//! - **Once `loco-game` is in the workspace**, `domain` (behind the feature of
//!   the same name) walks the Rust domain the way `enums_test.go` walks the Go
//!   one. Enabling it is the merge's job: add `loco-game` as an optional
//!   dependency, point the feature at it, and check the three calls marked
//!   `API:` against what agent B named.

use loco_protocol::{ALL_CARD_COLORS, ALL_CARD_KINDS, ALL_EMOTES, ALL_MATCH_FORMATS};

/// Where the Go wire enums live, relative to this crate. One constant, so the
/// day the Go server is deleted this half of the file goes with one edit.
const GO_ENUMS: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../server/protocol/enums.go"
);

/// The string constants of one Go `type X string` block, in declaration order.
fn go_consts(src: &str, ty: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in src.lines() {
        let line = line.trim();
        // `ColorRed    CardColor = "red"`
        let mut parts = line.split_whitespace();
        let (Some(_name), Some(t), Some("=")) = (parts.next(), parts.next(), parts.next()) else {
            continue;
        };
        if t != ty {
            continue;
        }
        let rest: String = parts.collect::<Vec<_>>().join(" ");
        if let Some(v) = rest.strip_prefix('"').and_then(|r| r.split('"').next()) {
            out.push(v.to_owned());
        }
    }
    out
}

fn read_go() -> Option<String> {
    match std::fs::read_to_string(GO_ENUMS) {
        Ok(s) => Some(s),
        // After the cutover the Go tree is gone and `domain` is the check.
        Err(_) if cfg!(feature = "domain") => None,
        Err(e) => panic!("{GO_ENUMS}: {e}; if the Go server is gone, enable the `domain` feature"),
    }
}

fn assert_same(what: &str, go: Vec<String>, rust: Vec<&str>) {
    assert!(
        !go.is_empty(),
        "{what}: nothing read from {GO_ENUMS}, the parser is reading the wrong block"
    );
    assert_eq!(
        go, rust,
        "{what}: the Go wire enum and this crate's disagree (values or order)"
    );
}

#[test]
fn card_colors_match_the_go_wire() {
    let Some(src) = read_go() else { return };
    let rust = ALL_CARD_COLORS.iter().map(|c| c.as_str()).collect();
    assert_same("CardColor", go_consts(&src, "CardColor"), rust);
}

#[test]
fn card_kinds_match_the_go_wire() {
    let Some(src) = read_go() else { return };
    let rust = ALL_CARD_KINDS.iter().map(|k| k.as_str()).collect();
    assert_same("CardKind", go_consts(&src, "CardKind"), rust);
}

#[test]
fn match_formats_match_the_go_wire() {
    let Some(src) = read_go() else { return };
    let rust = ALL_MATCH_FORMATS.iter().map(|f| f.as_str()).collect();
    assert_same("MatchFormat", go_consts(&src, "MatchFormat"), rust);
}

#[test]
fn emotes_match_the_go_wire() {
    let Some(src) = read_go() else { return };
    let rust = ALL_EMOTES.iter().map(|e| e.as_str()).collect();
    assert_same("Emote", go_consts(&src, "Emote"), rust);
}

/// The Rust domain's half, mirroring `server/protocol/enums_test.go`: walk the
/// domain rather than list it, because a hand-written list here would be a
/// third copy that goes on passing the day somebody adds a colour.
#[cfg(feature = "domain")]
mod domain {
    use super::*;
    use std::collections::BTreeSet;

    /// Two-directional on purpose. A wire value the domain cannot produce is
    /// dead weight in front of every client; a domain value with no wire
    /// spelling is the one that costs a match, because the server writes it
    /// and the generated client refuses the whole message.
    fn assert_same_set(what: &str, domain: BTreeSet<String>, wire: BTreeSet<String>) {
        for d in domain.difference(&wire) {
            panic!("{what}: the domain produces {d:?} and no wire value carries it");
        }
        for w in wire.difference(&domain) {
            panic!("{what}: wire value {w:?} is not a value the domain can produce");
        }
    }

    #[test]
    fn card_colors_cover_the_domain() {
        // API: every domain colour and its wire spelling.
        let domain = loco_game::Color::ALL
            .iter()
            .map(|c| c.to_string())
            .collect();
        let wire = ALL_CARD_COLORS
            .iter()
            .map(|c| c.as_str().to_owned())
            .collect();
        assert_same_set("color", domain, wire);
    }

    #[test]
    fn card_kinds_cover_the_domain() {
        // API: every domain kind and its wire spelling.
        let domain = loco_game::Kind::ALL.iter().map(|k| k.to_string()).collect();
        let wire = ALL_CARD_KINDS
            .iter()
            .map(|k| k.as_str().to_owned())
            .collect();
        assert_same_set("kind", domain, wire);
    }

    /// The formats are not contiguous (1, 3, 5, 7), so the domain half is
    /// derived from the one rule that decides which are real: what a room
    /// agrees to be set to.
    #[test]
    fn match_formats_cover_the_domain() {
        let mut domain = BTreeSet::new();
        for n in 0..64u8 {
            // API: a room accepting or refusing a best-of-n.
            if loco_game::MatchFormat::try_from(n).is_ok() {
                domain.insert(format!("BO{n}"));
            }
        }
        assert!(
            !domain.is_empty(),
            "match format: the domain accepted nothing"
        );
        let wire = ALL_MATCH_FORMATS
            .iter()
            .map(|f| f.as_str().to_owned())
            .collect();
        assert_same_set("match format", domain, wire);
    }
}
