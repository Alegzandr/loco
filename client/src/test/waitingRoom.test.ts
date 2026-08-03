import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from './render'
import WaitingRoom from '../components/WaitingRoom.svelte'
import { PlayerDTO } from '../types/protocol'

function player(index: number, nickname: string): PlayerDTO {
  return { index, nickname, hand_size: 0, connected: true }
}

function renderWaiting(players: PlayerDTO[], maxPlayers = 10, onSend = vi.fn()) {
  render(WaitingRoom, { roomCode: "ABC123", players: players, myIndex: 0, matchFormat: "BO1", maxPlayers: maxPlayers, onSend: onSend, onLeave: vi.fn() })
  return { onSend, input: screen.getByRole('spinbutton') as HTMLInputElement }
}

function renderRoster(myIndex: number, players: PlayerDTO[], onSend = vi.fn()) {
  render(WaitingRoom, { roomCode: "ABC123", players: players, myIndex: myIndex, matchFormat: "BO1", maxPlayers: 4, onSend: onSend, onLeave: vi.fn() })
  return { onSend }
}

function renderSeat(myIndex: number, onLeave = vi.fn()) {
  render(WaitingRoom, { roomCode: "ABC123", players: [player(0, 'Alice'), player(1, 'Bob')], myIndex: myIndex, matchFormat: "BO1", maxPlayers: 4, onSend: vi.fn(), onLeave: onLeave })
  return { onLeave }
}

// The press on the code is the share: what leaves the screen is a link nobody
// has to retype, in the language it was shared from. The code stays on screen
// for the stream and for whoever is already at a lobby.
describe('WaitingRoom sharing', () => {
  it('copies the link to this table, not the six characters', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    render(WaitingRoom, { roomCode: "ABC234", players: [player(0, 'Alice')], myIndex: 0, matchFormat: "BO1", maxPlayers: 4, onSend: vi.fn(), onLeave: vi.fn() })

    fireEvent.click(screen.getByRole('button', { name: /ABC234/ }))

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/?t=ABC234`)
    // And the code is still readable on the screen it was shared from.
    expect(screen.getByText('ABC234')).toBeInTheDocument()
  })
})

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

// The host shapes their own table: an arrival at the wrong code, a seat that
// will not ready up, one bot too many. Every row but their own carries it, and
// nobody else's roster does.
describe('WaitingRoom kicking', () => {
  const roster = [player(0, 'Alice'), player(1, 'Bob'), player(2, 'Bot1')]

  it('names the seat it frees', () => {
    const { onSend } = renderRoster(0, roster)
    fireEvent.click(screen.getByRole('button', { name: 'Remove from the table: Bob' }))
    expect(onSend).toHaveBeenCalledWith({ type: 'kick_player', target_index: 1 })
  })

  it('offers a bot seat too: it is the only way to take one back', () => {
    const { onSend } = renderRoster(0, roster)
    fireEvent.click(screen.getByRole('button', { name: 'Remove from the table: Bot1' }))
    expect(onSend).toHaveBeenCalledWith({ type: 'kick_player', target_index: 2 })
  })

  // The way out of your own seat is the link at the bottom, which asks first.
  // A kick that could take seat 0 would hand the table away without saying so.
  it('never appears on the host’s own row', () => {
    renderRoster(0, roster)
    expect(
      screen.queryByRole('button', { name: 'Remove from the table: Alice' })
    ).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Remove from the table/ })).toHaveLength(2)
  })

  it('is not a control a guest has at all', () => {
    renderRoster(1, roster)
    expect(screen.queryAllByRole('button', { name: /^Remove from the table/ })).toHaveLength(0)
  })
})

// A table nobody can leave is a dead end: the only way out was closing the tab,
// which drops the socket and holds the seat for 60s instead of freeing it.
//
// Leaving is one-way — the code is gone from this screen and the seat with it —
// so the press asks before it acts. The confirmation lives in place rather than
// in a modal: it is a question about the thing directly above it.
describe('WaitingRoom leaving', () => {
  it('asks before the host gives the table up', () => {
    const { onLeave } = renderSeat(0)
    fireEvent.click(screen.getByRole('button', { name: 'Leave the table' }))
    expect(onLeave).not.toHaveBeenCalled()
    expect(screen.getByText('Leave this table?')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Yes, leave' }))
    expect(onLeave).toHaveBeenCalledTimes(1)
  })

  it('asks before a guest gives their seat up', () => {
    const { onLeave } = renderSeat(1)
    fireEvent.click(screen.getByRole('button', { name: 'Leave the table' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, leave' }))
    expect(onLeave).toHaveBeenCalledTimes(1)
  })

  it('puts the player back where they were on Stay', () => {
    const { onLeave } = renderSeat(1)
    fireEvent.click(screen.getByRole('button', { name: 'Leave the table' }))
    fireEvent.click(screen.getByRole('button', { name: 'Stay' }))

    expect(onLeave).not.toHaveBeenCalled()
    expect(screen.queryByText('Leave this table?')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Leave the table' })).toBeInTheDocument()
  })

  it('takes Escape as Stay', () => {
    const { onLeave } = renderSeat(1)
    fireEvent.click(screen.getByRole('button', { name: 'Leave the table' }))
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onLeave).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Leave the table' })).toBeInTheDocument()
  })
})
