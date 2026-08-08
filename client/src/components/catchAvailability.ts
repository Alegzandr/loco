import type { PlayerDTO } from '../types/protocol'

/**
 * The biggest hand that still makes the centre button worth pressing: one card
 * away from owing the call.
 *
 * The button goes live before the server names anybody, because a control that
 * only lights up once the window is open is one you can answer and never
 * anticipate, and five seconds is not long enough to find a button in. But the
 * anticipation has to be aimed at something that can actually happen on the
 * next card. A seat on two is one ordinary play from a window; a seat on three
 * needs an interrupt of two identical cards, which is rare enough that the
 * button would be live through a long stretch of the round where pressing it
 * can only miss.
 *
 * That stretch is what the threshold is really about, because the miss costs a
 * card and a card is not always a punishment: a player holding a Swap or a
 * Global Switch is about to hand their hand to somebody else, so a penalty they
 * chose to take is ammunition. A missed Contre-LOCO! has to stay something that
 * happens *to* a player — the thumb already committed, the seat drawing instead
 * of playing, the window that never opened — rather than something worth
 * deciding to do. Offering the wager only while it is one card from paying off
 * is what keeps it a spasm and not a plan.
 */
export const CATCH_LIVE_MAX_HAND = 2

/**
 * Whether Contre-LOCO! is pressable right now: some *other* seat is holding
 * between one and CATCH_LIVE_MAX_HAND cards.
 *
 * Our own seat never counts — there is nobody to catch there. Nor does an empty
 * hand: a seat on zero cards has either won the round or been retired out of it,
 * and neither owes the table a call.
 *
 * Nothing else narrows it, and **a declaration the table has heard narrows it
 * least of all**. What this button says is that a seat is near the finish, never
 * that somebody is catchable — and the difference is the whole mechanic. A
 * control that went dead the moment the last opponent called LOCO! would be
 * announcing that call to a player who was not listening for it, which is the
 * one thing they were supposed to have to do; and it would refuse the press this
 * price exists to charge for, the thumb already on its way down when the seat
 * shouted. That miss is the spasm the wager is made of. Take away the ability to
 * make it and the wager stops being one.
 *
 * So the button owes the player exactly one guarantee, and it is the threshold
 * above: the wager is never offered further than one ordinary play from paying
 * off. Whether it pays *this* time is theirs to read.
 *
 * This is the raw read of the roster and it is never what the bar shows on its
 * own — `nextCatchLive` below is, and it is the one the store keeps.
 */
export function isCatchLive(players: PlayerDTO[], myIndex: number): boolean {
  return players.some(
    (p) => p.index !== myIndex && p.hand_size >= 1 && p.hand_size <= CATCH_LIVE_MAX_HAND,
  )
}

/**
 * The value the button's liveness takes after a write: once live, it stays live
 * until the board moves.
 *
 * `isCatchLive` alone is a photograph of the roster, and a roster can slip out
 * of reach without anybody playing anything. A seat on its last card eats a
 * stack of four and is suddenly holding five; a Contre-LOCO! lands on it and it
 * is holding three. Read as a photograph, the button goes dead in that instant —
 * under a thumb that was already on its way down, and that thumb is the whole
 * mechanic. **A control that retracts itself is a control that decides the
 * wager for the player**, and it decides it in their favour, which is the same
 * bait as announcing a call: whoever was about to commit is quietly saved, and
 * the one thing this game asks them to do is read the table themselves.
 *
 * So liveness never falls between two cards. It rises on the roster and it is
 * put back down by the board moving on, and by nothing else.
 *
 * That is also the bound, and it is the reason this is a latch rather than a
 * permanent unlock: the next card played re-reads the roster from scratch. The
 * offer is never carried further than the board it was made on, so it cannot be
 * held open and farmed a card at a time by a player collecting penalties for a
 * Swap to hand off. One board, one read, one wager.
 */
export function nextCatchLive(
  wasLive: boolean,
  players: PlayerDTO[],
  myIndex: number,
): boolean {
  return wasLive || isCatchLive(players, myIndex)
}
