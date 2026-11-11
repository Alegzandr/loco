//! The authoritative server's runtime: the hub, the tables, the sockets, the
//! drain and the snapshot, grouped by what a module is for:
//!
//! - [`net`]: the socket edge (admission, origin, the pumps, privacy, the wire);
//! - [`router`]: the hub loop (registration, routing by code, the rooms index,
//!   matchmaking, the online count, the live strip);
//! - [`table`]: one table (the `Table` value, its task, its deadlines, and one
//!   module per kind of message it handles);
//! - [`ops`]: what an operator sees and does (config, clock, metrics, the log
//!   sink, the drain, the snapshot);
//! - [`ids`] and [`tokens`]: the room code and the session token, and minting
//!   both from the operating system. Every layer above names them.
//!
//! The rules this crate exists to keep, briefly (the reasons are in
//! `docs/notes/server.md`): a table is one task that owns its state and nothing
//! else reads it; the router routes and the table decides; every crossing
//! between them is non-blocking; a panic costs one message; and nothing outside
//! `net/privacy.rs` reads a remote address.

#![forbid(unsafe_code)]

pub mod ids;
#[cfg(test)]
mod internal_tests;
pub mod net;
pub mod ops;
pub mod router;
pub mod table;
#[cfg(any(test, feature = "testkit"))]
pub mod testkit;
pub mod tokens;

pub use ids::{InvalidRoomCode, RoomCode, SessionToken};
pub use net::client::Client;
pub use net::serve::routes;
pub use ops::config::{HubConfig, Limits, Timings};
pub use ops::drain::DRAIN_REFUSAL;
pub use ops::logsink::AsyncLog;
pub use ops::metrics::{HealthStats, LiveStats, MetricsStats};
pub use ops::snapshot::{SNAPSHOT_SCHEMA_VERSION, SnapshotError};
pub use router::hub::{Hub, HubCore};
pub use table::Table;
pub use table::actor::{
    DeadlineKey, Deadlines, Phase, TableCtx, TableHandle, TableJob, TableSender,
};
