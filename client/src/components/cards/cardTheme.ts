// Card colour palette and shared dimensions for the React rendering layer.
import { CardColor, CardDTO } from '../../types/protocol'

// ─── Suits ──────────────────────────────────────────────────────────────────
// Every face is one two-stop gradient running along the card's bottom-left →
// top-right diagonal, and the LOCO mark behind it is *the same gradient
// reversed*. That single trick is what makes the art read: the watermark is
// brighter than the face where the face is dark and darker where it is light,
// so the mark never needs an outline, a tint or an opacity to stay legible.
//
// Values measured off the reference art rather than eyeballed, so the four
// suits keep the hue *and* luminance separation they were designed with — red
// and green sit at clearly different lightness, and every card also carries its
// glyph, which is what carries colour-vision deficiency and 720p compression.
export interface SuitPaint {
  /** Bottom-left stop. */
  from: string
  /** Top-right stop. */
  to: string
  /** Mark stops; the coloured suits simply reverse the face. */
  mark: [string, string]
}

export const SUIT_PAINT: Record<CardColor, SuitPaint> = {
  yellow: { from: '#ffbd00', to: '#ff4852', mark: ['#ff4852', '#ffbd00'] },
  red: { from: '#ff002a', to: '#8f0098', mark: ['#8f0098', '#ff002a'] },
  green: { from: '#00ff6d', to: '#00668e', mark: ['#00668e', '#00ff6d'] },
  blue: { from: '#15d4ff', to: '#5918a7', mark: ['#5918a7', '#15d4ff'] },
  // Wilds belong to no suit, so they get the near-black card the reference uses
  // — the four-colour fan on the face is the whole statement, and it only lands
  // against something neutral. Its face barely moves, so the mark cannot be the
  // reversed face here; it is a fixed lift instead.
  wild: { from: '#1c1c1c', to: '#141414', mark: ['#282828', '#242424'] },
}

/** The gradient's own axis, in degrees, as CSS measures it. */
export const SUIT_ANGLE_DEG = 35

// Off-white for every glyph on a card face. Pure white vibrates against the
// saturated faces and clips first under stream compression.
export const CARD_GLYPH = '#efefef'

// …and the ink it is outlined in. Off-white on a suit face measures 1.18:1 on
// green and 1.46:1 on yellow — unreadable, and no single ink colour fixes it
// either (dark ink is 1.66:1 on blue). The outline is what makes it legible on
// every face: glyph-against-ink is ~15:1 and ink-against-any-face is ~14:1, so
// the value reads at 720p, in a stream re-encode, and for a low-vision player.
// The card's own face is deliberately NOT darkened to achieve this — the suit
// colours are the brand.
export const CARD_GLYPH_INK = '#120b24'

// Active-colour ring on the discard pile. The saturated end of each suit — the
// ring is a signal, not a swatch, and it has to win against the felt.
export const ACTIVE_RING: Record<CardColor, string> = {
  red: '#ff002a',
  yellow: '#ffbd00',
  green: '#00ff6d',
  blue: '#15d4ff',
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

// ─── Rarity & the throw ─────────────────────────────────────────────────────
// Presentation only. `game/` never consults any of this: it is how a card
// *lands*, not what it does. The tiers follow scarcity in the deck so the escalation
// matches how often a player actually sees each one: a number is two thirds of every
// hand, and dressing up the routine play would leave nothing to escalate to when a
// wild drops, which is the entire reason the tiers exist.
export type CardRarity = 'common' | 'rare' | 'legendary'

const WILD_KINDS: ReadonlySet<CardDTO['kind']> = new Set([
  'wild', 'wild_draw_four', 'global_switch',
])

/** common = number (72 cards), rare = coloured action (28), legendary = any wild (12). */
export function cardRarity(card: CardDTO): CardRarity {
  if (WILD_KINDS.has(card.kind)) return 'legendary'
  return card.kind === 'number' ? 'common' : 'rare'
}

/** How a card of this rarity crosses the table, and what it does on impact. */
export interface Flight {
  /** ms of travel. */
  duration: number
  /** Whole turns of barrel roll. A half turn would land the card face down. */
  spin: number
  /** Mid-flight scale: the card passes nearer the camera. */
  swell: number
  /** Peak lift of the arc, in px. */
  arcHeight: number
  /** Diameter of the shockwave ring on landing; 0 = no ring. */
  impact: number
  /** Legendary only: the board takes a knock when it lands. */
  kick: boolean
}

const FLIGHTS: Record<CardRarity, Flight> = {
  common:    { duration: 300, spin: 0, swell: 1.06, arcHeight: 22, impact: 0,   kick: false },
  rare:      { duration: 380, spin: 1, swell: 1.16, arcHeight: 30, impact: 170, kick: false },
  legendary: { duration: 470, spin: 2, swell: 1.26, arcHeight: 40, impact: 260, kick: true },
}

// The single source of flight timing. All four callers (hand to pile, seat to
// pile, the generic pile refresh and DiscardPile's reveal delay) read it here,
// because they must agree: a pile that reveals early shows the answer while its
// own card is still crossing the table.
export function flightFor(card: CardDTO): Flight {
  return FLIGHTS[cardRarity(card)]
}

// Layout math works in radians; framer-motion's `rotate` is in degrees.
// Convert at the render boundary so neither side has to compromise.
export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI
}

export const CARD_W = 72
export const CARD_H = 108
// The reference art rounds its corners at ~3.4% of the card width. Held to the
// letter that is 2.4px here, which antialiases into a ragged corner rather than
// reading as a rounded one; 5px is the same design at the size we actually
// render, and still far from the pill the old face used.
export const CARD_RADIUS = 5
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

// Kinds drawn as an icon rather than typeset. ⊘ ⇄ ⇋ ↻ are the obvious
// characters and the wrong tool: Fredoka carries none of them, so the font
// fallback chain would decide what a rule card looks like. Lives here rather
// than beside the drawings so CardArt.tsx exports components only.
const GLYPH_KINDS: ReadonlySet<CardDTO['kind']> = new Set([
  'skip', 'reverse', 'swap', 'global_switch', 'wild',
])

/** True when the kind is drawn as an icon instead of typeset as text. */
export function hasGlyph(kind: CardDTO['kind']): boolean {
  return GLYPH_KINDS.has(kind)
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
