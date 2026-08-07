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
 * between one and CATCH_LIVE_MAX_HAND cards, and is not a seat we have heard
 * call it on the single card it is holding.
 *
 * Our own seat never counts — there is nobody to catch there. Nor does an empty
 * hand: a seat on zero cards has either won the round or been retired out of it,
 * and neither owes the table a call.
 *
 * A seat on **one** card that has already declared is the one case where the
 * wager stops being a read: it cannot be caught until its hand changes, and the
 * whole table heard the call, so a press against it can only be a slip that
 * costs a card. A seat on two is a different question — its next play puts it
 * on one card and it will owe the table a fresh call when it gets there, which
 * is exactly the anticipation this button is live for, so a declaration there
 * voids nothing.
 *
 * `declaredSeats` is what the table *heard*, never an inference from a missing
 * catch window: a reloaded tab is told no windows at all, and greying the
 * button out on that silence would cost a reaction the player was entitled to.
 */
export function isCatchLive(
  players: PlayerDTO[],
  myIndex: number,
  declaredSeats: readonly number[],
): boolean {
  return players.some(
    (p) =>
      p.index !== myIndex &&
      p.hand_size >= 1 &&
      p.hand_size <= CATCH_LIVE_MAX_HAND &&
      !(p.hand_size === 1 && declaredSeats.includes(p.index)),
  )
}
