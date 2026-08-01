import { useEffect, useState } from 'react'
import { CatchFlash, CATCH_PENALTY_CARDS } from '../hooks/useGameStore'
import { Translations } from '../i18n/en'
import { seatColor } from './playerColors'
import styles from './CatchBanner.module.css'

interface Props {
  flash: CatchFlash | null
  myIndex: number
  players: { index: number; nickname: string }[]
  t: Translations
  onDone: () => void
}

/** How long the stamp stays up. Matched to the interception slam. */
const DURATION_MS = 1900

/**
 * The Contre-LOCO! verdict.
 *
 * A landed catch used to be the quietest thing in the game: the caught seat's
 * hand grew by two, which on a board where hands grow all match long reads as
 * an ordinary draw, and the player who won the race got no answer at all. It is
 * the hardest reaction LOCO asks for, so it gets a moment of its own.
 *
 * Deliberately a *stamp* rather than the interception's horizontal wipe, and
 * deliberately in the penalty's red rather than in an actor colour: the two are
 * the loudest banners in the game and a muted highlight clip has to tell them
 * apart at a glance. The caught player's seat colour appears on their name only
 * — a viewer following "the orange player" still finds them.
 */
export function CatchBanner({ flash, myIndex, players, t, onDone }: Props) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!flash) return
    setVisible(true)
    const id = setTimeout(() => {
      setVisible(false)
      onDone()
    }, DURATION_MS)
    return () => clearTimeout(id)
    // Keyed on the timestamp: a second catch restarts the stamp.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flash?.at])

  if (!flash || !visible) return null

  const caught = players.find((p) => p.index === flash.seat)
  const subtitle = flash.seat === myIndex
    ? t.catchBannerYou
    : t.catchBannerOther.replace('%player', caught?.nickname ?? `P${flash.seat}`)

  return (
    <div className={styles.overlay} key={flash.at} aria-live="assertive" data-testid="catch-banner">
      {/* Sits above the piles rather than over them, like the LOCO! banner: the
          penalty cards leave the deck while this is still up, and a verdict
          covering the cards it is about explains nothing. */}
      <div className={styles.anchor}>
        {/* Shockwave, delayed to the frame the stamp actually lands on. */}
        <div className={styles.ring} />
        <div className={styles.stamp} style={{ ['--caught-color' as string]: seatColor(flash.seat) }}>
          <span className={styles.title}>{t.catchBannerTitle}</span>
          <span className={styles.subtitle}>{subtitle}</span>
          {/* What it cost. The whole point of the banner: a hand that grew is
              only news once the table knows it was a price. */}
          <span className={styles.penalty}>
            {t.catchBannerPenalty.replace('%n', String(CATCH_PENALTY_CARDS))}
          </span>
        </div>
      </div>
    </div>
  )
}
