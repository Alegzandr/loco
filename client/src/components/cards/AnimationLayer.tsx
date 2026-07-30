import { motion, AnimatePresence } from 'framer-motion'
import { CardDTO } from '../../types/protocol'
import { Card } from './Card'
import { CardBack } from './CardBack'
import { CARD_W, CARD_H, EASE_OUT_CARD, radToDeg } from './cardTheme'
import styles from './AnimationLayer.module.css'

export interface Flier {
  id: string
  /** 'back' renders a card back; otherwise a card face. */
  kind: 'face' | 'back'
  card?: CardDTO   // required when kind === 'face'
  /** rotation is in radians, matching the layout helpers. */
  from: { x: number; y: number; rotation?: number }
  to: { x: number; y: number; rotation?: number }
  /** width/height/radius — defaults to full card. Mini cards (swap trail) are smaller. */
  size?: { w: number; h: number; r: number }
  /** 0..1 starting opacity (ends at 1). */
  startAlpha?: number
  /** 0..1 starting scale (ends at 1). */
  startScale?: number
  /** ms; default 300. */
  duration?: number
  /** ms delay before this flier starts. */
  delayMs?: number
  /** Optional fade-out tail after reaching the destination. */
  fadeOut?: boolean
  /** Peak lift of the arc, in px. 0 (default) flies in a straight line. */
  arcHeight?: number
}

export interface EffectText {
  id: string
  text: string
  color: string
  x: number
  y: number
}

interface Props {
  fliers: Flier[]
  effectTexts: EffectText[]
  onFlierDone: (id: string) => void
  onEffectDone: (id: string) => void
}

// Renders the absolute-positioned overlay holding all transient animations:
// flying cards (plays, draws, swap/global_switch trails) and floating effect
// text (SKIP / REVERSE / +N). Each entry self-cleans via onDone callback.
//
// Movement is expressed as `x`/`y` transforms rather than `left`/`top` so the
// browser can composite each flier on the GPU instead of running layout on
// every frame — the difference is visible once several cards fly at once.
export function AnimationLayer({ fliers, effectTexts, onFlierDone, onEffectDone }: Props) {
  return (
    <div className={styles.layer} aria-hidden>
      <AnimatePresence>
        {fliers.map((f) => {
          const w = f.size?.w ?? CARD_W
          const h = f.size?.h ?? CARD_H
          const r = f.size?.r ?? 10
          const duration = (f.duration ?? 300) / 1000
          const delay = (f.delayMs ?? 0) / 1000
          const fromRot = radToDeg(f.from.rotation ?? 0)
          const toRot = radToDeg(f.to.rotation ?? 0)
          // A card thrown across the table reads better with a slight lift in the
          // middle of the flight. Expressed as a 3-keyframe y track.
          const arc = f.arcHeight ?? 0
          const yTrack = arc > 0
            ? [f.from.y, (f.from.y + f.to.y) / 2 - arc, f.to.y]
            : f.to.y
          return (
            <motion.div
              key={f.id}
              className={styles.flier}
              initial={{
                x: f.from.x,
                y: f.from.y,
                opacity: f.startAlpha ?? 1,
                scale: f.startScale ?? 1,
                rotate: fromRot,
              }}
              animate={{
                x: f.to.x,
                y: yTrack,
                opacity: 1,
                scale: 1,
                rotate: toRot,
              }}
              exit={f.fadeOut ? { opacity: 0, transition: { duration: 0.22 } } : undefined}
              transition={{ duration, delay, ease: EASE_OUT_CARD }}
              onAnimationComplete={() => onFlierDone(f.id)}
              style={{ width: w, height: h }}
            >
              {f.kind === 'back'
                ? <CardBack width={w} height={h} radius={r} />
                : <Card card={f.card!} />}
            </motion.div>
          )
        })}
      </AnimatePresence>
      <AnimatePresence>
        {effectTexts.map((et) => (
          // Outer node owns the position and the centering transform; the inner
          // motion node owns the animation, so framer-motion's generated
          // transform can't clobber the -50%/-50% centering.
          <div key={et.id} className={styles.effectAnchor} style={{ left: et.x, top: et.y }}>
            <motion.div
              className={styles.effectText}
              style={{ color: et.color }}
              // Punch in, hold, then drift up and fade. The overshoot on the
              // way in is what makes the callout read as an impact rather than
              // a label that appeared.
              initial={{ opacity: 0, scale: 0.3, y: 12 }}
              animate={{
                opacity: [0, 1, 1, 0],
                scale: [0.3, 1.3, 1.08, 1.16],
                y: [12, -6, -22, -62],
              }}
              transition={{ duration: 1, times: [0, 0.16, 0.6, 1], ease: 'easeOut' }}
              onAnimationComplete={() => onEffectDone(et.id)}
            >
              {et.text}
            </motion.div>
          </div>
        ))}
      </AnimatePresence>
    </div>
  )
}
