//! Ported from `server/game/rng_test.go`, against ChaCha.
//!
//! The deal is hidden state, so the source that produces it has to be
//! unguessable. This runs the actual attack rather than asserting a property of
//! the constructor: seeding a room from the clock is not wrong because the
//! clock is "not random", it is wrong because an attacker who can bracket the
//! moment the room was seeded has a search space small enough to walk, and the
//! first message the server sends back tells them when they have found it.
//!
//! The crate cannot read the OS, so the seed is the hub's to draw
//! (`Room::new(code, [u8; 32])`). What this file pins is that a ChaCha room
//! seeded the way the hub seeds it survives the attack, and that the attack is
//! real against the same cipher seeded from a clock: ChaCha is not what makes
//! the deal hidden, the seed is.
//!
//! The observables are exactly what a player receives in `game_started`: the
//! map, the starting seat, and their own eight cards.

use crate::card::Card;
use crate::maps::MapId;
use crate::room::Room;
use crate::tests::support::NOW;
use rand_core::Rng;
use std::collections::HashSet;
use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, PartialEq, Eq)]
struct Deal {
    map_id: Option<MapId>,
    turn: usize,
    hand: Vec<Card>,
}

fn deal_of(mut r: Room, nicknames: &[&str]) -> Deal {
    for n in nicknames {
        r.join(n).unwrap_or_else(|e| panic!("Join({n:?}): {e}"));
    }
    r.start(NOW).expect("Start");
    let st = r.state.as_ref().unwrap();
    Deal {
        map_id: r.map_id,
        turn: st.current_turn,
        hand: st.hands[0].cards.clone(),
    }
}

/// Replays the server's deal for a candidate clock seed: the attacker's model
/// of a server that seeded its room from the nanosecond clock.
fn deal_from_seed(seed: u64, nicknames: &[&str]) -> Deal {
    deal_of(Room::from_u64_seed("SEED01", seed), nicknames)
}

/// Walks every nanosecond in `[from, to]` and reports the seed whose deal
/// matches. The attacker's offline step: one candidate costs a shuffle.
fn search_clock_seeds(from: u64, to: u64, nicknames: &[&str], target: &Deal) -> Option<u64> {
    (from..=to).find(|&seed| deal_from_seed(seed, nicknames) == *target)
}

fn clock_nanos() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock after 1970")
        .as_nanos() as u64
}

/// 32 bytes the way the hub draws them: from the OS, through std's own
/// randomly keyed hasher (the crate under test may not depend on `getrandom`).
fn os_seed() -> [u8; 32] {
    let mut seed = [0u8; 32];
    for (i, chunk) in seed.chunks_mut(8).enumerate() {
        let mut h = RandomState::new().build_hasher();
        h.write_usize(i);
        chunk.copy_from_slice(&h.finish().to_le_bytes());
    }
    seed
}

/// The regression test for the audit finding: it fails against a room seeded
/// from the clock.
#[test]
fn new_room_seed_is_not_recoverable_from_the_clock() {
    let nicknames = ["alice", "bob"];

    // Bracket the seeding, and only the seeding: the tightest window an
    // attacker could ever have. Capped so the search stays a unit test on a
    // clock with a coarse tick.
    let before = clock_nanos();
    let seed = os_seed();
    let after = clock_nanos().clamp(before, before + 20_000);

    let observed = deal_of(Room::new("REAL01", seed), &nicknames);

    // The positive control: without it this passes for the wrong reason the
    // moment the replay drifts out of step with deal_round. Hide a clock-shaped
    // seed in the same window and find it.
    let planted_seed = before + (after - before) / 2;
    let planted = deal_from_seed(planted_seed, &nicknames);
    assert_eq!(
        search_clock_seeds(before, after, &nicknames, &planted),
        Some(planted_seed),
        "the seed search is broken: this test proves nothing until it passes"
    );

    // The finding itself.
    if let Some(found) = search_clock_seeds(before, after, &nicknames, &observed) {
        panic!(
            "the room's deal was reproduced from clock seed {found}: every opponent's hand and \
             the whole draw order are derivable by anyone who timed create_room. Seed the room \
             from the OS (Room::new with 32 random bytes), never from the clock"
        );
    }
}

/// The other half: a random seed is only worth having if each room gets its
/// own. A hub that drew the entropy once into a shared value would pass the
/// test above while dealing every table in the process the same cards.
#[test]
fn new_rng_draws_differ_process_wide() {
    const N: usize = 64;
    let mut seen = HashSet::with_capacity(N);
    for _ in 0..N {
        let mut r = Room::new("TABLE1", os_seed());
        let v = r.rng_mut().next_u64();
        assert!(
            seen.insert(v),
            "a room repeated another's first draw within {N} rooms: the seed is shared, so \
             every table deals alike"
        );
    }
    // And the converse, which is what makes the first half meaningful: the
    // room reads nothing but its seed.
    let seed = os_seed();
    assert_eq!(
        Room::new("A", seed).rng_mut().next_u64(),
        Room::new("B", seed).rng_mut().next_u64(),
    );
}
