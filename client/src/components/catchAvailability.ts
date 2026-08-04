import type { PlayerDTO } from '../types/protocol'

/**
 * The biggest hand that still makes the centre button worth pressing.
 *
 * A seat on three cards can be on one by the time your thumb lands: two of them
 * can leave in a single interrupt, and the window that follows is five seconds
 * of somebody else's attention. So the button goes live here rather than at the
 * moment the server names a target — the player who was already aiming is the
 * one the mechanic is for, and a control that only lights up once the window is
 * open is a control you can only ever answer, never anticipate.
 *
 * What buys that is the risk: a press that finds nobody on the hook costs a
 * card. The server charges it at most once per card played, so reading the
 * table wrong is a mistake and spamming the button is not a second one.
 */
export const CATCH_LIVE_MAX_HAND = 3

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
 * costs a card. Two or three cards is a different question — an interrupt can
 * put that seat on one card before a thumb lands, which is exactly the
 * anticipation this button is live for, so a declaration there voids nothing.
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
