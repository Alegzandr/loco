import { Translations } from '../i18n/en'
import styles from './ActionBar.module.css'

interface Props {
  isMyTurn: boolean
  pendingDraw: number
  handSize: number
  onDraw: () => void
  onPass: () => void
  onUno: () => void
  onCatch: () => void
  onRules: () => void
  t: Translations
}

export function ActionBar({ isMyTurn, pendingDraw, handSize, onDraw, onPass, onUno, onCatch, onRules, t }: Props) {
  return (
    <div className={styles.actionBar}>
      {isMyTurn && pendingDraw > 0 && (
        <button className={styles.btnDraw} onClick={onDraw}>
          {t.draw} {pendingDraw}
        </button>
      )}
      {isMyTurn && pendingDraw === 0 && (
        <>
          <button className={styles.btnDraw} onClick={onDraw}>
            {t.draw}
          </button>
          <button className={styles.btnPass} onClick={onPass}>
            {t.pass}
          </button>
        </>
      )}
      <button className={styles.btnUno} onClick={onUno} disabled={handSize !== 1}>
        {t.unoBtn}
      </button>
      <button className={styles.btnCatch} onClick={onCatch}>
        {t.catchBtn}
      </button>
      <button className={styles.btnRules} onClick={onRules}>
        {t.rulesBtn}
      </button>
    </div>
  )
}
