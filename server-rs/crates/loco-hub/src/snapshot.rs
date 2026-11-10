//! The snapshot: what lets a deploy replace this process without ending the
//! matches on it. Port of `server/hub/snapshot.go`.
//!
//! Three deliberate limits, unchanged:
//!   - **Only matches in flight travel.** A lobby has nothing to lose.
//!   - **A snapshot is never replayed.** The file is removed as it is read.
//!   - **The schema version is a hard gate, not a merge.**
//!
//! **The file is the one secret this stack writes down**: every session token
//! and every hand of every interrupted match. Created `0600` in a `0700`
//! directory, and short-lived by construction.

use crate::Hub;
use crate::hub::{Control, HubCore};
use crate::room::{Room, Status};
use crate::table::{MatchRecord, Occupant, Table};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;
use std::time::SystemTime;
use tokio::sync::oneshot;
use tokio::time::Instant;

/// Bumped by hand whenever the shape written below changes, the room's
/// included. A restore refuses anything else. **5, as Go wrote it**: a file the
/// Go server saved on its way out is one this server must be able to read.
pub const SNAPSHOT_SCHEMA_VERSION: i64 = 5;

#[derive(Debug, thiserror::Error)]
pub enum SnapshotError {
    #[error("marshal snapshot: {0}")]
    Marshal(#[from] serde_json::Error),
    #[error("snapshot io: {0}")]
    Io(#[from] std::io::Error),
    #[error("hub stopped")]
    HubStopped,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SnapshotFile {
    pub schema_version: i64,
    #[serde(with = "crate::gotime::opt")]
    pub saved_at: Option<SystemTime>,
    #[serde(default)]
    pub rooms: Vec<RoomSnapshot>,
}

/// One match plus the hub-side bookkeeping that makes it playable. JSON names
/// are Go's; map keys are seats written as strings, as `encoding/json` did.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct RoomSnapshot {
    /// The domain's room, in Go's JSON: a Go snapshot deserialises into it.
    pub room: Room,
    /// What lets the returning client prove it owns the seat, with the token
    /// it has had since it joined.
    #[serde(
        default,
        skip_serializing_if = "BTreeMap::is_empty",
        deserialize_with = "null_as_default"
    )]
    pub session_tokens: BTreeMap<usize, String>,
    #[serde(
        default,
        skip_serializing_if = "Vec::is_empty",
        deserialize_with = "null_as_default"
    )]
    pub bot_slots: Vec<usize>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub matchmade: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub solo: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub streamer_mode: bool,
    #[serde(
        default,
        skip_serializing_if = "BTreeMap::is_empty",
        deserialize_with = "null_as_default"
    )]
    pub afk_timeouts: BTreeMap<usize, i64>,
    #[serde(
        default,
        skip_serializing_if = "Vec::is_empty",
        deserialize_with = "null_as_default"
    )]
    pub match_history: Vec<MatchRecord>,
    #[serde(with = "crate::gotime::opt", default)]
    pub match_started_at: Option<SystemTime>,
}

fn is_false(b: &bool) -> bool {
    !*b
}

/// A snapshot written by an older process may carry a `null` where this now
/// keeps a map.
fn null_as_default<'de, D, T>(d: D) -> Result<T, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Default + Deserialize<'de>,
{
    Ok(Option::<T>::deserialize(d)?.unwrap_or_default())
}

impl RoomSnapshot {
    /// What a table hands the snapshot, or `None` when it has nothing in flight
    /// worth carrying across a restart.
    pub fn of(t: &Table) -> Option<RoomSnapshot> {
        if t.room.status != Status::Playing {
            return None;
        }
        Some(RoomSnapshot {
            room: t.room.clone(),
            session_tokens: t
                .seats
                .iter()
                .enumerate()
                .filter_map(|(i, s)| s.token.clone().map(|tok| (i, tok)))
                .collect(),
            bot_slots: t.bot_seats(),
            matchmade: t.is_matchmade(),
            solo: t.solo,
            streamer_mode: t.streamer_mode,
            afk_timeouts: t
                .seats
                .iter()
                .enumerate()
                .filter(|(_, s)| s.afk > 0)
                .map(|(i, s)| (i, s.afk))
                .collect(),
            match_history: t.match_history.clone(),
            match_started_at: t.match_started_at,
        })
    }
}

impl Hub {
    /// Writes every match in flight to `path`. An empty path disables the
    /// feature, which is what local dev and the E2E suite run with. The work
    /// runs on the loop, because it reads every table.
    pub async fn save_snapshot(&self, path: &Path) -> Result<(), SnapshotError> {
        if path.as_os_str().is_empty() {
            return Ok(());
        }
        let (tx, rx) = oneshot::channel();
        if !self.control(Control::Save(path.to_owned(), tx)) {
            return Err(SnapshotError::HubStopped);
        }
        rx.await.map_err(|_| SnapshotError::HubStopped)?
    }

    /// Restores a snapshot and deletes the file. A missing, stale, unreadable
    /// or foreign one is "nothing to restore", never a reason to refuse to
    /// boot. Call it before the listener is up.
    pub async fn load_snapshot(&self, path: &Path) -> Result<(), SnapshotError> {
        if path.as_os_str().is_empty() {
            return Ok(());
        }
        let (tx, rx) = oneshot::channel();
        if !self.control(Control::Load(path.to_owned(), tx)) {
            return Err(SnapshotError::HubStopped);
        }
        rx.await.map_err(|_| SnapshotError::HubStopped)?
    }
}

impl HubCore {
    pub(crate) async fn save_snapshot(&mut self, path: &Path) -> Result<(), SnapshotError> {
        // Every table is stopped before a single one is read, and that is what
        // makes the file describe one instant: a table still running could be
        // halfway through dealing a hand. It also means the hub stops serving
        // its tables here, which is exactly what this call is.
        let tables = self.stop_tables().await;
        let rooms: Vec<RoomSnapshot> = tables.iter().filter_map(RoomSnapshot::of).collect();
        if rooms.is_empty() {
            // The ordinary shutdown, and the one the drain is for.
            tracing::info!("no match in flight, no snapshot written");
            return Ok(());
        }
        let n = rooms.len();
        write_atomic(
            path,
            &SnapshotFile {
                schema_version: SNAPSHOT_SCHEMA_VERSION,
                saved_at: Some(SystemTime::now()),
                rooms,
            },
        )?;
        tracing::info!(path = %path.display(), rooms = n, "snapshot written");
        Ok(())
    }

    pub(crate) fn load_snapshot(&mut self, path: &Path) -> Result<(), SnapshotError> {
        let data = match std::fs::read(path) {
            Ok(d) => d,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(e) => {
                tracing::warn!(path = %path.display(), "snapshot unreadable, starting empty err={e}");
                return Ok(());
            }
        };
        // Removed before it is trusted: a snapshot that breaks the restore
        // must break exactly one boot.
        if let Err(e) = std::fs::remove_file(path) {
            tracing::warn!(path = %path.display(), "snapshot could not be removed err={e}");
        }
        let snap: SnapshotFile = match serde_json::from_slice(&data) {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!(path = %path.display(), "snapshot malformed, starting empty err={e}");
                return Ok(());
            }
        };
        if snap.schema_version != SNAPSHOT_SCHEMA_VERSION {
            tracing::warn!(
                schema = snap.schema_version,
                want = SNAPSHOT_SCHEMA_VERSION,
                rooms = snap.rooms.len(),
                "snapshot from another build discarded"
            );
            return Ok(());
        }
        let max_age = self.hub.config().timings.snapshot_max_age;
        let age = snap
            .saved_at
            .and_then(|at| SystemTime::now().duration_since(at).ok())
            .unwrap_or_default();
        if snap.saved_at.is_none() || age > max_age {
            tracing::warn!(
                age_sec = age.as_secs(),
                rooms = snap.rooms.len(),
                "snapshot too old to be worth restoring"
            );
            return Ok(());
        }
        let total = snap.rooms.len();
        let restored = snap
            .rooms
            .into_iter()
            .filter(|rs| self.restore_room(rs.clone()))
            .count();
        tracing::info!(
            restored,
            of = total,
            age_ms = age.as_millis() as u64,
            "snapshot restored"
        );
        Ok(())
    }

    /// Puts one match back, with every seat marked absent. Nobody is connected
    /// yet, by construction, so every seat enters its reconnect window exactly
    /// as if its player had just dropped.
    pub(crate) fn restore_room(&mut self, rs: RoomSnapshot) -> bool {
        let mut room = rs.room;
        let code = room.code.clone();
        if code.is_empty() || room.state.is_none() || room.status != Status::Playing {
            return false;
        }
        // The RNG never travels: a restored room has none until it is given one.
        crate::room::reseed(&mut room);
        if self.tables.contains_key(&code) {
            tracing::warn!(
                code,
                "snapshot room code collides with a live room, dropped"
            );
            return false;
        }
        let players = room.players.len();
        let mut t = Table::new(&code, room);
        // Every seat comes back held — every human one: the bots are the
        // server's — exactly as if its player had just dropped.
        let now = Instant::now();
        for seat in 0..players {
            let occupant = if rs.bot_slots.contains(&seat) {
                Occupant::Bot
            } else {
                Occupant::Held { since: now }
            };
            t.set_occupant(seat, occupant);
            t.seats[seat].token = rs.session_tokens.get(&seat).cloned();
            t.seats[seat].afk = rs.afk_timeouts.get(&seat).copied().unwrap_or(0);
        }
        t.match_history = rs.match_history;
        t.match_started_at = rs.match_started_at;
        let bots = t.bot_count();
        if rs.matchmade {
            t.matchmade_at = Some(Instant::now());
        }
        t.solo = rs.solo;
        t.streamer_mode = rs.streamer_mode;
        self.hub
            .metrics()
            .bots_active
            .fetch_add(bots as i32, std::sync::atomic::Ordering::Relaxed);
        t.timings = std::sync::Arc::new(self.hub.config().timings.clone());
        // Every human seat enters its reconnect window exactly as if its
        // player had just dropped: the state the rest of the hub already knows
        // how to end when nobody comes back.
        for seat in 0..players {
            if !t.is_bot(seat) {
                t.schedule_reconnect_expiry(seat, now);
            }
        }
        let hub = self.hub.clone();
        let handle = self.open_table(t);
        // The turn clock restarts whole (the error is in the player's favour),
        // the bot is armed, and nobody being here yet starts the cleanup.
        handle.post_critical(
            &hub,
            "restore_arm",
            std::time::Duration::from_secs(1),
            |t, cx| {
                t.schedule_turn_timer(cx);
                t.maybe_schedule_bot(cx);
                t.schedule_room_cleanup();
            },
        );
        tracing::info!(
            code,
            players,
            bots,
            matchmade = rs.matchmade,
            "room restored"
        );
        true
    }
}

/// Writes through a temporary neighbour and renames it, so "the file exists"
/// means "the file is complete": a snapshot is written while the process is
/// being torn down, which is exactly when a half-written file is plausible.
pub fn write_atomic<T: Serialize>(path: &Path, v: &T) -> Result<(), SnapshotError> {
    let data = serde_json::to_vec(v)?;
    if let Some(dir) = path.parent().filter(|d| !d.as_os_str().is_empty()) {
        create_private_dir(dir)?;
    }
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = std::path::PathBuf::from(tmp);
    write_private(&tmp, &data)?;
    if let Err(e) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e.into());
    }
    Ok(())
}

#[cfg(unix)]
fn create_private_dir(dir: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::DirBuilderExt;
    std::fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(dir)
}

#[cfg(not(unix))]
fn create_private_dir(dir: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)
}

#[cfg(unix)]
fn write_private(path: &Path, data: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)?;
    f.write_all(data)?;
    f.sync_all()
}

#[cfg(not(unix))]
fn write_private(path: &Path, data: &[u8]) -> std::io::Result<()> {
    std::fs::write(path, data)
}
