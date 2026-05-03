import { motion, AnimatePresence } from 'framer-motion'
import { CardDTO } from '../../types/protocol'
import { Card } from './Card'
import { CardBack } from './CardBack'
import { CARD_W, CARD_H } from './cardTheme'
import styles from './AnimationLayer.module.css'

export interface Flier {
  id: string
  /** 'back' renders a card back; otherwise a card face. */
  kind: 'face' | 'back'
  card?: CardDTO   // required when kind === 'face'
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
          const fromRot = f.from.rotation ?? 0
          const toRot = f.to.rotation ?? 0
          return (
            <motion.div
              key={f.id}
              className={styles.flier}
              initial={{
                left: f.from.x,
                top: f.from.y,
                opacity: f.startAlpha ?? 1,
                scale: f.startScale ?? 1,
                rotate: fromRot,
              }}
              animate={{
                left: f.to.x,
                top: f.to.y,
                opacity: 1,
                scale: 1,
                rotate: toRot,
              }}
              exit={f.fadeOut ? { opacity: 0, transition: { duration: 0.22 } } : undefined}
              transition={{ duration, delay, ease: [0.16, 1, 0.3, 1] }}
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
          <motion.div
            key={et.id}
            className={styles.effectText}
            style={{ left: et.x, top: et.y, color: et.color }}
            initial={{ opacity: 1, scale: 1, y: 0 }}
            animate={{ opacity: 0, scale: 1.25, y: -55 }}
            transition={{ duration: 0.9, ease: 'easeOut' }}
            onAnimationComplete={() => onEffectDone(et.id)}
          >
            {et.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
