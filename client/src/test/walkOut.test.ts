import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from './render'
import GameView from '../components/GameView.svelte'
import { gameStore } from '../hooks/gameStore'
import { en } from '../i18n/en'
import type { PlayerDTO } from '../types/protocol'

/**
 * Leaving a match in progress.
 *
 * The control is drawn at every table, because a player who has to go is going
 * either way and the other exit is an empty chair the turn clock plays for. What
 * the table decides is the sentence under the question — what leaving costs the
 * people who are still holding cards — and that is what most of this file pins,
 * beside the two refusals that were here before it: the control is never on the
 * action bar, and it always asks first.
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

/** Opens the question and returns the note under it. */
function askedNote() {
  fireEvent.click(screen.getByRole('button', { name: en.leaveMatchBtn }))
  return screen.getByText(en.leaveMatchAsk).parentElement?.textContent ?? ''
}

describe('leaving a match', () => {
  beforeEach(() => {
    gameStore.getState().resetToHome()
  })

  it('is offered at every table, whatever its size', () => {
    for (const players of [
      [seat(0, 'Alice'), seat(1, 'Bob')],
      [seat(0, 'Alice'), seat(1, 'Bob'), seat(2, 'Carol')],
      [seat(0, 'Alice'), seat(1, 'Bob'), seat(2, 'Carol'), seat(3, 'Dave')],
    ]) {
      seed(players)
      renderView()
      expect(screen.getByRole('button', { name: en.leaveMatchBtn })).toBeTruthy()
      cleanup()
    }
  })

  // Two seats would be left, so the round carries on and the seat is the only
  // thing lost.
  it('says the match carries on where the table can spare the seat', () => {
    seed([seat(0, 'Alice'), seat(1, 'Bob'), seat(2, 'Carol'), seat(3, 'Dave')])
    renderView()
    expect(askedNote()).toContain(en.leaveMatchNoteTable)
  })

  // One seat would be left, which is nobody to play against: the match ends and
  // goes to whoever stayed, and the player is told that before they press.
  it('says the match ends where the table cannot', () => {
    seed([seat(0, 'Alice'), seat(1, 'Bob')])
    renderView()
    expect(askedNote()).toContain(en.leaveMatchNoteEnds)
  })

  // The floor counts seats that can still act, and a bot can act.
  it('counts bots among the seats that would be left', () => {
    seed([seat(0, 'Alice'), seat(1, 'Bob'), seat(2, 'Bot1', true), seat(3, 'Bot2', true)])
    renderView()
    expect(askedNote()).toContain(en.leaveMatchNoteTable)
  })

  // Held is not gone. A seat inside its reconnect window is still somebody who
  // may come back, so it still counts; one whose window ran out does not.
  it('stops counting a seat whose reconnect window ran out', () => {
    seed([seat(0, 'Alice'), seat(1, 'Bob'), seat(2, 'Carol'), seat(3, 'Dave')], {
      goneSeats: [3],
    })
    renderView()
    expect(askedNote()).toContain(en.leaveMatchNoteTable)
    cleanup()

    seed([seat(0, 'Alice'), seat(1, 'Bob'), seat(2, 'Carol')], { goneSeats: [2] })
    renderView()
    expect(askedNote()).toContain(en.leaveMatchNoteEnds)
  })

  it('names what a 1v1 costs: the opponent takes the match, the bot minds nothing', () => {
    seed([seat(0, 'Alice'), seat(1, 'Bob')], { isMatchmade: true })
    renderView()
    expect(askedNote()).toContain(en.leaveMatchNoteRanked)
    cleanup()

    seed([seat(0, 'Alice'), seat(1, 'Bot1', true)], { isSolo: true })
    renderView()
    expect(askedNote()).toContain(en.leaveMatchNoteSolo)
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

describe('telling the table somebody left', () => {
  beforeEach(() => {
    gameStore.getState().resetToHome()
  })

  // Held and gone both read `connected: false`, so without this the only sign
  // that a chair is empty for the rest of the match is a bubble going quiet.
  it('names the seat that left, once', () => {
    seed([seat(0, 'Alice'), seat(1, 'Bob'), seat(2, 'Carol')])
    renderView()
    expect(screen.queryByText(/Carol/)).toBeNull()

    gameStore.getState().noteSeatGone(2, 'Carol')
    expect(screen.getByText(en.departureNotice.replace('%player', 'Carol'))).toBeTruthy()

    // A repeat says nothing new: it must not put the banner back up over a board
    // the table has already moved on from.
    gameStore.getState().clearDepartureNotice()
    gameStore.getState().noteSeatGone(2, 'Carol')
    expect(screen.queryByText(en.departureNotice.replace('%player', 'Carol'))).toBeNull()
  })
})
