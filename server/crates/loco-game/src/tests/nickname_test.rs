//! Nickname validation: length, charset and the blocked-term matcher. The
//! invisible characters in the inputs are spelled as escapes.

#[allow(unused_imports)]
use super::support::*;
use crate::error::{ErrorKind, GameError, NICKNAME_REJECTED};
use crate::nickname::{self, lists, validate_nickname};

#[test]
fn validate_nickname_canonicalises() {
    let cases = [
        ("Alice", "Alice"),
        ("  Alice  ", "Alice"),
        ("Jean   Luc", "Jean Luc"),
        ("\u{c9}tienne", "\u{c9}tienne"),
        ("O'Brien", "O'Brien"),
        ("Anne-Marie", "Anne-Marie"),
        ("joueur_42", "joueur_42"),
        ("\u{3a9}-player", "\u{3a9}-player"),
        (
            "\u{414}\u{438}\u{43c}\u{430}",
            "\u{414}\u{438}\u{43c}\u{430}",
        ),
    ];
    for (input, want) in cases {
        match validate_nickname(input) {
            Err(e) => panic!("ValidateNickname({input:?}) = error {e}, want accepted"),
            Ok(got) => assert_eq!(got, want, "ValidateNickname({input:?})"),
        }
    }
}

#[test]
fn validate_nickname_length() {
    let twenty_one = "a".repeat(21);
    let cases = [
        ("empty", ""),
        ("spaces only", "   "),
        ("21 runes", twenty_one.as_str()),
    ];
    for (name, input) in cases {
        assert_eq!(
            validate_nickname(input),
            Err(GameError::NicknameLength),
            "{name}: want ErrNicknameLength"
        );
    }
    // 20 accented runes are 40 bytes: the limit counts characters, not the
    // bytes they happen to encode to.
    let accented = "\u{e9}".repeat(20);
    if let Err(e) = validate_nickname(&accented) {
        panic!("20 accented runes: err = {e}, want accepted");
    }
}

#[test]
fn validate_nickname_charset() {
    let cases = [
        ("zero-width space", "Ali\u{200b}ce"),
        ("zero-width joiner", "Ali\u{200d}ce"),
        ("zero-width non-joiner", "Ali\u{200c}ce"),
        ("byte order mark", "Ali\u{feff}ce"),
        ("soft hyphen", "Ali\u{ad}ce"),
        ("RTL override", "Ali\u{202e}ce"),
        ("LTR embedding", "\u{202a}Alice"),
        ("bidi isolate", "\u{2066}Alice\u{2069}"),
        ("newline", "Ali\nce"),
        ("tab", "Ali\tce"),
        ("NUL", "Ali\x00ce"),
        ("non-breaking space", "Ali\u{a0}ce"),
        ("emoji", "Alice\u{1f525}"),
        ("stacked diacritics", "A\u{301}\u{301}\u{301}lice"),
        ("leading combining mark", "\u{301}Alice"),
        ("mathematical bold", "\u{1d41f}\u{1d42e}\u{1d41c}\u{1d424}"),
        ("markup", "<script>"),
        ("symbol", "Ali\u{a9}e"),
        ("no letter or digit", "---"),
    ];
    for (name, input) in cases {
        assert_eq!(
            validate_nickname(input),
            Err(GameError::NicknameCharset),
            "{name} ({input:?}): want ErrNicknameCharset"
        );
    }
    // One mark on a base letter is a legitimate way to write a name; it is the
    // stack that is not.
    if let Err(e) = validate_nickname("A\u{301}lice") {
        panic!("single combining mark: err = {e}, want accepted");
    }
}

#[test]
fn validate_nickname_blocks_insults() {
    // The point is the normalisation, not the list: each of these reaches the
    // same entry through a different disguise.
    let blocked = [
        "fuck",
        "FUCK",
        "Fuuuuck",
        "f u c k",
        "f.u.c.k",
        "f-u-c-k",
        "f\u{fc}ck",   // diacritic
        "5h1t",        // leet s/i
        "n1gg3r",      // leet i/e
        "n i g g e r", // separators
        "n\u{cd}gger", // case + diacritic
        "niiiigger",   // repeats
        "encule",
        "encul\u{e9}",
        "3ncul3",
        "salope",
        "xXsalopeXx",
        "con",                // whole-word entry
        "c0n",                // leet, still whole-word
        "Nique ta m\u{e8}re", // a multi-word entry, matched on the whole nickname
        "niquetamere",
        "\u{425}\u{443}\u{439}", // the Russian list: the alphabet is allowed, so the list must be
    ];
    for n in blocked {
        assert_eq!(
            validate_nickname(n),
            Err(GameError::NicknameBlocked),
            "ValidateNickname({n:?}), want ErrNicknameBlocked"
        );
    }
}

#[test]
fn validate_nickname_accepts_legitimate_names() {
    // The false-positive set. Every one of these contains a blocked term as a
    // substring once normalised, or reads like one.
    let ok = [
        "Constance",
        "Connor",
        "Concepcion",
        "Bacon",
        "Falcon",
        "Deacon",
        "Dominique",
        "Monique",
        "D\u{e9}pute",
        "R\u{e9}putation",
        "Scunthorpe",
        "Penistone",
        "Cockburn",
        "Nigeria",
        "Niger",
        "Nigerian",
        "Shitake",
        "Anna",
        "Cassandra",
        "\u{c9}tienne",
        "Chlo\u{e9}",
        "I\u{f1}igo",
        "As",
        "Mr. Bean",
        "D'Artagnan",
        // The fixtures the test suites are written with. A filter that refused
        // one of these would take the E2E suite down with it.
        "Alice",
        "Bob",
        "Carol",
        "Host",
        "MobileAlice",
        "Player1",
        "Bot1",
    ];
    for n in ok {
        if let Err(e) = validate_nickname(n) {
            panic!("ValidateNickname({n:?}) = {e}, want accepted");
        }
    }
}

#[test]
fn normalize_nickname() {
    let cases = [
        ("Alice", "alice"),
        ("\u{c9}tienne", "etienne"),
        ("A\u{301}lice", "alice"),
        ("J-e_a.n Luc", "jeanluc"),
        ("5h1t", "shit"),
        ("@rn4ud", "arnaud"),
    ];
    for (input, want) in cases {
        assert_eq!(
            nickname::normalize_nickname(input),
            want,
            "normalizeNickname({input:?})"
        );
    }
}

// The embedded lists are the filter. An embed that resolved to nothing would
// leave every insult accepted and every other test in this file still passing.
#[test]
fn wordlists_are_embedded() {
    let l = lists();
    assert!(
        l.bad_words.len() >= 500,
        "badWords = {} entries, want the vendored LDNOOBW lists",
        l.bad_words.len()
    );
    assert!(
        l.bad_substrings.len() >= 200,
        "badSubstrings = {} entries, want the long terms of those lists",
        l.bad_substrings.len()
    );
}

// Every rejection reaches the player as one string, so the reason a nickname
// was refused stays on the server: a player who learns *which* rule fired
// learns how to walk around it.
#[test]
fn nickname_errors_are_one_wire_string() {
    for err in [
        GameError::NicknameLength,
        GameError::NicknameCharset,
        GameError::NicknameBlocked,
    ] {
        assert!(
            err.kind() == ErrorKind::NicknameRejected,
            "{err} does not wrap ErrNicknameRejected"
        );
        // Every nickname refusal starts with the one text a player is shown.
        assert!(
            err.to_string().starts_with(NICKNAME_REJECTED),
            "{err} does not start with {NICKNAME_REJECTED:?}"
        );
    }
}
