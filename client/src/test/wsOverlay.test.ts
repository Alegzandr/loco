/**
 * Tests for the WebSocket-down overlay rendered by GameView.
 *
 * When wsStatus !== 'open', GameView must render a "Connection lost /
 * Reconnecting…" overlay instead of leaving the board blank.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from './render'
import GameView from '../components/GameView.svelte'
import { gameStore } from '../hooks/gameStore'
import { en } from '../i18n/en'
import { WsStatus } from '../hooks/webSocketPolicy'

const baseGameState = {
  screen: 'game' as const,
  myIndex: 0,
  myHand: [{ color: 'red' as const, kind: 'number' as const, value: 5 }],
  players: [
    { index: 0, nickname: 'Alice', hand_size: 1, connected: true },
    { index: 1, nickname: 'Bob', hand_size: 3, connected: true },
  ],
  discard: { color: 'blue' as const, kind: 'number' as const, value: 7 },
  activeColor: 'blue' as const,
  currentTurn: 1,
  pendingDraw: 0,
  isReconnecting: false,
}

function renderGameView(wsStatus: WsStatus) {
  return render(GameView, { onSend: vi.fn(), wsStatus: wsStatus })
}

beforeEach(() => {
  gameStore.setState(baseGameState)
})

describe('GameView WS overlay', () => {
  it('does not show the WS overlay when wsStatus is open', () => {
    renderGameView('open')
    expect(screen.queryByText(en.wsLostConnection)).not.toBeInTheDocument()
    expect(screen.queryByText(en.wsReconnecting)).not.toBeInTheDocument()
  })

  it('shows the WS overlay when wsStatus is connecting', () => {
    renderGameView('connecting')
    expect(screen.getByText(en.wsLostConnection)).toBeInTheDocument()
    expect(screen.getByText(en.wsReconnecting)).toBeInTheDocument()
  })

  it('shows the WS overlay when wsStatus is closed', () => {
    renderGameView('closed')
    expect(screen.getByText(en.wsLostConnection)).toBeInTheDocument()
    expect(screen.getByText(en.wsReconnecting)).toBeInTheDocument()
  })
})
