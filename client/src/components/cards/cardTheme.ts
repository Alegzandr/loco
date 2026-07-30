// Card colour palette and shared dimensions for the React rendering layer.
import { CardColor, CardDTO } from '../../types/protocol'

// Suit colours. Saturated enough to survive stream compression at 720p, and
// far enough apart in hue *and* luminance that they stay distinguishable for
// the most common colour-vision deficiencies (red/green sit at clearly
// different lightness, and every card also carries its glyph).
export const CARD_FACE: Record<CardColor, string> = {
  red: '#eb2f45',
  yellow: '#ffc31f',
  green: '#17b877',
  blue: '#2b7fff',
  wild: '#2a1a52',
}

// Top-of-card sheen — a lighter tint of the face.
export const CARD_FACE_LIGHT: Record<CardColor, string> = {
  red: '#ff6d7d',
  yellow: '#ffe06b',
  green: '#4ee0a6',
  blue: '#74b0ff',
  wild: '#6b4bb8',
}

// Ink used for the numeral inside the white oval — a deepened face colour so
// the glyph reads as "the same colour, darker" rather than a second hue.
export const CARD_INK: Record<CardColor, string> = {
  red: '#b3132a',
  yellow: '#b8790a',
  green: '#0a7d50',
  blue: '#1250b8',
  wild: '#2a1a52',
}

export const ACTIVE_RING: Record<CardColor, string> = {
  red: '#ff5570',
  yellow: '#ffd23d',
  green: '#2fdc98',
  blue: '#4d96ff',
  wild: '#9b7bff',
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

// Opponent pill dimensions. Mirrored in PlayerSlot.module.css and consumed by
// the seat layout, so they live here rather than in either of those files.
export const PILL_W = 172
export const PILL_H = 66
export const PILL_W_COMPACT = 124
export const PILL_H_COMPACT = 56
// Mini seats drop the card fan entirely — name and count only. Reserved for a
// crowded table on a phone, where a fan would be 4px of unreadable mush anyway.
export const PILL_W_MINI = 82
export const PILL_H_MINI = 46

export type SeatSize = 'full' | 'compact' | 'mini'

export const SEAT_DIMS: Record<SeatSize, { w: number; h: number }> = {
  full: { w: PILL_W, h: PILL_H },
  compact: { w: PILL_W_COMPACT, h: PILL_H_COMPACT },
  mini: { w: PILL_W_MINI, h: PILL_H_MINI },
}

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
