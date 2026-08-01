import { useI18n } from '../i18n'
import styles from './ServerUpdating.module.css'

/**
 * "A new version is landing, and this match is going to finish."
 *
 * Deliberately the quietest thing on the board. Everything else that appears
 * over the felt is either a deadline (OpponentAway, the turn bar, the catch
 * window) or a moment (InterruptBanner, CatchBanner), and all of them are
 * asking for something. This asks for nothing: the server drains, the match
 * plays out, and if the process is replaced before the last card the restart
 * costs a one-second reconnect the client already handles on its own. So: no
 * countdown, no colour from the alert ramp, no blinking dot, and nothing
 * disabled. A player who ignores it entirely loses nothing, which is exactly
 * what it is telling them.
 *
 * It exists at all because a board that quietly changes behaviour is worse than
 * one that says so: during a drain the rematch button stops working, and
 * without this line that reads as a bug.
 *
 * Where it sits depends on the width, and it hides nothing at either: see the
 * stylesheet.
 */

interface Props {
  /** Step down below the opponent-away banner when both are up. Only does
   *  anything at the narrow width, where the two share a slot. */
  offset?: boolean
}

export function ServerUpdating({ offset = false }: Props) {
  const { t } = useI18n()
  return (
    <div
      className={`${styles.banner}${offset ? ` ${styles.offset}` : ''}`}
      role="status"
    >
      <span className={styles.text}>{t.serverUpdatingBanner}</span>
    </div>
  )
}
