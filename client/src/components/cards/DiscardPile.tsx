import { CardDTO, CardColor } from '../../types/protocol'
import { Card } from './Card'
import { ACTIVE_RING, CARD_W, CARD_H } from './cardTheme'
import { discardPosition } from './layout'
import styles from './DiscardPile.module.css'

interface Props {
  card: CardDTO | null
  activeColor: CardColor
  pendingDraw: number
  width: number
  height: number
}

// Top of the discard pile + active-color ring + pending-draw +N badge.
export function DiscardPile({ card, activeColor, pendingDraw, width, height }: Props) {
  if (!card) return null
  const { x, y } = discardPosition(width, height)

  return (
    <div className={styles.pile} style={{ left: x, top: y, width: CARD_W, height: CARD_H }} aria-label="discard">
      <div className={styles.ring} style={{ borderColor: ACTIVE_RING[activeColor] }} />
      <Card card={card} />
      {pendingDraw > 0 && (
        <div
          className={styles.badge}
          style={{ left: CARD_W - 38 / 2 + 4, top: -22 / 2 + 4 }}
          aria-label={`pending draw ${pendingDraw}`}
        >
          +{pendingDraw}
        </div>
      )}
    </div>
  )
}
