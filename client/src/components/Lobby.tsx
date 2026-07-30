import { useState } from 'react'
import type { FormEvent } from 'react'
import { ClientMsg } from '../types/protocol'
import { useI18n } from '../i18n'
import { resolveServerError } from '../i18n/serverErrors'
import { RulesModal } from './RulesModal'
import { LanguageSwitcher } from './LanguageSwitcher'
import { ThemeToggle } from './ThemeToggle'
import { AudioSettings } from './AudioSettings'
import { LocoLogo } from './LocoLogo'
import { playSfx } from '../audio/sfx'
import styles from './Lobby.module.css'

type LobbyMode = 'home' | 'create' | 'join'

interface Props {
  onSend: (msg: ClientMsg) => void
  error: string
  onClearError: () => void
  /** Starting sub-screen. Only set by the visual showcase; the app always starts at 'home'. */
  initialMode?: LobbyMode
}

export function Lobby({ onSend, error, onClearError, initialMode = 'home' }: Props) {
  const { t } = useI18n()
  const [nickname, setNickname] = useState('')
  const [roomCode, setRoomCode] = useState('')
  const [mode, setMode] = useState<LobbyMode>(initialMode)
  const [showRules, setShowRules] = useState(false)

  // Leaving a sub-screen gets the descending blip; entering one is silent
  // because the screen change is already obvious.
  const goHome = () => {
    playSfx('uiBack')
    setMode('home')
  }

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
        <ThemeToggle />
        <AudioSettings />
        <button className={styles.rulesLink} onClick={() => setShowRules(true)}>
          {t.rulesBtn}
        </button>
      </div>

      <h1 className={styles.title}>
        <LocoLogo size="clamp(58px, 11vw, 128px)" animated />
      </h1>
      <p className={styles.tagline}>{t.tagline}</p>

      {/* An alert, not a control: it announces itself to assistive tech and
          clears as soon as the player edits the field it is complaining about,
          so it never needed to be clickable to be dismissible. Styling it as a
          filled pill the same size as the CTA below made it read as a third
          button on the screen. */}
      {error && (
        <p className={styles.error} role="alert">
          {resolveServerError(error, t.errors)}
        </p>
      )}

      {mode === 'home' && (
        <div className={styles.buttonGroup}>
          <button className={styles.btn} onClick={() => setMode('create')}>
            {t.createRoom}
          </button>
          {/* Two equally-valid entry points, so they get two distinct colours
              rather than a primary/secondary pair — neither is a fallback. */}
          <button className={styles.btnAlt} onClick={() => setMode('join')}>
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
          <button className={styles.btnSecondary} type="button" onClick={goHome}>
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
          <button className={styles.btnSecondary} type="button" onClick={goHome}>
            {t.back}
          </button>
        </form>
      )}

      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
    </div>
  )
}
