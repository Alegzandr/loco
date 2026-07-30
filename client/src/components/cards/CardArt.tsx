// Everything that is painted *inside* a card face, in one SVG per card.
//
// Face, watermark, wild fan and action glyphs all live in the same 1000x1500
// user space, so they scale as one object and stay in register whatever size
// the card is drawn at — hand, discard, a flier mid-flight or a 12px mini fan.
// Two separate layers (a CSS gradient for the face, an SVG for the mark) drift
// apart the moment the element's aspect ratio is not the reference's.
import { useId } from 'react'
import { CardDTO, CardColor } from '../../types/protocol'
import { SUIT_PAINT, CARD_GLYPH, CARD_GLYPH_INK } from './cardTheme'
import { LOCO_MARK_PATH } from './locoMark'
import {
  CARD_ART_W as W,
  CARD_ART_H as H,
  CARD_ART_VIEWBOX,
  CARD_AXIS as AXIS,
  MARK_AXIS,
  MARK_CROP_TRANSFORM,
} from './cardArtSpace'

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
// The reference strokes these hairline-thin, which is a choice made at 890px.
// At 72px a mini card is 12px wide and a scaled-down hairline disappears, so the
// stroke is held at a width that still draws a line there — the fan is the whole
// meaning of a wild and it has to survive the hand, not just the mockup.
const FAN_STROKE = 18

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

export function CardArt({ card, className }: Props) {
  const paint = SUIT_PAINT[card.color]
  const isWild = showsFan(card)
  // Per instance, not per suit: several cards of the same suit are on screen at
  // once, and duplicate ids make `url(#…)` resolve to whichever copy happens to
  // be first in the document — which changes as cards mount and unmount.
  const id = useId().replace(/:/g, '')

  return (
    <svg
      className={className}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={`${id}-face`} gradientUnits="userSpaceOnUse" {...AXIS}>
          <stop offset="0" stopColor={paint.from} />
          <stop offset="1" stopColor={paint.to} />
        </linearGradient>
        <linearGradient id={`${id}-mark`} gradientUnits="userSpaceOnUse" {...MARK_AXIS}>
          <stop offset="0" stopColor={paint.mark[0]} />
          <stop offset="1" stopColor={paint.mark[1]} />
        </linearGradient>
        {isWild && FAN.map((f) => (
          <linearGradient
            key={f.color}
            id={`${id}-fan-${f.color}`}
            gradientUnits="objectBoundingBox"
            x1="0" y1="1" x2="1" y2="0"
          >
            <stop offset="0" stopColor={SUIT_PAINT[f.color].from} />
            <stop offset="1" stopColor={SUIT_PAINT[f.color].to} />
          </linearGradient>
        ))}
        {isWild && FAN.map((f) => (
          <clipPath key={f.color} id={`${id}-clip-${f.color}`}>
            <rect width={FAN_W} height={FAN_H} rx={FAN_W * 0.09} />
          </clipPath>
        ))}
      </defs>

      <rect width={W} height={H} fill={`url(#${id}-face)`} />
      <g transform={MARK_CROP_TRANSFORM}>
        <path d={LOCO_MARK_PATH} fillRule="evenodd" fill={`url(#${id}-mark)`} />
      </g>

      {isWild && FAN.map((f) => (
        <g
          key={f.color}
          transform={`translate(${f.cx} ${FAN_CY}) rotate(${f.rot}) translate(${-FAN_W / 2} ${-FAN_H / 2})`}
        >
          <g clipPath={`url(#${id}-clip-${f.color})`}>
            <svg
              width={FAN_W}
              height={FAN_H}
              viewBox={CARD_ART_VIEWBOX}
              preserveAspectRatio="none"
            >
              <g transform={MARK_CROP_TRANSFORM}>
                <path
                  d={LOCO_MARK_PATH}
                  fillRule="evenodd"
                  fill={`url(#${id}-fan-${f.color})`}
                  opacity="0.9"
                />
              </g>
            </svg>
          </g>
          <rect
            width={FAN_W}
            height={FAN_H}
            rx={FAN_W * 0.09}
            fill="none"
            stroke={`url(#${id}-fan-${f.color})`}
            strokeWidth={FAN_STROKE}
          />
        </g>
      ))}
    </svg>
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
  // Crossing arrows, not the two arcs an exchange usually gets: a ring of arrows
  // is what GlobalSwitch means on this deck, and two rule cards that both say
  // "something moves around" must not share a silhouette.
  swap: (
    <>
      <path d="M22 30 L78 70" />
      <path d="M78 70 L62 70 M78 70 L78 55" />
      <path d="M78 30 L22 70" />
      <path d="M22 70 L38 70 M22 70 L22 55" />
    </>
  ),
  global_switch: (
    <>
      <path d="M50 17 A33 33 0 1 1 21 36" />
      <path d="M36 12 L50 17 L37 27" />
    </>
  ),
}

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

export function CardGlyph({ kind }: { kind: CardDTO['kind'] }) {
  const isWildFan = kind === 'wild'
  const g = isWildFan ? wildFanGlyph(false) : glyphs[kind]
  const inkPass = isWildFan ? wildFanGlyph(true) : g
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
