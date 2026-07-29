// Card colour palette and shared dimensions for the React rendering layer.
import { CardColor, CardDTO } from '../../types/protocol'

export const CARD_FACE: Record<CardColor, string> = {
  red: '#d63031',
  yellow: '#fdcb6e',
  green: '#00b894',
  blue: '#0984e3',
  wild: '#2d3436',
}

export const CARD_FACE_LIGHT: Record<CardColor, string> = {
  red: '#ff7675',
  yellow: '#ffeaa7',
  green: '#55efc4',
  blue: '#74b9ff',
  wild: '#636e72',
}

export const ACTIVE_RING: Record<CardColor, string> = {
  red: '#ff6b6b',
  yellow: '#ffd93d',
  green: '#6bcb77',
  blue: '#4d96ff',
  wild: '#aaaaaa',
}

// ─── Motion ─────────────────────────────────────────────────────────────────
// One easing curve and one spring shared by every card movement, so a card
// travelling from hand to discard and the neighbours closing the gap behind it
// decelerate on the same curve.
export const EASE_OUT_CARD = [0.16, 1, 0.3, 1] as const

// Reflow of the hand fan: stiff enough to feel immediate, damped enough not to
// wobble. `mass` is kept low so many cards settling at once stay crisp.
export const SPRING_HAND = { type: 'spring', stiffness: 520, damping: 38, mass: 0.7 } as const

// Per-card delay when a fresh hand is dealt, in ms.
export const DEAL_STAGGER_MS = 45

// Layout math works in radians; framer-motion's `rotate` is in degrees.
// Convert at the render boundary so neither side has to compromise.
export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI
}

export const CARD_W = 72
export const CARD_H = 108
export const CARD_RADIUS = 10
// Reserved for the action bar so cards never overlap it.
export const BOTTOM_RESERVE = 82

export function cardLabel(card: CardDTO): string {
  switch (card.kind) {
    case 'number': return String(card.value ?? 0)
    case 'skip': return '⊘'
    case 'reverse': return '⇄'
    case 'draw_two': return '+2'
    case 'wild': return 'W'
    case 'wild_draw_four': return '+4'
    case 'swap': return '⇋'
    case 'global_switch': return '↻'
    default: return '?'
  }
}

// Stable key for diffing/animation lists.
export function cardKey(card: CardDTO, suffix?: string | number): string {
  const base = `${card.color}-${card.kind}-${card.value ?? ''}`
  return suffix === undefined ? base : `${base}-${suffix}`
}
