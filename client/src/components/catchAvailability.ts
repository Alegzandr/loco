import type { PlayerDTO } from '../types/protocol'

/**
 * The biggest hand that still makes the centre button worth pressing: one card
 * away from owing the call.
 *
 * The button goes live before the server names anybody, because a control that
 * only lights up once the window is open is one you can answer and never
 * anticipate, and five seconds is not long enough to find a button in. But the
 * anticipation has to be aimed at something that can actually happen on the
 * next card. A seat on two is one ordinary play from a window; nothing takes a
 * seat from three cards to one in a single action, so arming the button there
 * would keep it live through a long stretch of the round where pressing it can
 * only miss. (One thing used to: an interject of two identical cards. An
 * interject is one card now, so the threshold is exact.)
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
 * How long past the end of a seat's window the button stays live: the stretch
 * in which a Contre-LOCO! is a call that came *too late* rather than a call on
 * a seat that was never on the hook.
 *
 * The wager has two ways to lose and the interface only ever offered one of
 * them. Pressing too early — the seat had not spoken yet and never would, or
 * somebody beat you to it — costs a card, and always did. Pressing too late
 * cost nothing, because the button went dark on the frame the offer vanished:
 * the window ran out, or the seat's hand grew out of reach (it drew, it
 * swallowed a stack of four, a catch landed on it), and the control greyed out
 * from under a thumb that was already on its way down. That is the interface
 * making the read on the player's behalf and making it in their favour, which
 * is the same failure as announcing a call: a button that cannot be got wrong
 * is not measuring anything.
 *
 * So the offer outlives the picture that made it. One second: long enough to be
 * a beat you can miss by, short enough that it is still the same gesture and not
 * a second chance.
 *
 * **It is deliberately shorter than the server's own `catchGrace` (2s), and the
 * difference is the wire.** The server charges any call that arrives inside two
 * seconds of a window; the button offers one for one. A press made on the last
 * frame it is live therefore has a whole second to cross the network and still
 * be charged — which is the point, because a press the player made and the
 * server dropped in silence is the same failure as a button that greys out
 * under their thumb: they were allowed to be late, and nothing happened. Longer
 * than `catchGrace` would be the other failure, a live button over a wager the
 * server answers with nothing. `serverMirrors.test.ts` pins the inequality.
 */
export const CATCH_LATE_GRACE_MS = 1000

/**
 * When each seat's current last card stops being catchable: seat → the end of
 * the window the server named for it (`catch_seats`, on `card_played` and on
 * every snapshot). It is kept past the declaration the table hears, past the
 * window's own retirement from `catchWindows`, and past the hand growing back
 * out of reach, because the button below reads *time* and never *who spoke* or
 * *what they are holding now*: a window is offered for exactly as long as it
 * runs, plus CATCH_LATE_GRACE_MS, whatever happened inside it.
 */
export type OnHookUntil = Record<number, number>

/**
 * Whether Contre-LOCO! is pressable right now: some *other* seat has a window
 * still inside its late grace, or is holding exactly CATCH_LIVE_MAX_HAND cards,
 * which is one ordinary play from opening one.
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
 * Nor does the hand growing out of reach. A seat on its last card can leave
 * the near-finish picture without a card being played — it draws, it swallows
 * a stack of four, a Contre-LOCO! lands on it — and the button used to grey out
 * on that frame, which spared the player the late half of their own wager. The
 * offer is the window, so it runs its course whatever the hand does inside it,
 * and the server charges for that press too (`catchOffered`, whose own window is wider still by a
 * round trip).
 *
 * What it is still not is a latch. The window ends, grace and all, and the
 * button goes dark on the clock rather than waiting for the next card: held
 * past that, the offer could be farmed a card at a time — press, watch the seat
 * draw, press again after somebody plays — which is exactly the hand a Swap is
 * fed with.
 *
 * Time-dependent, so the store re-reads it at `catchLiveUntil` below.
 */
export function isCatchLive(
  players: PlayerDTO[],
  myIndex: number,
  onHookUntil: OnHookUntil,
  lockedUntil: number,
  now: number,
): boolean {
  if (isCatchLocked(lockedUntil, now)) return false
  return players.some((p) => offeredBy(p, myIndex, onHookUntil, now))
}

/**
 * Whether our own last Contre-LOCO! has put us out of the mechanic for a
 * moment: the server's lockout, as an absolute instant it sent us
 * (`catch_locked` / `catch_locked_until`, moved onto our clock like every other
 * deadline).
 *
 * It is the half of the price a held thumb pays. The card is rationed per
 * *offer*, so after the first one every later press against the same
 * near-finish picture was silent and free — and the one that landed on the
 * frame a window opened took the catch, because a catch that lands spends no
 * offer. Mashing cost one card and collected every window at the table. The
 * lockout is rationed per *press* instead: every call that finds nobody arms
 * it, every press made while it runs re-arms it, so a button held down is never
 * live at the instant a window opens, and a single aimed press pays it once and
 * has the rest of the window back.
 *
 * Nothing is mirrored here on purpose — no duration, no constant. The server
 * says when it ends and the button counts that down, so the two cannot drift
 * and a re-arm is one message rather than a guess.
 */
export function isCatchLocked(lockedUntil: number, now: number): boolean {
  return lockedUntil > now
}

/**
 * The last instant a press aimed at this seat's window is still a wager: the
 * end the server named, plus the late grace. `undefined` when the seat never
 * had a window this round.
 */
export function offerEnd(seat: number, onHookUntil: OnHookUntil): number | undefined {
  const end = onHookUntil[seat]
  return end === undefined ? undefined : end + CATCH_LATE_GRACE_MS
}

/**
 * The instant the button will go dead on its own if nothing else moves — the
 * last window still standing, plus its late grace — or null when it is either
 * dead already or held live by a seat on two cards, which only a card can move.
 * The store arms one timer on it and asks again (`rereadCatchLive`), so the
 * button goes dark the moment the server stops charging rather than on the next
 * message, and never at the moment the capsule finishes draining: the bar is
 * the window, and the wager outlives it.
 */
export function catchLiveUntil(
  players: PlayerDTO[],
  myIndex: number,
  onHookUntil: OnHookUntil,
  lockedUntil: number,
  now: number,
): number | null {
  // Locked out: the answer changes when the lock does, whatever the table is
  // holding. It is the *earliest* of the two — a lock that outlives every
  // window leaves a dead button that re-reads once and stays dead, which is
  // the right answer arrived at the right instant.
  if (isCatchLocked(lockedUntil, now)) return lockedUntil
  let until: number | null = null
  for (const p of players) {
    if (p.index === myIndex) continue
    // A seat one play from a window is an offer no clock ends: only a card can
    // move it, and a card is a message.
    if (p.hand_size === CATCH_LIVE_MAX_HAND) return null
    const end = offerEnd(p.index, onHookUntil)
    if (end === undefined || end <= now) continue
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
  const end = offerEnd(p.index, onHookUntil)
  if (end !== undefined && end > now) return true
  return p.hand_size === CATCH_LIVE_MAX_HAND
}
