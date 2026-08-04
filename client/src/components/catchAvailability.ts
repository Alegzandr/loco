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
 * between one and CATCH_LIVE_MAX_HAND cards.
 *
 * Our own seat never counts — there is nobody to catch there. Nor does an empty
 * hand: a seat on zero cards has either won the round or been retired out of it,
 * and neither owes the table a call.
 */
export function isCatchLive(players: PlayerDTO[], myIndex: number): boolean {
  return players.some(
    (p) => p.index !== myIndex && p.hand_size >= 1 && p.hand_size <= CATCH_LIVE_MAX_HAND,
  )
}
