import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { CardDTO, CardColor } from '../../types/protocol'
import { Card } from './Card'
import { ACTIVE_RING, SUIT_PAINT, SUIT_ANGLE_DEG, CARD_W, CARD_H, cardKey, flightFor } from './cardTheme'
import { SuitMark } from './suitMark'
import { useColorAssist } from '../../hooks/useColorAssist'
import { discardPosition } from './layout'
import styles from './DiscardPile.module.css'

interface Props {
  card: CardDTO | null
  activeColor: CardColor
  pendingDraw: number
  width: number
  height: number
  /** Vertical space claimed by the opponent seats — the piles follow the felt. */
  topReserve?: number
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
export function DiscardPile({ card, activeColor, pendingDraw, width, height, topReserve = 0 }: Props) {
  const assist = useColorAssist()
  // The pile reveals on impact, not on the message: the card is still crossing
  // the table, and showing the answer early makes the flight look decorative.
  // The one exception is the first card this pile ever shows (an opening
  // discard, or a board rebuilt after a reconnect), where nothing flew, and
  // waiting for a flight that never happened just blanks the pile.
  const [shown, setShown] = useState<CardDTO | null>(card)
  const isFirst = useRef(true)
  const key = card ? cardKey(card) : ''
  useEffect(() => {
    if (!card) { setShown(null); return }
    if (isFirst.current) {
      isFirst.current = false
      setShown(card)
      return
    }
    const timer = window.setTimeout(() => setShown(card), flightFor(card).duration)
    return () => clearTimeout(timer)
    // Keyed on the card's identity: a re-render must not restage the reveal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  if (!shown) return null
  const { x, y } = discardPosition(width, height, topReserve)
  const tilt = hashTilt(shown)

  return (
    <div className={styles.pile} style={{ left: x, top: y, width: CARD_W, height: CARD_H }} aria-label="discard">
      {/* Three readings of the same fact, at three distances. The pool is the
          one a spectator gets at 720p without looking for anything; the ring is
          the one a player already knows; the chip is the one that answers the
          question when the card itself cannot — a wild has no colour on its
          face, and that is exactly when people ask where the colour is.
          Keyed on the colour so a wild resolving replays all three. */}
      <motion.div
        key={`pool-${activeColor}`}
        className={styles.pool}
        style={{ color: ACTIVE_RING[activeColor] }}
        initial={{ opacity: 0.78, scale: 1.28 }}
        animate={{ opacity: 0.44, scale: 1 }}
        transition={{ duration: 0.55, ease: 'easeOut' }}
      />
      {/* `color` drives both the border (border-color defaults to currentColor)
          and the glow, so the active colour is set in one place. */}
      <div className={styles.ring} style={{ color: ACTIVE_RING[activeColor] }} />
      {UNDER_LAYERS.map((l, i) => (
        <div
          key={i}
          className={styles.under}
          style={{ transform: `translate(${l.dx}px, ${l.dy}px) rotate(${l.rotate}deg)`, opacity: l.opacity }}
        />
      ))}
      {/* Keyed on the card so every new top card remounts and replays the settle. */}
      <motion.div
        key={cardKey(shown)}
        className={styles.top}
        initial={{ scale: 1.14, rotate: tilt * 2.2, opacity: 0.85 }}
        animate={{ scale: 1, rotate: tilt, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 460, damping: 26, mass: 0.8 }}
      >
        <Card card={shown} />
      </motion.div>
      {/* The chip carries the suit's whole gradient, so it is literally the
          paint of the swatch that was tapped in <ColorPicker /> and of the
          cards it now lets you play. A flat sample would be a fourth colour to
          learn. Bottom-left mirrors the +N badge's corner: the pile has two
          fixed places to look, and this one is always occupied. */}
      <motion.div
        key={`chip-${activeColor}`}
        className={styles.chip}
        style={{
          left: -16,
          top: CARD_H - 22,
          color: ACTIVE_RING[activeColor],
          background: `linear-gradient(${SUIT_ANGLE_DEG}deg, ${SUIT_PAINT[activeColor].from}, ${SUIT_PAINT[activeColor].to})`,
        }}
        aria-label={`active color ${activeColor}`}
        initial={{ scale: 0.35, rotate: -22 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 520, damping: 18 }}
      >
        {/* The chip is the answer to "what can I play now?", and after a wild
            it is the *only* place that answer is written. */}
        {assist && <SuitMark color={activeColor} className={styles.chipMark} />}
      </motion.div>
      {pendingDraw > 0 && (
        <motion.div
          className={styles.badge}
          style={{ left: CARD_W - 46 / 2, top: -30 / 2 }}
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
