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
  // Fixed three-column grid: draw left, reaction button centre, pass right. The
  // slots keep their width whether or not they hold a button, so every control
  // sits at the same screen pixel all match long and can be aimed at before it
  // lights up — this is a speed game, and a bar that reflows under the cursor
  // costs a win.
  //
  // The centre column is CATCH's home, and LOCO only borrows it while we are the
  // one on a single card. Catch is by far the hardest button in the game to hit:
  // it opens on someone else's mistake and lives for seconds, so it has to sit —
  // greyed out, but present and in place — on the pixel the player already knows,
  // long before the window opens. LOCO borrows the column at `handSize === 1`
  // because declaring is ours to lose and outranks an opportunity; Catch then
  // floats beside the bar for that rare overlap.
  const locoTurn = handSize === 1

  return (
    <div className={styles.actionBar}>
      <div className={styles.slot} data-slot="left">
        {isMyTurn && pendingDraw > 0 && (
          <button className={`${styles.btn} ${styles.btnPenalty}`} onClick={onDraw}>
            {t.draw} +{pendingDraw}
          </button>
        )}
        {isMyTurn && pendingDraw === 0 && (
          <button
            className={`${styles.btn} ${hasDrawn ? styles.btnDisabled : hasPlayableCard ? styles.btnDrawSecondary : styles.btnDraw}`}
            onClick={onDraw}
            disabled={hasDrawn}
          >
            {t.draw}
          </button>
        )}
      </div>

      <div className={styles.slot} data-slot="center">
        {locoTurn ? (
          // We are on one card: LOCO is live by definition, so it is always armed.
          <button className={`${styles.btn} ${styles.btnUno} ${styles.armed}`} onClick={onUno}>
            {t.unoBtn}
          </button>
        ) : (
          <button
            className={`${styles.btn} ${styles.btnCatch} ${canCatch ? styles.armed : ''}`}
            onClick={onCatch}
            disabled={!canCatch}
          >
            {t.catchBtn}
          </button>
        )}
      </div>

      <div className={styles.slot} data-slot="right">
        {isMyTurn && pendingDraw === 0 && (
          <button
            className={`${styles.btn} ${styles.btnPass} ${!hasDrawn ? styles.btnDisabled : ''}`}
            onClick={onPass}
            disabled={!hasDrawn}
          >
            {t.pass}
          </button>
        )}
      </div>

      {/* Overlap only: we are on one card (so LOCO borrows the centre) AND
          somebody else is catchable. Out of the grid flow entirely, so its
          arrival cannot push the three fixed slots. */}
      {canCatch && locoTurn && (
        <div className={styles.catchSlot} data-slot="float">
          <button className={`${styles.btn} ${styles.btnCatch} ${styles.armed}`} onClick={onCatch}>
            {t.catchBtn}
          </button>
        </div>
      )}
    </div>
  )
}
