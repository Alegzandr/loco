/**
 * Tests for the WebSocket-down overlay rendered by GameView.
 *
 * When wsStatus !== 'open', GameView must render a "Connection lost /
 * Reconnecting…" overlay instead of leaving the board blank.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { I18nProvider } from '../i18n'
import { GameView } from '../components/GameView'
import { useGameStore } from '../hooks/useGameStore'
import { en } from '../i18n/en'
import { WsStatus } from '../hooks/useWebSocket'

// PixiGame is heavy (WebGL). Mock the entire module so GameView renders in
// jsdom without a real canvas or GPU context.
vi.mock('../game/PixiGame', () => ({
  PixiGame: vi.fn().mockImplementation(() => ({
    init: vi.fn().mockResolvedValue(undefined),
    render: vi.fn(),
    renderReconnect: vi.fn(),
    animateCardPlay: vi.fn(),
    animateCardDrawn: vi.fn(),
    destroy: vi.fn(),
    app: { screen: { width: 800, height: 600 } },
  })),
}))

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
  return render(
    <I18nProvider>
      <GameView onSend={vi.fn()} wsStatus={wsStatus} />
    </I18nProvider>
  )
}

beforeEach(() => {
  useGameStore.setState(baseGameState)
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
