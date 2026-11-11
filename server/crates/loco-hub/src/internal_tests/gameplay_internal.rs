//! The gameplay handlers, run on a table directly.

use crate::ops::clock::now_ms;
use crate::{Client, Hub, HubConfig, Table};
use loco_game::{Card, CatchCharge, Color, Hand, Room};

// A Contre-LOCO! that loses its race costs the caller a card, and the table is
// told whose call it was so the penalty renders. Once both piles are dry there
// is no penalty: the draw comes back empty and the call goes unpunished. It
// was announced anyway — the last corner where a catch was free, and an
// amplification at the rate limit. The caller is still answered; the table is
// not asked to render a penalty nobody paid.
#[tokio::test]
async fn penalize_failed_catch_dry_piles_tell_only_the_caller() {
    let hub = Hub::start(HubConfig::default());

    let mut room = Room::from_u64_seed("AAAAAA", 1);
    room.join("Alice").expect("join Alice");
    room.join("Bob").expect("join Bob");
    room.start(now_ms()).expect("start");

    {
        let st = room.state.as_mut().unwrap();
        // Bob one play from the finish, so the press is a wager at all.
        st.hands[1] = Hand {
            cards: vec![Card::number(Color::Red, 1), Card::number(Color::Red, 2)],
        };
        // Deck empty and nothing under the top discard, so the replenish behind
        // the draw finds nothing either.
        st.deck.cards.clear();
        let top = *st.discard.last().unwrap();
        st.discard = vec![top];
    }
    let CatchCharge::Charged { drawn } = room.penalize_failed_catch(0, now_ms()) else {
        panic!("fixture is wrong: the probe was not charged");
    };
    assert!(
        drawn.is_empty(),
        "fixture is wrong: the penalty still drew {} cards",
        drawn.len()
    );
    // That probe spent seat 0's one charge for this offer, so put a fresh one
    // on the table: Bob down to his last card, window just opened.
    {
        let st = room.state.as_mut().unwrap();
        st.hands[1] = Hand {
            cards: vec![Card::number(Color::Red, 1)],
        };
        st.seats[1].last_card_at = Some(now_ms());
    }

    let mut tbl = Table::new("AAAAAA", room);
    let (caller, mut caller_rx) = Client::detached(&hub);
    let (bystander, mut bystander_rx) = Client::detached(&hub);
    tbl.set_members(vec![Some(caller), Some(bystander)]);

    tbl.penalize_failed_catch(0, now_ms());

    let mut to_bystander = 0;
    while bystander_rx.try_recv().is_ok() {
        to_bystander += 1;
    }
    assert_eq!(
        to_bystander, 0,
        "the rest of the table was sent {to_bystander} messages for a penalty nobody paid"
    );
    // Two, and both are the caller's own business: the penalty nobody paid, and
    // the lockout every fruitless call arms.
    let mut to_caller = 0;
    while caller_rx.try_recv().is_ok() {
        to_caller += 1;
    }
    assert_eq!(
        to_caller, 2,
        "the caller was sent {to_caller} messages, want the two answers their own button asked for"
    );
    hub.stop().await;
}
