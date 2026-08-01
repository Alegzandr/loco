import { CardColor } from '../types/protocol'
import { SUIT_PAINT, SUIT_ANGLE_DEG } from './cards/cardTheme'
import { SuitMark } from './cards/suitMark'
import { useColorAssist } from '../hooks/useColorAssist'
import { useEscapeKey } from '../hooks/useEscapeKey'
import styles from './ColorPicker.module.css'

const WILD_COLORS: CardColor[] = ['red', 'yellow', 'green', 'blue']

interface Props {
  label: string
  /** Accessible name of the ✕. Every way out of this panel says the same thing. */
  cancelLabel: string
  onChoose: (color: CardColor) => void
  onCancel: () => void
}

export function ColorPicker({ label, cancelLabel, onChoose, onCancel }: Props) {
  const assist = useColorAssist()
  // The same way out as the scrim and the ✕: cancelling puts the card back in
  // the hand, so there is nothing here Escape could cost.
  useEscapeKey(true, onCancel)

  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={styles.colorPicker} onClick={(e) => e.stopPropagation()}>
        <p>{label}</p>
        {/* Swatches carry the suit's whole gradient, not a flat sample of it —
            the button and the card it produces are literally the same paint.
            `color` additionally drives the hover glow through currentColor. */}
        <div className={styles.colorBtnRow}>
          {WILD_COLORS.map((col) => (
            <button
              key={col}
              className={styles.colorBtn}
              aria-label={col}
              style={{
                background: `linear-gradient(${SUIT_ANGLE_DEG}deg, ${SUIT_PAINT[col].from}, ${SUIT_PAINT[col].to})`,
                color: SUIT_PAINT[col].from,
              }}
              onClick={() => onChoose(col)}
            >
              {/* Four swatches that differ only in hue is the one control in
                  the game a colour-blind player cannot use at all. */}
              {assist && <SuitMark color={col} className={styles.suitMark} />}
            </button>
          ))}
        </div>
        <button className={styles.cancelBtn} onClick={onCancel} aria-label={cancelLabel}>
          ✕
        </button>
      </div>
    </div>
  )
}
