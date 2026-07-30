import { CSSProperties, forwardRef, useId } from 'react'
import { SUIT_PAINT } from './cardTheme'
import { CARD_ART_VIEWBOX, MARK_CROP_TRANSFORM } from './cardArtSpace'
import { LOCO_MARK_PATH, LOCO_MARK_BOLD_STROKE } from './locoMark'
import styles from './CardBack.module.css'

interface Props {
  /** Card width in px. Default 72 (full size). */
  width?: number
  /** Card height in px. Default 108 (full size). */
  height?: number
  /** Border radius in px. Default 5, matching the face. */
  radius?: number
  /** 0..1; the deck stack and mini fans fade the cards behind the top one. */
  opacity?: number
  className?: string
  style?: CSSProperties
}

/** Below this width the mark is a smudge, so a back is painted flat instead. */
const ART_MIN_W = 26

// CardBack renders the deck-back visual: the wild card's near-black face, the
// same LOCO mark watermarked into it, and the mark again across the middle in
// all four suit colours at once — the one place the full palette appears, which
// is what makes a face-down card unmistakable in a blurred mini-fan.
export const CardBack = forwardRef<HTMLDivElement, Props>(function CardBack(
  { width = 72, height = 108, radius = 5, opacity = 1, className, style },
  ref,
) {
  const id = useId().replace(/:/g, '')
  const showArt = width >= ART_MIN_W

  return (
    <div
      ref={ref}
      className={`${styles.back} ${className ?? ''}`}
      style={{ width, height, borderRadius: radius, opacity, ...style }}
    >
      {showArt && (
        <svg
          className={styles.art}
          viewBox={CARD_ART_VIEWBOX}
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          <defs>
            <linearGradient id={`${id}-suits`} gradientUnits="objectBoundingBox" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0" stopColor={SUIT_PAINT.green.from} />
              <stop offset="0.34" stopColor={SUIT_PAINT.blue.from} />
              <stop offset="0.67" stopColor={SUIT_PAINT.red.from} />
              <stop offset="1" stopColor={SUIT_PAINT.yellow.from} />
            </linearGradient>
          </defs>
          {/* The back is a card, so it gets the card framing — the same cropped,
              tilted mark every face carries — and nothing else. Painting the
              whole mark on top of it as well showed the duck twice at two
              different angles, which reads as a rendering bug.

              What makes it a *back* rather than a face is the paint: all four
              suit colours at once, the one place the full palette appears, which
              is what makes a face-down card unmistakable in a blurred mini fan.
              Stroked to the logo weight, because a back is drawn at 26px in an
              opponent's fan far more often than at full size and the bare bars
              close up long before the silhouette does. */}
          <g transform={MARK_CROP_TRANSFORM}>
            <path
              d={LOCO_MARK_PATH}
              fillRule="evenodd"
              fill={`url(#${id}-suits)`}
              stroke={`url(#${id}-suits)`}
              strokeWidth={LOCO_MARK_BOLD_STROKE}
              strokeLinejoin="round"
            />
          </g>
        </svg>
      )}
    </div>
  )
})
