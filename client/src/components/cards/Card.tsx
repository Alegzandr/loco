import { CSSProperties, forwardRef, KeyboardEvent, MouseEvent } from 'react'
import { CardDTO } from '../../types/protocol'
import { CARD_FACE, CARD_FACE_LIGHT, cardLabel } from './cardTheme'
import styles from './Card.module.css'

interface Props {
  card: CardDTO
  /** Visually marks the card as legal-to-play (white border + golden glow). */
  playable?: boolean
  /** Adds the drop-shadow used for in-hand cards. */
  shadow?: boolean
  /** Click/tap handler. Triggers cursor + keyboard binding. */
  onClick?: (e: MouseEvent<HTMLDivElement>) => void
  className?: string
  style?: CSSProperties
}

// Card renders a single card face. Sized exactly like the old Pixi sprite
// (CARD_W × CARD_H = 72 × 108). Stateless, no animation — wrap in a
// <motion.div> at the call site for movement / hover effects.
export const Card = forwardRef<HTMLDivElement, Props>(function Card(
  { card, playable = false, shadow = false, onClick, className, style },
  ref,
) {
  const label = cardLabel(card)
  const isNumeric = label.length === 1 && /\d/.test(label)
  const labelClass = isNumeric ? styles.numeric : label.length <= 2 ? styles.short : styles.long

  const cssVars = {
    '--card-face': CARD_FACE[card.color],
    '--card-face-light': CARD_FACE_LIGHT[card.color],
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
      <div className={styles.highlight} />
      <div className={styles.oval} />
      <div className={`${styles.label} ${labelClass}`}>{label}</div>
      {label.length <= 3 && <div className={styles.corner}>{label}</div>}
    </div>
  )
})
