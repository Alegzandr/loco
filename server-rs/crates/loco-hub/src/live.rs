//! Who is streaming this game, told to the ones who are not playing yet. Port
//! of `server/hub/live.go`: the live-streams strip's one crossing into the loop.

use crate::Hub;
use crate::client::Client;
use crate::hub::HubCore;
use crate::wire::{LiveStream, msg};
use axum::extract::ws::Utf8Bytes;
use std::sync::atomic::Ordering;

/// What goes on the socket. The home screen draws three rows; six is two
/// spare. It reaches every seatless socket, which is the only reason it is not
/// twelve — the content page reads the longer list over HTTP.
pub const LIVE_WIRE_MAX: usize = 6;

impl Hub {
    /// The only point of contact between the poller and this loop. Never
    /// blocks: the poller has already screened the rows and fetched the
    /// pictures, and hands over a finished list.
    pub fn publish_live(&self, rows: Vec<LiveStream>) {
        self.post_to_router("live_streams", move |core| core.set_live_streams(rows));
    }
}

impl HubCore {
    /// Caps the list, marshals it once and hands it to every seatless socket
    /// that has not been told this version.
    pub(crate) fn set_live_streams(&mut self, mut rows: Vec<LiveStream>) {
        rows.truncate(LIVE_WIRE_MAX);
        let n = rows.len();
        // Not stamped, as in Go: the bytes are kept and sent later, to sockets
        // arriving after this instant, and a server_now from the past would
        // be a clock reading the client should not trust.
        let msg = msg::live_streams(rows);
        let body = match serde_json::to_string(&msg) {
            Ok(b) => b,
            Err(e) => {
                tracing::warn!("live_streams marshal failed err={e}");
                return;
            }
        };
        self.live_version += 1;
        self.live_bytes = Some(Utf8Bytes::from(body));
        self.hub
            .metrics()
            .live_streams
            .store(n as i64, Ordering::Relaxed);
        self.broadcast_live_streams();
    }

    /// Seatless only, per-socket version, and no ticker: nothing here moves on
    /// its own.
    fn broadcast_live_streams(&self) {
        let Some(bytes) = &self.live_bytes else {
            return;
        };
        for c in self.clients.values() {
            if c.room_code().is_some() || c.live_sent.load(Ordering::Relaxed) == self.live_version {
                continue;
            }
            c.live_sent.store(self.live_version, Ordering::Relaxed);
            c.send_bytes(bytes.clone());
        }
    }

    /// Answers one socket, on arrival. Sends nothing when the feature is off,
    /// which is every environment but production.
    pub(crate) fn send_live_streams(&self, c: &Client) {
        let Some(bytes) = &self.live_bytes else {
            return;
        };
        c.live_sent.store(self.live_version, Ordering::Relaxed);
        c.send_bytes(bytes.clone());
    }
}
