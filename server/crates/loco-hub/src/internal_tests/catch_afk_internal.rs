//! Port of `server/hub/catch_afk_internal_test.go`.

use crate::clock::now_ms;
use crate::{Client, Hub, HubConfig, Table};
use loco_game::{Card, Color, Hand, Room};

// A Contre-LOCO! the server deliberately does not answer is still a refusal.
// Nothing offered, inside the caller's own lockout, or against an offer already
// paid for: all three say nothing to anybody, so none of them reached
// send_error, and the dispatch boundary read every one as accepted and cleared
// the AFK counter — the declare_uno loophole, back through another message.
#[tokio::test]
async fn catch_uno_silent_refusals_are_counted_as_refusals() {
    let hub = Hub::start(HubConfig::default());
    let mut room = Room::from_u64_seed("AAAAAA", 1);
    for n in ["Alice", "Bob"] {
        room.join(n).expect("join");
    }
    room.start(now_ms()).expect("start");
    let mut tbl = Table::new("AAAAAA", room);
    let (caller, _rx_caller) = Client::detached(&hub);
    let (other, _rx_other) = Client::detached(&hub);
    caller.sit_at(&tbl.code, 0);
    tbl.set_members(vec![Some(caller.clone()), Some(other)]);

    let press = |tbl: &mut Table, label: &str, want_refused: bool| {
        let before = caller.refusals();
        tbl.handle_catch_uno(&caller, None);
        let refused = caller.refusals() != before;
        assert_eq!(
            refused, want_refused,
            "{label}: counted as refused = {refused}, want {want_refused}"
        );
    };

    // Both seats on eight cards: nothing is offered.
    press(&mut tbl, "a press where nothing is offered", true);

    // Bob two cards from the finish: an offer. The first miss is a charged
    // wager the table hears, so it is not a refusal.
    tbl.room.state.as_mut().unwrap().hands[1] = Hand {
        cards: vec![Card::number(Color::Red, 1), Card::number(Color::Red, 2)],
    };
    press(&mut tbl, "the first miss against an offer", false);

    // The miss armed the lockout: every press inside it wins and costs nothing.
    press(&mut tbl, "a press inside the lockout", true);

    // Lockout over, same offer, already paid for: charged nothing, said nothing.
    tbl.room.state.as_mut().unwrap().seats[0].catch_locked_until = None;
    press(
        &mut tbl,
        "a second miss against an offer already paid for",
        true,
    );
    hub.stop().await;
}
