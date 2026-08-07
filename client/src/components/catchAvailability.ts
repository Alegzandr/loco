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
 */
export function isCatchLive(players: PlayerDTO[], myIndex: number): boolean {
  return players.some(
    (p) => p.index !== myIndex && p.hand_size >= 1 && p.hand_size <= CATCH_LIVE_MAX_HAND,
  )
}
