import { useState } from 'react'
import { PlayerDTO, ClientMsg, MatchFormat } from '../types/protocol'
import { useI18n } from '../i18n'
import { RulesModal } from './RulesModal'
import { LanguageSwitcher } from './LanguageSwitcher'
import { ThemeToggle } from './ThemeToggle'
import { AudioSettings } from './AudioSettings'
import { seatColor, seatInitial } from './playerColors'
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

// Mirrors the server's serverMinPlayers / serverMaxPlayers (game/room.go). A cap of 1
// is a room that can never start, so the field must not even offer it.
const MIN_PLAYERS = 2
const MAX_PLAYERS = 10

export function WaitingRoom({ roomCode, players, myIndex, matchFormat, maxPlayers, onSend }: Props) {
  const { t } = useI18n()
  const isOwner = myIndex === 0
  const canStart = players.length >= 2
  const [maxInput, setMaxInput] = useState<string>(String(maxPlayers))
  const [showRules, setShowRules] = useState(false)
  const [copied, setCopied] = useState(false)

  // Clipboard is unavailable on insecure origins and in some embedded views;
  // failing silently is correct here — the code stays visible either way.
  const copyCode = () => {
    navigator.clipboard?.writeText(roomCode).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1600)
      },
      () => {},
    )
  }

  const FORMAT_LABEL: Record<MatchFormat, string> = {
    BO1: t.bestOf1,
    BO3: t.bestOf3,
    BO5: t.bestOf5,
    BO7: t.bestOf7,
  }

  const minAllowed = Math.max(MIN_PLAYERS, players.length)

  const handleMaxPlayersChange = (val: string) => {
    setMaxInput(val)
    const n = parseInt(val, 10)
    if (!isNaN(n) && n >= minAllowed && n <= MAX_PLAYERS) {
      onSend({ type: 'set_max_players', max_players: n })
    }
  }

  // Typing an out-of-range value leaves the field showing something the server never
  // accepted; snapping back on blur is what tells the host the change did not take.
  const handleMaxPlayersBlur = () => {
    const n = parseInt(maxInput, 10)
    if (isNaN(n) || n < minAllowed || n > MAX_PLAYERS) setMaxInput(String(maxPlayers))
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

      <h2 className={styles.heading}>{t.waitingRoom}</h2>
      {/* Tap-to-copy: this code gets read out loud and pasted into chat, so
          copying it should never mean selecting six characters by hand. */}
      <button className={styles.code} onClick={copyCode} aria-label={`${t.roomCode} ${roomCode}`}>
        <span className={copied ? styles.copied : undefined}>{copied ? t.copyCode : t.roomCode}</span>
        <span className={styles.codeVal}>{roomCode}</span>
      </button>
      <p className={styles.hint}>{t.shareCode}</p>

      <ul className={styles.playerList}>
        {players.map((p) => (
          <li key={p.index} className={styles.player}>
            <span className={styles.playerMain}>
              <span className={styles.avatar} style={{ background: seatColor(p.index) }} aria-hidden>
                {seatInitial(p.nickname)}
              </span>
              <span className={`${styles.playerName} ${p.index === myIndex ? styles.you : ''}`}>
                {p.nickname}
              </span>
            </span>
            {p.index === 0 && <span className={styles.owner}>{t.hostBadge}</span>}
          </li>
        ))}
      </ul>

      {isOwner && (
        <div className={styles.hostConfig}>
          <div className={styles.configRow}>
            <label className={styles.configLabel}>{t.matchFormat}</label>
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
            <label className={styles.configLabel}>{t.maxPlayersLabel}</label>
            <input
              type="number"
              min={minAllowed}
              max={MAX_PLAYERS}
              value={maxInput}
              onChange={(e) => handleMaxPlayersChange(e.target.value)}
              onBlur={handleMaxPlayersBlur}
              className={styles.maxInput}
            />
          </div>
        </div>
      )}

      {!isOwner && (
        <div className={styles.configDisplay}>
          <span>{t.matchFormat}: <strong>{FORMAT_LABEL[matchFormat]}</strong></span>
          <span>{t.maxPlayersLabel}: <strong>{maxPlayers}</strong></span>
        </div>
      )}

      {isOwner && (
        <div className={styles.hostActions}>
          <button
            className={styles.btnSecondary}
            disabled={players.length >= maxPlayers}
            onClick={() => onSend({ type: 'add_bot' })}
          >
            {t.addBot}
          </button>
          <button
            className={styles.btn}
            disabled={!canStart}
            onClick={() => onSend({ type: 'start_game' })}
          >
            {canStart ? t.startGame : t.waitingForPlayers}
          </button>
        </div>
      )}
      {!isOwner && (
        <p className={styles.waitingMsg}>{t.waitingForHost}</p>
      )}

      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
    </div>
  )
}
