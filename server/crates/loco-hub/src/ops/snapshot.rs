//! The snapshot: what lets a deploy replace this process without ending the
//! matches on it.
//!
//! Three deliberate limits:
//!   - **Only matches in flight travel.** A lobby has nothing to lose.
//!   - **A snapshot is never replayed.** The file is removed as it is read.
//!   - **The schema version is a hard gate, not a merge.**
//!
//! **The file is the one secret this stack writes down**: every session token
//! and every hand of every interrupted match. Created `0600` in a `0700`
//! directory, and short-lived by construction.
//!
//! The shape is plain serde: field names as the structs spell them, instants
//! as integer milliseconds (`Millis` inside the room, Unix milliseconds for the
//! two wall-clock stamps here), "never" and "nobody" as `null`, and one record
//! per seat rather than maps keyed by seat number.

use crate::Hub;
use crate::ids::{RoomCode, SessionToken};
use crate::router::hub::{Control, HubCore};
use crate::table::room::Status;
use crate::table::{MatchRecord, Occupant, Table};
use loco_game::SavedRoom;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::SystemTime;
use tokio::sync::oneshot;
use tokio::time::Instant;

/// Bumped by hand whenever the shape written below changes, the room's
/// included. A restore drops a file of any other version whole, unread: a room
/// shaped by another build is not a room this one can play, and guessing is
/// worse than dropping it. 6 is the first plain-serde shape; a version-5 file
/// is refused by this gate like any other.
pub const SNAPSHOT_SCHEMA_VERSION: i64 = 6;

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
    /// When the file was written, in Unix milliseconds. A file that does not
    /// say is as good as too old.
    #[serde(with = "unix_ms", default)]
    pub saved_at: Option<SystemTime>,
    #[serde(default)]
    pub rooms: Vec<RoomSnapshot>,
}

/// The one field a restore reads before it trusts anything else, so a file
/// from another build is dropped by its version, whatever its shape.
#[derive(Deserialize)]
struct SnapshotHeader {
    schema_version: i64,
}

/// One match plus the hub-side bookkeeping that makes it playable.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RoomSnapshot {
    /// The domain's room. It carries no RNG; the restore draws a fresh seed.
    pub room: SavedRoom,
    /// One record per seat, indexed like the room's players.
    #[serde(default)]
    pub seats: Vec<SeatSnapshot>,
    #[serde(default)]
    pub matchmade: bool,
    #[serde(default)]
    pub solo: bool,
    #[serde(default)]
    pub streamer_mode: bool,
    #[serde(default)]
    pub match_history: Vec<MatchRecord>,
    /// When the match opened, in Unix milliseconds, so a deploy does not
    /// restart the clock its duration is measured on.
    #[serde(with = "unix_ms", default)]
    pub match_started_at: Option<SystemTime>,
}

/// What the hub keeps about one seat beyond the room's own record of it.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct SeatSnapshot {
    /// What lets the returning client prove it owns the seat, with the token
    /// it has had since it joined. `None` for a bot or a seat never claimed.
    pub token: Option<SessionToken>,
    /// Played by the server: it comes back seated, not held.
    pub bot: bool,
    /// Turn timeouts in a row, toward the AFK threshold.
    pub afk: i64,
}

/// `Option<SystemTime>` as integer Unix milliseconds, `null` for none.
mod unix_ms {
    use serde::{Deserialize, Deserializer, Serializer};
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    pub fn serialize<S: Serializer>(v: &Option<SystemTime>, s: S) -> Result<S::Ok, S::Error> {
        match v {
            Some(t) => {
                let ms = match t.duration_since(UNIX_EPOCH) {
                    Ok(d) => i64::try_from(d.as_millis()).unwrap_or(i64::MAX),
                    Err(e) => -i64::try_from(e.duration().as_millis()).unwrap_or(i64::MAX),
                };
                s.serialize_i64(ms)
            }
            None => s.serialize_none(),
        }
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Option<SystemTime>, D::Error> {
        Ok(Option::<i64>::deserialize(d)?.map(|ms| {
            let abs = Duration::from_millis(ms.unsigned_abs());
            if ms >= 0 {
                UNIX_EPOCH + abs
            } else {
                UNIX_EPOCH - abs
            }
        }))
    }
}

impl RoomSnapshot {
    /// A snapshot of `room` and nothing else: no tokens, no bots, no history.
    pub fn new(room: SavedRoom) -> RoomSnapshot {
        RoomSnapshot {
            room,
            seats: Vec::new(),
            matchmade: false,
            solo: false,
            streamer_mode: false,
            match_history: Vec::new(),
            match_started_at: None,
        }
    }

    /// What a table hands the snapshot, or `None` when it has nothing in flight
    /// worth carrying across a restart.
    pub fn of(t: &Table) -> Option<RoomSnapshot> {
        if t.room.status != Status::Playing {
            return None;
        }
        Some(RoomSnapshot {
            room: SavedRoom::from(&t.room),
            seats: (0..t.seats.len())
                .map(|i| SeatSnapshot {
                    token: t.seats[i].token.clone(),
                    bot: t.is_bot(i),
                    afk: t.seats[i].afk,
                })
                .collect(),
            matchmade: t.is_matchmade(),
            solo: t.solo,
            streamer_mode: t.streamer_mode,
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
        // The version first, alone: a file from another build is dropped by
        // it, never half-read through a shape it was not written in.
        let header: SnapshotHeader = match serde_json::from_slice(&data) {
            Ok(h) => h,
            Err(e) => {
                tracing::warn!(path = %path.display(), "snapshot malformed, starting empty err={e}");
                return Ok(());
            }
        };
        if header.schema_version != SNAPSHOT_SCHEMA_VERSION {
            tracing::warn!(
                schema = header.schema_version,
                want = SNAPSHOT_SCHEMA_VERSION,
                "snapshot from another build discarded"
            );
            return Ok(());
        }
        let snap: SnapshotFile = match serde_json::from_slice(&data) {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!(path = %path.display(), "snapshot malformed, starting empty err={e}");
                return Ok(());
            }
        };
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
        let saved = rs.room;
        if saved.code.is_empty() || saved.state.is_none() || saved.status != Status::Playing {
            return false;
        }
        // The RNG never travels: the restored room is seeded from the OS, as
        // every new one is.
        let room = crate::table::room::restore_room(saved);
        let code = RoomCode::from_trusted(room.code.clone());
        if self.tables.contains_key(&code) {
            tracing::warn!(
                code = %code,
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
            let saved = rs.seats.get(seat).cloned().unwrap_or_default();
            let occupant = if saved.bot {
                Occupant::Bot
            } else {
                Occupant::Held { since: now }
            };
            t.set_occupant(seat, occupant);
            t.seats[seat].token = saved.token;
            t.seats[seat].afk = saved.afk;
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
            code = %code,
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
