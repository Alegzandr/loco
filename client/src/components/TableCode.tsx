import { useI18n } from '../i18n'
import { useStreamerMode } from '../hooks/useStreamerMode'
import styles from './TableCode.module.css'

interface Props {
  code: string
  /** The host screen's own styling for the value. The blur is layered on top of
   *  it rather than replacing it, so the code keeps its size and weight and the
   *  layout does not move when the mode is switched mid-screen. */
  className?: string
}

/**
 * The table code as it is shown on screen.
 *
 * Streamer mode blurs it: six characters on a stream is an open door, and the
 * one place a player is guaranteed to be showing them is the screen they are
 * sitting on while they wait for friends. Nothing is masked in the DOM: the
 * copy button still copies the real code, and hovering or focusing the value
 * clears the blur so the owner can still read it out loud.
 */
export function TableCode({ code, className }: Props) {
  const { t } = useI18n()
  const hidden = useStreamerMode()

  if (!hidden) return <span className={className}>{code}</span>

  return (
    <span
      className={`${className ?? ''} ${styles.hidden}`}
      data-streamer-hidden="true"
      tabIndex={0}
      title={t.prefsCodeHidden}
      aria-label={`${t.prefsCodeHidden} ${code}`}
    >
      {code}
    </span>
  )
}
