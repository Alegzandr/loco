import { useEffect, useState } from 'react'
import type { MatchFormat } from '../types/protocol'
import { useI18n } from '../i18n'
import { seatColor, seatInitial } from './playerColors'
import { LocoLogo } from './LocoLogo'
import styles from './MatchFound.module.css'

/**
 * The versus reveal: two and a half seconds between "you are in a queue" and
 * "you are in a match".
 *
 * It exists so the other side of the table is a person before it is a hand. A
 * queue that dealt straight into a board would make the opponent a number that
 * appeared in a seat, and this is the game's one chance to say who they are
 * while nothing else is happening.
 *
 * The countdown is presentation and nothing rests on it: the match begins when
 * the server's game_started lands, whether that is early, late or never. If the
 * counter reaches zero first the screen simply holds, which is the correct
 * thing for it to do while the server is the one deciding.
 */

interface Props {
  myNickname: string
  opponentNickname: string
  mySeat: number
  /** Date.now() ms at which the server deals. */
  startsAt: number
  format: MatchFormat
}

export function MatchFound({ myNickname, opponentNickname, mySeat, startsAt, format }: Props) {
  const { t } = useI18n()
  const [remaining, setRemaining] = useState(() => Math.max(0, startsAt - Date.now()))

  useEffect(() => {
    const id = setInterval(() => setRemaining(Math.max(0, startsAt - Date.now())), 200)
    return () => clearInterval(id)
  }, [startsAt])

  const seconds = Math.ceil(remaining / 1000)
  const opponentSeat = mySeat === 0 ? 1 : 0
  // The badge says what the match is, not what the wire calls it: "BO1" is a
  // protocol value, "One round" is the thing the player is about to play.
  const formatLabel = { BO1: t.bestOf1, BO3: t.bestOf3, BO5: t.bestOf5, BO7: t.bestOf7 }[format]

  return (
    <div className={styles.container}>
      <LocoLogo size="clamp(34px, 6vw, 56px)" />
      <p className={styles.kicker}>{t.matchFoundKicker}</p>

      <div className={styles.versus}>
        {/* Each side slides in from its own edge and lands with a bounce. The
            two arrivals are staggered so the collision reads as a meeting
            rather than a single object appearing. */}
        <div className={`${styles.side} ${styles.left}`}>
          <span className={styles.avatar} style={{ background: seatColor(mySeat) }}>
            {seatInitial(myNickname)}
          </span>
          <span className={styles.name}>{myNickname}</span>
          <span className={styles.you}>{t.matchFoundYou}</span>
        </div>

        <div className={styles.vs} aria-hidden="true">
          <span className={styles.vsText}>VS</span>
        </div>

        <div className={`${styles.side} ${styles.right}`}>
          <span className={styles.avatar} style={{ background: seatColor(opponentSeat) }}>
            {seatInitial(opponentNickname)}
          </span>
          <span className={styles.name}>{opponentNickname}</span>
          <span className={styles.format}>{formatLabel}</span>
        </div>
      </div>

      <p className={styles.countdown} aria-live="polite">
        {seconds > 0 ? t.matchFoundStartingIn.replace('%n', String(seconds)) : t.matchFoundDealing}
      </p>
    </div>
  )
}
