import { CardColor } from '../../types/protocol'
import { CARD_GLYPH, CARD_GLYPH_INK, SUIT_SHAPE } from './cardTheme'

/**
 * Drawn twice like every other glyph on a card: an ink pass under an off-white
 * fill. Off-white on the green suit is 1.18:1 on its own, and the mark has to
 * read on all four faces and through a stream re-encode.
 */
export function SuitMark({ color, className }: { color: CardColor; className?: string }) {
  if (color === 'wild') return null
  return (
    <svg
      className={className}
      viewBox="0 0 100 100"
      aria-hidden="true"
      focusable="false"
      data-suit-mark={color}
    >
      <path
        d={SUIT_SHAPE[color]}
        fill={CARD_GLYPH}
        stroke={CARD_GLYPH_INK}
        strokeWidth={14}
        strokeLinejoin="round"
        paintOrder="stroke"
      />
    </svg>
  )
}
