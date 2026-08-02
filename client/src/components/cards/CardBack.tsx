import { CSSProperties, Ref } from 'react'
import { SUIT_PAINT } from './cardTheme'
import { MARK_MASK_BOLD_URL } from './cardArtSpace'
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
  /** React 19 ref-as-prop; see the same note on Card. */
  ref?: Ref<HTMLDivElement>
}

/** Below this width the mark is a smudge, so a back is painted flat instead. */
const ART_MIN_W = 26

// CardBack renders the deck-back visual: the wild card's near-black face, the
// same LOCO mark watermarked into it, and the mark again across the middle in
// all four suit colours at once — the one place the full palette appears, which
// is what makes a face-down card unmistakable in a blurred mini-fan.
export function CardBack({
  width = 72,
  height = 108,
  radius = 5,
  opacity = 1,
  className,
  style,
  ref,
}: Props) {
  const showArt = width >= ART_MIN_W

  return (
    <div
      ref={ref}
      className={`${styles.back} ${className ?? ''}`}
      style={{ width, height, borderRadius: radius, opacity, ...style }}
    >
      {/* The back is a card, so it gets the card framing — the same cropped,
          tilted mark every face carries — and nothing else. Painting the whole
          mark on top of it as well showed the duck twice at two different
          angles, which reads as a rendering bug.

          What makes it a *back* rather than a face is the paint: all four suit
          colours at once, the one place the full palette appears, which is what
          makes a face-down card unmistakable in a blurred mini fan. */}
      {showArt && (
        <div
          className={styles.art}
          aria-hidden="true"
          style={{
            ['--suit-green' as string]: SUIT_PAINT.green.from,
            ['--suit-blue' as string]: SUIT_PAINT.blue.from,
            ['--suit-red' as string]: SUIT_PAINT.red.from,
            ['--suit-yellow' as string]: SUIT_PAINT.yellow.from,
            ['--mark-mask' as string]: MARK_MASK_BOLD_URL,
          } as CSSProperties}
        />
      )}
    </div>
  )
}
