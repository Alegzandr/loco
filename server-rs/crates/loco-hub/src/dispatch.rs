//! Where a message is routed. Port of the floor of `server/hub/dispatch.go`;
//! the routes themselves arrive with the handler port.
//!
//! What is here already is what every route will stand on: the `catch_unwind`
//! that makes one message unable to cost the server, and the hand-off of a
//! table-scoped message to its table's mailbox with the "server busy" answer
//! when that one table is behind.

use crate::actor::TableJob;
use crate::client::Client;
use crate::hub::HubCore;
use crate::logsink::panic_message;
use crate::wire::ClientMsg;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::Arc;
use std::sync::atomic::Ordering;

/// Every inbound message passes through here, on the hub's loop.
///
/// TODO(handler port): route on `msg` — `tableScoped` types to
/// [`post_to_table`] with `dispatch_at_table`, the rest to
/// `dispatch_without_table` (create/join/find_match/play_bot/…) — and add the
/// gameplay gate (`isGameplayMsg` refused at a table not playing or whose seat
/// is not an index into the hands). Until then every type is refused exactly
/// the way Go refused one it did not know.
pub(crate) fn dispatch(core: &mut HubCore, c: &Arc<Client>, msg: ClientMsg) {
    let kind = msg.kind.clone();
    let result = catch_unwind(AssertUnwindSafe(|| {
        #[cfg(any(test, feature = "testkit"))]
        {
            let probe = core
                .hub
                .shared()
                .dispatch_probe
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone();
            if let Some(p) = probe {
                p(&kind);
            }
        }
        route(core, c, msg);
    }));
    if let Err(p) = result {
        core.hub
            .metrics()
            .handler_panics
            .fetch_add(1, Ordering::Relaxed);
        let seat = c.seat();
        tracing::warn!(
            r#type = %kind,
            conn = %c.conn_id,
            code = %seat.as_ref().map_or("", |s| s.code.as_str()),
            player = seat.as_ref().map_or(-1, |s| s.id as i64),
            panic = %panic_message(p.as_ref()),
            "handler panic recovered"
        );
        c.send_error("server error");
    }
}

fn route(_core: &mut HubCore, c: &Arc<Client>, _msg: ClientMsg) {
    c.send_error("unknown message type");
}

/// Hands a message's work to the table the sender sits at. A full box means
/// that one table is behind, and only its own players are told so.
pub fn post_to_table(core: &HubCore, c: &Arc<Client>, job: TableJob) -> bool {
    let Some(code) = c.room_code() else {
        c.send_error("not in a room");
        return false;
    };
    let Some(t) = core.tables.get(&code) else {
        c.send_error("room not found");
        return false;
    };
    let what = job.what.clone();
    if t.post(job.from_client(c.clone())).is_err() {
        core.hub
            .metrics()
            .messages_dropped_busy
            .fetch_add(1, Ordering::Relaxed);
        tracing::info!(r#type = %what, conn = %c.conn_id, code, "table box full, dropping message");
        c.send_error("server busy, please retry");
        return false;
    }
    true
}

/// A socket has gone. TODO(handler port): leave the queue (`dequeue`), then
/// hand the seat to its table as a critical job (`disconnect`, retried after
/// 1s) — the table holds it for the reconnect window or removes it.
pub(crate) fn handle_disconnect(core: &mut HubCore, c: &Arc<Client>) {
    core.queue.retain(|q| !Arc::ptr_eq(q, c));
    core.hub
        .metrics()
        .matchmaking_queue
        .store(core.queue.len() as i32, Ordering::Relaxed);
    match c.room_code() {
        None => {
            tracing::info!(conn = %c.conn_id, addr = %c.net_prefix(), "player disconnected (no room)")
        }
        Some(code) => tracing::info!(conn = %c.conn_id, code, "player disconnected"),
    }
}
