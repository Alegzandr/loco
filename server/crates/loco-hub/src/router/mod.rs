//! The hub loop and what it owns: registration, routing a message to the table
//! its code names, the index of tables, the 1v1 queue, the solo game's setup,
//! the online count and the live-streams list. The router routes; the table
//! decides.

pub mod dispatch;
pub mod hub;
pub mod live;
pub mod matchmaking;
pub mod online;
pub mod rooms;
pub mod solo;
