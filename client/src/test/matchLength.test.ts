import { describe, it, expect, vi } from 'vitest'
import { render, screen } from './render'
import WaitingRoom from '../components/WaitingRoom.svelte'
import {
  fastestRounds,
  formatRounds,
  matchLength,
  matchLengthLabel,
} from '../components/matchLengthModel'
import { en } from '../i18n/en'
import type { PlayerDTO } from '../types/protocol'

/**
 * What a host is choosing, said where the choice is made.
 *
 * The estimate is a range and not a number, and that is the half worth pinning:
 * a match stops the moment the lead in rounds won cannot be caught, so a best of
 * 7 finishes anywhere between four rounds and seven.
 */

describe('formatRounds / fastestRounds', () => {
  it('knows how long each format can run', () => {
    expect(formatRounds('BO1')).toBe(1)
    expect(formatRounds('BO3')).toBe(3)
    expect(formatRounds('BO5')).toBe(5)
    expect(formatRounds('BO7')).toBe(7)
  })

  it('knows how early each one can stop', () => {
    // The server's rule, stated as arithmetic: a seat takes the match when its
    // rounds won cannot be caught by the rounds left.
    expect(fastestRounds('BO1')).toBe(1)
    expect(fastestRounds('BO3')).toBe(2)
    expect(fastestRounds('BO5')).toBe(3)
    expect(fastestRounds('BO7')).toBe(4)
  })
})

describe('matchLength', () => {
  it('is a single number only where the format cannot end early', () => {
    expect(matchLength('BO1', 4).exact).toBe(true)
    for (const f of ['BO3', 'BO5', 'BO7'] as const) {
      const { minMinutes, maxMinutes, exact } = matchLength(f, 4)
      expect(exact, f).toBe(false)
      expect(maxMinutes, f).toBeGreaterThan(minMinutes)
    }
  })

  it('grows with the table', () => {
    expect(matchLength('BO3', 6).maxMinutes).toBeGreaterThan(matchLength('BO3', 2).maxMinutes)
  })

  it('never estimates a match at zero minutes', () => {
    // "≈ 0 min" reads as broken rather than as fast.
    expect(matchLength('BO1', 2).minMinutes).toBeGreaterThanOrEqual(1)
  })

  it('reads as an estimate, never as a promise', () => {
    expect(matchLengthLabel('BO1', 4, 'min')).toMatch(/^≈ \d+ min$/)
    expect(matchLengthLabel('BO7', 4, 'min')).toMatch(/^≈ \d+-\d+ min$/)
  })
})

describe('<WaitingRoom /> host advice', () => {
  const players: PlayerDTO[] = [
    { index: 0, nickname: 'Alice', hand_size: 0, connected: true },
    { index: 1, nickname: 'Bob', hand_size: 0, connected: true },
  ]

  function renderRoom(myIndex = 0) {
    render(WaitingRoom, {
      roomCode: 'KX7QP2',
      players,
      myIndex,
      matchFormat: 'BO3',
      maxPlayers: 6,
      onSend: vi.fn(),
      onLeave: vi.fn(),
    })
  }

  it('says what each format costs, on the control that sets it', () => {
    renderRoom()
    for (const f of ['BO1', 'BO3', 'BO5', 'BO7'] as const) {
      expect(
        screen.getByText(matchLengthLabel(f, players.length, en.matchLengthUnit)),
        f,
      ).toBeTruthy()
    }
  })

  it('says what a table size costs, under the field that sets it', () => {
    renderRoom()
    expect(screen.getByText(en.maxPlayersHint)).toBeTruthy()
  })

  // The advice belongs to the decision, and a guest is not making it.
  it('says neither to somebody who cannot change either', () => {
    renderRoom(1)
    expect(screen.queryByText(en.maxPlayersHint)).toBeNull()
  })

  // The plate copies a link, and the toast only says so after the press. The
  // chain is what says it before.
  it('draws the chain on the plate, and never as a font character', () => {
    renderRoom()
    const plate = document.querySelector('.code')!
    const icon = plate.querySelector('svg')
    expect(icon, 'the plate must carry a drawn chain').toBeTruthy()
    expect(icon!.getAttribute('aria-hidden')).toBe('true')
    // The button already carries the accessible name; a second one would be a
    // control voice access cannot say.
    expect(plate.getAttribute('aria-label')).toContain('KX7QP2')
  })
})
