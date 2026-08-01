import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { I18nProvider } from '../i18n'
import { GameOver } from '../components/GameOver'
import { en } from '../i18n/en'

const scoreboard = [
  { player_index: 0, nickname: 'Alice', score: 42, rounds_won: 1 },
  { player_index: 1, nickname: 'Bob', score: 0, rounds_won: 0 },
]

function renderGameOver(opts: { isHost: boolean; onSend?: ReturnType<typeof vi.fn> }) {
  const onSend = opts.onSend ?? vi.fn()
  render(
    <I18nProvider>
      <GameOver
        winner="Alice"
        myNickname="Bob"
        scoreboard={scoreboard}
        matchOver
        isHost={opts.isHost}
        onSend={onSend}
        onRematch={vi.fn()}
        onFindMatch={vi.fn()}
        onLeave={vi.fn()}
      />
    </I18nProvider>
  )
  return onSend
}

describe('GameOver rematch', () => {
  it('offers the host a rematch button that sends the rematch intent', () => {
    const onSend = renderGameOver({ isHost: true })
    fireEvent.click(screen.getByText(en.rematch))
    expect(onSend).toHaveBeenCalledWith({ type: 'rematch' })
  })

  it('tells non-hosts to wait instead of showing a dead button', () => {
    renderGameOver({ isHost: false })
    expect(screen.getByText(en.rematchWaiting)).toBeInTheDocument()
    expect(screen.queryByText(en.rematch)).not.toBeInTheDocument()
  })

  it('always offers a way out of the room', () => {
    renderGameOver({ isHost: false })
    expect(screen.getByText(en.leaveRoom)).toBeInTheDocument()
  })

  it('still shows the final scoreboard', () => {
    renderGameOver({ isHost: true })
    expect(screen.getByText(en.finalScores)).toBeInTheDocument()
    expect(screen.getByText('42 pts')).toBeInTheDocument()
  })
})
