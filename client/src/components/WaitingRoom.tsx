import React from 'react'
import { PlayerDTO } from '../types/protocol'
import { ClientMsg } from '../types/protocol'
import styles from './WaitingRoom.module.css'

interface Props {
  roomCode: string
  players: PlayerDTO[]
  myIndex: number
  onSend: (msg: ClientMsg) => void
}

export function WaitingRoom({ roomCode, players, myIndex, onSend }: Props) {
  const isOwner = myIndex === 0
  const canStart = players.length >= 2

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
        <button
          className={styles.btn}
          disabled={!canStart}
          onClick={() => onSend({ type: 'start_game' })}
        >
          {canStart ? 'Start Game' : 'Waiting for players…'}
        </button>
      )}
      {!isOwner && (
        <p className={styles.waitingMsg}>Waiting for host to start…</p>
      )}
    </div>
  )
}
