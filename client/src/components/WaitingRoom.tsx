import { useState } from 'react'
import { PlayerDTO, ClientMsg, MatchFormat } from '../types/protocol'
import { useI18n } from '../i18n'
import { RulesModal } from './RulesModal'
import { LanguageSwitcher } from './LanguageSwitcher'
import { ThemeToggle } from './ThemeToggle'
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

export function WaitingRoom({ roomCode, players, myIndex, matchFormat, maxPlayers, onSend }: Props) {
  const { t } = useI18n()
  const isOwner = myIndex === 0
  const canStart = players.length >= 2
  const [maxInput, setMaxInput] = useState<string>(String(maxPlayers))
  const [showRules, setShowRules] = useState(false)

  const FORMAT_LABEL: Record<MatchFormat, string> = {
    BO1: t.bestOf1,
    BO3: t.bestOf3,
    BO5: t.bestOf5,
    BO7: t.bestOf7,
  }

  const handleMaxPlayersChange = (val: string) => {
    setMaxInput(val)
    const n = parseInt(val, 10)
    if (!isNaN(n) && n >= 2 && n <= 10) {
      onSend({ type: 'set_max_players', max_players: n })
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.topBar}>
        <LanguageSwitcher />
        <ThemeToggle />
        <button className={styles.rulesLink} onClick={() => setShowRules(true)}>
          {t.rulesBtn}
        </button>
      </div>

      <h2 className={styles.heading}>{t.waitingRoom}</h2>
      <div className={styles.code}>
        {t.roomCode}: <span className={styles.codeVal}>{roomCode}</span>
      </div>
      <p className={styles.hint}>{t.shareCode}</p>

      <ul className={styles.playerList}>
        {players.map((p) => (
          <li key={p.index} className={styles.player}>
            <span className={p.index === myIndex ? styles.you : ''}>
              {p.nickname}
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
