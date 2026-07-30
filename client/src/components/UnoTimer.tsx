import { RefObject } from 'react'
import styles from './UnoTimer.module.css'

interface Props {
  /** Drained by useDrainBar in <GameView />: this component never re-renders for it. */
  fillRef: RefObject<HTMLDivElement>
  label: string
}

export function UnoTimer({ fillRef, label }: Props) {
  return (
    <div className={styles.unoTimer}>
      <span className={styles.unoTimerLabel}>{label}</span>
      <div className={styles.unoTimerBar}>
        <div ref={fillRef} className={styles.unoTimerFill} />
      </div>
    </div>
  )
}
