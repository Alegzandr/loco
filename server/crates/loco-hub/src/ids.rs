//! The two strings the hub must never mix up: a table code, which is public
//! and keys the map of tables, and a session token, which is the one secret
//! behind a seat reclaim. Each is a type so the compiler keeps them apart, and
//! so the token's equality and its `Debug` cannot be the ordinary ones.
//!
//! Both serialise as the bare string (`#[serde(transparent)]`): the drain
//! snapshot is byte-identical to what it was when they were `String`s. The
//! wire structs in `loco-protocol` keep their `String` fields, so the
//! generated TypeScript does not move; the conversion happens where a message
//! is built or read.

use serde::{Deserialize, Serialize};
use std::borrow::Borrow;
use std::fmt;
use std::ops::Deref;
use std::str::FromStr;
use subtle::ConstantTimeEq;

/// A table code: six characters of `rooms::ROOM_CODE_CHARS`, upper case.
///
/// [`RoomCode::parse`] (and `FromStr`) is the door for a code typed by a
/// player: the only check a table code goes through, case aside, and it
/// upper-cases what it accepts. [`RoomCode::from_trusted`] is for a code this
/// server minted itself: the generator, a snapshot, `loco_game::Room::code`.
///
/// `Hash`, `Eq` and `Borrow<str>` agree with `str`'s, so a map keyed by
/// `RoomCode` is looked up by `&str` as well.
#[derive(Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct RoomCode(String);

/// A string that is not a table code.
#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
#[error("invalid room code")]
pub struct InvalidRoomCode;

impl RoomCode {
    /// Checks a code arriving from the wire and canonicalises its case: exactly
    /// `ROOM_CODE_LEN` characters of `ROOM_CODE_CHARS`, either case. The one
    /// place a table code is validated.
    pub fn parse(raw: &str) -> Result<RoomCode, InvalidRoomCode> {
        use crate::router::rooms::{ROOM_CODE_CHARS, ROOM_CODE_LEN};
        let code = raw.to_ascii_uppercase();
        if code.len() == ROOM_CODE_LEN
            && code
                .bytes()
                .all(|b| ROOM_CODE_CHARS.as_bytes().contains(&b))
        {
            Ok(RoomCode(code))
        } else {
            Err(InvalidRoomCode)
        }
    }

    /// Wraps a code this server minted, unchecked.
    pub fn from_trusted(code: impl Into<String>) -> RoomCode {
        RoomCode(code.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn into_string(self) -> String {
        self.0
    }
}

impl FromStr for RoomCode {
    type Err = InvalidRoomCode;
    fn from_str(s: &str) -> Result<RoomCode, InvalidRoomCode> {
        RoomCode::parse(s)
    }
}

impl fmt::Display for RoomCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl fmt::Debug for RoomCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "RoomCode({})", self.0)
    }
}

impl Deref for RoomCode {
    type Target = str;
    fn deref(&self) -> &str {
        &self.0
    }
}

impl AsRef<str> for RoomCode {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

impl Borrow<str> for RoomCode {
    fn borrow(&self) -> &str {
        &self.0
    }
}

impl PartialEq<str> for RoomCode {
    fn eq(&self, other: &str) -> bool {
        self.0 == other
    }
}

impl PartialEq<&str> for RoomCode {
    fn eq(&self, other: &&str) -> bool {
        self.0 == *other
    }
}

impl From<RoomCode> for String {
    fn from(c: RoomCode) -> String {
        c.0
    }
}

/// The secret a seat is reclaimed with. Minted by
/// `tokens::generate_session_token`; whatever a client presents is wrapped
/// with `From<String>` and only ever compared.
///
/// Equality is constant time (`subtle`), not `==`. `Debug` prints
/// `SessionToken(..)` and there is no `Display`, so a token cannot reach a log
/// line by accident; [`SessionToken::expose`] is the one way to read it, for
/// the wire.
#[derive(Clone, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SessionToken(String);

impl SessionToken {
    /// Whether a presented token proves this seat. Constant time, and an
    /// empty value on either side never matches.
    pub fn matches(&self, presented: &SessionToken) -> bool {
        !self.0.is_empty() && !presented.0.is_empty() && self == presented
    }

    /// The secret itself, for the message that hands it to its owner.
    pub fn expose(&self) -> &str {
        &self.0
    }

    pub fn into_string(self) -> String {
        self.0
    }
}

impl PartialEq for SessionToken {
    fn eq(&self, other: &SessionToken) -> bool {
        bool::from(self.0.as_bytes().ct_eq(other.0.as_bytes()))
    }
}

impl Eq for SessionToken {}

impl fmt::Debug for SessionToken {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("SessionToken(..)")
    }
}

impl From<String> for SessionToken {
    fn from(s: String) -> SessionToken {
        SessionToken(s)
    }
}

impl From<&str> for SessionToken {
    fn from(s: &str) -> SessionToken {
        SessionToken(s.to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn a_code_round_trips_through_parse_and_display() {
        let c: RoomCode = "AB23CD".parse().expect("a valid code");
        assert_eq!(c.to_string(), "AB23CD");
        assert_eq!(c.as_str().parse::<RoomCode>(), Ok(c));
    }

    #[test]
    fn parse_accepts_the_alphabet_either_case_and_upper_cases_it() {
        assert_eq!(
            RoomCode::parse("abcdef").map(String::from).as_deref(),
            Ok("ABCDEF")
        );
        for bad in [
            "ABCDE0", "ABCDEO", "ABCDE1", "ABCDEI", "ABCDE", "ABCDEFG", "", "ABCDÉ",
        ] {
            assert_eq!(RoomCode::parse(bad), Err(InvalidRoomCode), "{bad:?}");
        }
    }

    #[test]
    fn a_map_keyed_by_code_is_looked_up_by_str() {
        let mut m = HashMap::new();
        m.insert(RoomCode::from_trusted("ABCDEF"), 1);
        assert_eq!(m.get("ABCDEF"), Some(&1));
        assert!(!m.contains_key("ABCDEG"));
    }

    #[test]
    fn a_code_serialises_as_the_bare_string() {
        let c = RoomCode::from_trusted("ABC234");
        let json = serde_json::to_string(&c).unwrap();
        assert_eq!(json, r#""ABC234""#);
        assert_eq!(serde_json::from_str::<RoomCode>(&json).unwrap(), c);
    }

    #[test]
    fn token_equality_is_exact() {
        let a = SessionToken::from("abc");
        assert_eq!(a, SessionToken::from("abc"));
        assert_ne!(a, SessionToken::from("abd"));
        assert_ne!(a, SessionToken::from("ab"));
        assert_ne!(a, SessionToken::from("abcd"));
    }

    #[test]
    fn a_token_matches_only_on_an_exact_non_empty_value() {
        let t = |s: &str| SessionToken::from(s);
        assert!(t("abc").matches(&t("abc")));
        assert!(!t("abc").matches(&t("abd")));
        assert!(!t("abc").matches(&t("ab")));
        assert!(!t("").matches(&t("")));
        assert!(!t("abc").matches(&t("")));
        assert!(!t("").matches(&t("abc")));
    }

    #[test]
    fn a_tokens_debug_does_not_print_the_secret() {
        let tok = crate::tokens::generate_session_token();
        let shown = format!("{tok:?} {:?}", Some(&tok));
        assert!(!shown.contains(tok.expose()), "{shown}");
        assert_eq!(format!("{tok:?}"), "SessionToken(..)");
    }

    #[test]
    fn a_token_serialises_as_the_bare_string() {
        let tok = SessionToken::from("0123456789abcdef0123456789abcdef");
        let json = serde_json::to_string(&tok).unwrap();
        assert_eq!(json, r#""0123456789abcdef0123456789abcdef""#);
        assert_eq!(serde_json::from_str::<SessionToken>(&json).unwrap(), tok);
    }
}
