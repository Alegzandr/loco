//! Port of `server/hub/suspect_test.go`.

use crate::client::SUSPECT_THRESHOLD;
use crate::{Client, Hub, HubConfig};
use loco_game::GameError;
use std::sync::atomic::Ordering;

fn suspected(hub: &Hub) -> i64 {
    hub.metrics().suspected_cheats.load(Ordering::Relaxed)
}

// suspected_cheats is a pointer for an operator, not a scoreboard of how
// contested the table was. LOCO decides interrupts by arrival order and catches
// on a five-second window, so a good player loses those races constantly.
#[tokio::test]
async fn note_rejection_lost_races_are_not_suspicious() {
    let hub = Hub::start(HubConfig::default());
    let (c, _rx) = Client::detached(&hub);

    let lost = [
        GameError::AlreadyDrawn,
        GameError::MustDrawBeforePass,
        GameError::InterruptWindowClosed,
        GameError::InterruptMismatch,
        GameError::InterruptNotADrawCard,
        GameError::AlreadyDeclared,
    ];
    // Well past the threshold, several times over.
    for i in 0..(SUSPECT_THRESHOLD * 3) as usize {
        c.note_rejection(&lost[i % lost.len()]);
    }
    assert_eq!(
        suspected(&hub),
        0,
        "suspected_cheats after {} lost races",
        SUSPECT_THRESHOLD * 3
    );
    hub.stop().await;
}

// The metric must still do its job. An illegal card is not a race: the client
// decides legality before it sends, so a stream of them is a client that is not
// ours.
#[tokio::test]
async fn note_rejection_still_catches_real_rejections() {
    let hub = Hub::start(HubConfig::default());
    let (c, _rx) = Client::detached(&hub);
    for _ in 0..SUSPECT_THRESHOLD {
        c.note_rejection(&GameError::IllegalPlay);
    }
    assert_eq!(suspected(&hub), 1);
    hub.stop().await;
}

// A wrapped sentinel is the same sentinel. Anything that reaches for the error
// string instead breaks the first time a message is reworded.
//
// Adapted: Rust's `GameError` is an enum and nothing wraps it, so the
// classification is by variant by construction. What is left to pin is that
// the lost race is recognised by its variant whatever its wire text, i.e.
// many presses of the same lost race stay unsuspicious.
#[tokio::test]
async fn note_rejection_matches_wrapped_sentinels() {
    let hub = Hub::start(HubConfig::default());
    let (c, _rx) = Client::detached(&hub);
    for _ in 0..SUSPECT_THRESHOLD * 2 {
        c.note_rejection(&GameError::InterruptMismatch);
    }
    assert_eq!(suspected(&hub), 0, "a lost race counted as suspect");
    hub.stop().await;
}

// Go passed a nil error. `note_rejection` takes a `&GameError`, so there is no
// "no error" to pass: the type system is the guarantee.
#[test]
#[ignore = "NOT-PORTABLE: note_rejection takes &GameError; a nil error cannot be expressed"]
fn note_rejection_nil_is_not_a_rejection() {}
