import { Translations } from '../i18n/en'
import styles from './ActionBar.module.css'

interface Props {
  isMyTurn: boolean
  pendingDraw: number
  handSize: number
  hasDrawn: boolean
  hasPlayableCard: boolean
  // True while another player sits on a single card without having called it.
  // Driven by the catch window, not by uno_declared — a declaration is exactly
  // the moment catching stops being possible.
  canCatch: boolean
  onDraw: () => void
  onPass: () => void
  onUno: () => void
  onCatch: () => void
  t: Translations
}

export function ActionBar({
  isMyTurn,
  pendingDraw,
  handSize,
  hasDrawn,
  hasPlayableCard,
  canCatch,
  onDraw,
  onPass,
  onUno,
  onCatch,
  t,
}: Props) {
  return (
    <div className={styles.actionBar}>
      {isMyTurn && pendingDraw > 0 && (
        <button className={`${styles.btn} ${styles.btnPenalty}`} onClick={onDraw}>
          {t.draw} +{pendingDraw}
        </button>
      )}

      {isMyTurn && pendingDraw === 0 && (
        <>
          <button
            className={`${styles.btn} ${hasDrawn ? styles.btnDisabled : hasPlayableCard ? styles.btnDrawSecondary : styles.btnDraw}`}
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

      <button
        className={`${styles.btn} ${styles.btnUno}`}
        onClick={onUno}
        disabled={handSize !== 1}
      >
        {t.unoBtn}
      </button>

      {canCatch && (
        <button className={`${styles.btn} ${styles.btnCatch}`} onClick={onCatch}>
          {t.catchBtn}
        </button>
      )}
    </div>
  )
}
