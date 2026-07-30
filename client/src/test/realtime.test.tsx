import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { I18nProvider } from '../i18n'
import { GameView } from '../components/GameView'
import { useGameStore } from '../hooks/useGameStore'
import { reconnectDelay } from '../hooks/useWebSocket'
import type { CardDTO } from '../types/protocol'

// LOCO is decided on windows measured in seconds, so anything that silently
// delays or swallows a deliberate input is a rules problem, not a polish one.
// These lock the three places that used to do exactly that.

const red3: CardDTO = { color: 'red', kind: 'number', value: 3 }
const blue7: CardDTO = { color: 'blue', kind: 'number', value: 7 }
const wild: CardDTO = { color: 'wild', kind: 'wild' }

function seat(index: number, nickname: string, handSize: number) {
  return { index, nickname, hand_size: handSize, connected: true }
}

function renderGame(onSend = vi.fn()) {
  const view = render(
    <I18nProvider>
      <GameView onSend={onSend} wsStatus="open" />
    </I18nProvider>,
  )
  return { onSend, ...view }
}

beforeEach(() => {
  // jsdom measures everything as 0×0; the board (and the hand) renders nothing
  // until useElementSize sees a real box.
  Element.prototype.getBoundingClientRect = () =>
    ({ width: 1240, height: 790, top: 0, left: 0, right: 1240, bottom: 790, x: 0, y: 0 }) as DOMRect

  useGameStore.setState({
    myIndex: 0,
    myHand: [red3, blue7, wild],
    players: [seat(0, 'Alice', 3), seat(1, 'Bob', 3)],
    discard: red3,
    activeColor: 'red',
    currentTurn: 0,
    direction: 1,
    pendingDraw: 0,
    hasDrawn: false,
    lastPlay: null,
    showRoundSummary: false,
    catchWindows: [],
  })
})

describe('double-tap guard is per control', () => {
  // Draw, then pass is the single most common sequence in the game, and a
  // player who has just drawn a dead card passes immediately. One shared 400ms
  // lockout swallowed that pass with no feedback at all.
  it('lets a pass through immediately after a draw', () => {
    const { onSend } = renderGame()
    fireEvent.click(screen.getByRole('button', { name: 'Draw' }))
    // The server's card_drawn is what unlocks Pass; flush it the way React would.
    act(() => useGameStore.setState({ hasDrawn: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Pass' }))

    const types = onSend.mock.calls.map((c) => c[0].type)
    expect(types).toContain('draw_card')
    expect(types).toContain('pass_turn')
  })

  // The guard still has to do its job: a genuine double-tap on one control is
  // one action, not two.
  it('still swallows a double-tap on the same control', () => {
    const { onSend } = renderGame()
    const draw = screen.getByRole('button', { name: 'Draw' })
    fireEvent.click(draw)
    fireEvent.click(draw)
    expect(onSend.mock.calls.filter((c) => c[0].type === 'draw_card')).toHaveLength(1)
  })

  // A Swap can put two seats on one card at once, so catching the second one
  // right after the first is a legal, deliberate double action.
  it('lets a catch on a second seat through right after the first', () => {
    const now = Date.now()
    useGameStore.setState({
      players: [seat(0, 'Alice', 3), seat(1, 'Bob', 1), seat(2, 'Cara', 1)],
      catchWindows: [
        { seat: 1, endsAt: now + 5000 },
        { seat: 2, endsAt: now + 6000 },
      ],
      // catchTarget / unoTimerEnd are derived from catchWindows by the store's
      // own actions; seeding state directly has to seed the derivation too.
      catchTarget: 1,
      unoTimerEnd: now + 5000,
    })
    const { onSend } = renderGame()
    fireEvent.click(screen.getByRole('button', { name: 'Catch!' }))
    // The first window is retired the way uno_caught would retire it; the
    // button now offers the other seat.
    act(() => useGameStore.getState().closeCatchWindow(1))
    fireEvent.click(screen.getByRole('button', { name: 'Catch!' }))

    const targets = onSend.mock.calls
      .filter((c) => c[0].type === 'catch_uno')
      .map((c) => c[0].target_index)
    expect(targets).toEqual([1, 2])
  })

  // A missed Contre-LOCO! costs a card, and the server answers a round trip
  // later. The button is therefore spent on press, not on the reply — otherwise
  // an impatient second tap pays twice for one opinion.
  it('spends the catch button on the seat it was pressed for', () => {
    const now = Date.now()
    useGameStore.setState({
      players: [seat(0, 'Alice', 3), seat(1, 'Bob', 1)],
      catchWindows: [{ seat: 1, endsAt: now + 5000 }],
      catchTarget: 1,
      unoTimerEnd: now + 5000,
    })
    const { onSend } = renderGame()
    const catchBtn = screen.getByRole('button', { name: 'Catch!' })
    fireEvent.click(catchBtn)
    // Not the 400ms double-tap guard: the button itself is dead until the seat
    // is settled, the same way our own LOCO! button is spent by a declaration.
    expect(screen.getByRole('button', { name: 'Catch!' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Catch!' }))
    expect(onSend.mock.calls.filter((c) => c[0].type === 'catch_uno')).toHaveLength(1)
  })
})

describe('the board animates only a committed play', () => {
  // Flying the card out and snapping it back reads as a bug rather than as
  // "you can't play that", and it costs the player a beat working out which.
  it('does not fly a card the client refuses', () => {
    const { onSend, container } = renderGame()
    act(() => useGameStore.setState({ discard: red3, activeColor: 'red' }))
    fireEvent.click(screen.getByRole('button', { name: 'blue number 7' }))
    expect(onSend).not.toHaveBeenCalled()
    expect(container.querySelector('[data-flier-face="face"]')).toBeNull()
  })

  // Tapping a wild only opens the colour prompt: the card has not left the
  // hand, and a cancelled prompt must leave the fan exactly as it was.
  it('does not fly a wild until its colour is named', () => {
    const { container } = renderGame()
    fireEvent.click(screen.getByRole('button', { name: 'wild wild' }))
    expect(container.querySelector('[data-flier-face="face"]')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'green' }))
    expect(container.querySelector('[data-flier-face="face"]')).toBeInTheDocument()
  })

  it('flies a legal ordinary play', () => {
    const { onSend, container } = renderGame()
    fireEvent.click(screen.getByRole('button', { name: 'red number 3' }))
    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ type: 'play_card' }))
    expect(container.querySelector('[data-flier-face="face"]')).toBeInTheDocument()
  })
})

describe('reconnect backoff', () => {
  // A dropped socket is a dead board: no plays land, no interrupt can be won.
  // The first retry has to be inside a single interrupt window, not two
  // seconds later, because most drops come back straight away.
  it('retries almost immediately on the first attempt', () => {
    expect(reconnectDelay(0)).toBeLessThanOrEqual(300)
  })

  it('backs off monotonically and settles on a cap', () => {
    const delays = [0, 1, 2, 3, 4, 5, 9].map(reconnectDelay)
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1])
    }
    expect(delays[delays.length - 1]).toBe(delays[delays.length - 2])
    expect(delays[delays.length - 1]).toBeLessThanOrEqual(5000)
  })
})
