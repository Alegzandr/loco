import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { CardDTO, CardColor } from '../../types/protocol'
import { Card } from './Card'
import { calcHandSlots, handCardKeys } from './layout'
import { CARD_W, CARD_H, SPRING_HAND, DEAL_STAGGER_MS, radToDeg } from './cardTheme'
import styles from './Hand.module.css'

interface Props {
  hand: CardDTO[]
  width: number
  height: number
  /** Predicate run per card to decide playable/highlight state. */
  isPlayable: (card: CardDTO) => boolean
  /** Predicate that decides whether a tap should be allowed at all (turn or
      legal interrupt). When false, the card renders without pointer cursor. */
  isInteractive: (card: CardDTO) => boolean
  onCardClick: (card: CardDTO, idx: number) => void
}

// Hand renders the local player's fanned cards. Pure presentational —
// position / rotation comes from `calcHandSlots`. Hover state is local.
//
// Each slot is a motion node positioned purely by transform, so when a card
// leaves the fan the neighbours glide into the gap on a spring instead of
// snapping to their new left/top. A fresh deal staggers the cards in.
export function Hand({
  hand,
  width,
  height,
  isPlayable,
  isInteractive,
  onCardClick,
}: Props) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)

  // A hand that grows from empty is a deal — worth staggering. Any other growth
  // is a draw, which already has its own deck→hand flier and must not stagger.
  const prevLen = useRef(hand.length)
  const [dealing, setDealing] = useState(false)
  useEffect(() => {
    const wasEmpty = prevLen.current === 0
    prevLen.current = hand.length
    if (!wasEmpty || hand.length < 2) return
    setDealing(true)
    const id = setTimeout(() => setDealing(false), hand.length * DEAL_STAGGER_MS + 400)
    return () => clearTimeout(id)
  }, [hand.length])

  if (hand.length === 0) return null
  const slots = calcHandSlots(hand.length, width, height)
  const keys = handCardKeys(hand)

  return (
    <div className={styles.hand} aria-label="hand">
      {hand.map((card, i) => {
        const slot = slots[i]
        const playable = isPlayable(card)
        const interactive = isInteractive(card)
        // Playable cards lift slightly even at rest so they stand out.
        const restLift = playable ? -9 : 0
        const isHovered = hoveredIdx === i
        return (
          <motion.div
            key={keys[i]}
            className={`${styles.slot}${isHovered ? ' ' + styles.hovered : ''}`}
            style={{ width: CARD_W, height: CARD_H, zIndex: isHovered ? 100 : i }}
            initial={{ x: slot.x, y: slot.y + restLift, rotate: radToDeg(slot.rotation), opacity: 0, scale: 0.88 }}
            animate={{
              x: slot.x,
              y: slot.y + restLift,
              // Hovering straightens the card so its face is fully readable.
              rotate: isHovered ? 0 : radToDeg(slot.rotation),
              opacity: 1,
              scale: 1,
            }}
            transition={{
              ...SPRING_HAND,
              delay: dealing ? (i * DEAL_STAGGER_MS) / 1000 : 0,
            }}
            onMouseEnter={() => setHoveredIdx(i)}
            onMouseLeave={() => setHoveredIdx((cur) => (cur === i ? null : cur))}
          >
            <Card
              card={card}
              playable={playable}
              shadow
              onClick={interactive ? () => onCardClick(card, i) : undefined}
              className={styles.card}
            />
          </motion.div>
        )
      })}
    </div>
  )
}

// Re-export for places that need the same predicate without importing the
// helper directly (avoids a cycle through GameView).
export type HandPlayablePredicate = (card: CardDTO, top: CardDTO | null, active: CardColor) => boolean
