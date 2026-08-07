import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from './render'
import { act, renderHook } from './renderHook'
import { gameStore } from '../hooks/gameStore'
import { hostStreamerSync } from '../hooks/appEffects.svelte'
import { createServerMessageHandler } from '../hooks/serverMessages'
import { setStreamerMode, resetStreamerMode } from '../hooks/streamerMode'
import TableCode from '../components/TableCode.svelte'
import type { ClientMsg, GameStateDTO } from '../types/protocol'

/**
 * Streamer mode is the one preference in this client that is not purely local.
 *
 * The table code is a single string shared by everybody who can see it, so a
 * host who is streaming is exposed by their guests' screens as much as by their
 * own — the server holds one answer per table and this is the client half of it:
 * what makes the blur happen, what asks for it, and the two moments that must
 * *not* ask for it.
 */

const noopTimer = { clear: () => {}, arm: () => {} }

function sends(): { send: (m: ClientMsg) => void; sent: ClientMsg[] } {
  const sent: ClientMsg[] = []
  return { send: (m) => sent.push(m), sent }
}

beforeEach(() => {
  localStorage.clear()
  resetStreamerMode()
  gameStore.getState().resetToHome()
  gameStore.setState({ tableStreamer: false })
})

describe('the table code blurs on the table s answer', () => {
  it('hides the code when the host is streaming and this player is not', () => {
    gameStore.setState({ tableStreamer: true })
    render(TableCode, { code: 'ABC123' })

    expect(screen.getByText('ABC123')).toHaveAttribute('data-streamer-hidden', 'true')
  })

  it('leaves it alone when neither says so', () => {
    render(TableCode, { code: 'ABC123' })
    expect(screen.getByText('ABC123')).not.toHaveAttribute('data-streamer-hidden')
  })

  // The two answers are ORed, never merged. A guest who wants the code hidden
  // for their own stream keeps it hidden after the host stops theirs, and a
  // guest whose own switch is off still hides the host's.
  it('keeps this player s own preference when the host is not streaming', () => {
    setStreamerMode(true)
    render(TableCode, { code: 'ABC123' })
    expect(screen.getByText('ABC123')).toHaveAttribute('data-streamer-hidden', 'true')
  })
})

describe('the table s answer arrives from the server', () => {
  it('takes streamer_mode_changed', () => {
    const handle = createServerMessageHandler(noopTimer)
    handle({ type: 'streamer_mode_changed', streamer_mode: true, turn: 0, drawn_count: 0 })
    expect(gameStore.getState().tableStreamer).toBe(true)

    handle({ type: 'streamer_mode_changed', turn: 0, drawn_count: 0 })
    expect(gameStore.getState().tableStreamer).toBe(false)
  })

  // Somebody typing the code an hour into a stream has to arrive blurred.
  it('takes it off room_joined', () => {
    const handle = createServerMessageHandler(noopTimer)
    handle({
      type: 'room_joined',
      room_code: 'ABC123',
      player_id: 1,
      players: [],
      streamer_mode: true,
      turn: 0,
      drawn_count: 0,
    })
    expect(gameStore.getState().tableStreamer).toBe(true)
  })

  // And a tab that reloads mid-match rebuilds from the state snapshot alone.
  it('takes it off a state snapshot', () => {
    const handle = createServerMessageHandler(noopTimer)
    const state = {
      your_index: 0,
      hand: [],
      players: [],
      discard: { color: 'red', kind: 'number', value: 3 },
      active_color: 'red',
      turn: 0,
      direction: 1,
      round_number: 1,
      match_format: 'BO1',
      max_players: 4,
      streamer_mode: true,
    } as unknown as GameStateDTO

    handle({ type: 'game_state', state, turn: 0, drawn_count: 0 })
    expect(gameStore.getState().tableStreamer).toBe(true)
  })

  // The table's setting leaves with the table; the player's own does not.
  it('is dropped on the way home', () => {
    setStreamerMode(true)
    gameStore.setState({ tableStreamer: true })
    gameStore.getState().resetToHome()

    expect(gameStore.getState().tableStreamer).toBe(false)
    expect(localStorage.getItem('loco_streamer_mode')).toBe('1')
  })
})

describe('the host tells the table', () => {
  it('sends when the preference moves at a table it hosts', () => {
    const { send, sent } = sends()
    gameStore.setState({ roomCode: 'ABC123', myIndex: 0 })
    renderHook(() => hostStreamerSync(send))

    act(() => setStreamerMode(true))
    expect(sent).toEqual([{ type: 'set_streamer_mode', streamer_mode: true }])

    act(() => setStreamerMode(false))
    expect(sent[1]).toEqual({ type: 'set_streamer_mode', streamer_mode: false })
  })

  // The host who set it yesterday and opens a table today.
  it('sends on a new table when it is already on', () => {
    const { send, sent } = sends()
    setStreamerMode(true)
    renderHook(() => hostStreamerSync(send))
    expect(sent).toEqual([])

    act(() => gameStore.setState({ roomCode: 'ABC123', myIndex: 0 }))
    expect(sent).toEqual([{ type: 'set_streamer_mode', streamer_mode: true }])
  })

  it('says nothing on an ordinary new table', () => {
    const { send, sent } = sends()
    renderHook(() => hostStreamerSync(send))

    act(() => gameStore.setState({ roomCode: 'ABC123', myIndex: 0 }))
    expect(sent).toEqual([])
  })

  it('says nothing for a guest', () => {
    const { send, sent } = sends()
    gameStore.setState({ roomCode: 'ABC123', myIndex: 1 })
    renderHook(() => hostStreamerSync(send))

    act(() => setStreamerMode(true))
    expect(sent).toEqual([])
  })

  // The server refuses it at a hostless table, and an error nobody asked for
  // would land on the board.
  it('says nothing in a matchmade or solo game', () => {
    const { send, sent } = sends()
    gameStore.setState({ roomCode: 'ABC123', myIndex: 0, isMatchmade: true })
    renderHook(() => hostStreamerSync(send))

    act(() => setStreamerMode(true))
    expect(sent).toEqual([])

    act(() => gameStore.setState({ isMatchmade: false, isSolo: true }))
    act(() => setStreamerMode(false))
    expect(sent).toEqual([])
  })

  /**
   * Taking the table over is not an instruction about somebody else's stream.
   * `transfer_host` hands seat 0 to a player whose own switch is probably off,
   * and sending that would uncover the code for a host still sitting there with
   * it on camera. Their switch is theirs to touch.
   */
  it('says nothing when the seat changes under a table that is already hiding', () => {
    const { send, sent } = sends()
    gameStore.setState({ roomCode: 'ABC123', myIndex: 1, tableStreamer: true })
    renderHook(() => hostStreamerSync(send))

    act(() => gameStore.setState({ myIndex: 0 }))
    expect(sent).toEqual([])
  })

  // One ask per move. The store publishes several times a second during a match
  // and every one of those writes runs this.
  it('does not repeat itself on the next store write', () => {
    const { send, sent } = sends()
    gameStore.setState({ roomCode: 'ABC123', myIndex: 0 })
    renderHook(() => hostStreamerSync(send))

    act(() => setStreamerMode(true))
    act(() => gameStore.setState({ currentTurn: 1 }))
    act(() => gameStore.setState({ currentTurn: 0 }))

    expect(sent).toHaveLength(1)
  })
})

// The panel switch is the same control it always was: it writes the preference,
// and this file's job is to prove the wire half hangs off that and nothing else.
it('leaves the preference in localStorage where every other screen reads it', () => {
  const { send } = sends()
  gameStore.setState({ roomCode: 'ABC123', myIndex: 0 })
  renderHook(() => hostStreamerSync(send))

  act(() => setStreamerMode(true))
  expect(localStorage.getItem('loco_streamer_mode')).toBe('1')
})

vi.mock('../audio/sfx', () => ({ playSfx: vi.fn(), playVolumeAudition: vi.fn() }))
