import { useId } from 'react'
import { SUIT_PAINT } from './cards/cardTheme'
import { LOCO_MARK_PATH, LOCO_MARK_VIEWBOX, LOCO_MARK_BOLD_STROKE } from './cards/locoMark'
import styles from './LocoLogo.module.css'

interface Props {
  /**
   * Type size the whole logo is built from, as a CSS length. The card, the gaps,
   * the ink stroke and the shadow are all `em` of it, so the logo scales as one
   * drawing rather than as a picture next to some text.
   */
  size?: string
  /** Stacks the card above the word — for narrow spaces. */
  stacked?: boolean
  /** Lobby hero only: the slow idle breathe. */
  animated?: boolean
  className?: string
}

/**
 * The LOCO logo: the duck mark, in all four suit colours at once, beside the
 * wordmark.
 *
 * The mark stands on its own here — it is a closed drawing, so it needs no
 * frame to explain its edges. (It used to be held inside a little card, which
 * existed only to make the previous mark's bleed read as a deliberate crop.)
 *
 * Same geometry as the card watermark, the deck back and the favicon: a player
 * sees this duck on the cards they hold, on the back of the deck and in the
 * browser tab.
 */
export function LocoLogo({ size, stacked = false, animated = false, className }: Props) {
  const id = useId().replace(/:/g, '')
  const classes = [
    styles.logo,
    stacked ? styles.stacked : '',
    animated ? styles.animated : '',
    className ?? '',
  ].filter(Boolean).join(' ')

  return (
    /*
     * One image, not a drawing next to a word. WCAG exempts a logotype from the
     * contrast rules, and the wordmark is one: LOCO Red carries an ink outline
     * that a checker reads as the foreground on a dark canvas (1.07:1) and reads
     * past on a light one, so the same drawing was failing an audit written for
     * prose. `role="img"` says what it actually is, and the label is the word
     * itself — which is also what a screen reader owed the mark beside it.
     */
    <div
      className={classes}
      style={size ? { fontSize: size } : undefined}
      role="img"
      aria-label="LOCO"
    >
      <svg
        className={styles.mark}
        viewBox={LOCO_MARK_VIEWBOX}
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
        {/* Two passes, widest first: the ink outline every raised object in this
            UI carries, then the mark over it. `paint-order` would do it in one
            path, but the outline has to be *outside* the shape only, and a
            centred stroke on an even-odd wireframe eats its own facets. */}
        <path
          d={LOCO_MARK_PATH}
          fillRule="evenodd"
          fill="var(--color-stroke)"
          stroke="var(--color-stroke)"
          strokeWidth={LOCO_MARK_BOLD_STROKE + 12}
          strokeLinejoin="round"
        />
        <path
          d={LOCO_MARK_PATH}
          fillRule="evenodd"
          fill={`url(#${id}-suits)`}
          stroke={`url(#${id}-suits)`}
          strokeWidth={LOCO_MARK_BOLD_STROKE}
          strokeLinejoin="round"
        />
      </svg>
      {/* The label above already says it; a second announcement would be the
          word twice. */}
      <span className={styles.word} aria-hidden="true">
        LOCO
      </span>
    </div>
  )
}
