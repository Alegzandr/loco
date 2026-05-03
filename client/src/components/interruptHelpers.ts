import type { CardDTO, CardColor } from '../types/protocol'

// Client-side hint: returns true if `card` is an exact-match interrupt candidate
// (color + kind + value all match the current top discard). Wilds/global_switch
// are excluded — they can never be used to take the lead. Server is authoritative.
export function clientMayInterrupt(card: CardDTO, discard: CardDTO | null, pendingDraw: number): boolean {
  if (!discard) return false
  if (card.kind === 'wild' || card.kind === 'wild_draw_four' || card.kind === 'global_switch') return false
  // During an active Take2 chain only an identical DrawTwo extends it.
  if (pendingDraw > 0 && card.kind !== 'draw_two') return false
  return card.color === discard.color && card.kind === discard.kind && card.value === discard.value
}

// Client-side card legality hint — prevents animating clearly-invalid plays before
// the server rejects them. Server validation is always authoritative.
export function clientMayPlay(
  card: CardDTO,
  discard: CardDTO | null,
  activeColor: CardColor,
  pendingDraw: number,
): boolean {
  if (pendingDraw > 0) {
    if (!discard) return false
    return card.kind === discard.kind && (card.kind === 'draw_two' || card.kind === 'wild_draw_four')
  }
  if (card.kind === 'wild' || card.kind === 'wild_draw_four' || card.kind === 'global_switch') return true
  if (!discard) return true
  if (card.color === activeColor) return true
  if (card.kind !== 'number' && card.kind === discard.kind) return true
  if (card.kind === 'number' && discard.kind === 'number') return card.value === discard.value
  return false
}
