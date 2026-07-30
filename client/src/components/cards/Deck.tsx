import { CardBack } from './CardBack'
import { deckPosition } from './layout'
import { CARD_W, CARD_H } from './cardTheme'
import styles from './Deck.module.css'

interface Props {
  width: number
  height: number
  /** Vertical space claimed by the opponent seats — the piles follow the felt. */
  topReserve?: number
  /** True when drawing is currently legal — the pile then becomes a button. */
  canDraw?: boolean
  onDraw?: () => void
  /** Accessible name for the draw action, from i18n. */
  drawLabel?: string
}

// Depth of the visible stack. Deeper layers are drawn first and offset down-right
// so the pile reads as a physical block of cards seen from slightly above.
const LAYERS = [3, 2, 1, 0]
const LAYER_OFFSET = 3

/**
 * The draw pile. Clickable whenever drawing is legal: reaching for the deck is
 * the physical gesture players already expect, and it saves crossing the board
 * to the action bar on every turn.
 */
export function Deck({ width, height, topReserve = 0, canDraw = false, onDraw, drawLabel }: Props) {
  const { x, y } = deckPosition(width, height, topReserve)
  const interactive = canDraw && Boolean(onDraw)

  return (
    <div
      className={`${styles.deck} ${interactive ? styles.interactive : ''}`}
      style={{
        left: x,
        top: y,
        width: CARD_W + LAYERS.length * LAYER_OFFSET,
        height: CARD_H + LAYERS.length * LAYER_OFFSET,
      }}
      onClick={interactive ? onDraw : undefined}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? drawLabel : undefined}
      aria-hidden={interactive ? undefined : true}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onDraw?.()
              }
            }
          : undefined
      }
    >
      {LAYERS.map((i) => (
        <div
          key={i}
          className={i === 0 ? styles.layer : `${styles.layer} ${styles.buried}`}
          style={{ left: i * LAYER_OFFSET, top: i * LAYER_OFFSET }}
        >
          <CardBack />
        </div>
      ))}
    </div>
  )
}
