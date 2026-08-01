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
  /** This match came out of the 1v1 queue: no rematch, another opponent instead. */
  isMatchmade?: boolean
  /** The seat that abandoned, or null when the match ended on the cards. */
  forfeitBy?: number | null
  /** Our own seat, so we know which side of a forfeit we are on. */
  mySeat?: number
  /** Seats that have asked for another match (matchmade only). */
  rematchOffers?: number[]
  onSend: (msg: ClientMsg) => void
  /** Ask the opponent for another match (matchmade only). */
  onRematch: () => void
  /** Back into the queue for another opponent (matchmade matches only). */
  onFindMatch: () => void
  /** Give the seat up and go back to the home screen. */
  onLeave: () => void
}

export function GameOver({
  winner,
  myNickname,
  scoreboard,
  matchOver,
  isHost,
  isMatchmade,
  forfeitBy,
  mySeat,
  rematchOffers = [],
  onSend,
  onRematch,
  onFindMatch,
  onLeave,
}: Props) {
  const { t } = useI18n()
  const isWinner = winner === myNickname
  // A forfeit is not a victory and this screen must not pretend otherwise: no
  // confetti, no trophy, and a heading that says what actually happened. The
  // player who left is told plainly that they left, which is the honest reading
  // of a match they ended themselves.
  const isForfeit = typeof forfeitBy === 'number' && forfeitBy >= 0
  const iForfeited = isForfeit && forfeitBy === mySeat
  const iOffered = typeof mySeat === 'number' && rematchOffers.includes(mySeat)
  const theyOffered = rematchOffers.some((seat) => seat !== mySeat)

  return (
    <div className={styles.container}>
      {/* Only the winner gets confetti — a losing screen that celebrates is a
          worse experience than a quiet one, and a walkover is not something to
          throw paper over either. */}
      {isWinner && !isForfeit && <Confetti />}
      <div className={styles.card}>
        <div className={styles.emoji}>
          {isForfeit ? (iForfeited ? '🚪' : '🏳️') : isWinner ? '🏆' : '😔'}
        </div>
        <h2 className={styles.heading}>
          {isForfeit
            ? (iForfeited ? t.forfeitYouLeft : t.forfeitWon)
            : matchOver
              ? (isWinner ? t.matchWon : t.gameOver)
              : (isWinner ? t.youWin : t.gameOver)}
        </h2>
        {isForfeit ? (
          <p className={styles.sub}>{iForfeited ? t.forfeitYouLeftSub : t.forfeitWonSub}</p>
        ) : (
          !isWinner && <p className={styles.sub}>{winner} {matchOver ? t.winsMatch : t.winsGame}</p>
        )}

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

        {isMatchmade ? (
          /* A rematch here is an agreement, not a decision: there is no host, and
             the one thing known about the opponent is that they came to play
             somebody. So the button has three states, and the middle one is the
             point of the whole thing: knowing somebody is waiting on you.
             A forfeit removes the opponent from the room, so it removes the
             offer too and leaves only the next opponent. */
          <>
            {!isForfeit && (
              <button
                className={theyOffered ? styles.btn : styles.btnRematch}
                onClick={onRematch}
                disabled={iOffered}
              >
                {iOffered
                  ? t.rematchWaitingOpponent
                  : theyOffered
                    ? t.rematchAccept
                    : t.rematch}
              </button>
            )}
            <button
              className={isForfeit || theyOffered ? styles.btnSecondary : styles.btn}
              onClick={onFindMatch}
            >
              {t.findAnotherOpponent}
            </button>
          </>
        ) : isHost ? (
          /* Rematch keeps the room, the code and the roster; only the host may
             trigger it. Everyone else waits — the server moves them back to the
             waiting room when it happens. */
          <button className={styles.btn} onClick={() => onSend({ type: 'rematch' })}>
            {t.rematch}
          </button>
        ) : (
          <p className={styles.waiting}>{t.rematchWaiting}</p>
        )}

        <button className={styles.btnSecondary} onClick={onLeave}>
          {t.leaveRoom}
        </button>
      </div>
    </div>
  )
}
