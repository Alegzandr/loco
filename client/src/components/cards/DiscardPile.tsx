import { motion } from 'framer-motion'
import { CardDTO, CardColor } from '../../types/protocol'
import { Card } from './Card'
import { ACTIVE_RING, CARD_W, CARD_H, cardKey } from './cardTheme'
import { discardPosition } from './layout'
import styles from './DiscardPile.module.css'

interface Props {
  card: CardDTO | null
  activeColor: CardColor
  pendingDraw: number
  width: number
  height: number
}

// Fixed tilts for the cards buried under the top one. Static rather than random
// so the pile doesn't reshuffle itself on every render.
const UNDER_LAYERS = [
  { rotate: -4, dx: -2, dy: 1, opacity: 0.28 },
  { rotate: 3, dx: 1, dy: -1, opacity: 0.4 },
]

// hashTilt derives a small, stable tilt from the card's identity so each new top
// card lands at its own angle and the pile looks handled rather than machine
// stacked. Deterministic: the same card always lands the same way.
function hashTilt(card: CardDTO): number {
  const s = cardKey(card)
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return ((Math.abs(h) % 11) - 5) * 0.9 // −4.5°..+4.5°
}

// Top of the discard pile + active-color ring + pending-draw +N badge.
export function DiscardPile({ card, activeColor, pendingDraw, width, height }: Props) {
  if (!card) return null
  const { x, y } = discardPosition(width, height)
  const tilt = hashTilt(card)

  return (
    <div className={styles.pile} style={{ left: x, top: y, width: CARD_W, height: CARD_H }} aria-label="discard">
      <div className={styles.ring} style={{ borderColor: ACTIVE_RING[activeColor] }} />
      {UNDER_LAYERS.map((l, i) => (
        <div
          key={i}
          className={styles.under}
          style={{ transform: `translate(${l.dx}px, ${l.dy}px) rotate(${l.rotate}deg)`, opacity: l.opacity }}
        />
      ))}
      {/* Keyed on the card so every new top card remounts and replays the settle. */}
      <motion.div
        key={cardKey(card)}
        className={styles.top}
        initial={{ scale: 1.14, rotate: tilt * 2.2, opacity: 0.85 }}
        animate={{ scale: 1, rotate: tilt, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 460, damping: 26, mass: 0.8 }}
      >
        <Card card={card} />
      </motion.div>
      {pendingDraw > 0 && (
        <motion.div
          className={styles.badge}
          style={{ left: CARD_W - 38 / 2 + 4, top: -22 / 2 + 4 }}
          aria-label={`pending draw ${pendingDraw}`}
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 600, damping: 22 }}
        >
          +{pendingDraw}
        </motion.div>
      )}
    </div>
  )
}
