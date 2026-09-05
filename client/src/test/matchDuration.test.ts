import { describe, it, expect, vi } from 'vitest'
import { render, screen } from './render'
import GameOver from '../components/GameOver.svelte'
import { formatMatchDuration, lastMatchDurationMs } from '../components/matchDuration'
import { en } from '../i18n/en'
import { fr } from '../i18n/fr'
import type { MatchRecordDTO, PlayerDTO } from '../types/protocol'

const MIN = 60_000

describe('formatMatchDuration', () => {
  // Zero is the server's "cannot say" (a forfeit before the table opened, a
  // snapshot from an older process). Nothing honest can be written over it.
  it('says nothing for a match the server could not time', () => {
    expect(formatMatchDuration(undefined, en)).toBeNull()
    expect(formatMatchDuration(0, en)).toBeNull()
    expect(formatMatchDuration(-5, en)).toBeNull()
    expect(formatMatchDuration(Number.NaN, en)).toBeNull()
  })

  // To the second, units written out: `7:42` reads as a clock, and a player
  // who asked for the seconds gets them at every magnitude.
  it('counts the seconds under a minute, never below one', () => {
    expect(formatMatchDuration(1, en)).toBe('1 s of play')
    expect(formatMatchDuration(400, en)).toBe('1 s of play')
    expect(formatMatchDuration(42_000, en)).toBe('42 s of play')
    expect(formatMatchDuration(59_400, en)).toBe('59 s of play')
  })

  it('rounds to the nearest second and carries into the minute', () => {
    expect(formatMatchDuration(59_600, en)).toBe('1 min 00 s of play')
    expect(formatMatchDuration(MIN, en)).toBe('1 min 00 s of play')
    expect(formatMatchDuration(12 * MIN + 29_400, en)).toBe('12 min 29 s of play')
    expect(formatMatchDuration(12 * MIN + 30_600, en)).toBe('12 min 31 s of play')
  })

  it('turns to hours at sixty minutes, minutes and seconds padded', () => {
    expect(formatMatchDuration(59 * MIN + 59_600, en)).toBe('1 h 00 min 00 s of play')
    expect(formatMatchDuration(65 * MIN + 12_000, en)).toBe('1 h 05 min 12 s of play')
    expect(formatMatchDuration(150 * MIN + 7_000, en)).toBe('2 h 30 min 07 s of play')
  })

  it('is written in French too', () => {
    expect(formatMatchDuration(30_000, fr)).toBe('30 s de jeu')
    expect(formatMatchDuration(12 * MIN + 34_000, fr)).toBe('12 min 34 s de jeu')
    expect(formatMatchDuration(65 * MIN + 12_000, fr)).toBe('1 h 05 min 12 s de jeu')
  })
})

describe('lastMatchDurationMs', () => {
  // The server records the match before it announces it, so the last record
  // in match_end is always the match that just ended.
  it('reads the match that just ended, which is the last record', () => {
    const history: MatchRecordDTO[] = [
      { rounds_won: [1, 0], scores: [30, 0], winner_index: 0, duration_ms: 5 * MIN },
      { rounds_won: [0, 1], scores: [0, 40], winner_index: 1, duration_ms: 9 * MIN },
    ]
    expect(lastMatchDurationMs(history)).toBe(9 * MIN)
    expect(lastMatchDurationMs([])).toBeUndefined()
  })
})

describe('<GameOver /> duration line', () => {
  const players: PlayerDTO[] = [
    { index: 0, nickname: 'Alice', hand_size: 0, connected: true },
    { index: 1, nickname: 'Bob', hand_size: 3, connected: true },
  ]
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

  it('says how long the match took, off the last record', () => {
    render(GameOver, {
      ...base,
      matchHistory: [{ rounds_won: [2, 1], scores: [80, 40], winner_index: 0, duration_ms: 12 * MIN }],
    })
    expect(screen.getByText(en.matchDuration(en.durationMinutes(12, 0)))).toBeTruthy()
  })

  // A forfeit is a match end too, and the line sits under it without changing
  // what the heading says.
  it('is there under a forfeit as well', () => {
    render(GameOver, {
      ...base,
      forfeitBy: 0,
      forfeitedByMe: false,
      matchHistory: [{ rounds_won: [0, 0], scores: [0, 0], winner_index: 1, duration_ms: 3 * MIN }],
    })
    expect(screen.getByText(en.forfeitWon)).toBeTruthy()
    expect(screen.getByText(en.matchDuration(en.durationMinutes(3, 0)))).toBeTruthy()
  })

  it('draws no line when the server sent no duration', () => {
    render(GameOver, {
      ...base,
      matchHistory: [{ rounds_won: [2, 1], scores: [80, 40], winner_index: 0 }],
    })
    expect(document.querySelector('.duration')).toBeNull()
  })
})
