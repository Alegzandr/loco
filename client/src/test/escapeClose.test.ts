import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from './render'
import { en } from '../i18n/en'
import ColorPicker from '../components/ColorPicker.svelte'
import PlayerPicker from '../components/PlayerPicker.svelte'
import ScoreTable from '../components/ScoreTable.svelte'
import AudioSettings from '../components/AudioSettings.svelte'
import type { LatencyEntryDTO, PlayerDTO, ScoreboardEntryDTO } from '../types/protocol'

vi.mock('../audio/sfx', () => ({ playSfx: vi.fn() }))

/**
 * Escape backs out of everything that opened over the board.
 *
 * One key, every dismissible surface: a player who learns it on the rules modal
 * is entitled to it on the colour picker, and two of these had a scrim and a ✕
 * and nothing on the keyboard. RulesModal, Preferences and the waiting room's
 * leave confirmation are covered where they already live (rulesModal /
 * preferences / waitingRoom tests); this file owns the rest and the rule
 * itself.
 */

const players: PlayerDTO[] = [
  { index: 0, nickname: 'alice', hand_size: 4, connected: true },
  { index: 1, nickname: 'bob', hand_size: 7, connected: true },
]

const scoreboard: ScoreboardEntryDTO[] = [
  { player_index: 0, nickname: 'alice', score: 30, rounds_won: 1 },
  { player_index: 1, nickname: 'bob', score: 90, rounds_won: 0 },
]

const latencies: LatencyEntryDTO[] = [
  { player_index: 0, rtt_ms: 42 },
  { player_index: 1, rtt_ms: 51 },
]

function escape() {
  fireEvent.keyDown(document, { key: 'Escape' })
}

// Each panel is opened twice below — once to check Escape closes it, once to
// check it says so on screen — and both halves have to be looking at the same
// panel for the pair to mean anything.
const colorPicker = (onCancel: () => void) => ({
  label: 'pick',
  cancelLabel: en.pickerCancel,
  onChoose: vi.fn(),
  onCancel,
})

const playerPicker = (onCancel: () => void) => ({
  label: 'swap with',
  cardsLabel: (n: number) => `${n}`,
  players,
  cancelLabel: en.pickerCancel,
  onChoose: vi.fn(),
  onCancel,
})

const scoreTable = (onDismiss: (() => void) | undefined) => ({
  players,
  scoreboard,
  roundHistory: [[30, 0]],
  latencies,
  myIndex: 0,
  t: en,
  onDismiss,
})

describe('Escape closes every dismissible surface', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('cancels the wild colour picker', () => {
    const onCancel = vi.fn()
    render(ColorPicker, colorPicker(onCancel))
    escape()
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('cancels the swap target picker', () => {
    const onCancel = vi.fn()
    render(PlayerPicker, playerPicker(onCancel))
    escape()
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('dismisses the score table while it is pinned', () => {
    const onDismiss = vi.fn()
    render(ScoreTable, scoreTable(onDismiss))
    escape()
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('leaves the held-open score table alone', () => {
    // Held with TAB, it goes when the key comes up. Nothing to dismiss, so
    // nothing here may swallow an Escape aimed at whatever else is open.
    const { container } = render(ScoreTable, scoreTable(undefined))
    escape()
    expect(container.querySelector('[data-testid="score-table"]')).toBeInTheDocument()
  })

  it('shuts the audio mixer', () => {
    render(AudioSettings)
    fireEvent.click(screen.getByRole('button', { name: en.audioTitle }))
    expect(screen.getByText(en.audioMaster)).toBeInTheDocument()
    escape()
    expect(screen.queryByText(en.audioMaster)).not.toBeInTheDocument()
  })

  /**
   * Below 46rem the mixer is a sheet over the whole screen and the speaker chip
   * that opened it is behind the scrim, so the ✕ is the entire pressable way
   * out — the same hole `Preferences.svelte` had before it grew one. CSS reveals
   * it at that width and can only reveal something that is in the markup.
   */
  it('gives the mixer its own way out, for the width where the chip is covered', () => {
    render(AudioSettings)
    fireEvent.click(screen.getByRole('button', { name: en.audioTitle }))
    fireEvent.click(screen.getByRole('button', { name: en.audioClose }))
    expect(screen.queryByText(en.audioMaster)).not.toBeInTheDocument()
  })
})

/**
 * Escape is the way out nobody can see, so it is never the only one: a phone
 * has no Escape key, and a panel opened over a scrim has to say how to leave it.
 */
describe('Every panel has a visible way out', () => {
  it('names the ✕ on the wild colour picker', () => {
    const onCancel = vi.fn()
    render(ColorPicker, colorPicker(onCancel))
    fireEvent.click(screen.getByRole('button', { name: en.pickerCancel }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('names the ✕ on the swap target picker', () => {
    const onCancel = vi.fn()
    render(PlayerPicker, playerPicker(onCancel))
    fireEvent.click(screen.getByRole('button', { name: en.pickerCancel }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('gives the pinned score table a ✕, and the held one the TAB hint instead', () => {
    const onDismiss = vi.fn()

    const pinned = render(ScoreTable, scoreTable(onDismiss))
    fireEvent.click(screen.getByRole('button', { name: en.scoreTableClose }))
    expect(onDismiss).toHaveBeenCalledOnce()
    expect(screen.queryByText(en.scoreTableHint)).not.toBeInTheDocument()
    pinned.unmount()

    render(ScoreTable, scoreTable(undefined))
    expect(screen.queryByRole('button', { name: en.scoreTableClose })).not.toBeInTheDocument()
    expect(screen.getByText(en.scoreTableHint)).toBeInTheDocument()
  })
})
