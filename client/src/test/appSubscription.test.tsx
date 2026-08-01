import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { useGameStore } from '../hooks/useGameStore'
import type { ClientMsg } from '../types/protocol'

// <GameBoard /> is memoised and GameView keeps its props referentially stable,
// but all of that is decided one level up: App owns the tree, and an App that
// re-renders on every store change re-renders the whole match screen with it.
// These pin the parent half of that contract.

// The real hook's send/forceClose are useCallback([], …) — stable for the life
// of the app. A mock handing back fresh arrows would make handleSend unstable
// by itself and quietly prove nothing.
const stableSend = () => {}
const stableForceClose = () => {}
vi.mock('../hooks/useWebSocket', () => ({
  useWebSocket: () => ({ send: stableSend, wsStatus: 'open', forceClose: stableForceClose }),
}))

vi.mock('../audio/useGameAudio', () => ({ useGameAudio: () => {} }))

const gameView = { renders: 0, onSend: null as ((msg: ClientMsg) => void) | null }

vi.mock('../components/GameView', () => ({
  GameView: (props: { onSend: (msg: ClientMsg) => void }) => {
    gameView.renders++
    gameView.onSend = props.onSend
    return <div data-testid="game" />
  },
}))

const { default: App } = await import('../App')

beforeEach(() => {
  gameView.renders = 0
  gameView.onSend = null
  useGameStore.setState({
    screen: 'game',
    myIndex: 0,
    players: [{ index: 0, nickname: 'Alice', hand_size: 3, connected: true }],
    latencies: [],
  })
})

describe('App does not re-render the match screen on board state', () => {
  // The latency broadcast is the cheap, frequent one: every 3 seconds, all
  // match long, for information that lives in a panel nobody has open.
  it('ignores a latency broadcast', () => {
    render(<App />)
    const before = gameView.renders

    act(() => {
      useGameStore.getState().applyLatencies([{ player_index: 0, rtt_ms: 42 }])
    })

    expect(gameView.renders).toBe(before)
  })

  it('ignores a hand change', () => {
    render(<App />)
    const before = gameView.renders

    act(() => {
      useGameStore.setState({ myHand: [{ color: 'red', kind: 'number', value: 5 }] })
    })

    expect(gameView.renders).toBe(before)
  })

  // onSend reaching GameView with a new identity on every store change is what
  // rebuilt its memoised callbacks and defeated the board's memo.
  it('hands GameView the same onSend across store updates', () => {
    render(<App />)
    const first = gameView.onSend

    act(() => {
      useGameStore.getState().applyLatencies([{ player_index: 0, rtt_ms: 42 }])
      useGameStore.getState().setError('illegal card play')
    })

    expect(gameView.onSend).toBe(first)
  })

  // It must still follow what it does render.
  it('re-renders when the screen changes', () => {
    const { getByTestId } = render(<App />)
    expect(getByTestId('game')).toBeTruthy()

    act(() => useGameStore.setState({ screen: 'lobby' }))
    expect(() => getByTestId('game')).toThrow()
  })
})
