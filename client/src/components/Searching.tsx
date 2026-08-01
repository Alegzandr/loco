import { useEffect, useState } from 'react'
import { useI18n } from '../i18n'
import { playSfx } from '../audio/sfx'
import { seatColor, seatInitial } from './playerColors'
import { LocoLogo } from './LocoLogo'
import { searchStage, formatElapsed } from './searchStages'
import styles from './Searching.module.css'

/**
 * Waiting for an opponent.
 *
 * The screen times its own wait, because the server never says how long the
 * queue is (see searchStages.ts, which owns that rule and the three stages of
 * copy it produces). Everything here is presentation: a radar that is visibly
 * doing something, the empty chair opposite, and the two ways out.
 */

interface Props {
  /** Date.now() when the search began. */
  startedAt: number
  nickname: string
  onCancel: () => void
  /** Offered once the wait is long: a table needs one friend, not one stranger. */
  onCreateTable: () => void
}

export function Searching({ startedAt, nickname, onCancel, onCreateTable }: Props) {
  const { t } = useI18n()
  const [elapsed, setElapsed] = useState(() => Date.now() - startedAt)

  // One tick a second, and nothing else in this screen is stateful: the ring,
  // the sweep and the cards all run on CSS. See useDrainBar for why anything
  // continuous stays off React's hands.
  useEffect(() => {
    const id = setInterval(() => setElapsed(Date.now() - startedAt), 1000)
    return () => clearInterval(id)
  }, [startedAt])

  const stage = searchStage(elapsed)

  return (
    <div className={styles.container}>
      <LocoLogo size="clamp(30px, 5vw, 48px)" />

      <div className={styles.stage}>
        {/* The radar is the one thing on screen that is unambiguously *doing*
            something. Three rings on staggered delays so the pulse never has a
            still frame, and a sweep that keeps turning even when it stops. */}
        <div className={styles.radar} aria-hidden="true">
          <span className={styles.ring} />
          <span className={styles.ring} />
          <span className={styles.ring} />
          <span className={styles.sweep} />
          <span className={styles.avatar} style={{ background: seatColor(0) }}>
            {seatInitial(nickname)}
          </span>
        </div>

        {/* The empty chair opposite. It is what the whole screen is about, and
            leaving it visibly empty is more honest than a spinner. Same box as
            the radar so the two sides balance: this is a 1v1, and a lopsided
            pair reads as a layout bug rather than as a missing player. */}
        <div className={styles.opponent} aria-hidden="true">
          <span className={styles.opponentSlot}>?</span>
        </div>
      </div>

      <h1 className={styles.title}>{t.searchTitle}</h1>

      {/* aria-live so the stage change is announced rather than silently
          swapped: somebody using a screen reader is doing exactly the same
          thing as everybody else here, which is waiting. */}
      <p className={styles.subtitle} aria-live="polite">
        {stage === 'long'
          ? t.searchLong
          : stage === 'patient'
            ? t.searchPatient
            : t.searchFresh}
      </p>

      <p className={styles.elapsed}>
        <span className={styles.elapsedLabel}>{t.searchElapsed}</span>
        <span className={styles.elapsedValue}>{formatElapsed(elapsed)}</span>
      </p>

      <div className={styles.actions}>
        <button
          className={styles.cancel}
          onClick={() => {
            playSfx('uiBack')
            onCancel()
          }}
        >
          {t.searchCancel}
        </button>
        {stage === 'long' && (
          <button className={styles.alternative} onClick={onCreateTable}>
            {t.searchCreateTable}
          </button>
        )}
      </div>
    </div>
  )
}
