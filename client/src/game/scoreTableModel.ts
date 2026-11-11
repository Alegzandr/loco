/**
 * Pure model behind the in-game score table: merging the roster, the
 * scoreboard, the round history and the latest pings, and banding a round trip
 * into a colour tier. Kept out of the component so both are unit-tested
 * directly, the way layout.ts sits beside the card renderer.
 */
import type { LatencyEntryDTO, PlayerDTO, ScoreboardEntryDTO } from '../types/protocol'

/** One rendered row: everything the table shows about a seat, already merged. */
export interface ScoreRow {
  index: number
  nickname: string
  connected: boolean
  /** Points scored in each finished round, oldest first. */
  perRound: number[]
  total: number
  wins: number
  /** Round trip in ms, or null when the server has nothing to report. */
  rtt: number | null
  bot: boolean
}

export type PingTier = 'good' | 'ok' | 'poor' | 'bad' | 'unknown'

/**
 * Ping thresholds, in milliseconds. LOCO is a reaction game, an interrupt is
 * decided by arrival order at the server, so the bands are tighter than a
 * turn-based game would need: at 200ms a player is losing races they saw first.
 */
const PING_GOOD = 60
const PING_OK = 120
const PING_POOR = 220

export function pingTier(rtt: number | null | undefined): PingTier {
  // The server sends -1 for "not measured yet" (a bot, or a connection that has
  // not answered a ping frame). Rendering that as 0ms would be a flattering lie.
  if (rtt === null || rtt === undefined || rtt < 0) return 'unknown'
  if (rtt < PING_GOOD) return 'good'
  if (rtt < PING_OK) return 'ok'
  if (rtt < PING_POOR) return 'poor'
  return 'bad'
}

/**
 * Merges the roster, the cumulative scoreboard, the per-round history and the
 * latest ping broadcast into display rows, leader first.
 *
 * Pure and exported so the sort and the merge are unit-tested rather than
 * inferred from a screenshot. The roster is the source of truth for which rows
 * exist: the scoreboard and the latency broadcast can each be a beat behind it.
 */
export function buildScoreRows(
  players: PlayerDTO[],
  scoreboard: ScoreboardEntryDTO[],
  roundHistory: number[][],
  latencies: LatencyEntryDTO[],
): ScoreRow[] {
  const rows = players.map((p) => {
    const entry = scoreboard.find((s) => s.player_index === p.index)
    const ping = latencies.find((l) => l.player_index === p.index)
    return {
      index: p.index,
      nickname: p.nickname,
      connected: p.connected,
      perRound: roundHistory.map((round) => round[p.index] ?? 0),
      total: entry?.score ?? 0,
      wins: entry?.rounds_won ?? 0,
      rtt: ping && ping.rtt_ms >= 0 ? ping.rtt_ms : null,
      // The roster answers this, and it has to: the latency broadcast is held
      // back until a human has answered a ping, so a table read in the first
      // seconds of a match knows nothing about who is a bot. Labelling that
      // seat off the pings left it saying "no ping" for six seconds, which
      // reads as a connection nobody can measure rather than as a bot. The
      // broadcast's own flag is kept as the second source: it is the same
      // answer, a beat later.
      bot: p.is_bot === true || ping?.bot === true,
    }
  })
  // Most rounds won first, then points, then seat order — the same ordering the
  // match tiebreakers use, so the table never contradicts the final standings.
  // It used to lead on points, which is what the match used to be decided on;
  // once rounds won took that over, a table sorted on points was telling the
  // player the wrong seat was winning.
  return rows.sort((a, b) => b.wins - a.wins || b.total - a.total || a.index - b.index)
}
