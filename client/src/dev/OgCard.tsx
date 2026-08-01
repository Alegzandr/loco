/**
 * The social preview card (Open Graph / X), 1200×630 — dev-only, like every
 * other showcase scene, and captured by `tools/og/shoot.mjs` into
 * `client/public/og.png`.
 *
 * It is built from the real `<LocoLogo />` and the real `<Card />` rather than
 * from a standalone drawing, because that is the whole point: the duck on the
 * link preview is the duck on the cards is the duck in the tab. A hand-authored
 * copy would drift away from the mark the first time it is touched.
 *
 * What it has to do, in the half second a link gets in a Discord channel or on
 * a timeline: say *card game*, say *LOCO*, and look like something you'd click.
 * So the frame is the duck and a fan of real cards, and the text is a wordmark
 * plus one line. Anything longer is unread at preview size anyway — Discord
 * renders this at ~400px wide and X crops it.
 */
import { useRef } from 'react'
import { LocoLogo } from '../components/LocoLogo'
import { Card } from '../components/cards/Card'
import { CardDTO } from '../types/protocol'
import { useElementSize } from '../hooks/useElementSize'
import { useI18n } from '../i18n'
import styles from './OgCard.module.css'

/** The canonical OG size. Both Discord and X take 1.91:1 without re-cropping. */
export const OG_W = 1200
export const OG_H = 630

const card = (color: CardDTO['color'], kind: CardDTO['kind'], value?: number): CardDTO =>
  value === undefined ? { color, kind } : { color, kind, value }

/**
 * The fan, left to right: all four suits so the palette is complete at a
 * glance, plus the +4 — the card that decides matches — kept in the middle of
 * the arc rather than at an end, where a crop or an avatar overlay could take
 * it. Two of the five are action cards, which is what says "this one bites"
 * without a word of copy.
 */
const FAN: { card: CardDTO; rot: number; y: number; z: number }[] = [
  { card: card('green', 'number', 4), rot: -18, y: 30, z: 1 },
  { card: card('blue', 'skip'), rot: -9, y: 6, z: 2 },
  { card: card('wild', 'wild_draw_four'), rot: 0, y: 0, z: 5 },
  { card: card('yellow', 'draw_two'), rot: 9, y: 6, z: 4 },
  { card: card('red', 'number', 7), rot: 18, y: 30, z: 3 },
]

const CARD_W = 196
const CARD_H = 294
/** Horizontal step between fanned cards — deliberately tight: overlap reads as a hand. */
const CARD_STEP = 126

export function OgCard() {
  const { t } = useI18n()
  const frameRef = useRef<HTMLDivElement>(null)
  const { width, height } = useElementSize(frameRef)
  // The capture runs at exactly 1200×630, so the scale is 1 there. Everywhere
  // else (the gallery, a contact sheet, a phone) the card shrinks whole rather
  // than reflowing — it is one fixed image, not a responsive layout.
  const scale = width && height ? Math.min(1, width / OG_W, height / OG_H) : 1

  return (
    <div className={styles.frame} ref={frameRef}>
      <div
        className={styles.card}
        data-og-card=""
        style={{ transform: `scale(${scale})` }}
      >
        <div className={styles.glow} aria-hidden="true" />

        <div className={styles.brand}>
          <LocoLogo size="118px" stacked className={styles.logo} />
          {/* One line per sentence. Left to itself the column breaks the
              tagline wherever the width runs out ("Cards at speed. Nobody /
              waits their turn."), which reads as a text box that ran out of
              room rather than as a line somebody wrote. */}
          <p className={styles.tagline}>
            {t.tagline.split(/(?<=[.!?])\s+/).map((line) => (
              <span key={line} className={styles.taglineLine}>{line}</span>
            ))}
          </p>
        </div>

        <div className={styles.fan} aria-hidden="true">
          {FAN.map((f, i) => (
            <div
              key={i}
              className={styles.slot}
              style={{
                transform: `translate(${i * CARD_STEP}px, ${f.y}px) rotate(${f.rot}deg)`,
                zIndex: f.z,
              }}
            >
              <Card card={f.card} shadow style={{ width: CARD_W, height: CARD_H }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
