//! The room a table holds: the domain's, seeded here.
//!
//! The deal is hidden state, so the room's RNG is seeded from the operating
//! system and nowhere else (`game/rng_test.go`'s clock-seed attack is why).
//! The RNG is never serialised: a room that comes back from a snapshot has
//! none, and [`reseed`] is what makes it playable again.

pub use loco_game::{Room, Status};

/// A fresh lobby at `code`, its RNG drawn from the OS. The only way the hub
/// makes a room.
pub fn new_room(code: &str) -> Room {
    Room::new(code, crate::tokens::room_seed())
}

/// Gives a restored room a fresh OS seed. Go's `ensureRNG` did the same on
/// first use; here it is explicit and done before the table starts.
pub fn reseed(room: &mut Room) {
    room.reseed(crate::tokens::room_seed());
}
