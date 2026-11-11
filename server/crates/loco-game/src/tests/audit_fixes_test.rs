//! Ported from Go: `server/game/audit_fixes_test.go`.

use super::support::*;
use crate::card::{Card, Color};
use crate::event::EventKind;
use crate::hand::Hand;
use crate::room::Status;

// A replenish adds the pile to what is left of the deck; it never replaces
// it. The deck is reshuffled when it is *short*, which is exactly when it is
// not empty: replacing it threw the unseen cards away, and a +6 against a
// two-card deck cost the round two cards for good.
#[test]
fn ensure_deck_keeps_the_cards_still_in_the_deck() {
    let mut r = new_room("DECK");
    for n in ["a", "b"] {
        must_join(&mut r, n);
    }
    r.start(NOW).unwrap();
    // Two cards left in the deck, a pile of twenty under the top card.
    let kept = [num(Color::Red, 1), num(Color::Blue, 2)];
    st(&mut r).deck.cards = kept.to_vec();
    let pile: Vec<Card> = (0..21).map(|v| num(Color::Green, v % 10)).collect();
    st(&mut r).discard = pile;

    r.ensure_deck(6);

    let s = st_ref(&r);
    let got = s.deck.cards.len();
    assert_eq!(
        got, 22,
        "deck after replenish = {got} cards, want 22 (2 kept + 20 from the pile)"
    );
    assert_eq!(
        s.discard.len(),
        1,
        "discard after replenish = {} cards, want the top card alone",
        s.discard.len()
    );
    for k in kept {
        assert!(
            s.deck.cards.contains(&k),
            "card {k:?} that was still in the deck is gone after the replenish"
        );
    }
}

// A finished room keeps its scores for the game-over screen, and everything
// the scoreboard is drawn from is indexed by seat: removing a seat re-bases
// them with the roster, or the leaver's column shows under the seat above it.
#[test]
fn room_remove_lobby_player_rebases_the_scores() {
    let mut r = new_room("RBSC");
    for n in ["alice", "bob", "carol"] {
        must_join(&mut r, n);
    }
    r.status = Status::Finished;
    r.scores = vec![10, 20, 30];
    r.rounds_won = vec![1, 0, 2];
    r.lost_hand_total = vec![5, 6, 7];
    r.retired = vec![false, true, false];
    r.round_history = vec![vec![1, 2, 3], vec![4, 5, 6]];

    r.remove_lobby_player(1).unwrap();

    assert_eq!(r.scores, vec![10, 30], "Scores");
    assert_eq!(r.rounds_won, vec![1, 2], "RoundsWon");
    assert_eq!(r.lost_hand_total, vec![5, 7], "LostHandTotal");
    assert_eq!(r.round_history[0], vec![1, 3], "RoundHistory[0]");
    assert_eq!(r.round_history[1], vec![4, 6], "RoundHistory[1]");
    assert_eq!(
        r.retired,
        vec![false, false],
        "Retired = {:?}, want [false false]",
        r.retired
    );
}

// A one-card interject off a one-card hand was declared before the message,
// and the log used to carry the call twice.
#[test]
fn interrupt_play_cards_single_card_finish_logs_one_declaration() {
    let mut r = new_room("ONED");
    for n in ["a", "b"] {
        must_join(&mut r, n);
    }
    r.start(NOW).unwrap();
    let top = num(Color::Red, 5);
    {
        let s = st(&mut r);
        s.discard = vec![top];
        s.active_color = Color::Red;
        s.hands[1] = Hand::of([top]);
        s.current_turn = 0;
        s.last_play_by = Some(0);
        s.interrupt_open = true;
        s.update_last_card_state(1, NOW);
    }
    r.declare_last_card(1, NOW).unwrap();
    let count = |r: &crate::room::Room| {
        st_ref(r)
            .event_log
            .iter()
            .filter(|ev| ev.kind == EventKind::UnoDeclared)
            .count()
    };
    let before = count(&r);
    r.interrupt_play(1, &[top], Color::Red, None, NOW).unwrap();
    let after = count(&r);
    assert_eq!(
        after, before,
        "declarations in the log went {before} -> {after} on a one-card finish, want unchanged"
    );
}
