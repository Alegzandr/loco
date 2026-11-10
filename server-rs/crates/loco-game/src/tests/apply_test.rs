//! `Room::apply`, the `(state, action) -> state` form: it is the `&mut`
//! methods and nothing else, it leaves its input alone, and it reports what the
//! action logged plus the answers the hub needs.

use super::support::*;
use crate::card::Color;
use crate::error::GameError;
use crate::event::EventKind;
use crate::room::{Action, Event, Room};

fn logged(events: &[Event]) -> Vec<EventKind> {
    events
        .iter()
        .filter_map(|e| match e {
            Event::Logged(g) => Some(g.kind),
            _ => None,
        })
        .collect()
}

#[test]
fn apply_is_the_methods() {
    let r = setup_two_player_game();
    let top = st_ref(&r).top_card();
    let card = num(top.color, if top.value == 9 { 1 } else { top.value + 1 });
    let mut via_method = r.clone();
    st(&mut via_method).hands[0].cards.push(card);
    let r = via_method.clone();
    via_method.play_card(0, card, Color::Red, -1, NOW).unwrap();
    let (via_apply, events) = r
        .apply(
            Action::PlayCard {
                seat: 0,
                card,
                chosen_color: Color::Red,
                chosen_player: -1,
            },
            NOW,
        )
        .unwrap();
    assert_eq!(via_apply, via_method);
    assert_eq!(logged(&events), vec![EventKind::CardPlayed]);
}

#[test]
fn apply_leaves_its_input_alone_and_a_refusal_returns_nothing_else() {
    let r = setup_two_player_game();
    let before = r.clone();
    assert_eq!(
        r.apply(Action::PassTurn { seat: 0 }, NOW),
        Err(GameError::MustDrawBeforePass)
    );
    assert_eq!(
        r.apply(Action::DrawCard { seat: 1 }, NOW),
        Err(GameError::NotYourTurn)
    );
    let (next, _) = r.apply(Action::DrawCard { seat: 0 }, NOW).unwrap();
    assert_eq!(r, before, "apply mutated its input");
    assert_ne!(next, before);
}

#[test]
fn a_deal_reports_its_whole_log() {
    let mut r = new_room("APPLY1");
    must_join(&mut r, "alice");
    must_join(&mut r, "bob");
    let (r, events) = r.apply(Action::Start, NOW).unwrap();
    assert_eq!(logged(&events), vec![EventKind::GameStarted]);
    assert!(r.state.is_some());
}

#[test]
fn the_answers_ride_the_events() {
    let mut r = setup_three_player_game();
    near_seat(&mut r, 1);
    let (r, events) = r
        .apply(Action::PenalizeFailedCatch { catcher: 0 }, NOW)
        .unwrap();
    assert!(matches!(
        events.last(),
        Some(Event::FailedCatch { catcher: 0, cards, charged: true }) if cards.len() == 1
    ));
    assert_eq!(logged(&events), vec![EventKind::CatchFailed]);
    let (_, events) = r.apply(Action::LockCatch { catcher: 0 }, NOW).unwrap();
    assert_eq!(
        events,
        vec![Event::CatchLocked {
            catcher: 0,
            until: Some(NOW + 2000)
        }]
    );

    let mut lobby = new_room("APPLY2");
    must_join(&mut lobby, "alice");
    must_join(&mut lobby, "bob");
    let (lobby, events) = lobby
        .apply(Action::RemoveLobbyPlayer { seat: 0 }, NOW)
        .unwrap();
    assert_eq!(
        events,
        vec![Event::SeatRemoved {
            seat: 0,
            was_host: true
        }]
    );
    assert_eq!(lobby.players[0].nickname, "bob");
}

#[test]
fn an_unseeded_room_refuses_every_action() {
    let r = Room::default();
    assert_eq!(
        r.apply(
            Action::Join {
                nickname: "alice".into()
            },
            NOW
        ),
        Err(GameError::Unseeded)
    );
}
