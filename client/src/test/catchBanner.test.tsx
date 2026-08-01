import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { I18nProvider } from '../i18n'
import { GameView } from '../components/GameView'
import { useGameStore } from '../hooks/useGameStore'
import type { CardDTO } from '../types/protocol'

const red3: CardDTO = { color: 'red', kind: 'number', value: 3 }

function seat(index: number, nickname: string, handSize: number) {
  return { index, nickname, hand_size: handSize, connected: true }
}

function renderGame() {
  render(
    <I18nProvider>
      <GameView onSend={vi.fn()} wsStatus="open" />
    </I18nProvider>,
  )
}

/**
 * A landed Contre-LOCO! is the one moment the client used to render nothing at
 * all: the server closed the window, the caught hand grew by two, and on a
 * board where hands grow all match long that is indistinguishable from a draw.
 * These pin the verdict onto the screen.
 */
describe('GameView — Contre-LOCO! verdict', () => {
  beforeEach(() => {
    Element.prototype.getBoundingClientRect = () =>
      ({ width: 1240, height: 790, top: 0, left: 0, right: 1240, bottom: 790, x: 0, y: 0 }) as DOMRect

    useGameStore.setState({
      myIndex: 0,
      myHand: [red3],
      players: [seat(0, 'Alice', 1), seat(1, 'Bob', 3)],
      discard: red3,
      activeColor: 'red',
      currentTurn: 0,
      direction: 1,
      pendingDraw: 0,
      hasDrawn: false,
      catchFlash: null,
      showRoundSummary: false,
    })
  })

  it('shows nothing until a catch lands', () => {
    renderGame()
    expect(screen.queryByTestId('catch-banner')).toBeNull()
  })

  it('names the caught seat and what the miss cost', () => {
    renderGame()
    act(() => { useGameStore.getState().applyUnoCaught(1) })

    const banner = screen.getByTestId('catch-banner')
    expect(banner).toHaveTextContent('CAUGHT!')
    expect(banner).toHaveTextContent('Bob never called LOCO!')
    // The price is the whole point: a hand that grew is only news once the
    // table knows it was charged rather than drawn.
    expect(banner).toHaveTextContent('+2 cards')
  })

  it('addresses the caught player directly when it is us', () => {
    renderGame()
    act(() => { useGameStore.getState().applyUnoCaught(0) })
    expect(screen.getByTestId('catch-banner')).toHaveTextContent('You never called LOCO!')
  })

  it('retires itself and clears the flash', () => {
    vi.useFakeTimers()
    try {
      renderGame()
      act(() => { useGameStore.getState().applyUnoCaught(1) })
      expect(screen.getByTestId('catch-banner')).toBeTruthy()

      act(() => { vi.advanceTimersByTime(2500) })
      expect(screen.queryByTestId('catch-banner')).toBeNull()
      expect(useGameStore.getState().catchFlash).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
