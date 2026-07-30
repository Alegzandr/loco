import { useMemo } from 'react'
import styles from './Confetti.module.css'

interface Props {
  /** Number of pieces. Kept modest: this runs on phones too. */
  count?: number
}

const COLORS = ['#ff3d68', '#ffc93c', '#17b877', '#2b7fff', '#6c5cff', '#ff5cc8']

/**
 * Confetti burst for the victory screen.
 *
 * Pure CSS: every piece is one absolutely-positioned div animating `transform`
 * and `opacity`, so the whole burst stays on the compositor and costs no
 * JavaScript per frame. Values are randomised once on mount — re-randomising on
 * every render would restart the animation.
 */
export function Confetti({ count = 60 }: Props) {
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 2.4,
        duration: 2.6 + Math.random() * 2.2,
        drift: (Math.random() - 0.5) * 220,
        spin: 360 + Math.random() * 900,
        size: 7 + Math.random() * 9,
        color: COLORS[i % COLORS.length],
        round: Math.random() < 0.3,
      })),
    [count],
  )

  return (
    <div className={styles.layer} aria-hidden>
      {pieces.map((p) => (
        <span
          key={p.id}
          className={`${styles.piece} ${p.round ? styles.round : ''}`}
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.round ? p.size : p.size * 1.6,
            background: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            ['--drift' as string]: `${p.drift}px`,
            ['--spin' as string]: `${p.spin}deg`,
          }}
        />
      ))}
    </div>
  )
}
