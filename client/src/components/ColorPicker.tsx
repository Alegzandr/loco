import { CardColor } from '../types/protocol'
import { SUIT_PAINT, SUIT_ANGLE_DEG } from './cards/cardTheme'
import styles from './ColorPicker.module.css'

const WILD_COLORS: CardColor[] = ['red', 'yellow', 'green', 'blue']

interface Props {
  label: string
  onChoose: (color: CardColor) => void
  onCancel: () => void
}

export function ColorPicker({ label, onChoose, onCancel }: Props) {
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
            />
          ))}
        </div>
        <button className={styles.cancelBtn} onClick={onCancel}>✕</button>
      </div>
    </div>
  )
}
