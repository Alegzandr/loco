//! How many people are here, told to the ones who are not playing yet. Port of
//! `server/hub/online.go`.
//!
//! Sockets, not seats; seatless only; and **what each socket was last told is
//! kept per socket**, which is what makes a player coming back from a match
//! pick the number up on the next tick. The count is the client's to floor.

use crate::client::Client;
use crate::hub::HubCore;
use crate::wire::msg;
use std::sync::atomic::Ordering;

impl HubCore {
    /// Every socket this process is holding, seated or not.
    pub fn players_online(&self) -> usize {
        self.clients.len()
    }

    /// Tells the seatless sockets that have not heard this number.
    pub(crate) fn broadcast_players_online(&self) {
        let n = self.players_online();
        for c in self.clients.values() {
            if c.room_code().is_some() || c.online_sent.load(Ordering::Relaxed) == n as i64 {
                continue;
            }
            c.online_sent.store(n as i64, Ordering::Relaxed);
            c.send(msg::players_online(n));
        }
    }

    /// Answers one socket, on arrival: waiting for the next tick would leave
    /// the home screen without its count on exactly the visit it exists for.
    pub(crate) fn send_players_online(&self, c: &Client) {
        let n = self.players_online();
        c.online_sent.store(n as i64, Ordering::Relaxed);
        c.send(msg::players_online(n));
    }
}
