import { useEffect, useState } from 'react'
import { PlayerDTO, ClientMsg, MatchFormat } from '../types/protocol'
import { useI18n } from '../i18n'
import { RulesButton } from './RulesButton'
import { RulesModal } from './RulesModal'
import { Preferences } from './Preferences'
import { TableCode } from './TableCode'
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
  onLeave: () => void
  /** Showcase only: mounts straight into the confirmation, which is otherwise
   *  component-local state no scene could reach. Same trick as Lobby's
   *  `initialMode`. */
  initialConfirmLeave?: boolean
}

const MATCH_FORMATS: MatchFormat[] = ['BO1', 'BO3', 'BO5', 'BO7']

// Drawn, not a glyph: a `×` is a different object on every platform and lands
// somewhere between a multiplication sign and a letter. Same rule as the
// preference icons.
function KickIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden focusable="false">
      <path
        d="M6 6 L18 18 M18 6 L6 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  )
}

// Mirrors the server's serverMinPlayers / serverMaxPlayers (game/room.go). A cap of 1
// is a room that can never start, so the field must not even offer it.
const MIN_PLAYERS = 2
const MAX_PLAYERS = 10

export function WaitingRoom({
  roomCode,
  players,
  myIndex,
  matchFormat,
  maxPlayers,
  onSend,
  onLeave,
  initialConfirmLeave = false,
}: Props) {
  const { t } = useI18n()
  const isOwner = myIndex === 0
  const canStart = players.length >= 2
  const [maxInput, setMaxInput] = useState<string>(String(maxPlayers))
  const [showRules, setShowRules] = useState(false)
  const [copied, setCopied] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(initialConfirmLeave)

  // Escape backs out of the question, like every other dismissible thing here.
  // Bound while the question is up and only then: a listener that outlives it
  // would swallow the key from whatever comes next.
  useEffect(() => {
    if (!confirmLeave) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConfirmLeave(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirmLeave])

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
        <Preferences />
        <AudioSettings />
        <RulesButton label={t.rulesBtn} onClick={() => setShowRules(true)} />
      </div>

      <h2 className={styles.heading}>{t.waitingRoom}</h2>
      {/* Tap-to-copy: this code gets read out loud and pasted into chat, so
          copying it should never mean selecting six characters by hand. */}
      <button className={styles.code} onClick={copyCode} aria-label={`${t.roomCode} ${roomCode}`}>
        <span className={copied ? styles.copied : undefined}>{copied ? t.copyCode : t.roomCode}</span>
        <TableCode code={roomCode} className={styles.codeVal} />
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
            {/* The host's control over one row. Never on their own: giving up
                the seat you are sitting in is the link at the bottom, and a
                kick that could do it would hand the table away silently.

                No confirmation, deliberately: this table's one question is the
                one about leaving, and unlike leaving a mistake here costs
                nothing — the code is still in the removed player's hands and
                they sit back down. */}
            {isOwner && p.index !== myIndex && (
              <button
                className={styles.kick}
                aria-label={`${t.kickPlayer}: ${p.nickname}`}
                title={t.kickPlayer}
                onClick={() => onSend({ type: 'kick_player', target_index: p.index })}
              >
                <KickIcon />
              </button>
            )}
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

      {/* Nothing has been dealt yet, so leaving is free: the server frees the seat
          on the spot instead of holding it 60s the way a closed tab would. Kept
          quiet on purpose — it must never compete with Start.

          It still asks first: the press is one-way, and on this screen it also
          costs the table code, which a guest has no way to get back. The question
          takes the link's place rather than opening over it, so the answer is
          where the finger already is and nothing else on the screen moves. */}
      {confirmLeave ? (
        <div className={styles.leaveConfirm}>
          <p className={styles.leaveConfirmMsg}>{t.leaveConfirm}</p>
          <div className={styles.leaveConfirmBtns}>
            {/* Staying comes first and is the solid one: the safe answer should
                be the easy one to hit. */}
            <button
              className={styles.leaveStay}
              onClick={() => setConfirmLeave(false)}
              autoFocus
            >
              {t.leaveConfirmStay}
            </button>
            <button className={styles.leaveGo} onClick={onLeave}>
              {t.leaveConfirmYes}
            </button>
          </div>
        </div>
      ) : (
        <button className={styles.leaveBtn} onClick={() => setConfirmLeave(true)}>
          {t.leaveRoom}
        </button>
      )}

      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
    </div>
  )
}
