import { PlayerDTO } from '../types/protocol'
import styles from './PlayerPicker.module.css'

interface Props {
  label: string
  players: PlayerDTO[]
  onChoose: (playerIndex: number) => void
  onCancel: () => void
}

export function PlayerPicker({ label, players, onChoose, onCancel }: Props) {
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
              <span className={styles.handSize}>{p.hand_size} cards</span>
            </button>
          ))}
        </div>
        <button className={styles.cancelBtn} onClick={onCancel}>✕</button>
      </div>
    </div>
  )
}
