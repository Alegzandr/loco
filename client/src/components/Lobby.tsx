import { useState } from 'react'
import type { FormEvent } from 'react'
import { ClientMsg } from '../types/protocol'
import { useI18n } from '../i18n'
import { RulesModal } from './RulesModal'
import { LanguageSwitcher } from './LanguageSwitcher'
import styles from './Lobby.module.css'

interface Props {
  onSend: (msg: ClientMsg) => void
  error: string
  onClearError: () => void
}

export function Lobby({ onSend, error, onClearError }: Props) {
  const { t } = useI18n()
  const [nickname, setNickname] = useState('')
  const [roomCode, setRoomCode] = useState('')
  const [mode, setMode] = useState<'home' | 'create' | 'join'>('home')
  const [showRules, setShowRules] = useState(false)

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
      <div className={styles.topBar}>
        <LanguageSwitcher />
        <button className={styles.rulesLink} onClick={() => setShowRules(true)}>
          {t.rulesBtn}
        </button>
      </div>

      <h1 className={styles.title}>LOCO</h1>
      <p className={styles.tagline}>{t.tagline}</p>

      {error && (
        <div className={styles.error} onClick={onClearError}>
          {error}
        </div>
      )}

      {mode === 'home' && (
        <div className={styles.buttonGroup}>
          <button className={styles.btn} onClick={() => setMode('create')}>
            {t.createRoom}
          </button>
          <button className={styles.btn} onClick={() => setMode('join')}>
            {t.joinRoom}
          </button>
        </div>
      )}

      {mode === 'create' && (
        <form className={styles.form} onSubmit={handleCreate}>
          <input
            className={styles.input}
            placeholder={t.yourNickname}
            value={nickname}
            onChange={(e) => { setNickname(e.target.value); onClearError() }}
            maxLength={20}
            autoFocus
          />
          <button className={styles.btn} type="submit">
            {t.createGame}
          </button>
          <button className={styles.btnSecondary} type="button" onClick={() => setMode('home')}>
            {t.back}
          </button>
        </form>
      )}

      {mode === 'join' && (
        <form className={styles.form} onSubmit={handleJoin}>
          <input
            className={styles.input}
            placeholder={t.yourNickname}
            value={nickname}
            onChange={(e) => { setNickname(e.target.value); onClearError() }}
            maxLength={20}
            autoFocus
          />
          <input
            className={styles.input}
            placeholder={t.roomCodeLabel}
            value={roomCode}
            onChange={(e) => { setRoomCode(e.target.value.toUpperCase()); onClearError() }}
            maxLength={6}
          />
          <button className={styles.btn} type="submit">
            {t.joinGame}
          </button>
          <button className={styles.btnSecondary} type="button" onClick={() => setMode('home')}>
            {t.back}
          </button>
        </form>
      )}

      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
    </div>
  )
}
