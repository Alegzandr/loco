//! Nickname validation.
//!
//! The nickname is the only string a player ever authors, printed on a seat,
//! in the score table and in a clip somebody is streaming. Shape first, then
//! meaning, and the player is never told which rule fired: every refusal is one
//! of three [`GameError`] variants the hub sends as
//! [`crate::error::NICKNAME_REJECTED`].
//!
//! The word list (`wordlists/`, Shutterstock's LDNOOBW, CC BY 4.0, see
//! `NOTICE.md`) is compiled in with `include_str!`. How it is applied is ours,
//! because applied naively it refuses half a phone book:
//!  1. the whole nickname and every token in it match every term;
//!  2. substring matching only for terms of `SUBSTRING_MIN_LEN` characters or
//!     more — the entire false-positive control ("ass" lives in Cassandra);
//!  3. an allowlist for the collisions rule 2 still leaves, whole name only.

use crate::error::GameError;
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;
use unicode_general_category::{GeneralCategory as Gc, get_general_category};

/// Counts characters, not bytes: "Étienne" is 7 characters and 8 bytes.
/// `client/src/test/serverMirrors.test.ts` reads this line.
pub const NICKNAME_MAX_RUNES: usize = 20;

/// How many combining marks may sit on one base letter. One is how "Á" is
/// written when it is not precomposed; a stack of them is Zalgo.
const NICKNAME_MAX_MARKS: usize = 1;

/// The punctuation a name legitimately contains: O'Brien, Anne-Marie, Mr. Bean,
/// joueur_42. Everything else is refused.
const NICKNAME_PUNCT: &str = "-_.'";

/// Rule 2: below this, a term only matches a whole token.
pub const SUBSTRING_MIN_LEN: usize = 6;

/// Rule 3: real names and places whose normalised form carries a long entry.
/// An *allow* list, so a missing entry fails as a refusal, never as a slur.
pub const NICKNAME_ALLOW_SEED: [&str; 15] = [
    "scunthorpe",
    "penistone",
    "cockburn",
    "lightwater",
    "clitheroe",
    "niger",
    "nigeria",
    "nigerian",
    "nigerien",
    "nigerienne",
    "shitake",
    "shiitake",
    "bordeleau",
    "matsushita",
    "assange",
];

/// The vendored lists, one per language, in file-name order.
const WORDLISTS: [&str; 19] = [
    include_str!("../wordlists/cs.txt"),
    include_str!("../wordlists/da.txt"),
    include_str!("../wordlists/de.txt"),
    include_str!("../wordlists/en.txt"),
    include_str!("../wordlists/eo.txt"),
    include_str!("../wordlists/es.txt"),
    include_str!("../wordlists/fi.txt"),
    include_str!("../wordlists/fil.txt"),
    include_str!("../wordlists/fr-CA.txt"),
    include_str!("../wordlists/fr.txt"),
    include_str!("../wordlists/hu.txt"),
    include_str!("../wordlists/it.txt"),
    include_str!("../wordlists/nl.txt"),
    include_str!("../wordlists/no.txt"),
    include_str!("../wordlists/pl.txt"),
    include_str!("../wordlists/pt.txt"),
    include_str!("../wordlists/ru.txt"),
    include_str!("../wordlists/sv.txt"),
    include_str!("../wordlists/tr.txt"),
];

/// Canonicalises and checks an inbound nickname: trimmed, internal runs of
/// spaces collapsed, 1–20 characters, an allowlisted charset, no blocked term.
/// Returns the form the room should store.
pub fn validate_nickname(raw: &str) -> Result<String, GameError> {
    let n = collapse_spaces(raw);
    let count = n.chars().count();
    if count == 0 || count > NICKNAME_MAX_RUNES {
        return Err(GameError::NicknameLength);
    }
    check_nickname_charset(&n)?;
    if blocked_nickname(&n) {
        return Err(GameError::NicknameBlocked);
    }
    Ok(n)
}

/// Trims and squeezes runs of the one space the charset allows. Every other
/// space is a character the nickname may not contain, and the charset says so.
pub(crate) fn collapse_spaces(s: &str) -> String {
    let mut b = String::with_capacity(s.len());
    let mut prev_space = true; // leading spaces go by the same rule as doubles
    for r in s.chars() {
        if r == ' ' {
            if prev_space {
                continue;
            }
            prev_space = true;
            b.push(r);
            continue;
        }
        prev_space = false;
        b.push(r);
    }
    if b.ends_with(' ') {
        b.pop();
    }
    b
}

fn is_mn(r: char) -> bool {
    get_general_category(r) == Gc::NonspacingMark
}

/// Whether a character is a letter: the five Unicode letter categories.
fn is_letter(r: char) -> bool {
    matches!(
        get_general_category(r),
        Gc::UppercaseLetter
            | Gc::LowercaseLetter
            | Gc::TitlecaseLetter
            | Gc::ModifierLetter
            | Gc::OtherLetter
    )
}

fn is_upper(r: char) -> bool {
    get_general_category(r) == Gc::UppercaseLetter
}

fn is_lower(r: char) -> bool {
    get_general_category(r) == Gc::LowercaseLetter
}

fn is_digit(r: char) -> bool {
    get_general_category(r) == Gc::DecimalNumber
}

/// A simple (one-to-one) case mapping. Rust's full mapping turns 'İ' into two
/// characters; the simple one keeps one character for one and gives 'i', the
/// first of them.
fn to_lower(r: char) -> char {
    r.to_lowercase().next().unwrap_or(r)
}

/// The alphabet a nickname may be written in: Latin, Greek, Cyrillic. An
/// allowlist rather than "is a letter", because the Mathematical Alphanumeric
/// Symbols block is letters too and renders as the word.
fn in_nickname_scripts(r: char) -> bool {
    matches!(r as u32,
        0x0041..=0x005a // A-Z
        | 0x0061..=0x007a // a-z
        | 0x00c0..=0x024f // Latin-1 letters + Latin Extended-A/B
        | 0x0370..=0x03ff // Greek
        | 0x0400..=0x04ff) // Cyrillic
}

pub(crate) fn check_nickname_charset(s: &str) -> Result<(), GameError> {
    let mut has_alnum = false;
    let mut marks = 0;
    let mut prev_base = false;
    for r in s.chars() {
        if is_mn(r) {
            // A combining mark modifies the letter before it: it cannot open a
            // nickname and it cannot pile up.
            if !prev_base || marks >= NICKNAME_MAX_MARKS {
                return Err(GameError::NicknameCharset);
            }
            marks += 1;
        } else if r.is_ascii_digit() || (in_nickname_scripts(r) && is_letter(r)) {
            has_alnum = true;
            prev_base = true;
            marks = 0;
        } else if r == ' ' || NICKNAME_PUNCT.contains(r) {
            prev_base = false;
            marks = 0;
        } else {
            return Err(GameError::NicknameCharset);
        }
    }
    // "---" is inside the charset and is not a name.
    if !has_alnum {
        return Err(GameError::NicknameCharset);
    }
    Ok(())
}

/// Precomposed accented letters onto their base. Decomposed input is handled
/// by dropping the mark, so both spellings of "é" fold the same.
fn fold(r: char) -> Option<&'static str> {
    Some(match r {
        'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'ā' | 'ă' | 'ą' => "a",
        'ç' | 'ć' | 'ĉ' | 'ċ' | 'č' => "c",
        'ď' | 'đ' | 'ð' => "d",
        'è' | 'é' | 'ê' | 'ë' | 'ē' | 'ĕ' | 'ė' | 'ę' | 'ě' => "e",
        'ĝ' | 'ğ' | 'ġ' | 'ģ' => "g",
        'ĥ' | 'ħ' => "h",
        'ì' | 'í' | 'î' | 'ï' | 'ĩ' | 'ī' | 'ĭ' | 'į' | 'ı' => "i",
        'ĵ' => "j",
        'ķ' => "k",
        'ĺ' | 'ļ' | 'ľ' | 'ł' => "l",
        'ñ' | 'ń' | 'ņ' | 'ň' => "n",
        'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ø' | 'ō' | 'ŏ' | 'ő' => "o",
        'ŕ' | 'ŗ' | 'ř' => "r",
        'ś' | 'ŝ' | 'ş' | 'š' | 'ș' => "s",
        'ţ' | 'ť' | 'ŧ' | 'ț' => "t",
        'ù' | 'ú' | 'û' | 'ü' | 'ũ' | 'ū' | 'ŭ' | 'ů' | 'ű' | 'ų' => "u",
        'ŵ' => "w",
        'ý' | 'ÿ' | 'ŷ' => "y",
        'ź' | 'ż' | 'ž' => "z",
        'þ' => "th",
        'ß' => "ss",
        'æ' => "ae",
        'œ' => "oe",
        _ => return None,
    })
}

/// The substitutions meant to be read as letters. Conservative on purpose:
/// '2' is absent ("l33t" reads, "b2b" does not).
fn leet(r: char) -> Option<char> {
    Some(match r {
        '0' => 'o',
        '1' => 'i',
        '3' => 'e',
        '4' => 'a',
        '5' => 's',
        '7' => 't',
        '@' => 'a',
        '$' => 's',
        '!' => 'i',
        '+' => 't',
        '|' => 'i',
        _ => return None,
    })
}

/// Folds a nickname to the form the list is written in: lower case, no
/// diacritics, no leet, no separators. Repeats are left alone.
pub(crate) fn normalize_nickname(s: &str) -> String {
    let mut b = String::with_capacity(s.len());
    for r in s.chars() {
        if is_mn(r) {
            continue; // a stripped diacritic, decomposed spelling
        }
        let r = to_lower(r);
        if let Some(f) = fold(r) {
            b.push_str(f);
            continue;
        }
        if let Some(l) = leet(r) {
            b.push(l);
            continue;
        }
        if is_letter(r) || r.is_ascii_digit() {
            b.push(r);
        }
        // everything else is a separator: "f.u.c.k" is "fuck"
    }
    b
}

/// Squeezes runs of the same character to one ("fuuuuck").
pub(crate) fn collapse_repeats(s: &str) -> String {
    let mut b = String::with_capacity(s.len());
    let mut prev = None;
    for r in s.chars() {
        if Some(r) != prev {
            b.push(r);
        }
        prev = Some(r);
    }
    b
}

pub(crate) struct Lists {
    /// Every term, matched whole.
    pub bad_words: HashSet<String>,
    /// The long ones, matched anywhere.
    pub bad_substrings: Vec<String>,
    pub allow: HashSet<String>,
}

pub(crate) fn lists() -> &'static Lists {
    static LISTS: OnceLock<Lists> = OnceLock::new();
    LISTS.get_or_init(|| {
        let mut bad_words = HashSet::with_capacity(2048);
        let mut bad_substrings = Vec::new();
        let mut seen: HashMap<String, ()> = HashMap::new();
        for raw in WORDLISTS {
            for line in raw.split('\n') {
                let line = line.trim();
                if line.is_empty() || line.starts_with('#') {
                    continue;
                }
                // Terms go through the same normalisation as the input.
                let term = normalize_nickname(line);
                if term.is_empty() {
                    continue; // an entry that is only punctuation or an emoji
                }
                bad_words.insert(term.clone());
                if term.chars().count() < SUBSTRING_MIN_LEN {
                    continue;
                }
                for v in [term.clone(), collapse_repeats(&term)] {
                    if seen.insert(v.clone(), ()).is_some() {
                        continue;
                    }
                    bad_substrings.push(v);
                }
            }
        }
        let allow = NICKNAME_ALLOW_SEED
            .iter()
            .map(|w| normalize_nickname(w))
            .collect();
        Lists {
            bad_words,
            bad_substrings,
            allow,
        }
    })
}

/// Whether the nickname carries a blocked term once normalised.
pub(crate) fn blocked_nickname(n: &str) -> bool {
    let l = lists();
    let plain = normalize_nickname(n);
    if plain.is_empty() {
        return false;
    }
    if l.allow.contains(&plain) {
        return false;
    }
    let squeezed = collapse_repeats(&plain);
    // Whole nickname, then every token. The squeezed form is matched against
    // the terms as written, never a squeezed list: squeezing "nigger" is a
    // country.
    let mut cands = nickname_tokens(n);
    cands.push(plain.clone());
    cands.push(squeezed.clone());
    for cand in &cands {
        if l.bad_words.contains(cand) || l.bad_words.contains(&collapse_repeats(cand)) {
            return true;
        }
    }
    l.bad_substrings
        .iter()
        .any(|term| plain.contains(term.as_str()) || squeezed.contains(term.as_str()))
}

/// Cuts a nickname into the words a person reads in it, normalised: on
/// separators, on digit boundaries and on lower→upper transitions
/// ("xXsalopeXx").
pub(crate) fn nickname_tokens(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut prev: Option<char> = None;
    let flush = |cur: &mut String, out: &mut Vec<String>| {
        let t = normalize_nickname(cur);
        if !t.is_empty() {
            out.push(t);
        }
        cur.clear();
    };
    for r in s.chars() {
        if r == ' ' || NICKNAME_PUNCT.contains(r) {
            flush(&mut cur, &mut out);
            prev = None;
            continue;
        }
        if let Some(p) = prev
            && (is_digit(r) != is_digit(p) || (is_upper(r) && is_lower(p)))
        {
            flush(&mut cur, &mut out);
        }
        cur.push(r);
        prev = Some(r);
    }
    flush(&mut cur, &mut out);
    out
}
