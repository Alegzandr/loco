import type { CardDTO, CardColor } from '../types/protocol'

// Client-side hint: returns true if `card` is an exact-match interrupt candidate
// (color + kind + value all match the current top discard). Every kind qualifies,
// wilds included — they all carry the 'wild' colour, so the same equality test
// keeps a wild off a wild_draw_four. Server is authoritative.
//
// `windowOpen` is the server's word on whether the pile can still be slammed at
// all: a draw or a pass by the seat at turn shuts it, and the card on top says
// nothing about that. Offered without it, the twin stayed tappable after
// somebody had drawn and the press came back "somebody was faster" on a table
// where nobody had been. It defaults to open for the callers that only ask
// about the cards.
export function clientMayInterrupt(
  card: CardDTO,
  discard: CardDTO | null,
  pendingDraw: number,
  windowOpen = true,
): boolean {
  if (!discard || !windowOpen) return false
  // During an active draw chain only an identical draw card extends it.
  if (pendingDraw > 0 && card.kind !== 'draw_two' && card.kind !== 'wild_draw_four') return false
  return card.color === discard.color && card.kind === discard.kind && card.value === discard.value
}

// True when this tap answers a pending +2/+4 stack rather than being an ordinary
// play. The counter is the *same card*: same kind **and** same colour (every +4
// is wild-coloured, so a +4 chain satisfies the colour test by construction).
// The kinds never cross — a +4 does not answer a +2.
//
// A differently-coloured +2 is not a dead card: the forced draw does not cost the
// turn, so its holder takes the stack and can then play it as an ordinary
// kind-match on the same discard.
//
// Such a tap must go out as `counter_draw`, never `play_card` — `Room.PlayCard`
// refuses every card while `PendingDraw > 0`, so routing it as a play makes the
// whole stacking mechanic unreachable for a human ("must counter or draw pending
// penalty cards first" on a card the rules allow).
export function isCounterCard(card: CardDTO, discard: CardDTO | null, pendingDraw: number): boolean {
  if (pendingDraw <= 0 || !discard) return false
  if (card.kind !== 'draw_two' && card.kind !== 'wild_draw_four') return false
  return card.kind === discard.kind && card.color === discard.color
}

// Client-side card legality hint — prevents animating clearly-invalid plays before
// the server rejects them. Server validation is always authoritative.
export function clientMayPlay(
  card: CardDTO,
  discard: CardDTO | null,
  activeColor: CardColor,
  pendingDraw: number,
): boolean {
  if (pendingDraw > 0) return isCounterCard(card, discard, pendingDraw)
  if (card.kind === 'wild' || card.kind === 'wild_draw_four' || card.kind === 'global_switch') return true
  if (!discard) return true
  if (card.color === activeColor) return true
  if (card.kind !== 'number' && card.kind === discard.kind) return true
  if (card.kind === 'number' && discard.kind === 'number') return card.value === discard.value
  return false
}
