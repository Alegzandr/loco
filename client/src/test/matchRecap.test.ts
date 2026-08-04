import { describe, it, expect, vi } from 'vitest'
import { render, screen } from './render'
import GameOver from '../components/GameOver.svelte'
import { buildMatchRecap, hasEveningToShow } from '../components/matchRecapModel'
import { en } from '../i18n/en'
import type { MatchRecordDTO, PlayerDTO } from '../types/protocol'

const players: PlayerDTO[] = [
  { index: 0, nickname: 'Alice', hand_size: 0, connected: true },
  { index: 1, nickname: 'Bob', hand_size: 3, connected: true },
  { index: 2, nickname: 'Carol', hand_size: 5, connected: true },
]

// Three matches on one table: Alice took two, Carol one.
const history: MatchRecordDTO[] = [
  { rounds_won: [2, 1, 0], scores: [80, 40, 10], winner_index: 0 },
  { rounds_won: [0, 1, 2], scores: [5, 30, 70], winner_index: 2 },
  { rounds_won: [2, 0, 1], scores: [95, 5, 25], winner_index: 0 },
]

describe('buildMatchRecap', () => {
  it('gives every seat one cell per finished match', () => {
    const rows = buildMatchRecap(players, history)
    const alice = rows.find((r) => r.index === 0)!
    expect(alice.cells).toHaveLength(3)
    expect(alice.cells.map((c) => c.roundsWon)).toEqual([2, 0, 2])
    expect(alice.cells.map((c) => c.score)).toEqual([80, 5, 95])
    expect(alice.cells.map((c) => c.won)).toEqual([true, false, true])
  })

  it('ranks on matches taken, not on points', () => {
    const rows = buildMatchRecap(players, history)
    expect(rows.map((r) => r.nickname)).toEqual(['Alice', 'Carol', 'Bob'])
    expect(rows.map((r) => r.matchesWon)).toEqual([2, 1, 0])
  })

  // A record can be shorter than the roster: somebody joined the table after
  // that match. Zero is the honest answer — they were not there.
  it('reads a seat the record does not cover as zero rather than dropping it', () => {
    const short: MatchRecordDTO[] = [{ rounds_won: [1], scores: [30], winner_index: 0 }]
    const rows = buildMatchRecap(players, short)
    expect(rows).toHaveLength(3)
    const bob = rows.find((r) => r.index === 1)!
    expect(bob.cells[0]).toEqual({ roundsWon: 0, score: 0, won: false })
  })

  // The server sets winner_index to -1 once the seat that took the match has
  // left, and no row may claim it.
  it('credits nobody when the winner has left the table', () => {
    const orphan: MatchRecordDTO[] = [{ rounds_won: [1, 0, 0], scores: [30, 0, 0], winner_index: -1 }]
    const rows = buildMatchRecap(players, orphan)
    expect(rows.every((r) => r.matchesWon === 0)).toBe(true)
  })
})

describe('hasEveningToShow', () => {
  it('is false until the table has rematched', () => {
    expect(hasEveningToShow([])).toBe(false)
    expect(hasEveningToShow(history.slice(0, 1))).toBe(false)
    expect(hasEveningToShow(history.slice(0, 2))).toBe(true)
  })
})

describe('<GameOver /> recap', () => {
  const base = {
    winner: 'Alice',
    myNickname: 'Bob',
    mySeat: 1,
    matchOver: true,
    players,
    onRematch: vi.fn(),
    onFindMatch: vi.fn(),
    onLeave: vi.fn(),
  }

  it('draws one column per match plus the total once there is an evening', () => {
    render(GameOver, { ...base, matchHistory: history })
    expect(screen.getByText(en.recapTitle)).toBeTruthy()
    // Off the token, not off a copy of it: the head is a dense grid's column
    // label and it went from "Match %n" to "M%n" to stop a word sizing the
    // whole table. What is pinned here is that there is one per match.
    expect(screen.getByText(en.recapMatchCol.replace('%n', '1'))).toBeTruthy()
    expect(screen.getByText(en.recapMatchCol.replace('%n', '3'))).toBeTruthy()
    expect(screen.getByText(en.recapWonCol)).toBeTruthy()
  })

  // One column would be the standings immediately above it, said twice.
  it('stays off a table that has not rematched', () => {
    render(GameOver, { ...base, matchHistory: history.slice(0, 1) })
    expect(screen.queryByText(en.recapTitle)).toBeNull()
  })

  // The final standings lead with the rounds, because that is what took the
  // match. The points are beside them as the gap.
  it('states the winner in rounds and the score as the gap', () => {
    render(GameOver, {
      ...base,
      scoreboard: [
        { player_index: 0, nickname: 'Alice', score: 20, rounds_won: 2 },
        { player_index: 1, nickname: 'Bob', score: 500, rounds_won: 1 },
      ],
    })
    expect(screen.getByText(en.roundsWonCount(2))).toBeTruthy()
    expect(screen.getByText('500 pts')).toBeTruthy()
    // Alice took the match on rounds despite being far behind on points, so her
    // row is the one at the top.
    const rows = document.querySelectorAll('.scoreRow')
    expect(rows[0].textContent).toContain('Alice')
  })
})
