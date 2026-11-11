//! Draining: what a deploy does to a server people are playing on. Port of
//! `server/hub/drain.go`.
//!
//! Nothing new starts, and everything already running is left completely
//! alone. **The drain has to terminate**, which is what decides the refusal
//! list: `create_room`, `start_game`, `rematch`, `find_match`, and a
//! `join_room` aimed at a table this process does not have. The handlers call
//! [`HubCore::refuse_while_draining`]; the snapshot covers whatever the drain
//! timeout does not finish.

use crate::Hub;
use crate::actor::Phase;
use crate::client::Client;
use crate::hub::{Control, HubCore};
use crate::wire::msg;
use std::sync::atomic::Ordering;

/// The wire string every drained-away action answers with. The client maps it
/// in `i18n/serverErrors.ts`; keep the two in step.
pub const DRAIN_REFUSAL: &str = "server updating, try again in a moment";

impl Hub {
    /// Puts the hub into draining mode. Safe from any task, and safe more than
    /// once. It goes through the loop, because the work it starts touches the
    /// queue and every table.
    pub fn begin_drain(&self) {
        self.control(Control::Drain);
    }

    /// Resolves once no match is in flight. Only ever resolves while draining.
    pub async fn drain_done(&self) {
        let mut rx = self.shared().drained.subscribe();
        let _ = rx.wait_for(|d| *d).await;
    }

    /// Whether this process is on its way out. `/health` and `/metrics` read it.
    pub fn draining(&self) -> bool {
        self.shared().draining.load(Ordering::Acquire)
    }
}

impl HubCore {
    pub(crate) fn begin_drain(&mut self) {
        let shared = self.hub.shared().clone();
        if shared.draining.swap(true, Ordering::AcqRel) {
            return;
        }
        tracing::info!(
            rooms = shared.metrics.rooms.load(Ordering::Relaxed),
            clients = shared.metrics.clients.load(Ordering::Relaxed),
            "drain started"
        );

        // The queue goes first: nobody in it is in a match, and leaving them
        // waiting for an opponent this process has stopped pairing is the
        // cruellest possible outcome.
        let queued = std::mem::take(&mut self.queue);
        shared.metrics.matchmaking_queue.store(0, Ordering::Relaxed);
        for q in queued {
            let c = q.client;
            c.refuse(crate::refusal::Refusal::Draining);
            c.send(msg::matchmaking_cancelled());
        }

        // Every table is told once — every table, not only the ones playing:
        // a waiting room, a game-over screen and a versus reveal are the three
        // places a drain is actually felt. Asked of each table, because who is
        // sitting at one is that table's to say.
        for t in self.tables.values() {
            t.post_from_timer("drain_notice", |table, _| {
                table.broadcast_all(msg::server_updating());
            });
        }

        self.check_drained();
    }

    /// Answers an action that would extend the drain, and reports whether it
    /// did.
    pub fn refuse_while_draining(&self, c: &Client) -> bool {
        if !self.hub.draining() {
            return false;
        }
        c.refuse(crate::refusal::Refusal::Draining);
        true
    }

    /// Publishes `drained` once nothing is in flight. Runs on the loop after
    /// every event while draining.
    pub(crate) fn check_drained(&mut self) {
        let in_flight = self.matches_in_flight();
        let shared = self.hub.shared();
        shared
            .metrics
            .matches_in_flight
            .store(in_flight as i32, Ordering::Relaxed);
        if self.drained_closed || in_flight > 0 {
            return;
        }
        self.drained_closed = true;
        shared.drained.send_replace(true);
        tracing::info!("drain complete, no match left in flight");
    }

    /// The matches a shutdown would interrupt, read off each table's published
    /// phase rather than the table itself.
    pub fn matches_in_flight(&self) -> usize {
        self.tables
            .values()
            .filter(|t| t.phase() == Phase::InFlight)
            .count()
    }
}
