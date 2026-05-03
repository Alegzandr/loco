import { CardBack } from './CardBack'
import { deckPosition } from './layout'
import { CARD_W, CARD_H } from './cardTheme'
import styles from './Deck.module.css'

interface Props {
  width: number
  height: number
}

// Stacked deck visual — three offset card backs, fading toward the back.
export function Deck({ width, height }: Props) {
  const { x, y } = deckPosition(width, height)
  return (
    <div className={styles.deck} style={{ left: x, top: y, width: CARD_W + 6, height: CARD_H + 6 }} aria-hidden>
      {[2, 1, 0].map((i) => (
        <div key={i} className={styles.layer} style={{ left: i * 2, top: i * 2 }}>
          <CardBack opacity={0.6 + i * 0.15} />
        </div>
      ))}
    </div>
  )
}
