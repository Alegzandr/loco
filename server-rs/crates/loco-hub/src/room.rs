//! The room a table holds, kept opaque until the domain crate lands.
//!
//! TODO(after loco-game merges): delete this file and hold a
//! `loco_game::Room` in `Table::room`. The snapshot relies on the domain
//! keeping Go's JSON field names (`docs/migration.md`, step 2 contract), which
//! is why the opaque form below reads `Code`, `Status`, `Players` and `State`:
//! those are the names `encoding/json` gave the untagged Go struct.

use serde::{Deserialize, Serialize};

/// `game.Status`: Go's `iota`, so the number is what travels.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RoomStatus {
    Lobby,
    Playing,
    Finished,
    Unknown,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct RoomPayload(pub serde_json::Value);

impl RoomPayload {
    /// An empty lobby at `code`, which is all the foundation ever builds.
    pub fn lobby(code: &str) -> RoomPayload {
        RoomPayload(serde_json::json!({ "Code": code, "Status": 0, "Players": [], "State": null }))
    }

    pub fn code(&self) -> &str {
        self.0.get("Code").and_then(|v| v.as_str()).unwrap_or("")
    }

    pub fn status(&self) -> RoomStatus {
        match self.0.get("Status").and_then(serde_json::Value::as_i64) {
            Some(0) => RoomStatus::Lobby,
            Some(1) => RoomStatus::Playing,
            Some(2) => RoomStatus::Finished,
            _ => RoomStatus::Unknown,
        }
    }

    pub fn players_len(&self) -> usize {
        self.0
            .get("Players")
            .and_then(|v| v.as_array())
            .map_or(0, Vec::len)
    }

    /// Whether a board has been dealt: `State` is nil in a lobby.
    pub fn has_state(&self) -> bool {
        self.0.get("State").is_some_and(|s| !s.is_null())
    }
}
