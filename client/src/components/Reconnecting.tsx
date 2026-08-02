import { useI18n } from '../i18n'
import { LocoLogo } from './LocoLogo'
import { Preferences } from './Preferences'
import { TableCode } from './TableCode'
import styles from './Reconnecting.module.css'

interface Props {
  /** The room the seat is being reclaimed in. Shown so a player can tell at a
   *  glance that this is the game they meant, not a leftover from an old tab. */
  roomCode: string
  /** Whether the tab is coming back to a match or to a waiting room. One is a
   *  seat with a hand on it, the other is a queue, and the wait means different
   *  things in each. */
  target: 'waiting' | 'game'
  /** Give up and go to the lobby. A reclaim can only be waited on for so long
   *  before "is it stuck?" is a reasonable question, and it must be answerable
   *  without reaching for the reload button. */
  onCancel: () => void
}

/**
 * Shown while a reloaded tab reclaims its seat.
 *
 * It exists because the alternative reads as data loss: the page comes back on
 * the lobby, the room code is gone, the nickname field is empty, and the match
 * is still running somewhere with a hand in it. This says the seat is being
 * fetched, names the room so the player recognises it, and offers the way out.
 */
export function Reconnecting({ roomCode, target, onCancel }: Props) {
  const { t } = useI18n()

  return (
    <div className={styles.container}>
      <div className={styles.topBar}>
        <Preferences />
      </div>

      <LocoLogo size="clamp(46px, 9vw, 88px)" animated />

      <div className={styles.card} role="status" aria-live="polite">
        {/* Three dots on their own stagger rather than a spinning ring: the rest
            of this UI has no spinners in it, and a bouncing row is the same
            language as the cards and the buttons. */}
        <div className={styles.dots} aria-hidden="true">
          <span /><span /><span />
        </div>
        <p className={styles.title}>
          {target === 'game' ? t.reconnectingGame : t.reconnectingRoom}
        </p>
        {roomCode && (
          <p className={styles.room}>
            <span className={styles.roomLabel}>{t.roomCodeLabel}</span>
            <TableCode code={roomCode} className={styles.roomVal} />
          </p>
        )}
        {/* The in-match promise is a 60 s clock; the pre-match one is not a
            clock at all, and stating a deadline that does not exist is how a
            player decides to reload something that was never at risk. */}
        <p className={styles.hint}>
          {target === 'game' ? t.reconnectingHint : t.reconnectingHintRoom}
        </p>
      </div>

      <button className={styles.cancel} type="button" onClick={onCancel}>
        {t.reconnectCancel}
      </button>
    </div>
  )
}
