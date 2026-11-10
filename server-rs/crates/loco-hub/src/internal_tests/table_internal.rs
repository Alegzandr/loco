//! Port of `server/hub/table_internal_test.go`.

use crate::HubConfig;
use crate::actor::TableJob;
use crate::client::Client;
use crate::hub::Hub;
use crate::room::new_room;
use crate::table::{MapLoadState, Table};
use crate::testkit::eventually;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tokio::time::Instant;

/// Runs `f` on a table's own task and hands back what it returns. Go's
/// `onTableValue`: reading a running table from the test task would be the
/// very race the hand-off exists to remove.
async fn on_table<R: Send + 'static>(
    hub: &Hub,
    code: &'static str,
    f: impl FnOnce(&mut Table) -> R + Send + 'static,
) -> R {
    on_table_cx(hub, code, move |t, _| f(t)).await
}

async fn on_table_cx<R: Send + 'static>(
    hub: &Hub,
    code: &'static str,
    f: impl FnOnce(&mut Table, &crate::TableCtx) -> R + Send + 'static,
) -> R {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let posted = hub
        .on_loop(move |core| {
            core.tables[code]
                .post(TableJob::new("test", move |t, cx| {
                    let _ = tx.send(f(t, cx));
                }))
                .is_ok()
        })
        .await;
    assert!(posted, "table box full");
    tokio::time::timeout(Duration::from_secs(2), rx)
        .await
        .expect("the table never ran the job")
        .expect("the job was dropped")
}

fn same(m: Option<&Arc<Client>>, c: &Arc<Client>) -> bool {
    m.is_some_and(|m| Arc::ptr_eq(m, c))
}

// A seat lives in two places: the client's own seat and the pointer at that
// index in the table's members. Binding a client to a seat takes it off
// wherever it was sitting before, so there is no arrangement of handlers that
// can leave the pointer behind — and that pointer is what personalised
// broadcasts index by, so a stale one is one player handed another's hand. The
// sweep of the old table is asked of that table, through the hub and both
// tasks exactly as production does.
#[tokio::test]
async fn seat_client_leaves_no_pointer_behind() {
    let hub = Hub::start(HubConfig::default());

    let mut first = Table::new("AAAAAA", new_room("AAAAAA"));
    first.members = vec![None, None];
    let second = Table::new("BBBBBB", new_room("BBBBBB"));

    let (c, _rx) = Client::detached(&hub);
    // Before either table is running, which is where every production caller
    // does its own filling in.
    first.seat(&c, 1);
    assert!(
        same(first.members[1].as_ref(), &c)
            && c.player_id() == 1
            && c.room_code().as_deref() == Some("AAAAAA"),
        "first seating did not take: seat={:?}",
        c.seat()
    );
    hub.on_loop(move |core| {
        core.open_table(first);
        core.open_table(second);
    })
    .await;

    let c2 = c.clone();
    on_table_cx(&hub, "BBBBBB", move |t, cx| t.seat_client(cx, &c2, 0)).await;

    let c2 = c.clone();
    assert!(
        on_table(&hub, "BBBBBB", move |t| same(t.members[0].as_ref(), &c2)).await,
        "the new table does not point at the client"
    );
    assert!(
        c.player_id() == 0 && c.room_code().as_deref() == Some("BBBBBB"),
        "the client's own record disagrees: {:?}",
        c.seat()
    );

    // Two hops away: the new table asks the hub, the hub asks the old table.
    let mut swept = false;
    let deadline = Instant::now() + Duration::from_secs(2);
    while !swept && Instant::now() < deadline {
        swept = on_table(&hub, "AAAAAA", |t| t.members[1].is_none()).await;
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    assert!(swept, "the old table still points at the client");
    hub.stop().await;
}

// Re-seating inside one table is the same rule with one table: the client must
// be at exactly one index when it is over.
#[tokio::test]
async fn seat_moves_rather_than_duplicates() {
    let hub = Hub::start(HubConfig::default());
    let mut tbl = Table::new("AAAAAA", new_room("AAAAAA"));
    let (c, _rx) = Client::detached(&hub);
    tbl.seat(&c, 2);
    tbl.seat(&c, 0);

    let seen = tbl.members.iter().filter(|m| same(m.as_ref(), &c)).count();
    assert_eq!(seen, 1, "client sits at {seen} indices: {:?}", tbl.members);
    assert!(
        same(tbl.members[0].as_ref(), &c),
        "client is not at the seat it was moved to"
    );
    hub.stop().await;
}

// Seating somebody means the table is not empty, so a cleanup timer counting it
// down is stale. It used to be a delete each of the four seating paths had to
// remember, and forgetting it in one of them deletes a table somebody is at.
#[tokio::test]
async fn seat_cancels_the_pending_cleanup() {
    let hub = Hub::start(HubConfig::default());
    let mut tbl = Table::new("AAAAAA", new_room("AAAAAA"));
    tbl.schedule_room_cleanup();
    assert!(
        tbl.empty_at.is_some(),
        "schedule_room_cleanup did not stamp the table"
    );

    let (c, _rx) = Client::detached(&hub);
    // Go called the hub's seatClient; its Rust half that does the work is
    // `Table::seat` (`seat_client` only adds the sweep of another table).
    tbl.seat(&c, 0);

    assert!(
        tbl.empty_at.is_none(),
        "a seated table is still counting down to deletion"
    );
    hub.stop().await;
}

// Removing a seat shifts the members, the surviving clients' own seat, the bot
// set and the session tokens in one move. Shifting one without the others is
// the class of bug the table type exists to close.
#[tokio::test]
async fn drop_seat_shifts_everything_together() {
    let hub = Hub::start(HubConfig::default());
    let mut tbl = Table::new("AAAAAA", new_room("AAAAAA"));
    let (a, _ra) = Client::detached(&hub);
    let (c, _rc) = Client::detached(&hub);
    tbl.seat(&a, 0);
    tbl.members.push(None); // seat 1: a bot
    tbl.bots.insert(1);
    tbl.seat(&c, 2);
    tbl.tokens.insert(0, "tok-a".into());
    tbl.tokens.insert(1, "tok-bot".into());
    tbl.tokens.insert(2, "tok-c".into());

    // Seat 0 leaves: the bot becomes seat 0 and c becomes seat 1.
    assert!(
        tbl.drop_seat(0),
        "drop_seat reported nobody left, but c is still seated"
    );

    assert!(
        tbl.members.len() == 2 && tbl.members[0].is_none() && same(tbl.members[1].as_ref(), &c),
        "members did not shift: {:?}",
        tbl.members
    );
    assert_eq!(c.player_id(), 1, "the client's own seat did not follow");
    assert!(
        tbl.is_bot(0) && !tbl.is_bot(1),
        "the bot set did not shift: {:?}",
        tbl.bots
    );
    assert!(
        tbl.tokens.get(&0).map(String::as_str) == Some("tok-bot")
            && tbl.tokens.get(&1).map(String::as_str) == Some("tok-c"),
        "the tokens did not shift: {:?}",
        tbl.tokens
    );
    assert!(
        !tbl.tokens.contains_key(&2),
        "the removed seat's token survived the shift"
    );
    hub.stop().await;
}

// delete_room is one removal because a table is one object. It used to be
// eleven, and the failure mode of eleven is a twelfth map added without being
// added here, leaking the match that just ended into the next one at the code.
#[tokio::test]
async fn delete_room_forgets_the_table_whole() {
    let hub = Hub::start(HubConfig::default());
    let mut tbl = Table::new("AAAAAA", new_room("AAAAAA"));
    tbl.bots.insert(0);
    hub.on_loop(move |core| {
        core.open_table(tbl); // counts the room
    })
    .await;
    hub.metrics().bots_active.fetch_add(1, Ordering::Relaxed);

    let survived = hub
        .on_loop(|core| {
            core.delete_room("AAAAAA");
            core.tables.contains_key("AAAAAA")
        })
        .await;

    assert!(!survived, "the table survived delete_room");
    assert_eq!(
        hub.metrics().bots_active.load(Ordering::Relaxed),
        0,
        "bots_active after deleting the only table's bot"
    );
    assert_eq!(hub.metrics_stats().rooms_active, 0, "rooms_active");
    hub.stop().await;
}

// A rematch deals on a table that has just finished a match, so everything the
// old match left has to go. The gate is the one that bites: a load state left
// behind keeps the next match shut forever, because its own timeout has
// already fired and nothing is left to reopen it.
#[tokio::test]
async fn reset_for_next_match_clears_the_gate() {
    let hub = Hub::start(HubConfig::default());
    let mut tbl = Table::new("AAAAAA", new_room("AAAAAA"));
    let (c, _rx) = Client::detached(&hub);
    tbl.seat(&c, 0);
    tbl.tokens.insert(0, "tok".into());
    tbl.bots.insert(1);
    tbl.loading = Some(MapLoadState {
        ready: Default::default(),
        started_at: Instant::now(),
    });
    tbl.afk.insert(0, 3);
    tbl.away_at.insert(0, Instant::now());
    tbl.rematch_offers.insert(0);

    tbl.reset_for_next_match();

    assert!(
        tbl.loading.is_none(),
        "the map gate survived into the next match"
    );
    assert!(
        tbl.afk.is_empty() && tbl.away_at.is_empty() && tbl.rematch_offers.is_empty(),
        "per-match bookkeeping survived: afk={:?} away={:?} offers={:?}",
        tbl.afk,
        tbl.away_at,
        tbl.rematch_offers
    );
    // Who is at the table is not per-match and must survive.
    assert!(
        same(tbl.members[0].as_ref(), &c)
            && tbl.tokens.get(&0).map(String::as_str) == Some("tok")
            && tbl.is_bot(1),
        "reset_for_next_match emptied the table instead of the match"
    );
    hub.stop().await;
}

// Stop waits for the loop to be gone rather than merely asking it to go. It
// used to close the channel and return, which meant everything after Stop ran
// alongside a loop still dispatching. Go parked the loop inside a snapshot
// save whose reply nobody read; here the loop is parked inside a job on it,
// which is the same claim: Stop does not return mid-handler.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn stop_waits_for_the_loop_to_leave_the_handler() {
    let hub = Hub::start(HubConfig::default());
    let (release_tx, release_rx) = std::sync::mpsc::channel::<()>();
    let entered = Arc::new(AtomicBool::new(false));
    let e = entered.clone();
    let h2 = hub.clone();
    tokio::spawn(async move {
        h2.on_loop(move |_| {
            e.store(true, Ordering::SeqCst);
            let _ = release_rx.recv_timeout(Duration::from_secs(5));
        })
        .await
    });
    let e = entered.clone();
    assert!(eventually(Duration::from_secs(2), move || e.load(Ordering::SeqCst)).await);

    let stopper = tokio::spawn({
        let hub = hub.clone();
        async move { hub.stop().await }
    });
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(
        !stopper.is_finished(),
        "stop returned while the loop was still inside a handler"
    );

    release_tx.send(()).unwrap(); // release the loop
    tokio::time::timeout(Duration::from_secs(2), stopper)
        .await
        .expect("stop never returned after the loop was released")
        .unwrap();
}
