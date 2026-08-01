import { CSSProperties, forwardRef, KeyboardEvent, MouseEvent } from 'react'
import { CardDTO } from '../../types/protocol'
import { cardLabel, hasGlyph } from './cardTheme'
import { CardArt, CardGlyph } from './CardArt'
import { SuitMark } from './suitMark'
import { useColorAssist } from '../../hooks/useColorAssist'
import styles from './Card.module.css'

interface Props {
  card: CardDTO
  /** Visually marks the card as legal-to-play (bright rim + lift glow). */
  playable?: boolean
  /** Adds the drop-shadow used for in-hand cards. */
  shadow?: boolean
  /** Click/tap handler. Triggers cursor + keyboard binding. */
  onClick?: (e: MouseEvent<HTMLDivElement>) => void
  className?: string
  style?: CSSProperties
}

/**
 * A single card face: full-bleed suit gradient, the LOCO mark behind it in the
 * same gradient reversed, one large glyph, and the two corner marks.
 *
 * The corners follow the reference art exactly — brand monogram top-left, value
 * bottom-left-up (rotated 180°) — which is also the one thing here that costs
 * something: in a tightly overlapped fan the visible sliver of each card is its
 * top-left corner, so a crowded hand is read from the big glyph and the suit
 * colour rather than from the corners.
 *
 * Stateless and unanimated. Wrap in a <motion.div> at the call site for
 * movement or hover effects.
 */
export const Card = forwardRef<HTMLDivElement, Props>(function Card(
  { card, playable = false, shadow = false, onClick, className, style },
  ref,
) {
  const label = cardLabel(card)
  // Subscribes every card on screen, which costs one re-render on the rare
  // frame the preference is flipped and nothing at all otherwise.
  const assist = useColorAssist()
  const icon = hasGlyph(card.kind)
  const isWild = card.color === 'wild'
  // The colour-change card already *is* the four-suit fan at full size; a second
  // copy of it over the middle would only repeat itself.
  const bare = card.kind === 'wild'
  // A wild carries the four-suit fan across its middle, so its value sits below
  // it. Everything else centres on the card.
  const layout = isWild && !icon ? styles.underFan : styles.centred
  const size = icon ? styles.iconSize : label.length === 1 ? styles.oneChar : styles.manyChars

  const handleKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!onClick) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onClick(e as unknown as MouseEvent<HTMLDivElement>)
    }
  }

  const classes = [
    styles.card,
    shadow ? styles.shadow : '',
    playable ? styles.playable : '',
    onClick ? styles.interactive : '',
    className ?? '',
  ].filter(Boolean).join(' ')

  return (
    <div
      ref={ref}
      className={classes}
      style={style}
      onClick={onClick}
      onKeyDown={handleKey}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={`${card.color} ${card.kind}${card.value !== undefined ? ` ${card.value}` : ''}`}
      data-card-color={card.color}
      data-card-kind={card.kind}
      data-card-value={card.value ?? ''}
    >
      <CardArt card={card} className={styles.art} />
      {!bare && (
        <div className={`${styles.value} ${layout} ${size}`}>
          {icon ? <CardGlyph kind={card.kind} /> : label}
        </div>
      )}
      {/* Value top-left, monogram bottom-right — the reference's two marks, in
          the reference's two corners, the other way round. The reference is a
          hero shot of one card; in a hand the fan can overlap down to the left
          ~30% of each card, and branding that sliver leaves a player holding
          twelve cards that all say "L". The wild already reads this way in the
          reference, so this is also the rule that makes every card consistent. */}
      <div
        className={[
          styles.corner, styles.cornerTL,
          icon || label.length > 1 ? styles.cornerSmall : '',
        ].filter(Boolean).join(' ')}
      >
        {icon ? <CardGlyph kind={card.kind} /> : label}
      </div>
      {/* Under the value, where a printed card puts its suit: in a fan the
          cards overlap down to their top-left corner, so this is the only
          place a mark is still visible in a full hand. */}
      {assist && card.color !== 'wild' && (
        <SuitMark color={card.color} className={styles.suitMark} />
      )}
      <div className={`${styles.corner} ${styles.cornerBR}`}>L</div>
    </div>
  )
})
