//! Ported from `server/game/screen_test.go`.

#[allow(unused_imports)]
use super::support::*;
use crate::screen;

// The matcher itself is covered by nickname_test.go. What this file owns is
// the part that is new: that the exported door answers for a name this game
// did not create, and that it is the *matcher* it shares rather than the seat
// label's charset — which is the mistake that would have refused half of
// Twitch.
#[test]
fn contains_blocked_term() {
    let cases = [
        ("a plain channel name", "kisuke_sama", false),
        ("a blocked term on its own", "fuck", true),
        ("a blocked term dressed up", "xXfuckXx", true),
        (
            "the Scunthorpe allowlist still applies",
            "scunthorpe",
            false,
        ),
        ("a real surname carrying a long entry", "Bordeleau", false),
        ("empty", "", false),
        // The reason this is not ValidateNickname: none of these is a legal
        // seat label, and all three are legal Twitch logins.
        ("digits and underscores", "l0co_9000", false),
        ("twenty-five characters", "abcdefghijklmnopqrstuvwxy", false),
        ("a login that is only digits", "123456", false),
    ];
    for (name, input, blocked) in cases {
        assert_eq!(
            screen::contains_blocked_term(input),
            blocked,
            "{name}: ContainsBlockedTerm({input:?})"
        );
    }
}
