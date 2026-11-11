//! The room a table holds: the domain's, seeded here.
//!
//! The deal is hidden state, so the room's RNG is seeded from the operating
//! system and nowhere else (`loco-game`'s `rng_test.rs` runs the clock-seed attack that is why).
//! The RNG is never serialised: a room that comes back from a snapshot is
//! given a fresh seed by [`restore_room`].

pub use loco_game::{Room, Status};

/// A fresh lobby at `code`, its RNG drawn from the OS. The only way the hub
/// makes a room.
pub fn new_room(code: &str) -> Room {
    Room::new(code, crate::tokens::room_seed())
}

/// The room a snapshot saved, its RNG drawn from the OS exactly as
/// [`new_room`]'s is, before the table starts.
pub fn restore_room(saved: loco_game::SavedRoom) -> Room {
    saved.restore(crate::tokens::room_seed())
}
