// `import type`, unlike most of this codebase: the glyph tables below are data
// rather than markup, so this module is a plain .ts and the bundler resolves its
// imports for real. `protocol.ts` is generated and exports types only.
import type { CardDTO, CardColor } from '../../types/protocol'

/**
 * The geometry behind the card face's action glyphs and the wild's four-suit
 * fan, as data.
 *
 * It was JSX before, which meant the drawing and the markup that renders it were
 * the same file and neither could be read without the other. Splitting it out is
 * what lets `CardArt.svelte` and `CardGlyph.svelte` share the fan's positions
 * without one importing the other, and it keeps `cardArtSpace.ts`'s rule intact:
 * the shapes are described once, never per instance.
 */

/** The four suits shown on a wild, left to right, as the reference fans them. */
export const FAN: { color: Exclude<CardColor, 'wild'>; cx: number; rot: number }[] = [
  { color: 'red', cx: 250, rot: -9 },
  { color: 'yellow', cx: 415, rot: -3 },
  { color: 'blue', cx: 585, rot: 3 },
  { color: 'green', cx: 750, rot: 9 },
]
export const FAN_CY = 789
export const FAN_W = 164
export const FAN_H = 336
// The stroke around each mini card lives in CardArt.svelte's <style> (`.fanFace`'s
// inset). The reference strokes these hairline-thin, which is a choice made at
// 890px: at 72px a mini card is 12px wide and a scaled-down hairline disappears,
// so it is held at a width that still draws a line there — the fan is the whole
// meaning of a wild and it has to survive the hand, not just the mockup.

export const GLYPH_STROKE = 11

/** One drawn element of a glyph. `d` is a path; the rest describe a rect. */
export type GlyphShape =
  | { kind: 'path'; d: string; strokeWidth?: number; inkStrokeWidth?: number; fill?: 'glyph' | 'ink' }
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | {
      kind: 'rect'
      x: number
      y: number
      width: number
      height: number
      rx: number
      transform?: string
      stroke?: string
      strokeWidth?: number
      inkStrokeWidth?: number
    }
  | { kind: 'group'; transform: string; children: GlyphShape[] }

const simple: Partial<Record<CardDTO['kind'], GlyphShape[]>> = {
  skip: [
    { kind: 'circle', cx: 50, cy: 50, r: 33 },
    { kind: 'path', d: 'M27 73 L73 27' },
  ],
  reverse: [
    { kind: 'path', d: 'M72 36 H30' },
    { kind: 'path', d: 'M42 25 L29 36 L42 47' },
    { kind: 'path', d: 'M28 64 H70' },
    { kind: 'path', d: 'M58 53 L71 64 L58 75' },
  ],
  // Crossing arrows, not the two arcs an exchange usually gets: two rule cards
  // that both say "something moves around" must not share a silhouette, and this
  // one is the trade between exactly two seats.
  swap: [
    { kind: 'path', d: 'M22 30 L78 70' },
    { kind: 'path', d: 'M78 70 L62 70 M78 70 L78 55' },
    { kind: 'path', d: 'M78 30 L22 70' },
    { kind: 'path', d: 'M22 70 L38 70 M22 70 L22 55' },
  ],
}

// GlobalSwitch: three hands laid out in a ring, each one moving to the next seat.
// It replaces a single circular arrow, which is the "refresh" pictogram and
// therefore says that *something* turns without ever saying that the cards do —
// players read it as "redraw your hand". Drawing the cards themselves is the
// rule, and three of them can never be mistaken for Swap's two.
//
// The cards are outlines; the movement between them is a curved shaft and a solid
// head. Both halves are load-bearing — a bare arrowhead has no heading at this
// size (it reads as a wedge pointing at whatever is nearest), and the curve is the
// only thing that says the three of them go *round*.
//
// Deliberately stroked thinner than the other glyphs: three outlined rects at
// GLYPH_STROKE close up into three solid bars. That means the ink pass needs its
// own copy, exactly like the wild fan — a child `stroke-width` beats whatever the
// pass sets on its group.
const RING_R = 31
const HAND_W = 20
const HAND_H = 27
const HAND_SEATS = [0, 120, 240]
const ARROW_SEATS = [60, 180, 300]
// One arrow, drawn on the ring at 12 o'clock heading clockwise, then rotated into
// each gap. It spans −20°…+26° of the ring, so it is rotated 3° short of the
// gap's own angle to sit centred between the two cards it connects. Both paths
// are solved for RING_R — moving the ring means re-solving them.
const ARROW_LEAD = -3
const ARROW_SHAFT = 'M39.40 20.87 A31 31 0 0 1 53.24 19.17'
const ARROW_HEAD = 'M63.59 22.14 L52.77 23.65 L53.71 14.69 Z'

const rotatingHands: GlyphShape[] = [
  ...HAND_SEATS.map(
    (a): GlyphShape => ({
      kind: 'rect',
      x: 50 - HAND_W / 2,
      y: 50 - RING_R - HAND_H / 2,
      width: HAND_W,
      height: HAND_H,
      rx: 4.5,
      transform: `rotate(${a} 50 50)`,
      strokeWidth: 7,
      inkStrokeWidth: 14,
    }),
  ),
  ...ARROW_SEATS.map(
    (a): GlyphShape => ({
      kind: 'group',
      transform: `rotate(${a + ARROW_LEAD} 50 50)`,
      children: [
        { kind: 'path', d: ARROW_SHAFT, strokeWidth: 6, inkStrokeWidth: 13 },
        { kind: 'path', d: ARROW_HEAD, fill: 'glyph', strokeWidth: 3, inkStrokeWidth: 9 },
      ],
    }),
  ),
]

// The colour-change card is named by its four suits, never by a letter — that is
// how players actually read it, and a "W" is also a word in one language. Same
// fan as the face, small enough for a corner. In the ink pass the suit colours
// have to be left off rather than overridden: a child `stroke` attribute beats
// anything the pass sets on its group.
const wildFanGlyph: GlyphShape[] = FAN.map((f, i) => ({
  kind: 'rect',
  x: -13,
  y: -22,
  width: 26,
  height: 44,
  rx: 5,
  transform: `translate(${18 + i * 21.5} 50) rotate(${f.rot})`,
  stroke: 'suit',
  strokeWidth: 9,
}))

const twoPass: Partial<Record<CardDTO['kind'], GlyphShape[]>> = {
  wild: wildFanGlyph,
  global_switch: rotatingHands,
}

export function glyphShapes(kind: CardDTO['kind']): GlyphShape[] | null {
  return twoPass[kind] ?? simple[kind] ?? null
}

/** Suit stroke colours for the wild fan's rects, in FAN order. */
export const FAN_STROKES = FAN.map((f) => f.color)
