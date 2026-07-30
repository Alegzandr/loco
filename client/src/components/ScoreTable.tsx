import { LatencyEntryDTO, PlayerDTO, ScoreboardEntryDTO } from '../types/protocol'
import { buildScoreRows, pingTier } from './scoreTableModel'
import { Translations } from '../i18n/en'
import { seatColor } from './playerColors'
import styles from './ScoreTable.module.css'

interface Props {
  players: PlayerDTO[]
  scoreboard: ScoreboardEntryDTO[]
  roundHistory: number[][]
  latencies: LatencyEntryDTO[]
  myIndex: number
  t: Translations
  /** Tap-outside handler, only wired up when the table is pinned by the button. */
  onDismiss?: () => void
}

/**
 * In-game standings, held open with TAB (or pinned with the touch button).
 *
 * Read-only and non-interactive by design: it is consulted mid-round, often
 * while it is somebody else's turn and the player is about to interrupt, so
 * nothing here may take a click that was meant for a card.
 */
export function ScoreTable({
  players,
  scoreboard,
  roundHistory,
  latencies,
  myIndex,
  t,
  onDismiss,
}: Props) {
  const rows = buildScoreRows(players, scoreboard, roundHistory, latencies)

  return (
    <div className={styles.overlay} onPointerDown={onDismiss} data-testid="score-table">
      <div className={styles.card} onPointerDown={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>{t.scoreTableTitle}</h2>
          <span className={styles.hint}>{t.scoreTableHint}</span>
        </div>

        <div className={styles.scroller}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.thPlayer}>{t.player}</th>
                {roundHistory.map((_, i) => (
                  <th key={i} className={styles.thRound}>
                    {t.scoreTableRoundCol.replace('%n', String(i + 1))}
                  </th>
                ))}
                <th className={styles.thNum}>{t.totalLabel}</th>
                <th className={`${styles.thNum} ${styles.colWins}`}>{t.winsLabel}</th>
                <th className={styles.thPing}>{t.scoreTablePingCol}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const tier = pingTier(row.rtt)
                return (
                  <tr
                    key={row.index}
                    className={`${styles.row}${row.index === myIndex ? ' ' + styles.rowMe : ''}${
                      row.connected ? '' : ' ' + styles.rowOffline
                    }`}
                  >
                    {/* The flex box is an inner div: a display:flex <td> drops
                        out of the table's column sizing and the row splits in
                        two. */}
                    <td className={styles.tdPlayer}>
                      <div className={styles.playerCell}>
                        <span className={styles.dot} style={{ background: seatColor(row.index) }} />
                        <span className={styles.nickname}>{row.nickname}</span>
                        {row.index === myIndex && (
                          <span className={styles.you}>{t.scoreTableYou}</span>
                        )}
                      </div>
                    </td>
                    {row.perRound.map((points, i) => (
                      <td key={i} className={styles.tdRound}>
                        {points > 0 ? `+${points}` : '·'}
                      </td>
                    ))}
                    <td className={styles.tdTotal}>{row.total}</td>
                    <td className={`${styles.tdNum} ${styles.colWins}`}>{row.wins}</td>
                    <td className={styles.tdPing}>
                      <span className={styles.ping} data-tier={tier}>
                        {row.bot
                          ? t.scoreTableBot
                          : tier === 'unknown'
                            ? t.scoreTableNoPing
                            : `${row.rtt} ms`}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* A note under the table, never a column header: the sentence is far
            wider than the 40px a round column gets, and as a nowrap <th> it
            stretched the whole table past the card and pushed the ping off the
            right edge of a phone. */}
        {roundHistory.length === 0 && (
          <p className={styles.note}>{t.scoreTableEmptyRounds}</p>
        )}
      </div>
    </div>
  )
}
