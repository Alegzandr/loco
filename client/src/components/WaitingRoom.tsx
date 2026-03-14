import { useState } from 'react'
import { PlayerDTO, ClientMsg, MatchFormat } from '../types/protocol'
import styles from './WaitingRoom.module.css'

interface Props {
  roomCode: string
  players: PlayerDTO[]
  myIndex: number
  matchFormat: MatchFormat
  maxPlayers: number
  onSend: (msg: ClientMsg) => void
}

const MATCH_FORMATS: MatchFormat[] = ['BO1', 'BO3', 'BO5', 'BO7']
const FORMAT_LABEL: Record<MatchFormat, string> = {
  BO1: 'Best of 1',
  BO3: 'Best of 3',
  BO5: 'Best of 5',
  BO7: 'Best of 7',
}

export function WaitingRoom({ roomCode, players, myIndex, matchFormat, maxPlayers, onSend }: Props) {
  const isOwner = myIndex === 0
  const canStart = players.length >= 2
  const [maxInput, setMaxInput] = useState<string>(String(maxPlayers))

  const handleMaxPlayersChange = (val: string) => {
    setMaxInput(val)
    const n = parseInt(val, 10)
    if (!isNaN(n) && n >= 2 && n <= 10) {
      onSend({ type: 'set_max_players', max_players: n })
    }
  }

  return (
    <div className={styles.container}>
      <h2 className={styles.heading}>Waiting Room</h2>
      <div className={styles.code}>
        Room Code: <span className={styles.codeVal}>{roomCode}</span>
      </div>
      <p className={styles.hint}>Share this code with friends!</p>

      <ul className={styles.playerList}>
        {players.map((p) => (
          <li key={p.index} className={styles.player}>
            <span className={p.index === myIndex ? styles.you : ''}>
              {p.nickname}
            </span>
            {p.index === 0 && <span className={styles.owner}>Host</span>}
          </li>
        ))}
      </ul>

      {isOwner && (
        <div className={styles.hostConfig}>
          <div className={styles.configRow}>
            <label className={styles.configLabel}>Match Format</label>
            <div className={styles.formatBtns}>
              {MATCH_FORMATS.map((f) => (
                <button
                  key={f}
                  className={`${styles.formatBtn} ${matchFormat === f ? styles.formatBtnActive : ''}`}
                  onClick={() => onSend({ type: 'set_match_format', match_format: f })}
                >
                  {FORMAT_LABEL[f]}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.configRow}>
            <label className={styles.configLabel}>Max Players</label>
            <input
              type="number"
              min={players.length}
              max={10}
              value={maxInput}
              onChange={(e) => handleMaxPlayersChange(e.target.value)}
              className={styles.maxInput}
            />
          </div>
        </div>
      )}

      {!isOwner && (
        <div className={styles.configDisplay}>
          <span>Format: <strong>{FORMAT_LABEL[matchFormat]}</strong></span>
          <span>Max Players: <strong>{maxPlayers}</strong></span>
        </div>
      )}

      {isOwner && (
        <div className={styles.hostActions}>
          <button
            className={styles.btnSecondary}
            disabled={players.length >= maxPlayers}
            onClick={() => onSend({ type: 'add_bot' })}
          >
            + Add Bot
          </button>
          <button
            className={styles.btn}
            disabled={!canStart}
            onClick={() => onSend({ type: 'start_game' })}
          >
            {canStart ? 'Start Game' : 'Waiting for players…'}
          </button>
        </div>
      )}
      {!isOwner && (
        <p className={styles.waitingMsg}>Waiting for host to start…</p>
      )}
    </div>
  )
}
