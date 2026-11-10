//! The helpers the Go test files shared at package level, ported once so every
//! test module builds its fixtures the same way.
//!
//! Go's tests read `time.Now()`; these read [`NOW`], a fixed instant, and step
//! it explicitly. Go's rooms were crypto-seeded; these are seeded from a
//! per-thread counter, so a test deals the same cards on every run.

#![allow(dead_code)]

use crate::card::{Card, Color, Kind};
use crate::event::EventKind;
use crate::hand::Hand;
use crate::room::{GameState, MatchFormat, Room};
use crate::{Millis, Seat};
use rand_chacha::ChaCha12Rng;
use rand_core::SeedableRng;
use std::cell::Cell;

/// The instant every test treats as "now".
pub(crate) const NOW: Millis = 1_700_000_000_000;

thread_local! {
    static NEXT_SEED: Cell<u64> = const { Cell::new(1) };
}

/// A fresh lobby with its own deterministic seed (Go: `NewRoom`).
pub(crate) fn new_room(code: &str) -> Room {
    let seed = NEXT_SEED.with(|s| {
        let v = s.get();
        s.set(v + 1);
        v
    });
    Room::from_u64_seed(code, seed)
}

/// A deterministic source for a bot decision.
pub(crate) fn test_rng(seed: u64) -> ChaCha12Rng {
    ChaCha12Rng::seed_from_u64(seed)
}

/// The dealt round of a started room.
pub(crate) fn st(r: &mut Room) -> &mut GameState {
    r.state.as_mut().expect("room has a dealt round")
}

/// The dealt round of a started room, read-only.
pub(crate) fn st_ref(r: &Room) -> &GameState {
    r.state.as_ref().expect("room has a dealt round")
}

pub(crate) fn must_join(r: &mut Room, nickname: &str) {
    r.join(nickname)
        .unwrap_or_else(|e| panic!("Join({nickname:?}): {e}"));
}

fn join_all(r: &mut Room, names: &[&str]) {
    for n in names {
        must_join(r, n);
    }
}

/// Go: `setupTwoPlayerGame` — alice and bob, seat 0 to play, no pending draw,
/// clockwise.
pub(crate) fn setup_two_player_game() -> Room {
    let mut r = new_room("GAME");
    join_all(&mut r, &["alice", "bob"]);
    r.start(NOW).unwrap();
    let s = st(&mut r);
    s.current_turn = 0;
    s.pending_draw = 0;
    s.direction = 1;
    r
}

/// Go: `setupThreePlayerGame` — alice, bob and carol.
pub(crate) fn setup_three_player_game() -> Room {
    let mut r = new_room("3PLY");
    join_all(&mut r, &["alice", "bob", "carol"]);
    r.start(NOW).unwrap();
    let s = st(&mut r);
    s.current_turn = 0;
    s.pending_draw = 0;
    s.direction = 1;
    r
}

/// Go: `declareLast`.
pub(crate) fn declare_last(r: &mut Room, seat: Seat) {
    r.declare_last_card(seat, NOW)
        .unwrap_or_else(|e| panic!("DeclareLastCard({seat}): {e}"));
}

/// Go: `nearSeat` — seat `i` on exactly two cards.
pub(crate) fn near_seat(r: &mut Room, i: usize) {
    st(r).hands[i] = Hand::of([Card::number(Color::Red, 1), Card::number(Color::Red, 2)]);
}

/// Go: `armInterrupt`.
pub(crate) fn arm_interrupt(r: &mut Room, seat: Seat) {
    st(r).arm_interrupt_window(seat, NOW);
}

/// Go: `finishMatch` — a BO1 ended by seat 0's round.
pub(crate) fn finish_match(names: &[&str]) -> Room {
    let mut r = new_room("TEST");
    join_all(&mut r, names);
    r.start(NOW).unwrap();
    st(&mut r).hands[0].cards.clear();
    r.end_round(0, NOW);
    assert!(r.match_over, "setup: expected MatchOver after BO1 round");
    r
}

/// Go: `hasEvent`.
pub(crate) fn has_event(r: &Room, kind: EventKind, seat: Seat) -> bool {
    st_ref(r)
        .event_log
        .iter()
        .any(|e| e.kind == kind && e.player_index == seat)
}

/// Go: `interruptState` — seat 0 just played `top`, the bot is seat 1.
pub(crate) fn interrupt_state(top: Card, active: Color, bot_hand: &[Card]) -> GameState {
    GameState {
        hands: vec![Hand::of([top]), Hand::of(bot_hand)],
        discard: vec![top],
        active_color: active,
        interrupt_open: true,
        last_play_by: 0,
        current_turn: 1,
        ..GameState::default()
    }
}

/// Go: `twoSeatRoom` — one seat per size, each hand of red numbers.
pub(crate) fn two_seat_room(sizes: &[usize]) -> Room {
    let mut r = new_room("TEST01");
    for i in 0..sizes.len() {
        let name = char::from(b'A' + i as u8).to_string();
        must_join(&mut r, &name);
    }
    r.start(NOW).unwrap();
    for (i, &n) in sizes.iter().enumerate() {
        let mut hand = Hand::default();
        for j in 0..n {
            hand.add(&[Card::number(Color::Red, 1 + (j % 9) as i32)]);
        }
        st(&mut r).hands[i] = hand;
    }
    r
}

/// Go: `matchRoom`.
pub(crate) fn match_room(code: &str, format: MatchFormat, names: &[&str]) -> Room {
    let mut r = new_room(code);
    join_all(&mut r, names);
    r.format = format;
    r.start(NOW).unwrap();
    r
}

/// Go: `retireRoom` — a BO3 at `seats` seats.
pub(crate) fn retire_room(seats: usize) -> Room {
    let names = ["alice", "bob", "carol", "dave", "erin", "frank"];
    match_room("RET", MatchFormat::BO3, &names[..seats])
}

/// Go: `exhaustPiles` — the pile down to its top, the deck down to `keep`.
pub(crate) fn exhaust_piles(r: &mut Room, keep: usize) {
    let s = st(r);
    let top = s.top_card();
    s.discard = vec![top];
    let keep = keep.min(s.deck.cards.len());
    s.deck.cards.truncate(keep);
}

/// Go: `startedRoom`.
pub(crate) fn started_room(players: &[&str]) -> Room {
    let mut r = new_room("MAPTST");
    join_all(&mut r, players);
    r.start(NOW).unwrap();
    r
}

/// Go: `playRound` — seat `seat` takes the round off a declared last card,
/// every other seat holding `loser_cards`; then the next round is dealt
/// unless the match is over.
pub(crate) fn play_round(r: &mut Room, seat: Seat, loser_cards: &[Card]) {
    let top = Card::number(Color::Red, 1);
    {
        let s = st(r);
        s.discard = vec![top];
        s.active_color = Color::Red;
        s.current_turn = seat;
        s.pending_draw = 0;
        for (i, h) in s.hands.iter_mut().enumerate() {
            if i as Seat == seat {
                h.cards = vec![top];
            } else {
                h.cards = loser_cards.to_vec();
            }
        }
    }
    declare_last(r, seat);
    r.play_card(seat, top, Color::Red, -1, NOW)
        .unwrap_or_else(|e| panic!("PlayCard: {e}"));
    r.round_ended = false;
    if !r.match_over {
        r.begin_next_round(NOW)
            .unwrap_or_else(|e| panic!("BeginNextRound: {e}"));
    }
}

/// Go: `newTestState` — a minimal state for rule tests.
pub(crate) fn new_test_state(players: usize, current_turn: Seat) -> GameState {
    GameState {
        hands: vec![Hand::default(); players],
        current_turn,
        direction: 1,
        active_color: Color::Red,
        ..GameState::default()
    }
}

/// Shorthands for the card literals the Go tests are full of.
pub(crate) const fn num(color: Color, value: i32) -> Card {
    Card::number(color, value)
}
pub(crate) const fn act(color: Color, kind: Kind) -> Card {
    Card::action(color, kind)
}
pub(crate) const fn wild(kind: Kind) -> Card {
    Card::wild(kind)
}
