//! Ported from Go: `server/game/room_test.go`, from
//! `TestRoom_Reverse_FlipsDirection` to the end of the file. The helpers that
//! file defined in this range (`setupTwoPlayerGame`, `setupThreePlayerGame`,
//! `armInterrupt`, `finishMatch`, `nearSeat`, `declareLast`) live in
//! `support.rs`.

use super::support::*;
use crate::card::{Card, Color, Kind};
use crate::error::GameError;
use crate::hand::Hand;
use crate::room::{CATCH_WINDOW_MS, FAILED_CATCH_PENALTY, INITIAL_HAND_SIZE, MatchFormat, Status};

/// Go: `r.State.Hands[i].Cards = append([]Card{c}, r.State.Hands[i].Cards...)`.
fn prepend(r: &mut crate::room::Room, seat: usize, card: Card) {
    st(r).hands[seat].cards.insert(0, card);
}

#[test]
fn room_reverse_flips_direction() {
    let mut r = setup_three_player_game();
    // alice(0) plays a Reverse → direction becomes -1 → next turn is carol(2).
    st(&mut r).active_color = Color::Red;
    st(&mut r).discard = vec![num(Color::Red, 5)];
    st(&mut r).direction = 1;

    let rev = act(Color::Red, Kind::Reverse);
    prepend(&mut r, 0, rev);

    r.play_card(0, rev, Color::Red, -1, NOW)
        .expect("PlayCard Reverse");
    assert_eq!(st_ref(&r).direction, -1, "Direction after Reverse");
    assert_eq!(
        st_ref(&r).current_turn,
        2,
        "after Reverse (3p), want 2 (carol)"
    );
}

#[test]
fn room_reverse_two_players_acts_as_skip() {
    let mut r = setup_two_player_game();
    // With 2 players, Reverse acts as Skip — alice plays again.
    st(&mut r).active_color = Color::Red;
    st(&mut r).discard = vec![num(Color::Red, 5)];
    st(&mut r).direction = 1;

    let rev = act(Color::Red, Kind::Reverse);
    prepend(&mut r, 0, rev);

    r.play_card(0, rev, Color::Red, -1, NOW)
        .expect("PlayCard Reverse 2-player");
    // Direction flips then alice gets another turn (2-player skip behaviour).
    assert_eq!(
        st_ref(&r).current_turn,
        0,
        "after Reverse 2p, want 0 (alice again)"
    );
}

#[test]
fn room_wild_sets_active_color() {
    let mut r = setup_two_player_game();
    st(&mut r).active_color = Color::Red;
    st(&mut r).discard = vec![num(Color::Red, 5)];

    let w = wild(Kind::WildCard);
    prepend(&mut r, 0, w);

    r.play_card(0, w, Color::Green, -1, NOW)
        .expect("PlayCard Wild");
    assert_eq!(st_ref(&r).active_color, Color::Green);
    assert_eq!(st_ref(&r).current_turn, 1, "after Wild, want 1 (bob)");
}

#[test]
fn room_wild_draw_four_sets_pending_and_color() {
    let mut r = setup_two_player_game();
    st(&mut r).active_color = Color::Red;
    st(&mut r).discard = vec![num(Color::Red, 5)];

    let wdf = wild(Kind::WildDrawFour);
    prepend(&mut r, 0, wdf);

    r.play_card(0, wdf, Color::Blue, -1, NOW)
        .expect("PlayCard WildDrawFour");
    assert_eq!(st_ref(&r).active_color, Color::Blue);
    assert_eq!(st_ref(&r).pending_draw, 4);
    assert_eq!(st_ref(&r).current_turn, 1, "want 1 (bob)");
}

#[test]
fn room_draw_stack_draw_two_plus_wild_draw_four() {
    // alice plays +2 → bob counters with +4 (different kind, should be rejected by CounterDraw).
    // Actually the counter rule requires matching kind, so bob can't counter.
    // Instead: alice plays +2, bob faces 2; bob then plays another +2 → stack = 4.
    let mut r = setup_three_player_game();
    st(&mut r).active_color = Color::Red;
    st(&mut r).discard = vec![num(Color::Red, 5)];
    st(&mut r).direction = 1;

    let alice2 = act(Color::Red, Kind::DrawTwo);
    prepend(&mut r, 0, alice2);
    r.play_card(0, alice2, Color::Red, -1, NOW)
        .expect("alice +2");
    assert_eq!(st_ref(&r).pending_draw, 2, "PendingDraw after +2");
    assert_eq!(st_ref(&r).current_turn, 1);

    let bob2 = act(Color::Red, Kind::DrawTwo);
    prepend(&mut r, 1, bob2);
    r.counter_draw(1, bob2, Color::Red, NOW)
        .expect("bob counter +2");
    assert_eq!(st_ref(&r).pending_draw, 4, "after counter");
    assert_eq!(st_ref(&r).current_turn, 2, "after counter, want 2 (carol)");
    // Carol draws and takes all 4.
    let carol_before = st_ref(&r).hands[2].cards.len();
    r.draw_card(2, NOW).expect("carol draw");
    assert_eq!(st_ref(&r).hands[2].cards.len(), carol_before + 4);
    assert_eq!(st_ref(&r).pending_draw, 0, "PendingDraw after draw");
}

#[test]
fn room_counter_draw_wild_draw_four() {
    let mut r = setup_two_player_game();
    // alice plays +4 → bob faces 4 → bob counters with another +4 → alice faces 8.
    st(&mut r).active_color = Color::Red;
    st(&mut r).discard = vec![num(Color::Red, 5)];

    let wdf1 = wild(Kind::WildDrawFour);
    prepend(&mut r, 0, wdf1);
    r.play_card(0, wdf1, Color::Green, -1, NOW)
        .expect("alice +4");
    assert_eq!(st_ref(&r).pending_draw, 4);

    let wdf2 = wild(Kind::WildDrawFour);
    prepend(&mut r, 1, wdf2);
    r.counter_draw(1, wdf2, Color::Blue, NOW)
        .expect("bob counter +4");
    assert_eq!(st_ref(&r).pending_draw, 8, "after counter");
    assert_eq!(st_ref(&r).current_turn, 0, "after counter, want 0 (alice)");
    // Alice draws 8 penalty cards.
    let alice_before = st_ref(&r).hands[0].cards.len();
    r.draw_card(0, NOW).expect("alice draw 8");
    assert_eq!(st_ref(&r).hands[0].cards.len(), alice_before + 8);
}

// --- Interrupt play tests ---

#[test]
fn room_interrupt_play_valid() {
    let mut r = setup_three_player_game();
    // alice(0) has just played Red-7; top discard is Red-7; it is now bob(1)'s turn.
    // carol(2) holds a Red-7 and interrupts.
    st(&mut r).current_turn = 1; // bob's turn
    st(&mut r).active_color = Color::Red;
    st(&mut r).discard = vec![num(Color::Red, 7)];
    st(&mut r).pending_draw = 0;
    arm_interrupt(&mut r, 0);

    let carol_card = num(Color::Red, 7);
    prepend(&mut r, 2, carol_card);
    let carol_hand_before = st_ref(&r).hands[2].cards.len();

    r.interrupt_play(2, carol_card, carol_card.color, -1, NOW)
        .expect("InterruptPlay");
    // carol's hand shrank by 1
    assert_eq!(st_ref(&r).hands[2].cards.len(), carol_hand_before - 1);
    // Top discard is now carol's card
    let top = *st_ref(&r).discard.last().unwrap();
    assert!(
        top.color == Color::Red && top.kind == Kind::Number && top.value == 7,
        "top card = {top:?}, want Red-7-Number"
    );
    // Turn should have advanced from carol (2) clockwise to alice (0) — skipping no one.
    assert_eq!(
        st_ref(&r).current_turn,
        0,
        "after interrupt by carol, want 0 (alice)"
    );
}

// Every card can take the lead, wilds included — "identical to the top" is the
// only rule. A wild on a wild is identical (they share the wild colour), and the
// interjecter picks the new active colour just like a normal wild play.
#[test]
fn room_interrupt_play_wild_on_wild_allowed() {
    let mut r = setup_three_player_game();
    st(&mut r).current_turn = 1;
    st(&mut r).direction = 1;
    st(&mut r).active_color = Color::Red;
    st(&mut r).discard = vec![wild(Kind::WildCard)];
    arm_interrupt(&mut r, 0);

    let w = wild(Kind::WildCard);
    prepend(&mut r, 2, w);

    r.interrupt_play(2, w, Color::Green, -1, NOW)
        .expect("wild-on-wild interrupt must be accepted");
    assert_eq!(
        st_ref(&r).active_color,
        Color::Green,
        "interjecter's choice"
    );
    assert_eq!(st_ref(&r).current_turn, 0, "want 0 (seat after carol)");
}

#[test]
fn room_interrupt_play_wild_draw_four_extends_chain() {
    let mut r = setup_three_player_game();
    st(&mut r).current_turn = 1;
    st(&mut r).direction = 1;
    st(&mut r).active_color = Color::Red;
    st(&mut r).discard = vec![wild(Kind::WildDrawFour)];
    st(&mut r).pending_draw = 4;
    arm_interrupt(&mut r, 0);

    let wd4 = wild(Kind::WildDrawFour);
    prepend(&mut r, 2, wd4);

    r.interrupt_play(2, wd4, Color::Blue, -1, NOW)
        .expect("WildDrawFour interject must be accepted");
    assert_eq!(st_ref(&r).pending_draw, 8, "chain extended");
    assert_eq!(st_ref(&r).current_turn, 0, "victim is the seat after carol");
}

#[test]
fn room_interrupt_play_global_switch_rotates_hands() {
    let mut r = setup_three_player_game();
    st(&mut r).current_turn = 1;
    st(&mut r).direction = 1;
    st(&mut r).active_color = Color::Red;
    st(&mut r).discard = vec![wild(Kind::GlobalSwitch)];
    arm_interrupt(&mut r, 0);

    let gs = wild(Kind::GlobalSwitch);
    st(&mut r).hands[0].cards = vec![num(Color::Red, 1)];
    st(&mut r).hands[1].cards = vec![num(Color::Red, 2)];
    st(&mut r).hands[2].cards = vec![gs, num(Color::Red, 3)];

    r.interrupt_play(2, gs, Color::Yellow, -1, NOW)
        .expect("GlobalSwitch interject must be accepted");
    // Hands rotate one seat in the play direction: seat i receives seat i-1's hand.
    assert_eq!(
        st_ref(&r).hands[0].cards[0].value,
        3,
        "alice received carol's hand"
    );
    assert_eq!(
        st_ref(&r).hands[1].cards[0].value,
        1,
        "bob received alice's hand"
    );
    assert_eq!(
        st_ref(&r).hands[2].cards[0].value,
        2,
        "carol received bob's hand"
    );
}

#[test]
fn room_interrupt_play_wild_without_color_rejected() {
    let mut r = setup_three_player_game();
    st(&mut r).current_turn = 1;
    st(&mut r).discard = vec![wild(Kind::WildCard)];
    arm_interrupt(&mut r, 0);

    let w = wild(Kind::WildCard);
    prepend(&mut r, 2, w);

    assert!(
        r.interrupt_play(2, w, Color::Wild, -1, NOW).is_err(),
        "a wild interject must name a real colour"
    );
    assert_eq!(
        st_ref(&r).discard.len(),
        1,
        "a rejected interject must not touch the discard pile"
    );
}

#[test]
fn room_interrupt_play_non_matching_card_rejected() {
    let mut r = setup_two_player_game();
    st(&mut r).current_turn = 0;
    st(&mut r).active_color = Color::Red;
    st(&mut r).discard = vec![num(Color::Red, 5)];

    let mismatch = num(Color::Blue, 5); // same value, wrong color
    prepend(&mut r, 1, mismatch);
    assert!(
        r.interrupt_play(1, mismatch, mismatch.color, -1, NOW)
            .is_err(),
        "color-mismatched interrupt should be rejected"
    );
}

#[test]
fn room_interrupt_play_value_mismatch_rejected() {
    let mut r = setup_two_player_game();
    st(&mut r).current_turn = 0;
    st(&mut r).active_color = Color::Red;
    st(&mut r).discard = vec![num(Color::Red, 5)];

    let mismatch = num(Color::Red, 3); // same color, wrong value
    prepend(&mut r, 1, mismatch);
    assert!(
        r.interrupt_play(1, mismatch, mismatch.color, -1, NOW)
            .is_err(),
        "value-mismatched interrupt should be rejected"
    );
}

// During an active draw chain (PendingDraw > 0) only an identical draw card may
// be interjected — in a consistent state that is implied by the identical-to-top
// rule, but a non-draw "match" (only reachable from inconsistent state) must
// still be rejected rather than silently swallowing the pending penalty.
#[test]
fn room_interrupt_play_non_draw_card_during_pending_draw_rejected() {
    let mut r = setup_two_player_game();
    st(&mut r).current_turn = 0;
    st(&mut r).pending_draw = 2;
    st(&mut r).active_color = Color::Red;
    st(&mut r).discard = vec![num(Color::Red, 5)];
    arm_interrupt(&mut r, 0);
    let match_card = num(Color::Red, 5);
    prepend(&mut r, 1, match_card);
    assert!(
        r.interrupt_play(1, match_card, match_card.color, -1, NOW)
            .is_err(),
        "non-DrawTwo interrupt during pending draw should be rejected"
    );
}

#[test]
fn room_interrupt_play_own_turn_allowed() {
    // Slamming an identical card is available to everyone, including whoever
    // currently holds the turn — the client may route the tap either way.
    let mut r = setup_three_player_game();
    st(&mut r).current_turn = 0;
    st(&mut r).direction = 1;
    st(&mut r).active_color = Color::Red;
    st(&mut r).discard = vec![num(Color::Red, 5)];
    arm_interrupt(&mut r, 2); // someone else just played
    let match_card = num(Color::Red, 5);
    prepend(&mut r, 0, match_card);
    r.interrupt_play(0, match_card, match_card.color, -1, NOW)
        .expect("interrupt on own turn must be accepted");
    assert_eq!(
        st_ref(&r).current_turn,
        1,
        "after alice's slam, want 1 (bob)"
    );
}

#[test]
fn room_interrupt_play_empties_hand_ends_round() {
    // carol(2) interrupts with her last card → round ends immediately, carol wins.
    let mut r = setup_three_player_game();
    st(&mut r).current_turn = 1; // bob's turn
    st(&mut r).active_color = Color::Red;
    st(&mut r).discard = vec![num(Color::Red, 9)];
    st(&mut r).pending_draw = 0;
    arm_interrupt(&mut r, 0);

    let win_card = num(Color::Red, 9);
    st(&mut r).hands[2].cards = vec![win_card];
    st(&mut r).hands[1].cards = vec![act(Color::Red, Kind::Skip)]; // bob has 1 card (20 pts)

    declare_last(&mut r, 2);
    r.interrupt_play(2, win_card, win_card.color, -1, NOW)
        .expect("InterruptPlay finish");
    assert!(
        r.round_ended,
        "round must end the moment carol empties her hand via interrupt"
    );
    assert_eq!(r.winner, "carol", "round winner");
    assert_ne!(
        r.scores[2], 0,
        "carol should have scored points from other players' hands"
    );
    assert!(
        r.scores[1] == 0 && r.scores[0] == 0,
        "non-winners must score 0 this round"
    );
}

// Interjecting a Swap must remove the played card from the interjecter's
// hand BEFORE the hand exchange. Previously the swap happened first, after
// which Remove() looked for the card in the swapped-in opponent hand and
// failed (since Swap is one-per-color, no duplicates).
#[test]
fn room_interrupt_play_swap_removes_before_swapping() {
    let mut r = setup_three_player_game();
    st(&mut r).current_turn = 1; // bob's turn
    st(&mut r).active_color = Color::Red;
    st(&mut r).discard = vec![act(Color::Red, Kind::Swap)];
    st(&mut r).pending_draw = 0;
    arm_interrupt(&mut r, 0);

    let swap = act(Color::Red, Kind::Swap);
    // carol(2) has the matching Red Swap plus two other cards.
    let carol_other1 = num(Color::Blue, 4);
    let carol_other2 = act(Color::Green, Kind::Skip);
    st(&mut r).hands[2].cards = vec![swap, carol_other1, carol_other2];
    // bob (the swap target chosen by carol) has a known hand we can identify post-swap.
    let bob_hand = vec![
        num(Color::Yellow, 1),
        num(Color::Yellow, 2),
        num(Color::Yellow, 3),
    ];
    st(&mut r).hands[1].cards = bob_hand.clone();

    r.interrupt_play(2, swap, swap.color, 1, NOW)
        .expect("InterruptPlay Swap");
    // Top discard is the Red Swap.
    assert_eq!(*st_ref(&r).discard.last().unwrap(), swap, "top discard");
    // carol now holds bob's original hand (3 cards), NOT including the played Swap.
    assert_eq!(
        st_ref(&r).hands[2].cards,
        bob_hand,
        "carol holds bob's old hand"
    );
    // bob now holds carol's remaining 2 cards (Swap was removed before swap).
    assert_eq!(
        st_ref(&r).hands[1].cards,
        vec![carol_other1, carol_other2],
        "bob holds carol's old non-Swap cards"
    );
}

// Interjecting a Swap as the actor's last card must end the round
// (actor wins) and abort the hand exchange — same shape as the Swap
// edge case in PlayCard (rules.md §13).
#[test]
fn room_interrupt_play_swap_as_last_card_ends_round_without_swapping() {
    let mut r = setup_three_player_game();
    st(&mut r).current_turn = 1; // bob's turn
    st(&mut r).active_color = Color::Red;
    st(&mut r).discard = vec![act(Color::Red, Kind::Swap)];
    st(&mut r).pending_draw = 0;
    arm_interrupt(&mut r, 0);

    let swap = act(Color::Red, Kind::Swap);
    st(&mut r).hands[2].cards = vec![swap]; // carol's only card
    let bob_hand_before = vec![num(Color::Yellow, 1), num(Color::Yellow, 2)];
    st(&mut r).hands[1].cards = bob_hand_before.clone();

    declare_last(&mut r, 2);
    r.interrupt_play(2, swap, swap.color, 1, NOW)
        .expect("InterruptPlay last-card swap");
    assert!(
        r.round_ended,
        "interjecting Swap as last card must end the round"
    );
    assert_eq!(r.winner, "carol", "round winner");
    assert_eq!(
        st_ref(&r).hands[2].cards.len(),
        0,
        "carol hand (swap aborted)"
    );
    assert_eq!(
        st_ref(&r).hands[1].cards.len(),
        bob_hand_before.len(),
        "bob hand (swap aborted)"
    );
}

#[test]
fn room_interrupt_play_skip_effect() {
    // carol(2) interrupts with a Red-Skip; the Skip should apply from carol's position,
    // so the player after carol (alice, 0) is skipped and the new turn is bob (1).
    let mut r = setup_three_player_game();
    st(&mut r).current_turn = 0; // alice's turn
    st(&mut r).active_color = Color::Red;
    st(&mut r).discard = vec![act(Color::Red, Kind::Skip)];
    st(&mut r).pending_draw = 0;
    st(&mut r).direction = 1; // clockwise: alice(0)→bob(1)→carol(2)
    arm_interrupt(&mut r, 1); // pretend bob just played

    // carol has a Red-Skip (exact match of top)
    let carol_skip = act(Color::Red, Kind::Skip);
    prepend(&mut r, 2, carol_skip);

    r.interrupt_play(2, carol_skip, carol_skip.color, -1, NOW)
        .expect("InterruptPlay Skip");
    // Skip from carol (2): skip the next player after carol.
    // Clockwise from carol(2): next is alice(0), then bob(1).
    // Skip means alice(0) is skipped → turn is bob(1).
    assert_eq!(
        st_ref(&r).current_turn,
        1,
        "after carol Skip interrupt, want 1 (bob)"
    );
}

// --- Phase B: batch play and identical-card interrupt ---

#[test]
fn room_play_cards_stacked_draw_two() {
    let mut r = setup_three_player_game();
    st(&mut r).active_color = Color::Red;
    st(&mut r).discard = vec![num(Color::Red, 5)];
    st(&mut r).direction = 1;

    let d2 = act(Color::Red, Kind::DrawTwo);
    st(&mut r).hands[0].cards = vec![d2, d2, d2, num(Color::Blue, 4)];

    r.play_cards(0, &[d2, d2, d2], Color::Red, -1, false, NOW)
        .expect("PlayCards 3x +2");
    assert_eq!(st_ref(&r).pending_draw, 6, "3 × +2");
    assert_eq!(st_ref(&r).current_turn, 1, "want 1 (bob)");
    // All 3 +2 cards should be on top of discard.
    assert_eq!(st_ref(&r).discard.len(), 4, "initial + 3 +2s");
    // Player 0 hand has only the unrelated card left.
    assert_eq!(st_ref(&r).hands[0].size(), 1);
}

#[test]
fn room_play_cards_stacked_skip_skips_multiple_players() {
    // 4 players. Alice plays 2 Skip cards → skips 2 players → carol plays.
    let mut r = new_room("BSKP");
    for n in ["a", "b", "c", "d"] {
        let _ = r.join(n);
    }
    let _ = r.start(NOW);
    {
        let s = st(&mut r);
        s.current_turn = 0;
        s.pending_draw = 0;
        s.direction = 1;
        s.active_color = Color::Red;
        s.discard = vec![num(Color::Red, 5)];
    }
    let skip = act(Color::Red, Kind::Skip);
    st(&mut r).hands[0].cards = vec![skip, skip, num(Color::Yellow, 9)];

    r.play_cards(0, &[skip, skip], Color::Red, -1, false, NOW)
        .expect("PlayCards 2x Skip");
    // One Skip alone takes turn from 0 to 2 (skips 1). Two Skips take it to 3.
    assert_eq!(
        st_ref(&r).current_turn,
        3,
        "after 2x Skip from p0, want 3 (d)"
    );
}

#[test]
fn room_play_cards_rejects_non_identical() {
    let mut r = setup_two_player_game();
    st(&mut r).discard = vec![num(Color::Red, 5)];
    st(&mut r).active_color = Color::Red;
    let a = num(Color::Red, 5);
    let b = num(Color::Red, 6);
    st(&mut r).hands[0].cards = vec![a, b];
    assert!(
        r.play_cards(0, &[a, b], Color::Red, -1, false, NOW)
            .is_err(),
        "non-identical batch should be rejected"
    );
}

#[test]
fn room_play_cards_rejects_batch_swap() {
    let mut r = setup_two_player_game();
    st(&mut r).discard = vec![num(Color::Red, 5)];
    st(&mut r).active_color = Color::Red;
    let swap = act(Color::Red, Kind::Swap);
    st(&mut r).hands[0].cards = vec![swap, swap];
    assert!(
        r.play_cards(0, &[swap, swap], Color::Red, 1, false, NOW)
            .is_err(),
        "batch Swap must be rejected"
    );
}

// Per docs/rules.md §6, interjection is only allowed with an *exactly identical*
// card (same color + kind + value). A non-matching DrawTwo must be rejected.
#[test]
fn room_interrupt_play_non_identical_draw_two_rejected() {
    let mut r = setup_three_player_game();
    st(&mut r).current_turn = 0;
    st(&mut r).active_color = Color::Yellow;
    st(&mut r).discard = vec![num(Color::Yellow, 7)];
    st(&mut r).pending_draw = 0;
    arm_interrupt(&mut r, 2);

    let bob2 = act(Color::Blue, Kind::DrawTwo); // not identical to Yellow-7 top
    st(&mut r).hands[1].cards = vec![bob2, num(Color::Red, 1)];

    assert!(
        r.interrupt_play(1, bob2, bob2.color, -1, NOW).is_err(),
        "non-identical DrawTwo interrupt should be rejected"
    );
    // State must be untouched.
    assert_eq!(
        st_ref(&r).pending_draw,
        0,
        "interrupt rejected, no mutation"
    );
    assert_eq!(st_ref(&r).discard.len(), 1, "no mutation");
    assert_eq!(st_ref(&r).hands[1].size(), 2, "no mutation");
}

// Non-identical DrawTwo (color mismatch) during a Take2 chain must still be
// rejected — only an *exactly* identical DrawTwo may extend the chain.
#[test]
fn room_interrupt_play_non_identical_draw_two_during_chain() {
    let mut r = setup_three_player_game();
    st(&mut r).current_turn = 1;
    st(&mut r).pending_draw = 2;
    st(&mut r).active_color = Color::Red;
    st(&mut r).discard = vec![act(Color::Red, Kind::DrawTwo)];
    arm_interrupt(&mut r, 0);
    let bob2 = act(Color::Blue, Kind::DrawTwo); // wrong color
    st(&mut r).hands[2].cards = vec![bob2];
    assert!(
        r.interrupt_play(2, bob2, bob2.color, -1, NOW).is_err(),
        "color-mismatched DrawTwo during pending draw must be rejected"
    );
}

// Per rules: an identical DrawTwo may interject an active Take2 chain. The
// chain continues from the interjecter's seat — the next player after the
// interjecter becomes the new victim with the accumulated total.
#[test]
fn room_interrupt_play_identical_draw_two_extends_chain() {
    let mut r = setup_three_player_game();
    st(&mut r).current_turn = 1; // bob is the current victim
    st(&mut r).pending_draw = 2;
    st(&mut r).active_color = Color::Red;
    st(&mut r).direction = 1;
    st(&mut r).discard = vec![act(Color::Red, Kind::DrawTwo)];
    arm_interrupt(&mut r, 0); // alice played the original DrawTwo

    let carol_d2 = act(Color::Red, Kind::DrawTwo);
    st(&mut r).hands[2].cards = vec![carol_d2, num(Color::Blue, 1)];

    r.interrupt_play(2, carol_d2, carol_d2.color, -1, NOW)
        .expect("identical DrawTwo interrupt during chain");
    assert_eq!(st_ref(&r).pending_draw, 4, "chain extended");
    // Next player after carol(2) clockwise is alice(0): she is now the victim.
    assert_eq!(
        st_ref(&r).current_turn,
        0,
        "after carol's DrawTwo interject, want 0 (alice)"
    );
}

// --- Phase C: explicit interrupt window + batch interrupt ---

#[test]
fn room_interrupt_play_closed_window_rejected() {
    // The window is closed by a draw / pass / round end, not by elapsed time.
    let mut r = setup_three_player_game();
    st(&mut r).current_turn = 1;
    st(&mut r).active_color = Color::Red;
    st(&mut r).discard = vec![num(Color::Red, 7)];
    st(&mut r).pending_draw = 0;
    st(&mut r).close_interrupt_window();

    let carol_card = num(Color::Red, 7);
    prepend(&mut r, 2, carol_card);

    assert!(
        r.interrupt_play(2, carol_card, carol_card.color, -1, NOW)
            .is_err(),
        "interrupt on a closed window must be rejected"
    );
}

// The opening discard is a card on the pile like any other, so the seat dealt
// its twin may slam it before the round's first turn is taken. This used to be
// refused with ErrInterruptWindowClosed — which the client renders as "somebody
// was faster" — on a table where nobody had played at all. Nothing is armed by
// hand here: the point is the state dealRound leaves behind.
#[test]
fn room_interrupt_play_opening_discard_is_interceptable() {
    let mut r = setup_three_player_game();

    assert!(
        st_ref(&r).interrupt_open,
        "the deal must leave the interrupt window open on the opening discard"
    );
    assert_eq!(
        st_ref(&r).last_play_by,
        -1,
        "LastPlayBy after the deal: nobody played that card"
    );

    let top = st_ref(&r).top_card();
    assert_eq!(top.kind, Kind::Number, "opening discard = {top:?}");
    // Carol is neither the current player nor the one who put the card there.
    prepend(&mut r, 2, top);
    let before = st_ref(&r).hands[2].cards.len();

    r.interrupt_play(2, top, top.color, -1, NOW)
        .expect("interrupt on the opening discard must be accepted");
    assert_eq!(st_ref(&r).last_play_by, 2, "carol took the lead");
    assert_eq!(
        st_ref(&r).hands[2].cards.len(),
        before - 1,
        "the slammed copy left her hand"
    );
}

// The window the deal opens closes the same way every other one does.
#[test]
fn room_interrupt_play_opening_window_closes_on_a_draw() {
    let mut r = setup_three_player_game();
    let top = st_ref(&r).top_card();
    prepend(&mut r, 2, top);

    let turn = st_ref(&r).current_turn;
    r.draw_card(turn, NOW).expect("voluntary draw");
    assert!(
        !st_ref(&r).interrupt_open,
        "a draw must close the window the deal opened"
    );
    assert_eq!(
        r.interrupt_play(2, top, top.color, -1, NOW),
        Err(GameError::InterruptWindowClosed),
        "interrupt after the draw"
    );
}

#[test]
fn room_interrupt_play_no_time_limit() {
    // Taking the lead has no deadline: as long as the matching card is still on
    // top and nobody has drawn / passed, the jump-in stays available.
    let mut r = setup_three_player_game();
    st(&mut r).current_turn = 1;
    st(&mut r).active_color = Color::Red;
    st(&mut r).discard = vec![num(Color::Red, 7)];
    st(&mut r).pending_draw = 0;
    arm_interrupt(&mut r, 0);
    // Simulate a long think from the current player.
    st(&mut r).last_play_at = Some(NOW - 30_000);

    let carol_card = num(Color::Red, 7);
    prepend(&mut r, 2, carol_card);

    assert_eq!(
        r.interrupt_play(2, carol_card, carol_card.color, -1, NOW),
        Ok(()),
        "interrupt long after the play must still be accepted"
    );
    assert_eq!(st_ref(&r).last_play_by, 2, "carol took the lead");
}

#[test]
fn room_interrupt_play_self_interrupt_allowed() {
    // The player who just played may slam a second identical card and take the
    // lead back — this is the core of the game's speed.
    let mut r = setup_three_player_game();
    st(&mut r).current_turn = 1;
    st(&mut r).direction = 1;
    st(&mut r).active_color = Color::Red;
    st(&mut r).discard = vec![num(Color::Red, 7)];
    st(&mut r).pending_draw = 0;
    arm_interrupt(&mut r, 0); // alice just played

    let dup = num(Color::Red, 7);
    prepend(&mut r, 0, dup);

    r.interrupt_play(0, dup, dup.color, -1, NOW)
        .expect("self-interrupt must be accepted");
    // Lead transfers back to alice, so the next seat clockwise plays: bob(1).
    assert_eq!(
        st_ref(&r).current_turn,
        1,
        "after alice's self-interrupt, want 1 (bob)"
    );
}

#[test]
fn room_interrupt_play_fastest_serialized_wins() {
    // Two non-current players hold an identical Red-7 and both attempt to
    // interrupt. The first call wins (turn transfers to that player). The
    // second call runs against post-first state — it is a chain interrupt
    // against the same identical card on top, also valid, transferring lead onward.
    let mut r = new_room("FAST");
    for nick in ["alice", "bob", "carol", "dave"] {
        must_join(&mut r, nick);
    }
    r.start(NOW).expect("Start");
    {
        let s = st(&mut r);
        s.current_turn = 1; // bob's turn (alice just played)
        s.direction = 1;
        s.active_color = Color::Red;
        s.discard = vec![num(Color::Red, 7)];
        s.pending_draw = 0;
    }
    arm_interrupt(&mut r, 0); // alice just played

    let m = num(Color::Red, 7);
    // carol(2) and dave(3) both hold the identical card.
    prepend(&mut r, 2, m);
    prepend(&mut r, 3, m);

    r.interrupt_play(2, m, m.color, -1, NOW)
        .expect("first interrupt by carol");
    assert_eq!(
        st_ref(&r).last_play_by,
        2,
        "LastPlayBy after first interrupt (carol)"
    );
    // After carol's interject CurrentTurn = dave(3).

    // Second arrival: dave slams the same identical card. Being the current
    // player is no longer a reason to refuse — he simply takes the lead in turn,
    // and the seat after him plays next.
    r.interrupt_play(3, m, m.color, -1, NOW)
        .expect("second interrupt by dave");
    assert_eq!(
        st_ref(&r).last_play_by,
        3,
        "LastPlayBy after second interrupt (dave)"
    );
    assert_eq!(
        st_ref(&r).current_turn,
        0,
        "after dave's interject, want 0 (alice)"
    );
}

#[test]
fn room_interrupt_play_cards_batch_is_refused() {
    // carol holds three Red-3 and tries to slam all three at once. An interject
    // is one card: the copies are three presses into three windows, not one.
    let mut r = setup_three_player_game();
    st(&mut r).current_turn = 1;
    st(&mut r).active_color = Color::Red;
    st(&mut r).discard = vec![num(Color::Red, 3)];
    st(&mut r).pending_draw = 0;
    arm_interrupt(&mut r, 0);

    let m = num(Color::Red, 3);
    st(&mut r).hands[2].cards = vec![m, m, m, num(Color::Blue, 5)];
    let discard_len = st_ref(&r).discard.len();

    assert_eq!(
        r.interrupt_play_cards(2, &[m, m, m], m.color, -1, NOW),
        Err(GameError::InterruptBatch),
        "batch interject"
    );
    assert_eq!(
        st_ref(&r).discard.len(),
        discard_len,
        "discard mutated after rejection"
    );
    assert_eq!(st_ref(&r).hands[2].size(), 4, "carol hand size");
    assert_eq!(
        st_ref(&r).current_turn,
        1,
        "turn moved on a refused interject"
    );

    // One press, one card, and the lead is taken exactly as before.
    r.interrupt_play_cards(2, &[m], m.color, -1, NOW)
        .expect("single interject");
    assert_eq!(st_ref(&r).discard.len(), discard_len + 1, "initial + 1");
    assert_eq!(st_ref(&r).hands[2].size(), 3, "two copies left to press");
    assert_eq!(
        st_ref(&r).last_play_by,
        2,
        "LastPlayBy after interrupt (carol)"
    );
}

#[test]
fn room_interrupt_play_cards_not_in_hand_does_not_mutate() {
    // Player slams a card matching the top that they do not hold. Reject and
    // leave state untouched.
    let mut r = setup_three_player_game();
    st(&mut r).current_turn = 1;
    st(&mut r).active_color = Color::Red;
    st(&mut r).discard = vec![num(Color::Red, 4)];
    st(&mut r).pending_draw = 0;
    arm_interrupt(&mut r, 0);

    let m = num(Color::Red, 4);
    st(&mut r).hands[2].cards = vec![num(Color::Blue, 9)];
    let discard_len = st_ref(&r).discard.len();
    let hand_len = st_ref(&r).hands[2].size();
    let turn_before = st_ref(&r).current_turn;

    assert_eq!(
        r.interrupt_play_cards(2, &[m], m.color, -1, NOW),
        Err(GameError::CardNotInHand),
        "interject of a card not held"
    );
    assert_eq!(
        st_ref(&r).discard.len(),
        discard_len,
        "discard mutated after rejection"
    );
    assert_eq!(
        st_ref(&r).hands[2].size(),
        hand_len,
        "hand mutated after rejection"
    );
    assert_eq!(
        st_ref(&r).current_turn,
        turn_before,
        "turn mutated after rejection"
    );
}

#[test]
fn room_play_card_opens_interrupt_window() {
    let mut r = setup_two_player_game();
    st(&mut r).active_color = Color::Red;
    st(&mut r).discard = vec![num(Color::Red, 5)];
    let play = num(Color::Red, 5);
    st(&mut r).hands[0].cards = vec![play, num(Color::Blue, 9)];
    r.play_card(0, play, Color::Red, -1, NOW).expect("PlayCard");
    assert_eq!(st_ref(&r).last_play_by, 0);
    assert!(
        st_ref(&r).last_play_at.is_some(),
        "LastPlayAt must be stamped after a play"
    );
}

#[test]
fn room_draw_card_closes_interrupt_window() {
    let mut r = setup_two_player_game();
    arm_interrupt(&mut r, 1);
    r.draw_card(0, NOW).expect("DrawCard");
    assert_eq!(
        st_ref(&r).last_play_by,
        -1,
        "after DrawCard, LastPlayBy (window closed)"
    );
}

// --- BeginNextRound edge cases ---

#[test]
fn room_begin_next_round_rejects_after_match_over() {
    let mut r = new_room("BNRM");
    let _ = r.join("alice");
    let _ = r.join("bob");
    r.format = MatchFormat::BO1;
    let _ = r.start(NOW);
    st(&mut r).current_turn = 0;
    st(&mut r).pending_draw = 0;

    // Force alice to win round 1 → BO1 → MatchOver = true.
    let top = *st_ref(&r).discard.last().unwrap();
    let win_card = num(top.color, top.value);
    st(&mut r).hands[0].cards = vec![win_card];
    st(&mut r).hands[1].cards = vec![num(Color::Red, 5)];
    declare_last(&mut r, 0);
    r.play_card(0, win_card, win_card.color, -1, NOW)
        .expect("PlayCard");
    assert!(r.match_over, "expected MatchOver=true after BO1 win");
    assert!(
        r.begin_next_round(NOW).is_err(),
        "BeginNextRound after MatchOver should return error"
    );
}

#[test]
fn room_begin_next_round_rejects_in_lobby() {
    let mut r = new_room("BNRL");
    let _ = r.join("alice");
    let _ = r.join("bob");
    // Game not started; Status == StatusLobby.
    assert!(
        r.begin_next_round(NOW).is_err(),
        "BeginNextRound in lobby should return error"
    );
}

// --- RemoveLobbyPlayer re-indexing ---

#[test]
fn room_remove_lobby_player_reindexes_player_indices() {
    let mut r = new_room("RMVI");
    for n in ["alice", "bob", "carol"] {
        must_join(&mut r, n);
    }
    // Verify initial indices.
    for (i, p) in r.players.iter().enumerate() {
        assert_eq!(p.index, i as i32, "initial Players[{i}].Index");
    }

    // Remove the middle player (bob, index 1).
    let was_host = r.remove_lobby_player(1).expect("RemoveLobbyPlayer");
    assert!(!was_host, "removing index 1 should not report wasHost");
    assert_eq!(r.players.len(), 2, "Players after remove");
    assert!(
        r.players[0].nickname == "alice" && r.players[0].index == 0,
        "Players[0] = {:?}, want {{alice, 0}}",
        r.players[0]
    );
    assert!(
        r.players[1].nickname == "carol" && r.players[1].index == 1,
        "Players[1] = {:?}, want {{carol, 1}} after re-index",
        r.players[1]
    );
}

#[test]
fn room_remove_lobby_player_host_flag() {
    let mut r = new_room("RMVH");
    let _ = r.join("alice");
    let _ = r.join("bob");
    let was_host = r.remove_lobby_player(0).expect("RemoveLobbyPlayer");
    assert!(was_host, "removing index 0 should report wasHost=true");
    assert!(
        r.players[0].nickname == "bob" && r.players[0].index == 0,
        "after host removal, new host = {:?}, want {{bob, 0}}",
        r.players[0]
    );
}

#[test]
fn room_remove_lobby_player_rejected_after_start() {
    let mut r = new_room("RMVA");
    let _ = r.join("alice");
    let _ = r.join("bob");
    let _ = r.start(NOW);
    assert!(
        r.remove_lobby_player(0).is_err(),
        "RemoveLobbyPlayer after game start should return error"
    );
}

#[test]
fn room_remove_lobby_player_bounds_check() {
    let mut r = new_room("RMVB");
    let _ = r.join("alice");
    assert!(
        r.remove_lobby_player(-1).is_err(),
        "negative index should return error"
    );
    assert!(
        r.remove_lobby_player(99).is_err(),
        "out-of-range index should return error"
    );
}

// --- CatchUndeclared edge case (regression: catch attempt before someone played to 1 card) ---

#[test]
fn room_catch_undeclared_no_target_yet() {
    let mut r = setup_two_player_game();
    // Every seat starts with a full hand and a zero LastCardAt, so a catch
    // attempt at the start of the game must be rejected (target not at 1 card).
    assert!(
        r.catch_undeclared(1, 0, NOW).is_err(),
        "catch at game start should fail (no one played to 1 card yet)"
    );
}

// --- Receiving a single card owes the table a declaration (§11.1) ---

// Swap hands the target the actor's leftovers. If that is a single card the
// target must call LOCO! like anybody else: what the rule protects is the
// table's right to know somebody is one card from winning, and how the hand
// got there changes nothing.
#[test]
fn room_swap_receiver_owes_declaration() {
    let mut r = setup_three_player_game();
    st(&mut r).current_turn = 0;
    st(&mut r).direction = 1;
    st(&mut r).active_color = Color::Red;
    st(&mut r).discard = vec![num(Color::Red, 5)];

    let swap = act(Color::Red, Kind::Swap);
    // Alice: swap + one leftover. Bob: three cards. After the swap Alice holds
    // three and Bob holds the single leftover.
    st(&mut r).hands[0].cards = vec![swap, num(Color::Blue, 2)];
    st(&mut r).hands[1].cards = vec![
        num(Color::Green, 3),
        num(Color::Green, 4),
        num(Color::Green, 6),
    ];
    st(&mut r).hands[2].cards = vec![num(Color::Yellow, 7)];

    r.play_card(0, swap, Color::Red, 1, NOW)
        .expect("PlayCard swap");
    assert_eq!(
        st_ref(&r).hands[1].size(),
        1,
        "bob hand (received alice's leftover)"
    );
    r.catch_undeclared(2, 1, NOW)
        .expect("bob received a single card and never declared, so he must be catchable");
    assert_eq!(st_ref(&r).hands[1].size(), 3, "bob hand after penalty");
}

// Declaring closes the window for a receiver exactly as for a player who played
// down to one card.
#[test]
fn room_swap_receiver_can_declare() {
    let mut r = setup_three_player_game();
    st(&mut r).current_turn = 0;
    st(&mut r).active_color = Color::Red;
    st(&mut r).discard = vec![num(Color::Red, 5)];

    let swap = act(Color::Red, Kind::Swap);
    st(&mut r).hands[0].cards = vec![swap, num(Color::Blue, 2)];
    st(&mut r).hands[1].cards = vec![num(Color::Green, 3), num(Color::Green, 4)];
    st(&mut r).hands[2].cards = vec![num(Color::Yellow, 7)];

    r.play_card(0, swap, Color::Red, 1, NOW)
        .expect("PlayCard swap");
    r.declare_last_card(1, NOW)
        .expect("bob must be able to declare the card he received");
    assert!(
        r.catch_undeclared(2, 1, NOW).is_err(),
        "bob declared; catching him must fail"
    );
}

// A GlobalSwitch can put several seats on one card in the same instant, and each
// of them owes a declaration. A single tracked target would let all but one walk.
#[test]
fn room_global_switch_every_single_card_seat_is_catchable() {
    let mut r = setup_three_player_game();
    st(&mut r).current_turn = 0;
    st(&mut r).direction = 1;
    st(&mut r).active_color = Color::Red;
    st(&mut r).discard = vec![num(Color::Red, 5)];

    let gs = wild(Kind::GlobalSwitch);
    // After the play: seat 0 ← seat 2's hand (1 card), seat 1 ← alice's leftover
    // (1 card), seat 2 ← seat 1's hand (2 cards).
    st(&mut r).hands[0].cards = vec![gs, num(Color::Blue, 2)];
    st(&mut r).hands[1].cards = vec![num(Color::Green, 3), num(Color::Green, 4)];
    st(&mut r).hands[2].cards = vec![num(Color::Yellow, 7)];

    r.play_card(0, gs, Color::Green, -1, NOW)
        .expect("PlayCard global switch");
    let open = st_ref(&r).catchable_targets(NOW);
    assert!(
        open.len() == 2 && open[0] != open[1],
        "CatchableTargets = {open:?}, want the two seats left holding one card"
    );
    for seat in [0, 1] {
        assert_eq!(
            st_ref(&r).hands[seat].size(),
            1,
            "seat {seat}: fixture is wrong"
        );
    }
    // Both are catchable, independently.
    assert_eq!(
        r.catch_undeclared(2, 0, NOW),
        Ok(()),
        "seat 0 must be catchable"
    );
    assert_eq!(
        r.catch_undeclared(2, 1, NOW),
        Ok(()),
        "seat 1 must be catchable too, one slot cannot hold two debts"
    );
}

// Catching yourself would be a free pass: you would take a 2-card penalty at a
// moment of your choosing and close the window nobody else got to use.
#[test]
fn room_catch_undeclared_cannot_catch_yourself() {
    let mut r = setup_three_player_game();
    st(&mut r).active_color = Color::Red;
    st(&mut r).discard = vec![num(Color::Red, 5)];
    st(&mut r).hands[0].cards = vec![num(Color::Red, 2), num(Color::Red, 3)];
    r.play_card(0, num(Color::Red, 2), Color::Red, -1, NOW)
        .expect("PlayCard");
    assert!(
        r.catch_undeclared(0, 0, NOW).is_err(),
        "a player must not be able to catch themselves"
    );
}

// --- Additional Zwischenwerfen / out-of-turn play rule coverage ---

// An interjected Reverse flips the play direction, and the next-player
// resolution starts from the interjecter's seat under the new direction.
#[test]
fn room_interrupt_play_reverse_flips_direction() {
    let mut r = setup_three_player_game();
    st(&mut r).current_turn = 1; // bob's turn
    st(&mut r).direction = 1; // clockwise
    st(&mut r).active_color = Color::Red;
    st(&mut r).discard = vec![act(Color::Red, Kind::Reverse)];
    st(&mut r).pending_draw = 0;
    arm_interrupt(&mut r, 0);

    let carol_reverse = act(Color::Red, Kind::Reverse);
    prepend(&mut r, 2, carol_reverse);

    r.interrupt_play(2, carol_reverse, carol_reverse.color, -1, NOW)
        .expect("InterruptPlay Reverse");
    assert_eq!(
        st_ref(&r).direction,
        -1,
        "Direction after Reverse interject"
    );
    // New direction is CCW. Next player after carol(2) CCW is bob(1).
    assert_eq!(
        st_ref(&r).current_turn,
        1,
        "after Reverse interject, want 1 (bob via CCW)"
    );
}

// Direction must be respected: in counter-clockwise play, the player after the
// interjecter is computed by walking against the seat order.
#[test]
fn room_interrupt_play_counter_clockwise() {
    let mut r = setup_three_player_game();
    st(&mut r).current_turn = 0; // alice's turn
    st(&mut r).direction = -1; // counter-clockwise: 0 -> 2 -> 1 -> 0
    st(&mut r).active_color = Color::Red;
    st(&mut r).discard = vec![num(Color::Red, 4)];
    st(&mut r).pending_draw = 0;
    arm_interrupt(&mut r, 1); // bob just played

    let carol_card = num(Color::Red, 4);
    prepend(&mut r, 2, carol_card);

    r.interrupt_play(2, carol_card, carol_card.color, -1, NOW)
        .expect("InterruptPlay CCW");
    // CCW from carol(2): next is bob(1).
    assert_eq!(
        st_ref(&r).current_turn,
        1,
        "after CCW interject, want 1 (bob)"
    );
}

// When an interjecter goes from 2 -> 1 cards, the LOCO! catch window must open
// for them — the obligation to declare applies on out-of-turn plays too.
#[test]
fn room_interrupt_play_opens_catch_window() {
    let mut r = setup_three_player_game();
    st(&mut r).current_turn = 1;
    st(&mut r).direction = 1;
    st(&mut r).active_color = Color::Red;
    st(&mut r).discard = vec![num(Color::Red, 6)];
    st(&mut r).pending_draw = 0;
    arm_interrupt(&mut r, 0);
    st(&mut r).last_card_declared[2] = true; // simulate a previous declaration we expect to be cleared

    let m = num(Color::Red, 6);
    // carol holds exactly 2 cards; after the interject she will have 1.
    st(&mut r).hands[2].cards = vec![m, num(Color::Blue, 1)];

    let before = NOW;
    r.interrupt_play(2, m, m.color, -1, NOW)
        .expect("InterruptPlay");
    assert!(
        !st_ref(&r).last_card_declared[2],
        "LastCardDeclared[2] must be reset after a fresh play to 1 card"
    );
    let at = st_ref(&r).last_card_at[2]
        .expect("carol's catch window must be open after she interjects to 1 card");
    assert!(
        at >= before,
        "LastCardAt should be updated to the moment of the interject"
    );

    // And alice (idx 0) can catch carol if she didn't declare in time.
    assert_eq!(
        r.catch_undeclared(0, 2, NOW),
        Ok(()),
        "catch on undeclared interject must succeed"
    );
}

// --- Rematch -------------------------------------------------------------

#[test]
fn room_reset_for_rematch() {
    let mut r = finish_match(&["alice", "bob"]);
    r.format = MatchFormat::BO3;
    r.max_players = 4;
    let prev_players = r.players.clone();

    r.reset_for_rematch().expect("ResetForRematch");

    assert_eq!(r.status, Status::Lobby);
    assert!(
        r.state.is_none(),
        "State must be cleared so no stale hands leak into the new match"
    );
    assert!(
        !r.match_over && r.match_winner.is_empty() && !r.round_ended && r.winner.is_empty(),
        "match signals not cleared: over={} winner={:?} roundEnded={} roundWinner={:?}",
        r.match_over,
        r.match_winner,
        r.round_ended,
        r.winner
    );
    assert_eq!(r.round_number, 0, "Start sets it to 1");
    assert!(
        r.scores.is_empty() && r.rounds_won.is_empty() && r.lost_hand_total.is_empty(),
        "cumulative match tallies must be cleared"
    );
    assert!(
        r.round_history.is_empty(),
        "RoundHistory must be cleared, the new match starts at round 1"
    );
    // Roster and lobby config survive — the whole point is "same room, same people".
    assert_eq!(r.players.len(), prev_players.len());
    for (i, p) in r.players.iter().enumerate() {
        assert_eq!(*p, prev_players[i], "player {i} changed identity");
        assert_eq!(p.index, i as i32, "player {i} Index");
    }
    assert_eq!(r.format, MatchFormat::BO3, "preserved");
    assert_eq!(r.max_players, 4, "preserved");
}

#[test]
fn room_reset_for_rematch_then_start_again() {
    let mut r = finish_match(&["alice", "bob"]);
    r.reset_for_rematch().expect("ResetForRematch");
    r.start(NOW).expect("Start after rematch reset");
    assert_eq!(r.status, Status::Playing);
    assert_eq!(r.round_number, 1);
    for i in 0..r.players.len() {
        assert_eq!(
            st_ref(&r).hands[i].cards.len(),
            INITIAL_HAND_SIZE,
            "player {i} hand"
        );
    }
    assert!(
        r.scores[0] == 0 && r.scores[1] == 0,
        "scores not reset: {:?}",
        r.scores
    );
}

#[test]
fn room_reset_for_rematch_rejected_mid_match() {
    let mut r = new_room("TEST");
    let _ = r.join("alice");
    let _ = r.join("bob");
    assert!(
        r.reset_for_rematch().is_err(),
        "rematch from lobby must be rejected"
    );
    r.start(NOW).expect("Start");
    assert!(
        r.reset_for_rematch().is_err(),
        "rematch mid-match must be rejected"
    );
}

// A rematch must also be allowed after the lobby shrank — the new match is
// dealt for whoever is still in the room.
#[test]
fn room_reset_for_rematch_allows_roster_change_before_start() {
    let mut r = finish_match(&["alice", "bob", "carol"]);
    r.reset_for_rematch().expect("ResetForRematch");
    r.remove_lobby_player(1).expect("RemoveLobbyPlayer");
    r.start(NOW).expect("Start");
    assert_eq!(r.scores.len(), 2, "sized to the new roster");
}

// --- Failed catch penalty -------------------------------------------------

// A Contre-LOCO! that arrives after the target's declaration is a race lost on
// the wire, not a protocol violation: the domain must say so explicitly so the
// hub can charge the caller a card instead of treating them as a cheat.
#[test]
fn room_catch_undeclared_missed_by_declaration() {
    let mut r = setup_three_player_game();
    st(&mut r).active_color = Color::Red;
    st(&mut r).discard = vec![num(Color::Red, 5)];
    st(&mut r).hands[0].cards = vec![num(Color::Red, 2), num(Color::Red, 3)];
    r.play_card(0, num(Color::Red, 2), Color::Red, -1, NOW)
        .expect("PlayCard");
    r.declare_last_card(0, NOW).expect("DeclareLastCard");
    let err = r
        .catch_undeclared(1, 0, NOW)
        .expect_err("catching a declared player must fail");
    assert!(err.is_missed_catch(), "IsMissedCatch({err}) = false");
    assert_eq!(
        err.to_string(),
        "player already declared",
        "the unchanged wire string"
    );
}

// Same for a window that closed before the message landed.
#[test]
fn room_catch_undeclared_missed_by_expiry() {
    let mut r = setup_three_player_game();
    st(&mut r).active_color = Color::Red;
    st(&mut r).discard = vec![num(Color::Red, 5)];
    st(&mut r).hands[0].cards = vec![num(Color::Red, 2), num(Color::Red, 3)];
    r.play_card(0, num(Color::Red, 2), Color::Red, -1, NOW)
        .expect("PlayCard");
    let err = r
        .catch_undeclared(1, 0, NOW + CATCH_WINDOW_MS + 1000)
        .expect_err("catching after the window must fail");
    assert!(err.is_missed_catch(), "IsMissedCatch({err}) = false");
}

// A malformed target is a client bug or an attack, never a lost race — it must
// not be charged a card, and the hub still counts it as suspect.
#[test]
fn room_catch_undeclared_invalid_target_is_not_a_miss() {
    let mut r = setup_three_player_game();
    let err = r.catch_undeclared(1, 99, NOW);
    assert!(
        matches!(&err, Err(e) if !e.is_missed_catch()),
        "CatchUndeclared(1, 99) = {err:?}, want a non-miss error"
    );
    let err = r.catch_undeclared(0, 0, NOW);
    assert!(
        matches!(&err, Err(e) if !e.is_missed_catch()),
        "self-catch = {err:?}, want a non-miss error"
    );
}

// The wager: a miss costs the caller exactly one card, and nothing else about
// the round moves — not the turn, not the target's hand, not the draw flag.
#[test]
fn room_penalize_failed_catch() {
    let mut r = setup_three_player_game();
    near_seat(&mut r, 0);
    let before = st_ref(&r).hands[1].size();
    let (turn, has_drawn) = (st_ref(&r).current_turn, st_ref(&r).has_drawn);
    let target_before = st_ref(&r).hands[0].size();

    let (cards, charged) = r.penalize_failed_catch(1, NOW);
    assert!(
        charged,
        "the first failed catch on an offer must be charged"
    );
    assert_eq!(cards.len(), FAILED_CATCH_PENALTY, "cards drawn");
    assert_eq!(
        st_ref(&r).hands[1].size(),
        before + FAILED_CATCH_PENALTY,
        "catcher hand"
    );
    assert!(
        st_ref(&r).current_turn == turn && st_ref(&r).has_drawn == has_drawn,
        "a failed catch must not touch the turn state"
    );
    assert_eq!(
        st_ref(&r).hands[0].size(),
        target_before,
        "a failed catch must not touch the target's hand"
    );
}

// A penalty is a draw, and a draw never fails: with every card in a hand the
// caller simply gets away with it rather than the round freezing.
#[test]
fn room_penalize_failed_catch_empty_deck() {
    let mut r = setup_three_player_game();
    near_seat(&mut r, 0);
    st(&mut r).deck.cards.clear();
    st(&mut r).discard = vec![num(Color::Red, 5)];
    let before = st_ref(&r).hands[1].size();
    let (cards, charged) = r.penalize_failed_catch(1, NOW);
    assert_eq!(
        cards.len(),
        0,
        "PenalizeFailedCatch on an exhausted deck drew cards"
    );
    // Charged all the same: the wager was taken, the table simply had no card
    // left to take it with. Otherwise a dry deck would refund every press.
    assert!(
        charged,
        "a call against dry piles is still the seat's one charge for this offer"
    );
    assert_eq!(st_ref(&r).hands[1].size(), before, "catcher hand unchanged");
}

// The anti-spam rule, and the reason the button can afford to be live for most
// of an endgame: a seat pays for one misread per offer, not per press. Anything
// else would tax the reflex the whole mechanic is asking for.
#[test]
fn room_penalize_failed_catch_charges_once_per_offer() {
    let mut r = setup_three_player_game();
    near_seat(&mut r, 0);
    assert!(
        r.penalize_failed_catch(1, NOW).1,
        "the first press must be charged"
    );
    let before = st_ref(&r).hands[1].size();

    for i in 0..5 {
        let (cards, charged) = r.penalize_failed_catch(1, NOW);
        assert!(
            !charged && cards.is_empty(),
            "press {} on an unchanged offer charged again",
            i + 2
        );
    }
    assert_eq!(
        st_ref(&r).hands[1].size(),
        before,
        "spamming the button must cost nothing more"
    );
}

// A press against a table where nobody is near the finish is not a wager: no
// honest screen has the button live, so there is nothing to misread and
// nothing to charge. This is also what closes the farm to a client this game
// did not write — the price can only ever be paid where the offer is.
#[test]
fn room_penalize_failed_catch_nothing_offered_charges_nothing() {
    let mut r = setup_three_player_game();
    let before = st_ref(&r).hands[1].size();
    let (cards, charged) = r.penalize_failed_catch(1, NOW);
    assert!(
        !charged && cards.is_empty(),
        "eight-card hands all round: nothing was offered, so nothing may be charged"
    );
    // A seat on one card whose window shut long ago is the same table: the
    // button went dark when the window did.
    st(&mut r).hands[0] = Hand::of([num(Color::Red, 1)]);
    st(&mut r).last_card_at[0] = Some(NOW - 60_000);
    assert!(
        !r.penalize_failed_catch(1, NOW).1,
        "a seat stuck on one card past its window is not an offer"
    );
    // Three cards out is not one either — the client's threshold, pinned here.
    st(&mut r).hands[0] = Hand::of([num(Color::Red, 1), num(Color::Red, 2), num(Color::Red, 3)]);
    assert!(
        !r.penalize_failed_catch(1, NOW).1,
        "three cards out is one too many to be an offer"
    );
    assert_eq!(st_ref(&r).hands[1].size(), before, "catcher hand untouched");
}

// The other half of the ration, and the farm it closes: the catcher's own play
// is not a new offer. Charged per card played, a press before and a press
// after one's own play bought two cards a turn off a seat sitting on two —
// faster than the voluntary draw, and exactly the hand a Swap is fed with.
#[test]
fn room_penalize_failed_catch_own_play_is_not_a_new_offer() {
    let mut r = setup_three_player_game();
    near_seat(&mut r, 0);
    assert!(
        r.penalize_failed_catch(1, NOW).1,
        "the first press must be charged"
    );

    // The catcher plays a card, through the real path.
    let top = st_ref(&r).top_card();
    let card = Card::new(st_ref(&r).active_color, Kind::Number, top.value);
    st(&mut r).hands[1].add(&[card]);
    st(&mut r).current_turn = 1;
    r.play_card(1, card, Color::Red, -1, NOW).expect("PlayCard");

    assert!(
        !r.penalize_failed_catch(1, NOW).1,
        "the seat on two has not moved, so the second press is the same misread"
    );
}

// And what IS a new offer: the near seat playing down to its last card. The
// anticipation miss and the race miss are two reads of two boards.
#[test]
fn room_penalize_failed_catch_charges_again_on_a_new_offer() {
    let mut r = setup_three_player_game();
    st(&mut r).active_color = Color::Red;
    st(&mut r).discard = vec![num(Color::Red, 5)];
    near_seat(&mut r, 0);
    assert!(
        r.penalize_failed_catch(1, NOW).1,
        "the first press must be charged"
    );
    st(&mut r).current_turn = 0;
    r.play_card(0, num(Color::Red, 2), Color::Red, -1, NOW)
        .expect("PlayCard");
    assert!(
        r.penalize_failed_catch(1, NOW).1,
        "the seat is on its last card now: a new offer, a new wager, a new card"
    );
    // A second window on the same seat is a second offer too: the card it is
    // down to is not the card it was down to.
    st(&mut r).hands[0].add(&[num(Color::Red, 3)]);
    st(&mut r).hands[0].cards.remove(0);
    st(&mut r).open_catch_window(0, NOW);
    // Distinct from the first window whatever the clock's resolution.
    let at = st_ref(&r).last_card_at[0].unwrap();
    st(&mut r).last_card_at[0] = Some(at + 1);
    assert!(
        r.penalize_failed_catch(1, NOW + 1).1,
        "a reopened window is a fresh offer"
    );
}

// The server owns how long a catch window lasts, and now says so on the wire
// (protocol.CatchSeatDTO.EndsAt). The client no longer holds a copy of the
// duration, so this is the only place it is written down.
#[test]
fn game_state_catch_window_end() {
    let mut r = new_room("TEST");
    must_join(&mut r, "Alice");
    must_join(&mut r, "Bob");
    r.start(NOW).expect("start");
    st(&mut r).open_catch_window(1, NOW);
    let opened = st_ref(&r).last_card_at[1].unwrap();
    assert_eq!(
        st_ref(&r).catch_window_end(1),
        Some(opened + CATCH_WINDOW_MS),
        "CatchWindowEnd"
    );
    assert!(
        st_ref(&r).catch_window_open(1, opened + CATCH_WINDOW_MS - 1),
        "the window must still be open a millisecond before its end"
    );
}
