import { CardBack } from './CardBack'
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

// PlayerSlot renders an opponent bubble at (x, y) — pill background, nickname,
// fanned mini card backs with overflow label, and active-turn dot.
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
    <div className={cls} style={{ left: x, top: y }} aria-label={`player ${nickname}`}>
      {isActiveTurn && <div className={styles.dot} />}
      <div className={styles.label}>{label}</div>
      <div className={styles.miniFan} aria-hidden>
        {Array.from({ length: n }, (_, i) => {
          const t = n > 1 ? (i / (n - 1)) * 2 - 1 : 0
          const rot = t * maxRot
          const arcY = Math.abs(t) * 4
          const left = startX + i * STRIDE + MINI_W / 2 + 86 // half pill width
          return (
            <div
              key={i}
              className={styles.miniBack}
              style={{
                left,
                bottom: arcY,
                transform: `translateX(-50%) rotate(${rot}rad)`,
                opacity: 0.6 + (i / Math.max(n - 1, 1)) * 0.4,
              }}
            >
              <CardBack width={MINI_W} height={MINI_H} radius={MINI_R} />
            </div>
          )
        })}
        {handSize > MAX_VISIBLE && (
          <div className={styles.overflow} style={{ left: startX + n * STRIDE + 2 + 86 }}>
            +{handSize - MAX_VISIBLE}
          </div>
        )}
      </div>
    </div>
  )
}
