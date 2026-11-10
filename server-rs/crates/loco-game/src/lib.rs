//! The LOCO! game domain, ported from `server/game/` (Go).
//!
//! Pure on purpose: no async, no I/O, no clock and no OS randomness. Time enters
//! as data (`now`, Unix milliseconds, on every action that reads or stamps it)
//! and the only source of randomness is the room's own `ChaCha12Rng`, seeded by
//! the caller. The hub seeds it from the OS, which is what keeps the deal hidden
//! (`tests/rng_test.rs` runs the clock-seed attack against it).
//!
//! Two ways in, one behaviour:
//! - [`Room::apply`] is the `(state, action) -> state` form: `&self` in, a new
//!   [`Room`] and the [`Event`]s the action produced out, or a [`GameError`] and
//!   nothing changed.
//! - The `&mut self` methods (`play_card`, `draw_card`, …) are the Go entry
//!   points one for one, for the hub's table task that owns its room and for
//!   the tests ported from Go. `apply` is built on them.
//!
//! `API.md` beside this crate maps every Go function to its Rust counterpart.

pub mod bot;
pub mod card;
pub mod deck;
pub mod error;
pub mod event;
pub mod hand;
pub mod maps;
pub mod nickname;
mod rng;
pub mod room;
pub mod rules;
pub mod screen;
pub mod stamp;

#[cfg(test)]
mod tests;

pub use bot::{BotAction, BotActionKind, BotInterruptAction, bot_interrupt, bot_think};
pub use card::{Card, Color, Kind, card_value};
pub use deck::Deck;
pub use error::GameError;
pub use event::{EventKind, GameEvent};
pub use hand::Hand;
pub use maps::{MapId, TimeOfDay, Weather};
pub use nickname::validate_nickname;
pub use room::{Action, Event, GameState, MatchFormat, Player, Room, Status};
pub use rules::can_play;
pub use screen::contains_blocked_term;

/// An instant, as Unix milliseconds. Every deadline and timestamp in the domain
/// is one of these, handed in by the caller.
pub type Millis = i64;

/// A seat index. Signed because the wire and the Go domain both use -1 for
/// "no seat" (`LastPlayBy`, `ChosenPlayer`, an event with no player), and
/// because a seat number arriving from the wire may be anything.
pub type Seat = i32;
