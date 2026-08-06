import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from './render'
import Lobby from '../components/Lobby.svelte'
import { en } from '../i18n/en'
import { gameStore } from '../hooks/gameStore'
import { createServerMessageHandler } from '../hooks/serverMessages'
import { PLAYERS_ONLINE_MIN, showPlayersOnline } from '../components/playersOnline'
import type { ServerMsg } from '../types/protocol'

function renderLobby(playersOnline: number) {
  return render(Lobby, {
    onSend: vi.fn(),
    onFindMatch: vi.fn(),
    onPlayBot: vi.fn(),
    error: '',
    onClearError: vi.fn(),
    playersOnline,
  })
}

// The handler needs a banner timer it never uses here.
const handle = createServerMessageHandler({ clear: () => {}, arm: () => {} })

describe('players online', () => {
  beforeEach(() => {
    localStorage.clear()
    gameStore.setState({ playersOnline: 0 })
  })

  it('the floor is two, counting yourself', () => {
    expect(PLAYERS_ONLINE_MIN).toBe(2)
    expect(showPlayersOnline(0)).toBe(false)
    expect(showPlayersOnline(1)).toBe(false)
    expect(showPlayersOnline(2)).toBe(true)
  })

  // The number on screen is always the number the server sent. The floor hides
  // the chip; it never rounds, pads or rewords what is above it.
  it('draws the count it was given, unrounded', () => {
    renderLobby(37)
    expect(screen.getByText(en.playersOnline(37))).toBeInTheDocument()
  })

  it('draws nothing at all below the floor', () => {
    renderLobby(1)
    // Asserting on the copy alone would pass over a screen that rendered
    // nothing, so the seat labels next to it are what says the lobby is really
    // there.
    expect(screen.getByText(en.createRoom)).toBeInTheDocument()
    expect(screen.queryByText(en.playersOnline(1))).not.toBeInTheDocument()
  })

  it('says nothing before the server has said anything', () => {
    renderLobby(0)
    expect(screen.getByText(en.createRoom)).toBeInTheDocument()
    expect(screen.queryByText(en.playersOnline(0))).not.toBeInTheDocument()
  })

  it('takes the count off the wire', () => {
    handle({ type: 'players_online', players_online: 12 } as ServerMsg)
    expect(gameStore.getState().playersOnline).toBe(12)
  })

  // A count of zero is a real answer — every other tab gone — which is why the
  // field is a pointer on the wire and why nothing here treats it as absent.
  it('applies a zero as a value', () => {
    handle({ type: 'players_online', players_online: 5 } as ServerMsg)
    handle({ type: 'players_online', players_online: 0 } as ServerMsg)
    expect(gameStore.getState().playersOnline).toBe(0)
  })

  // The count belongs to the socket, not to the seat: leaving a table lands the
  // player back on the one screen that draws it, and the server only speaks
  // again when the number moves.
  it('survives the way home', () => {
    handle({ type: 'players_online', players_online: 9 } as ServerMsg)
    gameStore.getState().resetToHome()
    expect(gameStore.getState().playersOnline).toBe(9)
  })
})
