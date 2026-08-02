// Everything that is painted *inside* a card face.
//
// Face, watermark and wild fan all live in the same 1000x1500 space, so they
// scale as one object and stay in register whatever size the card is drawn at —
// hand, discard, a flier mid-flight or a 12px mini fan. That space and the card
// are both 2:3, so expressing it as percentages of the card box reproduces it
// exactly, rotations included.
//
// It used to be one SVG per card, and that was the board's single biggest
// rendering cost: fifty live copies of the mark's geometry, most of them under a
// scale animation and so re-filled every frame. The gradients are CSS now and
// the mark is a shared mask image; see MARK_MASK_URL in cardArtSpace.ts for the
// measurement and for why it must stay one.
// React 19 no longer declares JSX as a global namespace; it is exported from
// 'react' instead, so the glyph tables below name it explicitly.
import type { CSSProperties, JSX } from 'react'
import { CardDTO, CardColor } from '../../types/protocol'
import { SUIT_PAINT, SUIT_ANGLE_DEG, CARD_GLYPH, CARD_GLYPH_INK } from './cardTheme'
import {
  CARD_ART_W as W,
  CARD_ART_H as H,
  MARK_MASK_URL,
} from './cardArtSpace'
import styles from './CardArt.module.css'

/** The four suits shown on a wild, left to right, as the reference fans them. */
const FAN: { color: Exclude<CardColor, 'wild'>; cx: number; rot: number }[] = [
  { color: 'red', cx: 250, rot: -9 },
  { color: 'yellow', cx: 415, rot: -3 },
  { color: 'blue', cx: 585, rot: 3 },
  { color: 'green', cx: 750, rot: 9 },
]
const FAN_CY = 789
const FAN_W = 164
const FAN_H = 336
// The stroke around each mini card lives in CardArt.module.css (`.fanFace`'s
// inset). The reference strokes these hairline-thin, which is a choice made at
// 890px: at 72px a mini card is 12px wide and a scaled-down hairline disappears,
// so it is held at a width that still draws a line there — the fan is the whole
// meaning of a wild and it has to survive the hand, not just the mockup.

interface Props {
  card: CardDTO
  className?: string
}

/**
 * The four-suit fan is what "choose a colour" looks like — players read the
 * shape, not a letter — so it belongs to exactly the two cards that ask for one.
 * A GlobalSwitch is wild-coloured but chooses nothing; it keeps the bare black
 * face and its own glyph.
 */
function showsFan(card: CardDTO): boolean {
  return card.kind === 'wild' || card.kind === 'wild_draw_four'
}

/** The suit's face gradient, on the card's own axis. */
function faceGradient(color: CardColor): string {
  const p = SUIT_PAINT[color]
  return `linear-gradient(${SUIT_ANGLE_DEG}deg, ${p.from}, ${p.to})`
}

/** The same gradient run backwards: what the watermark is painted in. */
function markGradient(color: CardColor): string {
  const p = SUIT_PAINT[color]
  return `linear-gradient(${SUIT_ANGLE_DEG}deg, ${p.mark[0]}, ${p.mark[1]})`
}

/**
 * A mini card on the wild's fan: corner to corner, like the reference.
 *
 * `to top right`, and not the angle of the box's diagonal: they are different
 * gradients on anything that is not square, and this one is 164x336. The
 * reference was an SVG `objectBoundingBox` gradient, whose colour bands stay
 * parallel to the *other* diagonal because the unit square is stretched onto
 * the box after the gradient is laid out. CSS's corner keyword does exactly
 * that; an explicit angle keeps its bands perpendicular to itself instead, and
 * swaps the two off-diagonal corners. Caught by eye on `make visual`, which is
 * the only thing that was ever going to catch it.
 */
function fanGradient(color: Exclude<CardColor, 'wild'>): string {
  const p = SUIT_PAINT[color]
  return `linear-gradient(to top right, ${p.from}, ${p.to})`
}

const pct = (n: number, total: number) => `${(n / total) * 100}%`

export function CardArt({ card, className }: Props) {
  const isWild = showsFan(card)
  const face = faceGradient(card.color)

  return (
    <div
      className={`${styles.art} ${className ?? ''}`}
      style={{
        ['--face' as string]: face,
        ['--mark' as string]: markGradient(card.color),
        ['--mark-mask' as string]: MARK_MASK_URL,
      } as CSSProperties}
      aria-hidden="true"
    >
      <div className={styles.mark} />

      {isWild && FAN.map((f) => (
        <div
          key={f.color}
          className={styles.fanCard}
          style={{
            left: pct(f.cx - FAN_W / 2, W),
            top: pct(FAN_CY - FAN_H / 2, H),
            width: pct(FAN_W, W),
            height: pct(FAN_H, H),
            transform: `rotate(${f.rot}deg)`,
            ['--fan' as string]: fanGradient(f.color),
          } as CSSProperties}
        >
          <div className={styles.fanFace}>
            <div className={styles.fanMark} />
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Action glyphs ──────────────────────────────────────────────────────────
// The drawings behind `hasGlyph` (cardTheme.ts), which is where the list of
// kinds that get one lives.
const GLYPH_STROKE = 11

const glyphs: Partial<Record<CardDTO['kind'], JSX.Element>> = {
  skip: (
    <>
      <circle cx="50" cy="50" r="33" />
      <path d="M27 73 L73 27" />
    </>
  ),
  reverse: (
    <>
      <path d="M72 36 H30" />
      <path d="M42 25 L29 36 L42 47" />
      <path d="M28 64 H70" />
      <path d="M58 53 L71 64 L58 75" />
    </>
  ),
  // Crossing arrows, not the two arcs an exchange usually gets: two rule cards
  // that both say "something moves around" must not share a silhouette, and
  // this one is the trade between exactly two seats.
  swap: (
    <>
      <path d="M22 30 L78 70" />
      <path d="M78 70 L62 70 M78 70 L78 55" />
      <path d="M78 30 L22 70" />
      <path d="M22 70 L38 70 M22 70 L22 55" />
    </>
  ),
}

// GlobalSwitch: three hands laid out in a ring, each one moving to the next
// seat. It replaces a single circular arrow, which is the "refresh" pictogram
// and therefore says that *something* turns without ever saying that the cards
// do — players read it as "redraw your hand". Drawing the cards themselves is
// the rule, and three of them can never be mistaken for Swap's two.
//
// The cards are outlines; the movement between them is a curved shaft and a
// solid head. Both halves are load-bearing — a bare arrowhead has no heading at
// this size (it reads as a wedge pointing at whatever is nearest), and the
// curve is the only thing that says the three of them go *round*.
//
// Deliberately stroked thinner than the other glyphs: three outlined rects at
// GLYPH_STROKE close up into three solid bars. That means the ink pass needs
// its own copy, exactly like the wild fan — a child `stroke-width` beats
// whatever the pass sets on its group.
const RING_R = 31
const HAND_W = 20
const HAND_H = 27
const HAND_SEATS = [0, 120, 240]
const ARROW_SEATS = [60, 180, 300]
// One arrow, drawn on the ring at 12 o'clock heading clockwise, then rotated
// into each gap. It spans −20°…+26° of the ring, so it is rotated 3° short of
// the gap's own angle to sit centred between the two cards it connects.
// Both paths are solved for RING_R — moving the ring means re-solving them.
const ARROW_LEAD = -3
const ARROW_SHAFT = 'M39.40 20.87 A31 31 0 0 1 53.24 19.17'
const ARROW_HEAD = 'M63.59 22.14 L52.77 23.65 L53.71 14.69 Z'

const rotatingHands = (inked: boolean) => (
  <>
    {HAND_SEATS.map((a) => (
      <rect
        key={`hand${a}`}
        x={50 - HAND_W / 2}
        y={50 - RING_R - HAND_H / 2}
        width={HAND_W}
        height={HAND_H}
        rx={4.5}
        transform={`rotate(${a} 50 50)`}
        strokeWidth={inked ? 14 : 7}
      />
    ))}
    {ARROW_SEATS.map((a) => (
      <g key={`arrow${a}`} transform={`rotate(${a + ARROW_LEAD} 50 50)`}>
        <path d={ARROW_SHAFT} strokeWidth={inked ? 13 : 6} />
        <path
          d={ARROW_HEAD}
          fill={inked ? CARD_GLYPH_INK : CARD_GLYPH}
          strokeWidth={inked ? 9 : 3}
        />
      </g>
    ))}
  </>
)

// The colour-change card is named by its four suits, never by a letter — that
// is how players actually read it, and a "W" is also a word in one language.
// Same fan as the face, small enough for a corner.
// `inked` draws the same fan in the outline pass: a child `stroke` attribute
// beats anything the pass sets on its group, so the suit colours have to be
// left off rather than overridden.
const wildFanGlyph = (inked: boolean) => (
  <>
    {FAN.map((f, i) => (
      <rect
        key={f.color}
        x={-13} y={-22} width={26} height={44} rx={5}
        transform={`translate(${18 + i * 21.5} 50) rotate(${f.rot})`}
        stroke={inked ? undefined : SUIT_PAINT[f.color].from}
        strokeWidth={inked ? undefined : 9}
      />
    ))}
  </>
)

// Glyphs that carry their own stroke widths, and so have to be drawn twice from
// scratch instead of letting the ink pass re-render the same element wider.
const twoPassGlyphs: Partial<Record<CardDTO['kind'], (inked: boolean) => JSX.Element>> = {
  wild: wildFanGlyph,
  global_switch: rotatingHands,
}

export function CardGlyph({ kind }: { kind: CardDTO['kind'] }) {
  const twoPass = twoPassGlyphs[kind]
  const g = twoPass ? twoPass(false) : glyphs[kind]
  const inkPass = twoPass ? twoPass(true) : g
  if (!g) return null
  // Deliberately unsized: the parent (.value / .corner) owns how big a glyph is,
  // the same way it owns how big a numeral is.
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      {/* Drawn twice: an ink pass, then the glyph over it. Same reason the
          numerals carry a text-stroke — a light glyph on the green or yellow
          suit is otherwise about 1.2:1. A stroked icon has no fill to outline,
          so the outline has to be a wider copy underneath. */}
      <g
        fill="none"
        stroke={CARD_GLYPH_INK}
        strokeWidth={GLYPH_STROKE + 9}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {inkPass}
      </g>
      <g
        fill="none"
        stroke={CARD_GLYPH}
        strokeWidth={GLYPH_STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {g}
      </g>
    </svg>
  )
}
