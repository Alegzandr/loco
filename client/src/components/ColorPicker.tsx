import { CardColor } from '../types/protocol'
import { CARD_FACE } from './cards/cardTheme'
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
        {/* Swatch colours come from the card palette so the button and the card
            it produces are literally the same colour. `color` additionally
            drives the hover glow through currentColor. */}
        <div className={styles.colorBtnRow}>
          {WILD_COLORS.map((col) => (
            <button
              key={col}
              className={styles.colorBtn}
              aria-label={col}
              style={{ background: CARD_FACE[col], color: CARD_FACE[col] }}
              onClick={() => onChoose(col)}
            />
          ))}
        </div>
        <button className={styles.cancelBtn} onClick={onCancel}>✕</button>
      </div>
    </div>
  )
}
