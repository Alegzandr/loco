//! The one name this crate is asked about that is not a nickname
//! (`server/game/screen.go`).

/// Whether a name written by somebody outside this game carries a blocked
/// term. It is the nickname matcher and nothing more: the same lists, folding
/// and rules, so the two can never drift. It deliberately does not share
/// [`crate::validate_nickname`]'s charset, which was written for a 20-rune
/// seat label and would drop honest channels by the handful. (Go:
/// `ContainsBlockedTerm`.)
pub fn contains_blocked_term(name: &str) -> bool {
    crate::nickname::blocked_nickname(name)
}
