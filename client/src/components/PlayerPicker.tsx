import { PlayerDTO } from '../types/protocol'
import styles from './PlayerPicker.module.css'

interface Props {
  label: string
  /** Renders a hand size. A function rather than a `%n` template because one
      card is the most consequential size on this screen and reads wrong in
      both languages as "1 cards". */
  cardsLabel: (handSize: number) => string
  players: PlayerDTO[]
  onChoose: (playerIndex: number) => void
  onCancel: () => void
}

export function PlayerPicker({ label, cardsLabel, players, onChoose, onCancel }: Props) {
  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={styles.picker} onClick={(e) => e.stopPropagation()}>
        <p>{label}</p>
        <div className={styles.playerList}>
          {players.map((p) => (
            <button
              key={p.index}
              className={styles.playerBtn}
              onClick={() => onChoose(p.index)}
            >
              {p.nickname}
              <span className={styles.handSize}>{cardsLabel(p.hand_size)}</span>
            </button>
          ))}
        </div>
        <button className={styles.cancelBtn} onClick={onCancel}>✕</button>
      </div>
    </div>
  )
}
