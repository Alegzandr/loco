import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from './render'
import TurnIndicator from '../components/cards/TurnIndicator.svelte'

const texts = {
  yourTurn: 'Your turn',
  drawOrCounter: 'Draw %n or counter!',
  drawPenalty: 'Draw %n',
  playerTurnSuffix: "'s turn",
}

const players = [
  { index: 0, nickname: 'alice' },
  { index: 1, nickname: 'bob' },
]

describe('TurnIndicator', () => {
  it('offers the counter only when a card in hand can stack the penalty', () => {
    render(
      TurnIndicator, { isMyTurn: true, pendingDraw: 2, canCounter: true, currentTurn: 0, players: players, width: 1240, height: 700, texts: texts },
    )
    expect(screen.getByText('Draw 2 or counter!')).toBeTruthy()
  })

  it('asks for the draw alone when nothing in hand can stack it', () => {
    // A +4 does not answer a +2, so most hands cannot counter. Promising the
    // counter anyway sends the player tapping cards that will never leave.
    render(
      TurnIndicator, { isMyTurn: true, pendingDraw: 2, canCounter: false, currentTurn: 0, players: players, width: 1240, height: 700, texts: texts },
    )
    expect(screen.getByText('Draw 2')).toBeTruthy()
    expect(screen.queryByText('Draw 2 or counter!')).toBeNull()
  })

  it('names the current player when the turn is not ours', () => {
    render(
      TurnIndicator, { isMyTurn: false, pendingDraw: 0, canCounter: false, currentTurn: 1, players: players, width: 1240, height: 700, texts: texts },
    )
    expect(screen.getByText("bob's turn")).toBeTruthy()
  })

  it('draws the stack when the penalty pill is pressed, because it looks like a button', async () => {
    // Reported: "Draw 2" read as a control and did nothing. It is one now.
    const onDraw = vi.fn()
    render(TurnIndicator, {
      isMyTurn: true, pendingDraw: 2, canCounter: false, currentTurn: 0, players, width: 1240, height: 700, texts, onDraw,
    })
    const pill = screen.getByRole('button', { name: 'Draw 2' })
    await fireEvent.pointerDown(pill, { button: 0 })
    expect(onDraw).toHaveBeenCalledTimes(1)
    // The click the same press produces is not a second draw.
    await fireEvent.click(pill)
    expect(onDraw).toHaveBeenCalledTimes(1)
  })

  it('is the same control for a stacked +4', async () => {
    const onDraw = vi.fn()
    render(TurnIndicator, {
      isMyTurn: true, pendingDraw: 4, canCounter: true, currentTurn: 0, players, width: 1240, height: 700, texts, onDraw,
    })
    await fireEvent.pointerDown(screen.getByRole('button', { name: 'Draw 4 or counter!' }), { button: 0 })
    expect(onDraw).toHaveBeenCalledTimes(1)
  })

  it('stays a label in every other state', () => {
    const onDraw = vi.fn()
    render(TurnIndicator, {
      isMyTurn: true, pendingDraw: 0, canCounter: false, currentTurn: 0, players, width: 1240, height: 700, texts, onDraw,
    })
    expect(screen.queryByRole('button')).toBeNull()
    render(TurnIndicator, {
      isMyTurn: false, pendingDraw: 2, canCounter: false, currentTurn: 1, players, width: 1240, height: 700, texts, onDraw,
    })
    expect(screen.queryByRole('button')).toBeNull()
  })
})
