import { CardColor } from '../types/protocol'
import styles from './ColorPicker.module.css'

const WILD_COLORS: CardColor[] = ['red', 'yellow', 'green', 'blue']

function colorHex(c: CardColor): string {
  const map: Record<CardColor, string> = {
    red: '#e74c3c',
    yellow: '#f1c40f',
    green: '#2ecc71',
    blue: '#3498db',
    wild: '#2c3e50',
  }
  return map[c]
}

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
        <div className={styles.colorBtnRow}>
          {WILD_COLORS.map((col) => (
            <button
              key={col}
              className={styles.colorBtn}
              aria-label={col}
              style={{ background: colorHex(col) }}
              onClick={() => onChoose(col)}
            />
          ))}
        </div>
        <button className={styles.cancelBtn} onClick={onCancel}>✕</button>
      </div>
    </div>
  )
}
