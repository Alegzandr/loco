//! A refused bot move gives the turn up, never the table.

use crate::net::client::Client;
use crate::ops::clock;
use crate::ops::config::HubConfig;
use crate::router::hub::Hub;
use crate::table::actor::TableCtx;
use crate::table::{MapLoadState, Table};
use loco_game::Room;
use std::collections::BTreeSet;
use tokio::time::Instant;

/// Deals Alice (seat 0, human) and Bot1 (seat 1, bot) and hands the table back
/// unstarted, which is enough for the handlers that never cross a task.
fn two_seat_table(hub: &Hub) -> Table {
    let mut room = Room::from_u64_seed("AAAAAA", 7);
    for n in ["Alice", "Bot1"] {
        room.join(n).unwrap_or_else(|e| panic!("join({n}): {e}"));
    }
    room.start(clock::now_ms()).expect("start");
    let mut t = Table::new("AAAAAA", room);
    let (alice, _rx) = Client::detached(hub);
    t.set_members(vec![Some(alice)]);
    t.add_bot_seat();
    t
}

// A bot's turn used to be able to end nowhere: the domain refused the move it
// chose, botPlay logged it and returned, and nothing rescheduled the seat. A
// refusal is a bug in the bot, but the table must not pay for it: the recovery
// draws if it may and passes otherwise.
#[tokio::test]
async fn bot_recover_passes_when_it_has_already_drawn() {
    let hub = Hub::start(HubConfig::default());
    let cx = TableCtx::detached(&hub, "AAAAAA");
    let mut t = two_seat_table(&hub);
    {
        let st = t.room.state.as_mut().expect("dealt");
        st.current_turn = 1;
        st.has_drawn = true;
    }
    t.bot_recover(&cx, 1);
    assert_eq!(
        t.room.state.as_ref().unwrap().current_turn,
        0,
        "the seat has to move on"
    );
    hub.stop().await;
}

#[tokio::test]
async fn bot_recover_draws_first_when_it_still_may() {
    let hub = Hub::start(HubConfig::default());
    let cx = TableCtx::detached(&hub, "AAAAAA");
    let mut t = two_seat_table(&hub);
    let before = {
        let st = t.room.state.as_mut().expect("dealt");
        st.current_turn = 1;
        st.has_drawn = false;
        st.pending_draw = 0;
        st.hands[1].len()
    };
    t.bot_recover(&cx, 1);
    let st = t.room.state.as_ref().unwrap();
    assert_eq!(
        st.hands[1].len(),
        before + 1,
        "the recovery draws before it passes"
    );
    // Either the drawn card is playable and a move is rescheduled — the seat
    // keeps the turn with the draw spent — or the turn has passed.
    assert!(!(st.current_turn == 1 && !st.has_drawn));
    hub.stop().await;
}

// A personalised snapshot carries who is on the hook and until when, so a tab
// that reloads into somebody's window, or is corrected mid-window, is told
// what every other seat was told on card_played.
#[tokio::test]
async fn player_game_state_carries_the_open_catch_windows() {
    let hub = Hub::start(HubConfig::default());
    let mut tbl = two_seat_table(&hub);
    let state = tbl.room.state.as_mut().expect("dealt");
    state.hands[1].cards.truncate(1);
    state.seats[1].declared = false;
    state.seats[1].last_card_at = Some(clock::now_ms());

    let dto = tbl.player_game_state_using(0, tbl.player_list());
    assert!(
        dto.catch_seats.len() == 1 && dto.catch_seats[0].player_index == 1,
        "catch_seats = {:?}, want seat 1 on the hook",
        dto.catch_seats
    );
    assert!(
        dto.catch_seats[0].ends_at > clock::now_ms(),
        "ends_at = {} is already past",
        dto.catch_seats[0].ends_at
    );
    hub.stop().await;
}

// Nothing runs a clock or a bot behind the map gate: the match begins at
// match_ready, and opening the table arms both. A departure during the gate
// used to reach schedule_turn_timer and start the first turn's thirty seconds
// over a loading screen.
#[tokio::test]
async fn schedule_turn_timer_refuses_while_the_table_is_loading() {
    let hub = Hub::start(HubConfig::default());
    let mut tbl = two_seat_table(&hub);
    tbl.room.state.as_mut().expect("dealt").current_turn = 0;
    tbl.loading = Some(MapLoadState {
        ready: BTreeSet::new(),
        started_at: Instant::now(),
    });

    let cx = TableCtx::detached(&hub, "AAAAAA");
    tbl.schedule_turn_timer(&cx);

    assert!(
        tbl.turn_started_at.is_none(),
        "a turn clock was armed behind the map gate"
    );
    hub.stop().await;
}
