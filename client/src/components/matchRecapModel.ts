/**
 * Pure model behind the evening's recap on the game-over screen: the table's
 * finished matches, one column each, folded onto the roster.
 *
 * Kept out of the component the same way `scoreTableModel.ts` is, so the sort
 * and the fold are unit-tested rather than inferred from a screenshot.
 *
 * The recap answers a question the scoreboard above it cannot: a rematch nils
 * the scores, so after six matches on one table nobody could say who had won
 * the evening. Match by match rather than one cumulative number, because the
 * point is seeing *where* it went — a 3–0 sweep and three matches taken on the
 * last round are the same total and not the same evening.
 */
import type { MatchRecordDTO, PlayerDTO } from '../types/protocol'

/** One seat's line in one finished match. */
export interface MatchRecapCell {
  /** Rounds this seat won in that match: what actually decided it. */
  roundsWon: number
  /** Points scored in that match: the gap it was decided by. */
  score: number
  /** This seat took the match. */
  won: boolean
}

/** One rendered row: a seat, its column per match, and its total. */
export interface MatchRecapRow {
  index: number
  nickname: string
  cells: MatchRecapCell[]
  /** Matches taken, which is what the recap is ranked on. */
  matchesWon: number
}

/**
 * Folds the table's finished matches onto the current roster, best evening
 * first.
 *
 * The roster is the source of truth for which rows exist, exactly as in the
 * score table: a record can name a seat that has since left, and the server
 * re-bases the columns when it does. A record shorter than the roster (a player
 * who joined after that match) simply reads as zeros, which is the honest
 * answer — they were not there.
 */
export function buildMatchRecap(
  players: PlayerDTO[],
  history: MatchRecordDTO[],
): MatchRecapRow[] {
  const rows = players.map((p) => {
    const cells = history.map((rec) => ({
      roundsWon: rec.rounds_won[p.index] ?? 0,
      score: rec.scores[p.index] ?? 0,
      won: rec.winner_index === p.index,
    }))
    return {
      index: p.index,
      nickname: p.nickname,
      cells,
      matchesWon: cells.filter((c) => c.won).length,
    }
  })
  // Matches won, then rounds won across the evening, then seat order — the same
  // shape as the match tiebreakers, so the recap never contradicts them.
  return rows.sort(
    (a, b) =>
      b.matchesWon - a.matchesWon ||
      totalRounds(b) - totalRounds(a) ||
      a.index - b.index,
  )
}

function totalRounds(row: MatchRecapRow): number {
  return row.cells.reduce((sum, c) => sum + c.roundsWon, 0)
}

/**
 * Whether the recap is worth drawing at all.
 *
 * One match is one column, and that column is the scoreboard immediately above
 * it said twice. The block only earns its space once the table has rematched.
 */
export function hasEveningToShow(history: MatchRecordDTO[]): boolean {
  return history.length > 1
}
