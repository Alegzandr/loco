import { useEffect, useState } from 'react'
import { InterruptFlash } from '../hooks/useGameStore'
import { Translations } from '../i18n/en'
import { seatColor } from './playerColors'
import styles from './InterruptBanner.module.css'

interface Props {
  flash: InterruptFlash | null
  myIndex: number
  players: { index: number; nickname: string }[]
  t: Translations
  onDone: () => void
}

/** How long the slam stays up. Long enough to read, short enough not to hide the play. */
const DURATION_MS = 1800

/**
 * The interception slam.
 *
 * Playing an identical card out of turn is the most spectacular thing that can
 * happen in a round, and until now the client rendered it exactly like an
 * ordinary turn. This is the one moment the UI is allowed to shout.
 */
export function InterruptBanner({ flash, myIndex, players, t, onDone }: Props) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!flash) return
    setVisible(true)
    const id = setTimeout(() => {
      setVisible(false)
      onDone()
    }, DURATION_MS)
    return () => clearTimeout(id)
    // Keyed on the timestamp: a second interception restarts the banner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flash?.at])

  if (!flash || !visible) return null

  const actor = players.find((p) => p.index === flash.actorIndex)
  const isMe = flash.actorIndex === myIndex
  const subtitle = isMe
    ? t.interruptByYou
    : t.interruptBy.replace('%actor', actor?.nickname ?? `P${flash.actorIndex}`)

  return (
    <div className={styles.overlay} key={flash.at} aria-live="assertive">
      <div className={styles.slash} />
      <div className={styles.banner} style={{ ['--actor-color' as string]: seatColor(flash.actorIndex) }}>
        <span className={styles.title}>{t.interruptTitle}</span>
        <span className={styles.subtitle}>{subtitle}</span>
        {/* A batched interception (several identical cards at once) is rarer
            still — it gets its own multiplier chip. */}
        {flash.count > 1 && (
          <span className={styles.combo}>{t.interruptCombo.replace('%n', String(flash.count))}</span>
        )}
      </div>
    </div>
  )
}
