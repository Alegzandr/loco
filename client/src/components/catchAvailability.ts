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
 *
 * Mirrored by the server's `catchNearHand`, which refuses to charge a press
 * against a table where nothing is offered — so this is the shape of the
 * offer, not a client-side courtesy.
 */
export const CATCH_LIVE_MAX_HAND = 2

/**
 * When each seat's current last card stops being catchable: seat → the end of
 * the window the server named for it (`catch_seats`, on `card_played` and on
 * every snapshot). It is kept past the declaration the table hears and past
 * the window's own retirement from `catchWindows`, because the button below
 * reads *time* and never *who spoke*: a seat on its last card is offered for
 * exactly as long as its window runs, whatever it said in the meantime.
 */
export type OnHookUntil = Record<number, number>

/**
 * Whether Contre-LOCO! is pressable right now: some *other* seat is holding
 * exactly CATCH_LIVE_MAX_HAND cards, or its last card inside the window that
 * opened on it.
 *
 * Our own seat never counts — there is nobody to catch there. Nor does an empty
 * hand: a seat on zero cards has either won the round or been retired out of it,
 * and neither owes the table a call. Nor, any more, does a seat that has been
 * sitting on one card for longer than a window: nothing about it can be caught,
 * so a button live over it was a wager that could only ever lose — and a loss
 * a player can schedule is a card drawn on purpose, which is what the price
 * exists to prevent. The server says the same thing (`CatchOffered`), so a
 * press that lands there is answered by nobody and charged to nobody.
 *
 * What still does NOT narrow it is **a declaration the table has heard**. What
 * this button says is that a seat is near the finish, never that somebody is
 * catchable — and the difference is the whole mechanic. A control that went
 * dead the moment the last opponent called LOCO! would be announcing that call
 * to a player who was not listening for it, which is the one thing they were
 * supposed to have to do; and it would refuse the press this price exists to
 * charge for, the thumb already on its way down when the seat shouted. That
 * miss is the spasm the wager is made of. So a declared seat stays live for
 * the rest of its window, and goes dark when the window does — a clock that
 * runs the same whether the seat spoke or not, and so reports nothing.
 *
 * There is no latch either, any more: a seat that draws, swallows a stack of
 * four or takes two penalty cards takes the button down with it. Held past
 * that, the offer could be farmed a card at a time — press, watch the seat
 * draw, press again after somebody plays — which is exactly the hand a Swap
 * is fed with. The thumb that was already committed when the seat drew is
 * answered on the server by silence, never by a card.
 *
 * Time-dependent, so the store re-reads it at `catchLiveUntil` below.
 */
export function isCatchLive(
  players: PlayerDTO[],
  myIndex: number,
  onHookUntil: OnHookUntil,
  now: number,
): boolean {
  return players.some((p) => offeredBy(p, myIndex, onHookUntil, now))
}

/**
 * The instant the button will go dead on its own if nothing else moves, or
 * null when it is either dead already or held live by a seat on two cards,
 * which only a card can move. The store arms one timer on it and asks again
 * (`rereadCatchLive`), so the button goes dark the moment the last window
 * runs out rather than on the next message.
 */
export function catchLiveUntil(
  players: PlayerDTO[],
  myIndex: number,
  onHookUntil: OnHookUntil,
  now: number,
): number | null {
  let until: number | null = null
  for (const p of players) {
    if (!offeredBy(p, myIndex, onHookUntil, now)) continue
    if (p.hand_size !== 1) return null
    const end = onHookUntil[p.index]
    if (until === null || end > until) until = end
  }
  return until
}

function offeredBy(
  p: PlayerDTO,
  myIndex: number,
  onHookUntil: OnHookUntil,
  now: number,
): boolean {
  if (p.index === myIndex) return false
  if (p.hand_size === CATCH_LIVE_MAX_HAND) return true
  if (p.hand_size !== 1) return false
  const end = onHookUntil[p.index]
  return end !== undefined && end > now
}
