import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import { useDrainBar } from '../hooks/useDrainBar'
import styles from './OpponentAway.module.css'

/**
 * "They dropped, and here is how long that lasts."
 *
 * Only a matchmade match sends a deadline, and only a matchmade match should:
 * an ordinary room holds the seat for a minute for people who came in together,
 * and telling them their friend is on a countdown to losing would be a worse
 * table than the silent wait. Here the two players are strangers, the wait is
 * short, and a number is the difference between sitting through it and
 * reloading the page to see whether the game is broken.
 *
 * The bar drains on the compositor (useDrainBar) and only the seconds figure
 * touches React, once a second: a board frozen on somebody else's connection is
 * exactly when the main thread must stay free for the moment it unfreezes.
 */

interface Props {
  nickname: string
  /** Unix ms at which the match is given away. */
  deadline: number
}

export function OpponentAway({ nickname, deadline }: Props) {
  const { t } = useI18n()
  const trackRef = useRef<HTMLDivElement>(null)
  const fillRef = useRef<HTMLDivElement>(null)
  const [seconds, setSeconds] = useState(() => Math.max(0, Math.ceil((deadline - Date.now()) / 1000)))

  useDrainBar(fillRef, deadline, 'auto')

  useEffect(() => {
    const id = setInterval(() => {
      setSeconds(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)))
    }, 500)
    return () => clearInterval(id)
  }, [deadline])

  return (
    <div className={styles.banner} role="status">
      <span className={styles.dot} aria-hidden="true" />
      <span className={styles.text}>
        <span className={styles.headline}>
          <strong className={styles.name}>{nickname}</strong> {t.opponentAway}
        </span>
        <span className={styles.hint}>{t.opponentAwayHint}</span>
      </span>
      <span className={styles.count}>{seconds}s</span>
      <div ref={trackRef} className={styles.track}>
        <div ref={fillRef} className={styles.fill} />
      </div>
    </div>
  )
}
