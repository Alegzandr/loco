import styles from './UnoTimer.module.css'

interface Props {
  timerPct: number
  label: string
}

export function UnoTimer({ timerPct, label }: Props) {
  return (
    <div className={styles.unoTimer}>
      <span className={styles.unoTimerLabel}>{label}</span>
      <div className={styles.unoTimerBar}>
        <div className={styles.unoTimerFill} style={{ width: `${timerPct}%` }} />
      </div>
    </div>
  )
}
