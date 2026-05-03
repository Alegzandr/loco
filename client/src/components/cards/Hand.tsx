import { useState } from 'react'
import { CardDTO, CardColor } from '../../types/protocol'
import { Card } from './Card'
import { calcHandSlots } from './layout'
import { CARD_W, CARD_H } from './cardTheme'
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
export function Hand({
  hand,
  width,
  height,
  isPlayable,
  isInteractive,
  onCardClick,
}: Props) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
  if (hand.length === 0) return null
  const slots = calcHandSlots(hand.length, width, height)

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
          <div
            key={i}
            className={`${styles.slot}${isHovered ? ' ' + styles.hovered : ''}`}
            style={{
              left: slot.x,
              top: slot.y + restLift,
              width: CARD_W,
              height: CARD_H,
              zIndex: i,
              transform: `rotate(${isHovered ? 0 : slot.rotation}rad)`,
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
          </div>
        )
      })}
    </div>
  )
}

// Re-export for places that need the same predicate without importing the
// helper directly (avoids a cycle through GameView).
export type HandPlayablePredicate = (card: CardDTO, top: CardDTO | null, active: CardColor) => boolean
