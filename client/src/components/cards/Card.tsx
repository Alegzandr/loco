import { CSSProperties, forwardRef, KeyboardEvent, MouseEvent } from 'react'
import { CardDTO } from '../../types/protocol'
import { CARD_FACE, CARD_FACE_LIGHT, CARD_INK, cardLabel } from './cardTheme'
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
 * A single card face: white frame, ink outline, tilted white oval, big numeral.
 * The shape is deliberately close to a physical playing card — a spectator
 * recognises what was played from a stream thumbnail, without reading text.
 *
 * Stateless and unanimated. Wrap in a <motion.div> at the call site for
 * movement or hover effects.
 */
export const Card = forwardRef<HTMLDivElement, Props>(function Card(
  { card, playable = false, shadow = false, onClick, className, style },
  ref,
) {
  const label = cardLabel(card)
  const isNumeric = label.length === 1 && /\d/.test(label)
  const isWild = card.color === 'wild'
  const labelClass = isNumeric ? styles.numeric : label.length <= 2 ? styles.short : styles.long

  const cssVars = {
    '--card-face': CARD_FACE[card.color],
    '--card-face-light': CARD_FACE_LIGHT[card.color],
    '--card-ink': CARD_INK[card.color],
  } as CSSProperties

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
      style={{ ...cssVars, ...style }}
      onClick={onClick}
      onKeyDown={handleKey}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={`${card.color} ${card.kind}${card.value !== undefined ? ` ${card.value}` : ''}`}
      data-card-color={card.color}
      data-card-kind={card.kind}
      data-card-value={card.value ?? ''}
    >
      <div className={styles.sheen} />
      {/* Wilds show the four-colour wheel instead of a flat oval — the same
          visual shorthand every card game uses for "any colour". */}
      <div className={`${styles.oval} ${isWild ? styles.ovalWild : ''}`} />
      <div className={`${styles.label} ${labelClass} ${isWild ? styles.labelOnWild : ''}`}>{label}</div>
      {label.length <= 3 && (
        <>
          <div className={`${styles.corner} ${styles.cornerTL}`}>{label}</div>
          <div className={`${styles.corner} ${styles.cornerBR}`}>{label}</div>
        </>
      )}
    </div>
  )
})
