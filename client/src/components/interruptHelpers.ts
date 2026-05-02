import type { CardDTO } from '../types/protocol'

// Client-side hint: returns true if `card` is an exact-match interrupt candidate
// (color + kind + value all match the current top discard). Wilds/global_switch
// are excluded — they can never be used to take the lead. Server is authoritative.
export function clientMayInterrupt(card: CardDTO, discard: CardDTO | null, pendingDraw: number): boolean {
  if (!discard) return false
  if (pendingDraw > 0) return false
  if (card.kind === 'wild' || card.kind === 'wild_draw_four' || card.kind === 'global_switch') return false
  return card.color === discard.color && card.kind === discard.kind && card.value === discard.value
}
