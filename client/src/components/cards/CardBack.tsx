import { CSSProperties, forwardRef } from 'react'
import styles from './CardBack.module.css'

interface Props {
  /** Card width in px. Default 72 (full size). */
  width?: number
  /** Card height in px. Default 108 (full size). */
  height?: number
  /** Border radius in px. Default 10. */
  radius?: number
  /** 0..1; PixiJS used per-card alpha for the deck stack and mini fans. */
  opacity?: number
  className?: string
  style?: CSSProperties
}

// CardBack renders the deck-back visual. Defaults match the full card size;
// the mini-fan inside opponent bubbles passes smaller dimensions.
export const CardBack = forwardRef<HTMLDivElement, Props>(function CardBack(
  { width = 72, height = 108, radius = 10, opacity = 1, className, style },
  ref,
) {
  // Inner panel + monogram font scale with the outer dimensions, mirroring
  // the original Pixi math (font = w * 0.33, hidden when w <= 20).
  const monoSize = Math.max(8, width * 0.33)
  const showMono = width > 20

  return (
    <div
      ref={ref}
      className={`${styles.back} ${className ?? ''}`}
      style={{
        width,
        height,
        borderRadius: radius,
        opacity,
        ...style,
      }}
    >
      {/* Inner medallion is always an ellipse — its radius is owned by the
          stylesheet, not derived from the outer card radius. */}
      <div className={styles.inner} />
      {showMono && (
        <div className={styles.monogram} style={{ fontSize: monoSize }}>L</div>
      )}
    </div>
  )
})
