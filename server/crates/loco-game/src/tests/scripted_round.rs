//! One whole round, scripted through the room's `&mut self` commands, and
//! the events each command logged pinned with `insta`.
//!
//! The script walks the mechanics the hub has to relay in order: a +2, its
//! counter, a fruitless Contre-LOCO! charged once and locked, a press inside
//! the lock, the stack drawn without losing the turn, a play and the player's
//! own interject on it, a finishing batch refused without the call and taken
//! with it. A change to what any of those emits, or to their order, shows up
//! here as a reviewed diff rather than as a hub test failing three crates away.

use super::support::{rounds_won, scores};
use crate::card::{Card, Color, Kind};
use crate::deck::Deck;
use crate::error::GameError;
use crate::hand::Hand;
use crate::room::{CatchCharge, MatchFormat, Room};
use crate::{Millis, Seat};
use serde_json::{Value, json};

const T0: Millis = 1_700_000_000_000;

/// Takes `want` out of `pool`, one copy.
fn take(pool: &mut Vec<Card>, want: Card) -> Card {
    let i = pool.iter().position(|c| *c == want).expect("card in pool");
    pool.remove(i)
}

/// Runs one command and writes its transcript entry: the events it appended
/// to the round's log, the refusal's text, and whatever the command returned
/// that the room cannot tell afterwards.
fn run(
    room: &mut Room,
    transcript: &mut Vec<Value>,
    at: Millis,
    command: &str,
    f: impl FnOnce(&mut Room) -> Result<Option<Value>, GameError>,
) {
    let before = room.state.as_ref().map_or(0, |s| s.event_log.len());
    let res = f(room);
    let log = room.state.as_ref().map_or(&[][..], |s| &s.event_log[..]);
    let events = &log[before.min(log.len())..];
    let mut entry = json!({ "t": at - T0, "command": command, "events": events });
    match res {
        Ok(Some(returned)) => entry["returned"] = returned,
        Ok(None) => {}
        Err(e) => entry["refused"] = json!(e.to_string()),
    }
    transcript.push(entry);
}

fn charge_json(c: &CatchCharge) -> Value {
    match c {
        CatchCharge::Free => json!("free"),
        CatchCharge::Charged { drawn } => json!({ "charged": drawn }),
    }
}
#[test]
fn scripted_round_events() {
    let red7 = Card::number(Color::Red, 7);
    let red3 = Card::number(Color::Red, 3);
    let red5 = Card::number(Color::Red, 5);
    let green9 = Card::number(Color::Green, 9);
    let red_plus2 = Card::action(Color::Red, Kind::DrawTwo);

    let mut room = Room::from_u64_seed("SCRIPT", 42);
    let mut transcript: Vec<Value> = Vec::new();
    let tr = &mut transcript;
    run(&mut room, tr, T0, "join(alice)", |r| {
        r.join("alice").map(|()| None)
    });
    run(&mut room, tr, T0, "join(bob)", |r| {
        r.join("bob").map(|()| None)
    });
    run(&mut room, tr, T0, "set_format(Bo1)", |r| {
        r.set_format(MatchFormat::Bo1).map(|()| None)
    });
    run(&mut room, tr, T0, "start", |r| r.start(T0).map(|()| None));
    // The deal is the seed's; the round below is the script's. Every card
    // still comes from one deck, in a fixed order, so the table holds 112.
    {
        let st = room.state.as_mut().unwrap();
        let mut pool = Deck::standard().cards;
        let alice = vec![
            take(&mut pool, red_plus2),
            take(&mut pool, red7),
            take(&mut pool, red7),
            take(&mut pool, green9),
        ];
        let bob = vec![
            take(&mut pool, red_plus2),
            take(&mut pool, red3),
            take(&mut pool, red3),
        ];
        st.discard = vec![take(&mut pool, red5)];
        st.hands = vec![Hand::of(alice), Hand::of(bob)];
        st.deck.cards = pool;
        st.current_turn = 0;
        st.direction = 1;
        st.active_color = Color::Red;
        st.pending_draw = 0;
        st.event_log.clear();
    }

    let (alice, bob): (Seat, Seat) = (0, 1);
    let s = |ms: Millis| T0 + ms;
    let tr = &mut transcript;
    run(&mut room, tr, s(0), "play_card(alice, R+2)", |r| {
        r.play_card(alice, red_plus2, Color::Red, None, s(0))
            .map(|()| None)
    });
    run(&mut room, tr, s(1000), "counter_draw(bob, R+2)", |r| {
        r.counter_draw(bob, red_plus2, Color::Red, s(1000))
            .map(|()| None)
    });
    // Bob sits on two cards: a press now is a wager, and a wrong one.
    run(
        &mut room,
        tr,
        s(1500),
        "penalize_failed_catch(alice)",
        |r| Ok(Some(charge_json(&r.penalize_failed_catch(alice, s(1500))))),
    );
    run(&mut room, tr, s(1500), "lock_catch(alice)", |r| {
        Ok(Some(json!(r.lock_catch(alice, s(1500)))))
    });
    // The same picture again: no second card.
    run(
        &mut room,
        tr,
        s(1600),
        "penalize_failed_catch(alice)",
        |r| Ok(Some(charge_json(&r.penalize_failed_catch(alice, s(1600))))),
    );
    // Inside the lock: refused outright.
    run(
        &mut room,
        tr,
        s(2000),
        "catch_undeclared(alice, bob)",
        |r| r.catch_undeclared(alice, bob, s(2000)).map(|()| None),
    );
    run(&mut room, tr, s(2500), "draw_card(alice)", |r| {
        r.draw_card(alice, s(2500)).map(|()| None)
    });
    run(&mut room, tr, s(3000), "play_card(alice, R7)", |r| {
        r.play_card(alice, red7, Color::Red, None, s(3000))
            .map(|()| None)
    });
    run(&mut room, tr, s(3200), "interrupt_play(alice, [R7])", |r| {
        r.interrupt_play(alice, &[red7], Color::Red, None, s(3200))
            .map(|()| None)
    });
    run(
        &mut room,
        tr,
        s(4000),
        "play_cards(bob, [R3, R3], no call)",
        |r| {
            r.play_cards(bob, &[red3, red3], Color::Red, None, false, s(4000))
                .map(|()| None)
        },
    );
    run(
        &mut room,
        tr,
        s(4100),
        "play_cards(bob, [R3, R3], LOCO!)",
        |r| {
            r.play_cards(bob, &[red3, red3], Color::Red, None, true, s(4100))
                .map(|()| None)
        },
    );
    run(&mut room, tr, s(5000), "begin_next_round", |r| {
        r.begin_next_round(s(5000)).map(|()| None)
    });
    let st = room.state.as_ref().unwrap();
    let summary = json!({
        "transcript": transcript,
        "status": room.status.as_str(),
        "winner": room.winner,
        "match_winner": room.match_winner,
        "scores": scores(&room),
        "rounds_won": rounds_won(&room),
        "round_history": room.round_history(),
        "hand_sizes": st.hands.iter().map(Hand::len).collect::<Vec<_>>(),
        "cards_on_the_table": st.hands.iter().map(Hand::len).sum::<usize>() + st.deck.cards.len() + st.discard.len(),
    });
    insta::assert_json_snapshot!(summary);
}
