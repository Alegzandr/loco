import { useState } from 'react'
// React 19's types deprecate the FormEvent alias (the DOM event a submit fires
// is a SubmitEvent); SyntheticEvent is the base these handlers actually need.
import type { SyntheticEvent } from 'react'
import { ClientMsg } from '../types/protocol'
import { useI18n } from '../i18n'
import { resolveServerError } from '../i18n/serverErrors'
import { RulesButton } from './RulesButton'
import { RulesModal } from './RulesModal'
import { Preferences } from './Preferences'
import { AudioSettings } from './AudioSettings'
import { LocoLogo } from './LocoLogo'
import { playSfx } from '../audio/sfx'
import { readNickname, rememberNickname } from '../hooks/nicknameMemory'
import { canonicalNickname, isNicknameShapeValid } from './nicknameRules'
import { TABLE_CODE_LENGTH, isTableCodeValid, sanitizeTableCode } from './tableCodeRules'
import styles from './Lobby.module.css'

type LobbyMode = 'home' | 'find' | 'create' | 'join'

interface Props {
  onSend: (msg: ClientMsg) => void
  /** Enters the 1v1 queue. Separate from onSend because the search screen is
   *  entered optimistically, before the server has acknowledged anything. */
  onFindMatch: (nickname: string) => void
  error: string
  onClearError: () => void
  /** Starting sub-screen. Set by the visual showcase, and by a table link,
   *  which opens straight on the join form. */
  initialMode?: LobbyMode
  /** The table code a shared link arrived with. A prefill for the field, not a
   *  submission: the form still refuses to send without a nickname, and the
   *  server still owns the verdict on the code. */
  initialCode?: string
  /** Showcase only: mounts with the preferences panel open. */
  initialPrefsOpen?: boolean
}

export function Lobby({
  onSend,
  onFindMatch,
  error,
  onClearError,
  initialMode = 'home',
  initialCode = '',
  initialPrefsOpen = false,
}: Props) {
  const { t } = useI18n()
  // Read once, at mount: the field is the player's from then on, and re-reading
  // storage would fight whatever they are typing.
  const [nickname, setNickname] = useState(readNickname)
  // Read once, like the nickname: from here on the field belongs to the player,
  // and a link that has been spent must not put its code back.
  const [roomCode, setRoomCode] = useState(() => sanitizeTableCode(initialCode))
  const [mode, setMode] = useState<LobbyMode>(initialMode)
  const [showRules, setShowRules] = useState(false)
  // The shape rules the client can check itself, answered as the player types
  // rather than after a round trip. It says nothing the server would not have
  // said: the same one line, for the same reason (server/game/nickname.go).
  const [nicknameRefused, setNicknameRefused] = useState(false)

  const editNickname = (value: string) => {
    setNickname(value)
    setNicknameRefused(value.trim() !== '' && !isNicknameShapeValid(value))
    onClearError()
  }

  /** Guards every entry point. Returns the form to send, or '' to refuse. */
  const acceptNickname = (): string => {
    if (!isNicknameShapeValid(nickname)) {
      setNicknameRefused(nickname.trim() !== '')
      return ''
    }
    const value = canonicalNickname(nickname)
    rememberNickname(value)
    return value
  }

  // Leaving a sub-screen gets the descending blip; entering one is silent
  // because the screen change is already obvious.
  const goHome = () => {
    playSfx('uiBack')
    setMode('home')
  }

  const handleFind = (e: SyntheticEvent) => {
    e.preventDefault()
    const value = acceptNickname()
    if (!value) return
    onFindMatch(value)
  }

  const handleCreate = (e: SyntheticEvent) => {
    e.preventDefault()
    const value = acceptNickname()
    if (!value) return
    onSend({ type: 'create_room', nickname: value })
  }

  const handleJoin = (e: SyntheticEvent) => {
    e.preventDefault()
    const value = acceptNickname()
    if (!value || !isTableCodeValid(roomCode)) return
    onSend({ type: 'join_room', nickname: value, room_code: sanitizeTableCode(roomCode) })
  }

  return (
    <div className={styles.container}>
      <div className={styles.topBar}>
        {/* The one screen where the gear stands down on a phone: this is the
            only screen the home page's burger is on, and its drawer carries a
            Preferences row already. Everywhere past a taken seat that drawer is
            gone with the footer, so the chip stays at every width there. */}
        <Preferences defaultOpen={initialPrefsOpen} triggerBelowPhone={false} />
        <AudioSettings />
        <RulesButton label={t.rulesBtn} onClick={() => setShowRules(true)} />
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
      {(nicknameRefused || error) && (
        <p className={styles.error} role="alert">
          {nicknameRefused ? t.errors.nicknameRejected : resolveServerError(error, t.errors)}
        </p>
      )}

      {mode === 'home' && (
        <div className={styles.buttonGroup}>
          {/* One player, one button, one opponent. It leads because it is the
              only entry point that needs nobody else to be organised, and it
              carries the game's hue for that reason. The two table buttons
              underneath stay equally weighted between themselves: neither of
              them is a fallback for the other. */}
          <button className={styles.btn} onClick={() => setMode('find')}>
            {t.findMatch}
            <span className={styles.btnHint}>{t.findMatchHint}</span>
          </button>
          <button className={styles.btnAlt} onClick={() => setMode('create')}>
            {t.createRoom}
          </button>
          <button className={styles.btnJoin} onClick={() => setMode('join')}>
            {t.joinRoom}
          </button>
        </div>
      )}

      {mode === 'find' && (
        <form className={styles.form} onSubmit={handleFind}>
          <input
            className={styles.input}
            placeholder={t.yourNickname}
            value={nickname}
            onChange={(e) => editNickname(e.target.value)}
            maxLength={20}
            autoFocus
          />
          <button className={styles.btn} type="submit">
            {t.findMatchGo}
          </button>
          <button className={styles.btnSecondary} type="button" onClick={goHome}>
            {t.back}
          </button>
        </form>
      )}

      {mode === 'create' && (
        <form className={styles.form} onSubmit={handleCreate}>
          <input
            className={styles.input}
            placeholder={t.yourNickname}
            value={nickname}
            onChange={(e) => editNickname(e.target.value)}
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
            onChange={(e) => editNickname(e.target.value)}
            maxLength={20}
            autoFocus={!nickname}
          />
          {/* A returning player already has a name in the field, so the caret
              belongs on the one thing they still have to type. */}
          {/* The field only ever holds a possible code: the alphabet is the
              server's (tableCodeRules.ts), and anything else is dropped as it
              is typed or pasted rather than kept for the server to refuse. */}
          <input
            className={styles.input}
            placeholder={t.roomCodeLabel}
            value={roomCode}
            onChange={(e) => { setRoomCode(sanitizeTableCode(e.target.value)); onClearError() }}
            maxLength={TABLE_CODE_LENGTH}
            autoFocus={!!nickname && !roomCode}
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
          />
          {/* Nothing to take a seat at until the code is whole. The button says
              so instead of sending a request whose only outcome is an error
              line under a form the player has not finished filling in. */}
          <button className={styles.btn} type="submit" disabled={!isTableCodeValid(roomCode)}>
            {t.joinGame}
          </button>
          <button className={styles.btnSecondary} type="button" onClick={goHome}>
            {t.back}
          </button>
        </form>
      )}

      {/* Privacy and terms are not here any more: they are a page, linked at the
          right-hand end of the footer this screen sits above (GamePage.astro).
          A policy has to be linkable, and the entry screen is the one screen
          that footer is visible on anyway. */}

      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
    </div>
  )
}
