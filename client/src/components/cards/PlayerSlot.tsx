import { motion } from 'framer-motion'
import { CardBack } from './CardBack'
import { radToDeg } from './cardTheme'
import styles from './PlayerSlot.module.css'

interface Props {
  nickname: string
  handSize: number
  isActiveTurn: boolean
  isDisconnected: boolean
  x: number
  y: number
}

const MAX_VISIBLE = 9
const MINI_W = 17
const MINI_H = 25
const MINI_R = 3
const STRIDE = 11
// Pill dimensions, mirrored from PlayerSlot.module.css. Halved to convert the
// centre point the layout returns into the transform framer-motion applies.
const PILL_W = 172
const PILL_H = 66

// PlayerSlot renders an opponent bubble centred on (x, y) — pill background,
// nickname, fanned mini card backs with overflow label, and active-turn dot.
//
// The pill is placed by transform rather than left/top so seats glide when the
// arc is recomputed (a player joins or leaves, or the window is resized).
export function PlayerSlot({ nickname, handSize, isActiveTurn, isDisconnected, x, y }: Props) {
  const n = Math.min(handSize, MAX_VISIBLE)
  const totalW = (n - 1) * STRIDE + MINI_W
  const startX = -totalW / 2
  const maxRotDeg = n > 4 ? 14 : n > 1 ? 8 : 0
  const maxRot = (maxRotDeg * Math.PI) / 180

  const cls = [
    styles.slot,
    isActiveTurn ? styles.active : '',
    isDisconnected ? styles.disconnected : '',
  ].filter(Boolean).join(' ')

  const label = isDisconnected ? `${nickname} ✗` : nickname

  return (
    <motion.div
      className={cls}
      aria-label={`player ${nickname}`}
      initial={false}
      animate={{ x: x - PILL_W / 2, y: y - PILL_H / 2 }}
      transition={{ type: 'spring', stiffness: 320, damping: 30 }}
    >
      {isActiveTurn && <div className={styles.dot} />}
      <div className={styles.label}>{label}</div>
      <div className={styles.miniFan} aria-hidden>
        {Array.from({ length: n }, (_, i) => {
          const t = n > 1 ? (i / (n - 1)) * 2 - 1 : 0
          const rot = radToDeg(t * maxRot)
          const arcY = Math.abs(t) * 4
          // Offset from the pill centre; expressed as a transform so the fan
          // reflows on a transition instead of jumping when the count changes.
          const dx = startX + i * STRIDE + PILL_W / 2 - MINI_W / 2
          return (
            <div
              key={i}
              className={styles.miniBack}
              style={{
                transform: `translate(${dx}px, ${-arcY}px) rotate(${rot}deg)`,
                opacity: 0.6 + (i / Math.max(n - 1, 1)) * 0.4,
              }}
            >
              <CardBack width={MINI_W} height={MINI_H} radius={MINI_R} />
            </div>
          )
        })}
        {handSize > MAX_VISIBLE && (
          <div
            className={styles.overflow}
            style={{ transform: `translateX(${startX + n * STRIDE + 2 + PILL_W / 2}px)` }}
          >
            +{handSize - MAX_VISIBLE}
          </div>
        )}
      </div>
    </motion.div>
  )
}
