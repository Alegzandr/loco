import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { ScoreTable } from '../components/ScoreTable'
import { buildScoreRows, pingTier } from '../components/scoreTableModel'
import { en } from '../i18n/en'
import type { LatencyEntryDTO, PlayerDTO, ScoreboardEntryDTO } from '../types/protocol'

const players: PlayerDTO[] = [
  { index: 0, nickname: 'alice', hand_size: 4, connected: true },
  { index: 1, nickname: 'bob', hand_size: 7, connected: true },
  { index: 2, nickname: 'Bot1', hand_size: 2, connected: true },
]

const scoreboard: ScoreboardEntryDTO[] = [
  { player_index: 0, nickname: 'alice', score: 30, rounds_won: 1 },
  { player_index: 1, nickname: 'bob', score: 90, rounds_won: 1 },
  { player_index: 2, nickname: 'Bot1', score: 0, rounds_won: 0 },
]

// Only the finisher scores, so exactly one column per row is non-zero.
const roundHistory = [
  [30, 0, 0],
  [0, 90, 0],
]

const latencies: LatencyEntryDTO[] = [
  { player_index: 0, rtt_ms: 42 },
  { player_index: 1, rtt_ms: -1 },
  { player_index: 2, rtt_ms: -1, bot: true },
]

describe('pingTier', () => {
  it('bands a round trip by how much it costs in a race', () => {
    expect(pingTier(12)).toBe('good')
    expect(pingTier(59)).toBe('good')
    expect(pingTier(60)).toBe('ok')
    expect(pingTier(119)).toBe('ok')
    expect(pingTier(120)).toBe('poor')
    expect(pingTier(219)).toBe('poor')
    expect(pingTier(220)).toBe('bad')
    expect(pingTier(4000)).toBe('bad')
  })

  it('treats an unmeasured seat as unknown rather than as a perfect 0ms', () => {
    expect(pingTier(null)).toBe('unknown')
    expect(pingTier(undefined)).toBe('unknown')
    expect(pingTier(-1)).toBe('unknown')
  })
})

describe('buildScoreRows', () => {
  it('orders by score, then rounds won, then seat', () => {
    const rows = buildScoreRows(players, scoreboard, roundHistory, latencies)
    expect(rows.map((r) => r.nickname)).toEqual(['bob', 'alice', 'Bot1'])
  })

  it('carries each seat its own column of the history', () => {
    const rows = buildScoreRows(players, scoreboard, roundHistory, latencies)
    const alice = rows.find((r) => r.index === 0)!
    expect(alice.perRound).toEqual([30, 0])
    expect(alice.total).toBe(30)
    expect(alice.wins).toBe(1)
  })

  it('reports an unmeasured ping as null and flags bots', () => {
    const rows = buildScoreRows(players, scoreboard, roundHistory, latencies)
    expect(rows.find((r) => r.index === 0)!.rtt).toBe(42)
    expect(rows.find((r) => r.index === 1)!.rtt).toBeNull()
    expect(rows.find((r) => r.index === 2)!.bot).toBe(true)
  })

  // The roster arrives with game_state; the scoreboard and the latency
  // broadcast can each be a beat behind it, and a missing row is worse than a
  // zero: the player it belongs to disappears from the standings.
  it('keeps a row for a seat the scoreboard and the pings do not know yet', () => {
    const rows = buildScoreRows(players, [], [], [])
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => r.total === 0 && r.rtt === null && !r.bot)).toBe(true)
  })
})

describe('<ScoreTable />', () => {
  it('shows one column per finished round plus the ping of every seat', () => {
    render(
      <ScoreTable
        players={players}
        scoreboard={scoreboard}
        roundHistory={roundHistory}
        latencies={latencies}
        myIndex={0}
        t={en}
      />,
    )
    expect(screen.getByText('R1')).toBeTruthy()
    expect(screen.getByText('R2')).toBeTruthy()
    expect(screen.getByText('42 ms')).toBeTruthy()
    expect(screen.getByText(en.scoreTableBot)).toBeTruthy()
    // bob has no measurement yet, so the cell must not claim a number.
    expect(screen.getByText(en.scoreTableNoPing)).toBeTruthy()
  })

  it('tags the local player row so it can be found at a glance', () => {
    render(
      <ScoreTable
        players={players}
        scoreboard={scoreboard}
        roundHistory={roundHistory}
        latencies={latencies}
        myIndex={1}
        t={en}
      />,
    )
    const row = screen.getByText('bob').closest('tr')!
    expect(within(row).getByText(en.scoreTableYou)).toBeTruthy()
  })

  it('says so instead of showing empty columns before the first round ends', () => {
    render(
      <ScoreTable
        players={players}
        scoreboard={scoreboard}
        roundHistory={[]}
        latencies={latencies}
        myIndex={0}
        t={en}
      />,
    )
    expect(screen.getByText(en.scoreTableEmptyRounds)).toBeTruthy()
    expect(screen.queryByText('R1')).toBeNull()
  })
})
