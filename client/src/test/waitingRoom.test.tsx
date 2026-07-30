import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { I18nProvider } from '../i18n'
import { WaitingRoom } from '../components/WaitingRoom'
import { PlayerDTO } from '../types/protocol'

function player(index: number, nickname: string): PlayerDTO {
  return { index, nickname, hand_size: 0, connected: true }
}

function renderWaiting(players: PlayerDTO[], maxPlayers = 10, onSend = vi.fn()) {
  render(
    <I18nProvider>
      <WaitingRoom
        roomCode="ABC123"
        players={players}
        myIndex={0}
        matchFormat="BO1"
        maxPlayers={maxPlayers}
        onSend={onSend}
      />
    </I18nProvider>
  )
  return { onSend, input: screen.getByRole('spinbutton') as HTMLInputElement }
}

describe('WaitingRoom max players', () => {
  it('never offers a cap below the two players a match needs', () => {
    const { input } = renderWaiting([player(0, 'Alice')])
    expect(input.min).toBe('2')
    expect(input.max).toBe('10')
  })

  it('keeps the floor at the current roster once it exceeds two', () => {
    const { input } = renderWaiting([player(0, 'Alice'), player(1, 'Bob'), player(2, 'Carol')])
    expect(input.min).toBe('3')
  })

  it('does not send an unplayable cap of 1', () => {
    const { onSend, input } = renderWaiting([player(0, 'Alice')])
    fireEvent.change(input, { target: { value: '1' } })
    expect(onSend).not.toHaveBeenCalled()
  })

  it('restores the server value when the field is left invalid', () => {
    const { input } = renderWaiting([player(0, 'Alice')], 4)
    fireEvent.change(input, { target: { value: '1' } })
    expect(input.value).toBe('1')
    fireEvent.blur(input)
    expect(input.value).toBe('4')
  })

  it('sends a legal cap', () => {
    const { onSend, input } = renderWaiting([player(0, 'Alice')])
    fireEvent.change(input, { target: { value: '6' } })
    expect(onSend).toHaveBeenCalledWith({ type: 'set_max_players', max_players: 6 })
  })
})
