import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from './render'
import GameView from '../components/GameView.svelte'
import { gameStore } from '../hooks/gameStore'
import { en } from '../i18n/en'
import type { PlayerDTO } from '../types/protocol'

/**
 * Leaving a match a table can spare the seat from.
 *
 * Two things are pinned here and they are both refusals: the control is never
 * offered at a table too small to lose a seat, and it is never on the action
 * bar — that bar is a fixed three-column grid so a reaction can be aimed at it,
 * and it must not grow a fourth control.
 */

const seat = (index: number, nickname: string, is_bot = false): PlayerDTO => ({
  index,
  nickname,
  hand_size: 5,
  connected: true,
  ...(is_bot ? { is_bot: true } : {}),
})

function seed(players: PlayerDTO[], patch: Record<string, unknown> = {}) {
  gameStore.getState().resetToHome()
  gameStore.setState({
    screen: 'game',
    myIndex: 0,
    players,
    myHand: [{ color: 'red', kind: 'number', value: 7 }],
    discard: { color: 'red', kind: 'number', value: 5 },
    activeColor: 'red',
    currentTurn: 0,
    roomCode: 'KX7QP2',
    ...patch,
  })
}

function renderView(onLeave = vi.fn()) {
  render(GameView, { onSend: vi.fn(), wsStatus: 'open', onLeave })
  return onLeave
}

describe('walking out of a match', () => {
  beforeEach(() => {
    gameStore.getState().resetToHome()
  })

  it('is offered once three seats would be left', () => {
    seed([seat(0, 'Alice'), seat(1, 'Bob'), seat(2, 'Carol'), seat(3, 'Dave')])
    renderView()
    expect(screen.getByRole('button', { name: en.leaveMatchBtn })).toBeTruthy()
  })

  it('is not offered at a table that cannot spare one', () => {
    seed([seat(0, 'Alice'), seat(1, 'Bob'), seat(2, 'Carol')])
    renderView()
    expect(screen.queryByRole('button', { name: en.leaveMatchBtn })).toBeNull()
  })

  // The floor counts seats that can still act, and a bot can act.
  it('counts bots among the seats that would be left', () => {
    seed([seat(0, 'Alice'), seat(1, 'Bob'), seat(2, 'Bot1', true), seat(3, 'Bot2', true)])
    renderView()
    expect(screen.getByRole('button', { name: en.leaveMatchBtn })).toBeTruthy()
  })

  // Held is not gone. A seat inside its reconnect window is still somebody who
  // may come back, so it still counts; one whose window ran out does not.
  it('stops counting a seat whose reconnect window ran out', () => {
    seed([seat(0, 'Alice'), seat(1, 'Bob'), seat(2, 'Carol'), seat(3, 'Dave')], {
      goneSeats: [3],
    })
    renderView()
    expect(screen.queryByRole('button', { name: en.leaveMatchBtn })).toBeNull()
  })

  // A matchmade 1v1 already answers a player who wants out, with a forfeit; a
  // solo one is a seat and a server.
  it('is never offered in a 1v1 of either kind', () => {
    seed([seat(0, 'Alice'), seat(1, 'Bob'), seat(2, 'Carol'), seat(3, 'Dave')], {
      isMatchmade: true,
    })
    renderView()
    expect(screen.queryByRole('button', { name: en.leaveMatchBtn })).toBeNull()

    seed([seat(0, 'Alice'), seat(1, 'Bob'), seat(2, 'Carol'), seat(3, 'Dave')], { isSolo: true })
    renderView()
    expect(screen.queryByRole('button', { name: en.leaveMatchBtn })).toBeNull()
  })

  it('asks before it acts, and the safe answer backs out', () => {
    seed([seat(0, 'Alice'), seat(1, 'Bob'), seat(2, 'Carol'), seat(3, 'Dave')])
    const onLeave = renderView()

    fireEvent.click(screen.getByRole('button', { name: en.leaveMatchBtn }))
    expect(screen.getByText(en.leaveMatchAsk)).toBeTruthy()
    expect(onLeave).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: en.leaveMatchStay }))
    expect(screen.queryByText(en.leaveMatchAsk)).toBeNull()
    expect(onLeave).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: en.leaveMatchBtn }))
    fireEvent.click(screen.getByRole('button', { name: en.leaveMatchYes }))
    expect(onLeave).toHaveBeenCalled()
  })

  it('backs out on Escape, like everything else that opens over the board', () => {
    seed([seat(0, 'Alice'), seat(1, 'Bob'), seat(2, 'Carol'), seat(3, 'Dave')])
    renderView()
    fireEvent.click(screen.getByRole('button', { name: en.leaveMatchBtn }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText(en.leaveMatchAsk)).toBeNull()
  })

  // The rule this must never break: a reaction game does not move its buttons,
  // and the action bar is the surface a reaction is aimed at.
  it('never puts the control on the action bar', () => {
    seed([seat(0, 'Alice'), seat(1, 'Bob'), seat(2, 'Carol'), seat(3, 'Dave')])
    renderView()
    const bar = document.querySelector('[data-testid="action-bar"]') ?? document.querySelector('.actionBar')
    if (bar) {
      expect(bar.textContent).not.toContain(en.leaveMatchBtn)
      expect(bar.querySelector('[aria-label="' + en.leaveMatchBtn + '"]')).toBeNull()
    }
    // Wherever it is, it is in the chrome row with the gear and the "?".
    const chip = screen.getByRole('button', { name: en.leaveMatchBtn })
    expect(chip.closest('.topRight'), 'the way out lives in the chip row').toBeTruthy()
  })
})
