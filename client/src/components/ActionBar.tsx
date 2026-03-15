import { Translations } from '../i18n/en'
import styles from './ActionBar.module.css'

interface Props {
  isMyTurn: boolean
  isFinished: boolean
  pendingDraw: number
  handSize: number
  hasDrawn: boolean
  onDraw: () => void
  onPass: () => void
  onUno: () => void
  onCatch: () => void
  onRules: () => void
  t: Translations
}

export function ActionBar({
  isMyTurn,
  isFinished,
  pendingDraw,
  handSize,
  hasDrawn,
  onDraw,
  onPass,
  onUno,
  onCatch,
  onRules,
  t,
}: Props) {
  return (
    <div className={styles.actionBar}>
      {/* Penalty draw button */}
      {isMyTurn && pendingDraw > 0 && (
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

      {/* UNO declaration */}
      <button
        className={`${styles.btn} ${styles.btnUno}`}
        onClick={onUno}
        disabled={handSize !== 1}
      >
        {t.unoBtn}
      </button>

      {/* Catch opponent for not declaring */}
      <button className={`${styles.btn} ${styles.btnCatch}`} onClick={onCatch}>
        {t.catchBtn}
      </button>

      {/* Rules reference */}
      <button className={`${styles.btn} ${styles.btnRules}`} onClick={onRules}>
        {t.rulesBtn}
      </button>
    </div>
  )
}
