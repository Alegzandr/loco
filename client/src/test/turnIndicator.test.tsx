import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TurnIndicator } from '../components/cards/TurnIndicator'

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
      <TurnIndicator
        isMyTurn
        pendingDraw={2}
        canCounter
        currentTurn={0}
        players={players}
        height={700}
        texts={texts}
      />,
    )
    expect(screen.getByText('Draw 2 or counter!')).toBeTruthy()
  })

  it('asks for the draw alone when nothing in hand can stack it', () => {
    // A +4 does not answer a +2, so most hands cannot counter. Promising the
    // counter anyway sends the player tapping cards that will never leave.
    render(
      <TurnIndicator
        isMyTurn
        pendingDraw={2}
        canCounter={false}
        currentTurn={0}
        players={players}
        height={700}
        texts={texts}
      />,
    )
    expect(screen.getByText('Draw 2')).toBeTruthy()
    expect(screen.queryByText('Draw 2 or counter!')).toBeNull()
  })

  it('names the current player when the turn is not ours', () => {
    render(
      <TurnIndicator
        isMyTurn={false}
        pendingDraw={0}
        canCounter={false}
        currentTurn={1}
        players={players}
        height={700}
        texts={texts}
      />,
    )
    expect(screen.getByText("bob's turn")).toBeTruthy()
  })
})
