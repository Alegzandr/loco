//! The LOCO! game domain, ported from `server/game/` (Go).
//!
//! Pure on purpose: no async, no I/O, no clock and no OS randomness. Time enters
//! as data (`now`, Unix milliseconds, on every action that reads or stamps it)
//! and the only source of randomness is the room's own `ChaCha12Rng`, seeded by
//! the caller. The hub seeds it from the OS, which is what keeps the deal hidden
//! (`tests/rng_test.rs` runs the clock-seed attack against it).
//!
//! One way in: a [`Room`] is owned by one table task, and every command is a
//! `&mut self` method that validates before it mutates, so a refusal leaves the
//! room exactly as it was (see `room.rs`).
//!
//! `API.md` beside this crate maps every Go function to its Rust counterpart.

pub mod bot;
pub mod card;
pub mod deck;
pub mod error;
pub mod event;
pub mod gojson;
pub mod hand;
pub mod maps;
pub mod nickname;
mod rng;
pub mod room;
pub mod rules;
pub mod screen;
pub mod state;

#[cfg(test)]
mod tests;

pub use bot::{BotAction, BotActionKind, BotInterruptAction, bot_interrupt, bot_think};
pub use card::{Card, Color, Kind, card_value};
pub use deck::Deck;
pub use error::{ErrorKind, GameError};
pub use event::{EventKind, GameEvent};
pub use hand::Hand;
pub use maps::{MapId, TimeOfDay, Weather};
pub use nickname::validate_nickname;
pub use room::{CatchCharge, MatchFormat, Player, Room, SavedRoom, Status};
pub use rules::can_play;
pub use screen::contains_blocked_term;
pub use state::{GameState, SeatState};

/// An instant, as Unix milliseconds. Every deadline and timestamp in the domain
/// is one of these, handed in by the caller.
pub type Millis = i64;

/// A seat: an index into the table's hands and seat records, as the hub and
/// every `Vec` index it. "Nobody" is `Option<Seat>::None`, never a sentinel;
/// the -1 Go used survives only in JSON (`gojson::opt_seat`), where the wire
/// and the snapshot still carry it.
pub type Seat = usize;
