//! The authoritative server's runtime: the hub, the tables, the sockets, the
//! drain and the snapshot. One module per thing a message leads to, laid out
//! in the table at the top of `docs/notes/server.md`.
//!
//! The rules this crate exists to keep, briefly (the reasons are in the note):
//! a table is one task that owns its state and nothing else reads it; the hub
//! routes and the table decides; every crossing between them is non-blocking;
//! a panic costs one message; and nothing outside `privacy.rs` reads a remote
//! address.

#![forbid(unsafe_code)]

pub mod actor;
pub mod bots;
pub mod broadcast;
pub mod client;
pub mod clock;
pub mod config;
pub mod convert;
pub mod debug;
pub mod dispatch;
pub mod drain;
pub mod emotes;
pub mod gameplay;
pub mod gotime;
pub mod hub;
pub mod ids;
#[cfg(test)]
mod internal_tests;
pub mod live;
pub mod logsink;
pub mod maploading;
pub mod matchmaking;
pub mod metrics;
pub mod online;
pub mod presence;
pub mod privacy;
pub mod refusal;
pub mod rematch;
pub mod room;
pub mod rooms;
pub mod serve;
pub mod snapshot;
pub mod solo;
pub mod statedto;
pub mod table;
#[cfg(any(test, feature = "testkit"))]
pub mod testkit;
pub mod tokens;
pub mod turntimer;
pub mod wire;

pub use actor::{DeadlineKey, Deadlines, Phase, TableCtx, TableHandle, TableJob, TableSender};
pub use client::Client;
pub use config::{HubConfig, Limits, Timings};
pub use drain::DRAIN_REFUSAL;
pub use hub::{Hub, HubCore};
pub use ids::{InvalidRoomCode, RoomCode, SessionToken};
pub use logsink::AsyncLog;
pub use metrics::{HealthStats, LiveStats, MetricsStats};
pub use serve::routes;
pub use snapshot::{SNAPSHOT_SCHEMA_VERSION, SnapshotError};
pub use table::Table;
