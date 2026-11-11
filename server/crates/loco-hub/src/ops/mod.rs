//! What an operator sees and does: the configuration, the one clock, the
//! metrics, the asynchronous log, the drain on `SIGTERM` and the snapshot it
//! writes.

pub mod clock;
pub mod config;
pub mod drain;
pub mod gotime;
pub mod logsink;
pub mod metrics;
pub mod snapshot;
