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
  /** Barrel roll, in *whole turns* (a half turn would land the card face down). */
  spin?: number
  /** Mid-flight scale: the card passes nearer the camera. Most of what separates
   *  a card being thrown from a sprite being moved. */
  swell?: number
}

/** Shockwave ring left where a card landed. Rare and legendary plays only. */
export interface Impact {
  id: string
  /** Centre of the ring, in board coordinates. */
  x: number
  y: number
  /** Ring tint: the caller passes ACTIVE_RING[card.color]. */
  color: string
  /** Diameter in px; the caller sizes it by rarity. */
  size?: number
}

export interface EffectText {
  id: string
  text: string
  color: string
  x: number
  y: number
  /** ms to wait before the callout punches in, set to the flight time, so it
   *  announces the card's landing rather than the message that carried it. */
  delayMs?: number
}

interface Props {
  fliers: Flier[]
  effectTexts: EffectText[]
  /** Landing rings; omitted entirely when nothing notable landed. */
  impacts?: Impact[]
  onFlierDone: (id: string) => void
  onEffectDone: (id: string) => void
  onImpactDone?: (id: string) => void
}

const IMPACT_SIZE = 170

// Renders the absolute-positioned overlay holding all transient animations:
// flying cards (plays, draws, swap/global_switch trails) and floating effect
// text (SKIP / REVERSE / +N). Each entry self-cleans via onDone callback.
//
// Movement is expressed as `x`/`y` transforms rather than `left`/`top` so the
// browser can composite each flier on the GPU instead of running layout on
// every frame — the difference is visible once several cards fly at once.
export function AnimationLayer({
  fliers,
  effectTexts,
  impacts = [],
  onFlierDone,
  onEffectDone,
  onImpactDone,
}: Props) {
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
          const startScale = f.startScale ?? 1
          const swell = f.swell ?? 0
          const scaleTrack = swell > 1 ? [startScale, swell, 1] : 1
          const spin = f.spin ?? 0
          const face = f.kind === 'back'
            ? <CardBack width={w} height={h} radius={r} />
            : <Card card={f.card!} />
          return (
            <motion.div
              key={f.id}
              className={styles.flier}
              initial={{
                x: f.from.x,
                y: f.from.y,
                opacity: f.startAlpha ?? 1,
                scale: startScale,
                rotate: fromRot,
              }}
              animate={{
                x: f.to.x,
                y: yTrack,
                opacity: 1,
                scale: scaleTrack,
                // The spin is whole turns in the card's own plane, folded into the
                // same rotate track as the landing tilt: a full turn is visually a
                // no-op, so the card still settles on exactly `toRot`.
                rotate: toRot + spin * 360,
              }}
              exit={f.fadeOut ? { opacity: 0, transition: { duration: 0.22 } } : undefined}
              transition={{ duration, delay, ease: EASE_OUT_CARD }}
              onAnimationComplete={() => onFlierDone(f.id)}
              data-flier-face={f.kind}
              style={{ width: w, height: h }}
            >
              {face}
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
              transition={{
                duration: 1,
                delay: (et.delayMs ?? 0) / 1000,
                times: [0, 0.16, 0.6, 1],
                ease: 'easeOut',
              }}
              onAnimationComplete={() => onEffectDone(et.id)}
            >
              {et.text}
            </motion.div>
          </div>
        ))}
      </AnimatePresence>
      <AnimatePresence>
        {impacts.map((im) => (
          // Outer anchor owns the position, inner motion node owns the expansion:
          // same split as the effect text, for the same reason.
          <div key={im.id} className={styles.impactAnchor} style={{ left: im.x, top: im.y }}>
            <motion.div
              className={styles.impactRing}
              // `color` drives the border and the glow together, so the ring is
              // tinted in one place from the card that landed.
              style={{ width: im.size ?? IMPACT_SIZE, height: im.size ?? IMPACT_SIZE, color: im.color }}
              initial={{ scale: 0.18, opacity: 0.9 }}
              animate={{ scale: 1, opacity: 0 }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
              onAnimationComplete={() => onImpactDone?.(im.id)}
            />
          </div>
        ))}
      </AnimatePresence>
    </div>
  )
}
