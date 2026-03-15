import { Translations } from '../i18n/en'
import styles from './ActionBar.module.css'

interface Props {
  isMyTurn: boolean
  isFinished: boolean
  pendingDraw: number
  handSize: number
  hasDrawn: boolean
  unoTimerEnd: number | null
  onDraw: () => void
  onPass: () => void
  onUno: () => void
  onCatch: () => void
  t: Translations
}

export function ActionBar({
  isMyTurn,
  isFinished,
  pendingDraw,
  handSize,
  hasDrawn,
  unoTimerEnd,
  onDraw,
  onPass,
  onUno,
  onCatch,
  t,
}: Props) {
  return (
    <div className={styles.actionBar}>
      {/* Penalty draw button — only when it's our turn and we're still playing */}
      {isMyTurn && pendingDraw > 0 && !isFinished && (
        <button className={`${styles.btn} ${styles.btnDraw}`} onClick={onDraw}>
          {t.draw} {pendingDraw}
        </button>
      )}

      {/* Normal turn: Draw (disabled after drawing) + Pass (only after drawing) */}
      {isMyTurn && pendingDraw === 0 && !isFinished && (
        <>
          <button
            className={`${styles.btn} ${styles.btnDraw} ${hasDrawn ? styles.btnDisabled : ''}`}
            onClick={onDraw}
            disabled={hasDrawn}
          >
            {t.draw}
          </button>
          <button
            className={`${styles.btn} ${styles.btnPass} ${!hasDrawn ? styles.btnDisabled : ''}`}
            onClick={onPass}
            disabled={!hasDrawn}
          >
            {t.pass}
          </button>
        </>
      )}

      {/* UNO declaration — only while still playing */}
      {!isFinished && (
        <button
          className={`${styles.btn} ${styles.btnUno}`}
          onClick={onUno}
          disabled={handSize !== 1}
        >
          {t.unoBtn}
        </button>
      )}

      {/* Catch opponent — only visible during active UNO catch window */}
      {!isFinished && unoTimerEnd !== null && (
        <button className={`${styles.btn} ${styles.btnCatch}`} onClick={onCatch}>
          {t.catchBtn}
        </button>
      )}
    </div>
  )
}
