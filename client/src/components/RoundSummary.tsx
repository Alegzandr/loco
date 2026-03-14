import { RoundScoreEntry } from '../hooks/useGameStore'
import { ScoreboardEntryDTO, MatchFormat } from '../types/protocol'
import { Translations } from '../i18n/en'
import styles from './RoundSummary.module.css'

function matchFormatRounds(fmt: string): number {
  switch (fmt) {
    case 'BO3': return 3
    case 'BO5': return 5
    case 'BO7': return 7
    default: return 1
  }
}

interface Props {
  roundNumber: number
  roundWinner: string
  roundScores: RoundScoreEntry[]
  scoreboard: ScoreboardEntryDTO[]
  matchFormat: MatchFormat
  summaryCountdown: number
  onDismiss: () => void
  t: Translations
}

export function RoundSummary({ roundNumber, roundWinner, roundScores, scoreboard, matchFormat, summaryCountdown, onDismiss, t }: Props) {
  const matchRoundsNeeded = matchFormatRounds(matchFormat)

  return (
    <div className={styles.roundSummary}>
      <div className={styles.roundSummaryCard}>
        <div className={styles.roundSummaryTitle}>
          {t.round} {roundNumber}
          {matchRoundsNeeded > 1 && ` ${t.of} ${matchRoundsNeeded}`} {t.complete}
        </div>
        <div className={styles.roundSummaryWinner}>
          🏆 {roundWinner} {t.winsRound}
        </div>

        <div className={styles.roundScoreTable}>
          <div className={styles.roundScoreHeader}>
            <span>{t.player}</span>
            <span>{t.ptsLabel}</span>
            <span>{t.totalLabel}</span>
            <span>{t.winsLabel}</span>
          </div>
          {roundScores
            .slice()
            .sort((a, b) => b.cumulative_score - a.cumulative_score)
            .map((entry) => (
              <div
                key={entry.player_index}
                className={`${styles.roundScoreRow} ${entry.nickname === roundWinner ? styles.roundScoreRowWinner : ''}`}
              >
                <span className={styles.roundScoreName}>{entry.nickname}</span>
                <span className={styles.roundScoreDelta}>
                  {entry.round_points > 0 ? `+${entry.round_points}` : '—'}
                </span>
                <span className={styles.roundScoreTotal}>{entry.cumulative_score}</span>
                <span className={styles.roundScoreWins}>{entry.rounds_won}W</span>
              </div>
            ))}
        </div>

        {scoreboard.length > 0 && matchRoundsNeeded > 1 && (
          <div className={styles.matchProgress}>
            <div className={styles.matchProgressTitle}>
              {t.matchScoreboard} — {matchFormat}
            </div>
            <div className={styles.scoreboard}>
              {scoreboard
                .slice()
                .sort((a, b) => b.score - a.score)
                .map((entry) => (
                  <div key={entry.player_index} className={styles.scoreRow}>
                    <span className={styles.scoreName}>{entry.nickname}</span>
                    <span className={styles.scoreVal}>
                      {entry.score} pts · {entry.rounds_won}W
                    </span>
                  </div>
                ))}
            </div>
          </div>
        )}

        <button className={styles.btnContinue} onClick={onDismiss}>
          {t.continueBtn} ({summaryCountdown}s)
        </button>
      </div>
    </div>
  )
}
