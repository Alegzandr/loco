import { ScoreboardEntryDTO, ClientMsg } from '../types/protocol'
import { useI18n } from '../i18n'
import { Confetti } from './Confetti'
import styles from './GameOver.module.css'

interface Props {
  winner: string
  myNickname: string
  scoreboard?: ScoreboardEntryDTO[]
  matchOver?: boolean
  /** True when this client is the room host (player index 0) — only they can rematch. */
  isHost: boolean
  onSend: (msg: ClientMsg) => void
}

export function GameOver({ winner, myNickname, scoreboard, matchOver, isHost, onSend }: Props) {
  const { t } = useI18n()
  const isWinner = winner === myNickname

  return (
    <div className={styles.container}>
      {/* Only the winner gets confetti — a losing screen that celebrates is a
          worse experience than a quiet one. */}
      {isWinner && <Confetti />}
      <div className={styles.card}>
        <div className={styles.emoji}>{isWinner ? '🏆' : '😔'}</div>
        <h2 className={styles.heading}>
          {matchOver
            ? (isWinner ? t.matchWon : t.gameOver)
            : (isWinner ? t.youWin : t.gameOver)}
        </h2>
        {!isWinner && <p className={styles.sub}>{winner} {matchOver ? t.winsMatch : t.winsGame}</p>}

        {scoreboard && scoreboard.length > 0 && (
          <div className={styles.scoreboard}>
            <h3 className={styles.scoreboardTitle}>{t.finalScores}</h3>
            {scoreboard
              .slice()
              .sort((a, b) => b.score - a.score)
              .map((entry) => (
                <div
                  key={entry.player_index}
                  className={`${styles.scoreRow} ${entry.nickname === winner ? styles.scoreRowWinner : ''}`}
                >
                  <span className={styles.scoreName}>{entry.nickname}</span>
                  <span className={styles.scoreDetails}>
                    <span className={styles.scoreVal}>{entry.score} pts</span>
                    <span className={styles.scoreWins}>{entry.rounds_won}W</span>
                  </span>
                </div>
              ))}
          </div>
        )}

        {/* Rematch keeps the room, the code and the roster; only the host may
            trigger it. Everyone else waits — the server moves them back to the
            waiting room when it happens. */}
        {isHost ? (
          <button className={styles.btn} onClick={() => onSend({ type: 'rematch' })}>
            {t.rematch}
          </button>
        ) : (
          <p className={styles.waiting}>{t.rematchWaiting}</p>
        )}

        <button className={styles.btnSecondary} onClick={() => window.location.reload()}>
          {t.leaveRoom}
        </button>
      </div>
    </div>
  )
}
