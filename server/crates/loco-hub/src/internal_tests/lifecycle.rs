//! What a table owes the rules when it is told to stop, to stand down or to
//! warn its players: the drain notice, deletion, and the end of a forfeited
//! match.

use crate::HubConfig;
use crate::net::client::Client;
use crate::router::hub::Hub;
use crate::table::Table;
use crate::table::actor::{DeadlineKey, TableCtx, TableJob};
use crate::table::room::new_room;
use axum::extract::ws::Utf8Bytes;
use std::sync::Arc;
use std::sync::mpsc as std_mpsc;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::time::Instant;

const CODE: &str = "LIFECY";

/// A table with `c` in its one seat, opened on the hub.
async fn open_with(hub: &Hub, c: &Arc<Client>) {
    let mut t = Table::new(CODE, new_room(CODE));
    t.set_members(vec![None]);
    t.seat(c, 0);
    hub.on_loop(move |core| {
        core.open_table(t);
    })
    .await;
}

/// Posts a job that blocks the table's task until the returned sender is
/// dropped or sent to, and waits until it is running.
async fn hold_table(hub: &Hub) -> std_mpsc::Sender<()> {
    let (release, gate) = std_mpsc::channel::<()>();
    let (entered_tx, entered) = tokio::sync::oneshot::channel();
    let posted = hub
        .on_loop(move |core| {
            core.tables[CODE]
                .post(TableJob::new("hold", move |_, _| {
                    let _ = entered_tx.send(());
                    let _ = gate.recv();
                }))
                .is_ok()
        })
        .await;
    assert!(posted);
    entered.await.expect("the hold never started");
    release
}

/// Whether `rx` receives a message containing `needle` within `wait`.
async fn hears(rx: &mut mpsc::Receiver<Utf8Bytes>, needle: &str, wait: Duration) -> bool {
    let deadline = Instant::now() + wait;
    while let Ok(Some(m)) = tokio::time::timeout_at(deadline, rx.recv()).await {
        if m.as_str().contains(needle) {
            return true;
        }
    }
    false
}

// "Every table is told once — every table": a table whose box is full at the
// instant the drain starts still tells its players. Its notice used to be a
// best-effort post, dropped on a full box, and those players sat through the
// drain told nothing.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_drain_notice_reaches_a_table_whose_box_was_full() {
    let hub = Hub::start(HubConfig::default());
    let (c, mut rx) = Client::detached(&hub);
    open_with(&hub, &c).await;
    let release = hold_table(&hub).await;

    // Fill the box behind the job that holds the task.
    let filled = hub
        .on_loop(|core| {
            let t = &core.tables[CODE];
            let mut n = 0;
            while t.post(TableJob::new("filler", |_, _| {})).is_ok() {
                n += 1;
            }
            n
        })
        .await;
    assert!(filled > 0, "the box never filled");

    hub.begin_drain();
    tokio::time::sleep(Duration::from_millis(200)).await;
    let _ = release.send(());

    assert!(
        hears(&mut rx, "server_updating", Duration::from_secs(4)).await,
        "the table whose box was full never told its player about the drain"
    );
    hub.stop().await;
}

// A deleted table runs nothing after the job it was in: not a job still in
// its box, and not a deadline that fell due in the same batch as the one
// running when the deletion landed.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_deleted_table_runs_nothing_after_the_job_it_was_in() {
    let hub = Hub::start(HubConfig::default());
    let (c, mut rx) = Client::detached(&hub);
    open_with(&hub, &c).await;

    // Two deadlines due at once: the first holds the task, the second would
    // speak to the table.
    let (release, gate) = std_mpsc::channel::<()>();
    let (entered_tx, entered) = tokio::sync::oneshot::channel();
    let posted = hub
        .on_loop(move |core| {
            core.tables[CODE]
                .post(TableJob::new("arm", move |t: &mut Table, _| {
                    let now = Instant::now();
                    t.deadlines.arm(DeadlineKey::TurnTimeout, now, move |_, _| {
                        let _ = entered_tx.send(());
                        let _ = gate.recv();
                    });
                    t.deadlines
                        .arm(DeadlineKey::RoomCleanup, now, |t: &mut Table, _| {
                            t.broadcast_all(crate::net::wire::msg::server_updating());
                        });
                }))
                .is_ok()
        })
        .await;
    assert!(posted);
    entered.await.expect("the first deadline never ran");

    // And a job queued behind it in the box.
    hub.on_loop(|core| {
        core.tables[CODE].post_from_timer("queued", |t, _| {
            t.broadcast_all(crate::net::wire::msg::server_updating());
        });
        core.delete_room(CODE);
    })
    .await;
    let _ = release.send(());

    assert!(
        !hears(&mut rx, "server_updating", Duration::from_millis(500)).await,
        "a deleted table still spoke after the job it was in"
    );
    hub.stop().await;
}

// A forfeit ends the match, and what the match armed goes with it: the turn
// clock, the bots. What belongs to the table stays: the cleanup, and the hold
// of a seat still away, which settles that seat after the match.
#[tokio::test]
async fn a_forfeit_disarms_what_the_match_armed() {
    let hub = Hub::start(HubConfig::default());
    let mut room = new_room(CODE);
    room.join("Alice").unwrap();
    room.join("Bob").unwrap();
    room.start(crate::ops::clock::now_ms()).unwrap();
    let mut t = Table::new(CODE, room);
    t.timings = Arc::new(hub.config().timings.clone());
    t.set_members(vec![None, None]);
    let cx = TableCtx::detached(&hub, CODE);

    t.schedule_turn_timer(&cx);
    let turn = DeadlineKey::TurnTimeout;
    assert!(
        t.deadlines.when(turn).is_some(),
        "the turn clock never armed"
    );
    let bot = DeadlineKey::BotMove(1);
    let far = Instant::now() + Duration::from_secs(60);
    t.deadlines.arm(bot, far, |_, _| {});
    t.deadlines.arm(DeadlineKey::RoomCleanup, far, |_, _| {});
    let hold = t.reconnect_key();
    t.deadlines.arm(hold, far, |_, _| {});

    t.forfeit_match(&cx, 1);

    assert!(
        t.deadlines.when(turn).is_none(),
        "the turn clock survived the forfeit"
    );
    assert!(
        t.deadlines.when(bot).is_none(),
        "a bot move survived the forfeit"
    );
    assert!(
        t.deadlines.when(DeadlineKey::RoomCleanup).is_some(),
        "the cleanup was disarmed"
    );
    assert!(
        t.deadlines.when(hold).is_some(),
        "a seat's hold was disarmed"
    );
    hub.stop().await;
}
