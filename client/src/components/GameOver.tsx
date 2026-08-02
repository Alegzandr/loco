import { ScoreboardEntryDTO } from '../types/protocol'
import { useI18n } from '../i18n'
import { Confetti } from './Confetti'
import styles from './GameOver.module.css'

interface Props {
  winner: string
  myNickname: string
  scoreboard?: ScoreboardEntryDTO[]
  matchOver?: boolean
  /** This match came out of the 1v1 queue: the next one is another pairing. */
  isMatchmade?: boolean
  /** The seat that abandoned, or null when the match ended on the cards. */
  forfeitBy?: number | null
  /** Our own seat, so we know which side of a forfeit we are on. */
  mySeat?: number
  /** Seats that have asked for another match. */
  rematchOffers?: number[]
  /** How many asks deal it: everybody still at the table. 0 before the first. */
  rematchNeeded?: number
  /** True while somebody else is still at the table to agree with. */
  hasTablemates?: boolean
  /** Ask the table for another match. */
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
  isMatchmade,
  forfeitBy,
  mySeat,
  rematchOffers = [],
  rematchNeeded = 0,
  hasTablemates = true,
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
  // Nobody is asked to agree with an empty table. A matchmade one requeues
  // instead (App does it without being asked); an ordinary one keeps the button
  // in place and disabled, because the table is still there and somebody may
  // still walk back into it.
  const canRematch = !isForfeit && hasTablemates
  // Past two seats "waiting on them" names nobody, and the count is the only
  // thing that says how far off the next match is. At two it would be noise.
  const isTable = rematchNeeded > 2
  const progress = isTable ? ` ${t.rematchProgress(rematchOffers.length, rematchNeeded)}` : ''

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

        {/* A rematch is an agreement, not a decision, and it reads the same at
            every table: ask, wait, accept. The middle state is the point of the
            whole thing, which is why the ask is public: knowing somebody is
            waiting on you is what gets answered. A table nobody is left at
            keeps the button, disabled: the offer is gone, not the room. */}
        <button
          className={theyOffered ? styles.btn : styles.btnRematch}
          onClick={onRematch}
          disabled={iOffered || !canRematch}
        >
          {iOffered
            ? (isTable ? t.rematchWaitingTable : t.rematchWaitingOpponent) + progress
            : theyOffered
              ? t.rematchAccept + progress
              : t.rematch}
        </button>

        {/* Only a matchmade table has a next opponent to offer. */}
        {isMatchmade && (
          <button
            className={isForfeit || theyOffered ? styles.btnSecondary : styles.btn}
            onClick={onFindMatch}
          >
            {t.findAnotherOpponent}
          </button>
        )}

        <button className={styles.btnSecondary} onClick={onLeave}>
          {t.leaveRoom}
        </button>
      </div>
    </div>
  )
}
