//! The WebSocket protocol between the LOCO! client and server.
//!
//! This crate is the single source of the wire: the server serializes these
//! types, and the client's `src/types/protocol.ts` and `protocolSchemas.ts` are
//! generated from them by `crates/protocolgen` (`make protocol`). CI fails when
//! the committed files and this crate disagree.
//!
//! The JSON is a flat object holding `type` and the message's fields. The
//! parity fixtures under `tests/fixtures/` are golden frames, the wire
//! contract the client is built against, and `tests/parity.rs` reads each one
//! into these types and writes it back out unchanged.

pub mod client;
pub mod dto;
pub mod enums;
pub mod generate;
pub mod server;

pub use client::*;
pub use dto::*;
pub use enums::*;
pub use server::*;

/// Whether a field holds its type's zero, which an omit-when-empty field
/// leaves out. Every `skip_serializing_if` on a non-`Option`, non-`Vec` field
/// goes through here, so "omitted when zero" has one spelling.
pub(crate) fn is_default<T: Default + PartialEq>(v: &T) -> bool {
    *v == T::default()
}
