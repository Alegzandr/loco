import { useState } from 'react'
import type { FormEvent } from 'react'
import { ClientMsg } from '../types/protocol'
import styles from './Lobby.module.css'

interface Props {
  onSend: (msg: ClientMsg) => void
  error: string
  onClearError: () => void
}

export function Lobby({ onSend, error, onClearError }: Props) {
  const [nickname, setNickname] = useState('')
  const [roomCode, setRoomCode] = useState('')
  const [mode, setMode] = useState<'home' | 'create' | 'join'>('home')

  const handleCreate = (e: FormEvent) => {
    e.preventDefault()
    if (!nickname.trim()) return
    onSend({ type: 'create_room', nickname: nickname.trim() })
  }

  const handleJoin = (e: FormEvent) => {
    e.preventDefault()
    if (!nickname.trim() || !roomCode.trim()) return
    onSend({ type: 'join_room', nickname: nickname.trim(), room_code: roomCode.toUpperCase() })
  }

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>LOCO</h1>
      <p className={styles.tagline}>Real-time multiplayer card game</p>

      {error && (
        <div className={styles.error} onClick={onClearError}>
          {error}
        </div>
      )}

      {mode === 'home' && (
        <div className={styles.buttonGroup}>
          <button className={styles.btn} onClick={() => setMode('create')}>
            Create Room
          </button>
          <button className={styles.btn} onClick={() => setMode('join')}>
            Join Room
          </button>
        </div>
      )}

      {mode === 'create' && (
        <form className={styles.form} onSubmit={handleCreate}>
          <input
            className={styles.input}
            placeholder="Your nickname"
            value={nickname}
            onChange={(e) => { setNickname(e.target.value); onClearError() }}
            maxLength={20}
            autoFocus
          />
          <button className={styles.btn} type="submit">
            Create Game
          </button>
          <button className={styles.btnSecondary} type="button" onClick={() => setMode('home')}>
            Back
          </button>
        </form>
      )}

      {mode === 'join' && (
        <form className={styles.form} onSubmit={handleJoin}>
          <input
            className={styles.input}
            placeholder="Your nickname"
            value={nickname}
            onChange={(e) => { setNickname(e.target.value); onClearError() }}
            maxLength={20}
            autoFocus
          />
          <input
            className={styles.input}
            placeholder="Room code"
            value={roomCode}
            onChange={(e) => { setRoomCode(e.target.value.toUpperCase()); onClearError() }}
            maxLength={4}
          />
          <button className={styles.btn} type="submit">
            Join Game
          </button>
          <button className={styles.btnSecondary} type="button" onClick={() => setMode('home')}>
            Back
          </button>
        </form>
      )}
    </div>
  )
}
