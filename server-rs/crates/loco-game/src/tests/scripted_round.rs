//! One whole round, scripted through `Room::apply`, and the events it produced
//! pinned with `insta`.
//!
//! The script walks the mechanics the hub has to relay in order: a +2, its
//! counter, a fruitless Contre-LOCO! charged once and locked, a press inside
//! the lock, the stack drawn without losing the turn, a play and the player's
//! own interject on it, a finishing batch refused without the call and taken
//! with it. A change to what any of those emits, or to their order, shows up
//! here as a reviewed diff rather than as a hub test failing three crates away.

use crate::card::{Card, Color, Kind};
use crate::deck::Deck;
use crate::hand::Hand;
use crate::room::{Action, MatchFormat, Room};
use crate::{Millis, Seat};
use serde_json::{Value, json};

const T0: Millis = 1_700_000_000_000;

/// Takes `want` out of `pool`, one copy.
fn take(pool: &mut Vec<Card>, want: Card) -> Card {
    let i = pool.iter().position(|c| *c == want).expect("card in pool");
    pool.remove(i)
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
    let mut run = |room: &mut Room, action: Action, at: Millis| {
        let label = format!("{action:?}");
        match room.apply(action, at) {
            Ok((next, events)) => {
                *room = next;
                transcript.push(json!({ "t": at - T0, "action": label, "events": events }));
            }
            Err(e) => {
                transcript.push(json!({ "t": at - T0, "action": label, "refused": e.to_string() }));
            }
        }
    };

    run(
        &mut room,
        Action::Join {
            nickname: "alice".into(),
        },
        T0,
    );
    run(
        &mut room,
        Action::Join {
            nickname: "bob".into(),
        },
        T0,
    );
    run(&mut room, Action::SetFormat(MatchFormat::BO1), T0);
    run(&mut room, Action::Start, T0);

    // The deal is the seed's; the round below is the script's. Every card
    // still comes from one deck, in a fixed order, so the table holds 112.
    {
        let st = room.state.as_mut().unwrap();
        let mut pool = Deck::new().cards;
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
    run(
        &mut room,
        Action::PlayCard {
            seat: alice,
            card: red_plus2,
            chosen_color: Color::Red,
            chosen_player: -1,
        },
        s(0),
    );
    run(
        &mut room,
        Action::CounterDraw {
            seat: bob,
            card: red_plus2,
            chosen_color: Color::Red,
        },
        s(1000),
    );
    // Bob sits on two cards: a press now is a wager, and a wrong one.
    run(
        &mut room,
        Action::PenalizeFailedCatch { catcher: alice },
        s(1500),
    );
    run(&mut room, Action::LockCatch { catcher: alice }, s(1500));
    // The same picture again: no second card.
    run(
        &mut room,
        Action::PenalizeFailedCatch { catcher: alice },
        s(1600),
    );
    // Inside the lock: refused outright.
    run(
        &mut room,
        Action::CatchUndeclared {
            catcher: alice,
            target: bob,
        },
        s(2000),
    );
    run(&mut room, Action::DrawCard { seat: alice }, s(2500));
    run(
        &mut room,
        Action::PlayCard {
            seat: alice,
            card: red7,
            chosen_color: Color::Red,
            chosen_player: -1,
        },
        s(3000),
    );
    run(
        &mut room,
        Action::InterruptPlayCards {
            seat: alice,
            cards: vec![red7],
            chosen_color: Color::Red,
            chosen_player: -1,
        },
        s(3200),
    );
    run(
        &mut room,
        Action::PlayCards {
            seat: bob,
            cards: vec![red3, red3],
            chosen_color: Color::Red,
            chosen_player: -1,
            declare_loco: false,
        },
        s(4000),
    );
    run(
        &mut room,
        Action::PlayCards {
            seat: bob,
            cards: vec![red3, red3],
            chosen_color: Color::Red,
            chosen_player: -1,
            declare_loco: true,
        },
        s(4100),
    );
    run(&mut room, Action::BeginNextRound, s(5000));

    let st = room.state.as_ref().unwrap();
    let summary = json!({
        "transcript": transcript,
        "status": room.status.as_str(),
        "winner": room.winner,
        "match_winner": room.match_winner,
        "scores": room.scores,
        "rounds_won": room.rounds_won,
        "round_history": room.round_history,
        "hand_sizes": st.hands.iter().map(Hand::size).collect::<Vec<_>>(),
        "cards_on_the_table": st.hands.iter().map(Hand::size).sum::<usize>() + st.deck.cards.len() + st.discard.len(),
    });
    insta::assert_json_snapshot!(summary);
}
