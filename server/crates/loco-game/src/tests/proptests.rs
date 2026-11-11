//! Invariants no single example could state, held over random play.
//!
//! - 112 cards, always: hands + deck + discard, through every replenish,
//!   penalty, rotation and retirement.
//! - `Wild` is never the active colour.
//! - A draw never fails once it is the seat's to make, piles dry or not.
//! - A refusal changes nothing (every command validates before it mutates).
//! - The LOCO! gate holds on all four paths that can empty a hand.

use crate::card::{COLORS, Card, Color, Kind};
use crate::deck::DECK_SIZE;
use crate::error::GameError;
use crate::hand::Hand;
use crate::room::{MatchFormat, Room, Status};
use crate::rules::can_play;
use crate::{Millis, Seat};
use proptest::prelude::*;

const T0: Millis = 1_700_000_000_000;

fn card_total(r: &Room) -> usize {
    r.state.as_ref().map_or(DECK_SIZE, |s| {
        s.hands.iter().map(Hand::len).sum::<usize>() + s.deck.cards.len() + s.discard.len()
    })
}

fn started(seed: u64, seats: usize, format: MatchFormat) -> Room {
    let mut r = Room::from_u64_seed("PROP01", seed);
    for i in 0..seats {
        r.join(&format!("p{i}")).unwrap();
    }
    r.set_format(format).unwrap();
    r.start(T0).unwrap();
    r
}

/// One step of random play. Returns whether the step was a draw the seat was
/// entitled to, so the caller can hold it to "never fails".
/// `before` is set to the room as it stood just before the move under test,
/// after any declaration the driver made on the seat's behalf.
fn step(
    r: &mut Room,
    (a, b, c): (u8, u8, u8),
    now: Millis,
    before: &mut Room,
) -> (Result<(), GameError>, bool) {
    *before = r.clone();
    let st = r.state.as_ref().unwrap();
    let n = st.hands.len();
    let turn = st.current_turn;
    let seat: Seat = b as usize % n;
    let color = COLORS[c as usize % 4];
    let target_seat: Seat = c as usize % n;
    let target = Some(target_seat);
    let hand = &st.hands[turn].cards;
    let pick = |cards: &[Card], legal_only: bool| -> Option<Card> {
        let pool: Vec<Card> = cards
            .iter()
            .copied()
            .filter(|&x| !legal_only || can_play(x, st.top_card(), st.active_color))
            .collect();
        (!pool.is_empty()).then(|| pool[b as usize % pool.len()])
    };
    match a % 13 {
        0..=4 => match pick(hand, true).or_else(|| pick(hand, false)) {
            Some(card) => {
                // Most of the time the seat remembers its LOCO!, so rounds end.
                let owes = hand.len() == 1 && !st.seats[turn].declared;
                if owes && c % 3 != 0 {
                    let _ = r.declare_last_card(turn, now);
                    *before = r.clone();
                }
                (r.play_card(turn, card, color, target, now), false)
            }
            None => (r.draw_card(turn, now), false),
        },
        5 => {
            let entitled = st.pending_draw > 0 || !st.has_drawn;
            (r.draw_card(turn, now), entitled)
        }
        6 => (r.pass_turn(turn, now), false),
        7 => (r.declare_last_card(seat, now), false),
        8 => (r.catch_undeclared(seat, target_seat, now), false),
        9 => {
            r.penalize_failed_catch(seat, now);
            r.lock_catch(seat, now);
            (Ok(()), false)
        }
        10 => {
            // Slam the top card from whoever holds it, else anything.
            let top = st.top_card();
            let card = if st.hands[seat].contains(top) {
                top
            } else {
                pick(&st.hands[seat].cards, false).unwrap_or(top)
            };
            (r.interrupt_play(seat, &[card], color, target, now), false)
        }
        11 => match pick(hand, false) {
            Some(card) => (r.counter_draw(turn, card, color, now), false),
            None => (Ok(()), false),
        },
        _ => match pick(hand, true) {
            Some(card) => {
                let copies: Vec<Card> = hand.iter().copied().filter(|x| *x == card).collect();
                (
                    r.play_cards(turn, &copies, color, target, c % 2 == 0, now),
                    false,
                )
            }
            None => (Ok(()), false),
        },
    }
}

/// The walk below is only worth its invariants if it reaches the states they
/// are about: rounds that end, matches that end, a deck that runs dry. This
/// counts them over a fixed set of walks, so a driver that stopped making
/// progress fails here instead of passing vacuously.
#[test]
fn random_play_reaches_the_states_the_invariants_are_about() {
    use rand_core::{RngCore, SeedableRng};
    let mut rng = rand_chacha::ChaCha12Rng::seed_from_u64(7);
    let (mut rounds, mut matches, mut dry_draws, mut plays) = (0, 0, 0, 0);
    for seed in 0..40 {
        let mut r = started(seed, 2 + (seed as usize % 3), MatchFormat::Bo3);
        let mut now = T0;
        for _ in 0..1500 {
            if r.status != Status::Playing {
                matches += 1;
                break;
            }
            let v = rng.next_u32().to_le_bytes();
            now += 250;
            let dry = r.state.as_ref().unwrap().deck.cards.is_empty();
            let log = r.state.as_ref().unwrap().event_log.len();
            let mut before = r.clone();
            let (res, entitled) = step(&mut r, (v[0], v[1], v[2]), now, &mut before);
            if res.is_err() {
                assert_eq!(r, before);
            }
            if entitled && dry && res.is_ok() {
                dry_draws += 1;
            }
            if res.is_ok() && r.state.as_ref().unwrap().event_log.len() > log {
                plays += 1;
            }
            assert_eq!(card_total(&r), DECK_SIZE);
            if r.round_ended {
                rounds += 1;
                r.round_ended = false;
                if !r.match_over {
                    r.begin_next_round(now).unwrap();
                }
            }
        }
    }
    assert!(plays > 1000, "only {plays} accepted actions");
    assert!(rounds >= 20, "only {rounds} rounds ended");
    assert!(matches >= 5, "only {matches} matches ended");
    assert!(dry_draws > 0, "no draw ever met an empty deck");
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(96))]

    #[test]
    fn random_play_keeps_the_invariants(
        seed in any::<u64>(),
        seats in 2usize..=5,
        format in prop::sample::select(vec![1i64, 3, 5]),
        steps in prop::collection::vec((any::<u8>(), any::<u8>(), any::<u8>(), 0u16..4000), 1..400),
    ) {
        let mut r = started(seed, seats, MatchFormat::try_from(format).unwrap());
        let mut now = T0;
        for (a, b, c, dt) in steps {
            now += Millis::from(dt);
            if r.status != Status::Playing {
                break;
            }
            // Now and then a seat walks out, while two can still play.
            if a == 255 && b % 3 == 0 {
                let active = r.state.as_ref().unwrap().active_seats();
                if active > 2 {
                    let _ = r.retire_seat(c as usize % seats, now);
                }
            }
            let mut before = r.clone();
            let (res, entitled) = step(&mut r, (a, b, c), now, &mut before);
            if let Err(e) = &res {
                prop_assert_eq!(&r, &before, "refusal {:?} changed the room", e);
            }
            if entitled {
                prop_assert!(res.is_ok(), "a draw the seat was owed failed: {:?}", res);
            }
            prop_assert_eq!(card_total(&r), DECK_SIZE, "cards not conserved after {:?}", res);
            if let Some(st) = r.state.as_ref() {
                prop_assert_ne!(st.active_color, Color::Wild);
            }
            if r.round_ended {
                r.round_ended = false;
                if !r.match_over {
                    r.begin_next_round(now).unwrap();
                    prop_assert_eq!(card_total(&r), DECK_SIZE);
                }
            }
        }
    }

    /// A draw never fails, however dry the piles are.
    #[test]
    fn a_draw_never_fails(seed in any::<u64>(), keep in 0usize..3, pending in 0u32..12) {
        let mut r = started(seed, 3, MatchFormat::Bo1);
        let st = r.state.as_mut().unwrap();
        // Everything off the deck and the pile goes into seat 2's hand.
        let mut spill: Vec<Card> = st.deck.cards.drain(keep.min(st.deck.cards.len())..).collect();
        let top = st.discard.pop().unwrap();
        spill.append(&mut st.discard);
        st.discard.push(top);
        st.hands[2].add(&spill);
        st.pending_draw = pending;
        let turn = st.current_turn;
        let before = st.hands[turn].len();
        prop_assert!(r.draw_card(turn, T0).is_ok());
        let st = r.state.as_ref().unwrap();
        prop_assert!(st.has_drawn);
        prop_assert_eq!(st.pending_draw, 0);
        prop_assert!(st.hands[turn].len() >= before);
        prop_assert_eq!(card_total(&r), DECK_SIZE);
    }

    /// Every way to empty a hand asks whether the table was told.
    #[test]
    fn every_finish_requires_the_call(
        seed in any::<u64>(),
        color in prop::sample::select(COLORS.to_vec()),
        path in 0usize..4,
        declared in any::<bool>(),
    ) {
        let mut r = started(seed, 3, MatchFormat::Bo3);
        let st = r.state.as_mut().unwrap();
        let seat: Seat = 1;
        let s = seat;
        // The finishing card, and the hand that goes with each path; extras go
        // back on the deck so the table still holds 112.
        let (card, top, hand_len) = match path {
            0 | 2 => (Card::number(color, 5), Card::number(color, 5), 1), // play, interject
            1 => (Card::number(color, 7), Card::number(color, 5), 2),     // batch of two
            _ => (Card::action(color, Kind::DrawTwo), Card::action(color, Kind::DrawTwo), 1),
        };
        let mut pool: Vec<Card> = st.hands.iter_mut().flat_map(|h| h.cards.drain(..)).collect();
        pool.append(&mut st.deck.cards);
        pool.append(&mut st.discard);
        for want in std::iter::once(top).chain(std::iter::repeat_n(card, hand_len)) {
            let i = pool.iter().position(|c| *c == want).unwrap();
            pool.swap_remove(i);
        }
        st.discard = vec![top];
        st.hands[s].cards = vec![card; hand_len];
        for (i, h) in st.hands.iter_mut().enumerate() {
            if i != s {
                h.cards = pool.drain(..5).collect();
            }
        }
        st.deck.cards = pool;
        st.active_color = color;
        st.current_turn = if path == 2 { 0 } else { seat };
        st.pending_draw = if path == 3 { 2 } else { 0 };
        st.interrupt_open = true;
        st.last_play_by = Some(0);
        st.seats[s].declared = declared && hand_len == 1;
        prop_assert_eq!(card_total(&r), DECK_SIZE);

        let res = match path {
            0 => r.play_card(seat, card, color, None, T0),
            1 => r.play_cards(seat, &[card, card], color, None, declared, T0),
            2 => r.interrupt_play(seat, &[card], color, None, T0),
            _ => r.counter_draw(seat, card, color, T0),
        };
        if declared {
            prop_assert_eq!(res, Ok(()));
            prop_assert!(r.round_ended, "the finish did not end the round");
            prop_assert_eq!(r.state.as_ref().unwrap().hands[s].len(), 0);
        } else {
            prop_assert_eq!(res, Err(GameError::MustDeclareLoco));
            prop_assert_eq!(r.state.as_ref().unwrap().hands[s].len(), hand_len);
            prop_assert!(!r.round_ended);
        }
    }
}
