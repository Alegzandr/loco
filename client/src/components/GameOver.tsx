import { ScoreboardEntryDTO } from '../types/protocol'
import styles from './GameOver.module.css'

interface Props {
  winner: string
  myNickname: string
  scoreboard?: ScoreboardEntryDTO[]
  matchOver?: boolean
}

export function GameOver({ winner, myNickname, scoreboard, matchOver }: Props) {
  const isWinner = winner === myNickname

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.emoji}>{isWinner ? '🏆' : '😔'}</div>
        <h2 className={styles.heading}>
          {matchOver ? (isWinner ? 'Match Won!' : 'Match Over') : (isWinner ? 'You Win!' : 'Game Over')}
        </h2>
        {!isWinner && <p className={styles.sub}>{winner} wins{matchOver ? ' the match' : ''}!</p>}

        {scoreboard && scoreboard.length > 0 && (
          <div className={styles.scoreboard}>
            <h3 className={styles.scoreboardTitle}>Final Scores</h3>
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

        <button className={styles.btn} onClick={() => window.location.reload()}>
          Play Again
        </button>
      </div>
    </div>
  )
}
