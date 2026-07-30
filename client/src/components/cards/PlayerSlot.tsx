import { motion } from 'framer-motion'
import { CardBack } from './CardBack'
import { radToDeg, SEAT_DIMS, SeatSize } from './cardTheme'
import styles from './PlayerSlot.module.css'

interface Props {
  nickname: string
  handSize: number
  isActiveTurn: boolean
  isDisconnected: boolean
  x: number
  y: number
  /** Chosen by seatLayout() from the viewport and the number of opponents. */
  size?: SeatSize
}

/** Mini-fan geometry per seat size. `mini` drops the fan entirely. */
const FAN: Record<SeatSize, { maxVisible: number; miniW: number; miniH: number; miniR: number; stride: number } | null> = {
  full: { maxVisible: 9, miniW: 17, miniH: 25, miniR: 3, stride: 11 },
  compact: { maxVisible: 5, miniW: 13, miniH: 19, miniR: 2, stride: 9 },
  mini: null,
}

const SIZE_CLASS: Record<SeatSize, string | undefined> = {
  full: undefined,
  compact: styles.compact,
  mini: styles.mini,
}

// PlayerSlot renders an opponent bubble centred on (x, y) — pill background,
// nickname, card count, fanned mini card backs, and an active-turn marker.
//
// The pill is placed by transform rather than left/top so seats glide when the
// arc is recomputed (a player joins or leaves, or the window is resized).
export function PlayerSlot({ nickname, handSize, isActiveTurn, isDisconnected, x, y, size = 'full' }: Props) {
  const fan = FAN[size]
  const { w: pillW, h: pillH } = SEAT_DIMS[size]

  const n = fan ? Math.min(handSize, fan.maxVisible) : 0
  const totalW = fan ? (n - 1) * fan.stride + fan.miniW : 0
  const startX = -totalW / 2
  const maxRotDeg = n > 4 ? 14 : n > 1 ? 8 : 0
  const maxRot = (maxRotDeg * Math.PI) / 180

  const cls = [
    styles.slot,
    SIZE_CLASS[size],
    isActiveTurn ? styles.active : '',
    isDisconnected ? styles.disconnected : '',
  ].filter(Boolean).join(' ')

  const label = isDisconnected ? `${nickname} ✗` : nickname

  return (
    <motion.div
      className={cls}
      aria-label={`player ${nickname}`}
      initial={false}
      animate={{ x: x - pillW / 2, y: y - pillH / 2 }}
      transition={{ type: 'spring', stiffness: 320, damping: 30 }}
    >
      {isActiveTurn && <div className={styles.dot} />}
      <div className={styles.label}>{label}</div>
      {/* Explicit card count. The mini-fan conveys "few vs many" at a glance,
          but a spectator tracking who is about to win needs the exact number —
          and on mini seats it is the only card information there is. */}
      <div className={`${styles.count} ${handSize === 1 ? styles.countDanger : ''}`} aria-hidden>
        {handSize}
      </div>
      {fan && (
        <div className={styles.miniFan} aria-hidden>
          {Array.from({ length: n }, (_, i) => {
            const t = n > 1 ? (i / (n - 1)) * 2 - 1 : 0
            const rot = radToDeg(t * maxRot)
            const arcY = Math.abs(t) * 4
            // Offset from the pill centre; expressed as a transform so the fan
            // reflows on a transition instead of jumping when the count changes.
            const dx = startX + i * fan.stride + pillW / 2 - fan.miniW / 2
            return (
              <div
                key={i}
                className={styles.miniBack}
                style={{
                  transform: `translate(${dx}px, ${-arcY}px) rotate(${rot}deg)`,
                  opacity: 0.6 + (i / Math.max(n - 1, 1)) * 0.4,
                }}
              >
                <CardBack width={fan.miniW} height={fan.miniH} radius={fan.miniR} />
              </div>
            )
          })}
          {handSize > fan.maxVisible && (
            <div
              className={styles.overflow}
              style={{ transform: `translateX(${startX + n * fan.stride + 2 + pillW / 2}px)` }}
            >
              +{handSize - fan.maxVisible}
            </div>
          )}
        </div>
      )}
    </motion.div>
  )
}
