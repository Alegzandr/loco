import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from './render'
import { act } from './renderHook'
import { gameStore } from '../hooks/gameStore'
import { initSessionRestore, RESTORE_TIMEOUT_MS } from '../hooks/sessionRestore'
import { readSession, writeSession, SESSION_KEY } from '../hooks/sessionPersistence'
import type { ClientMsg, ServerMsg } from '../types/protocol'

/**
 * The reload path, end to end on the client side: a tab that comes back must
 * boot onto the reconnect screen, send a token-authenticated rejoin from the
 * very first socket open, and land on the board with the server's answer.
 *
 * Everything below the socket is real (the store, the persistence effect, the
 * restore screen); only the transport is mocked, and it captures what would
 * have gone out on the wire.
 */

const sent: ClientMsg[] = []
const stableSend = (msg: ClientMsg) => { sent.push(msg) }
const stableForceClose = () => {}
// Whatever App handed webSocket as getReconnectMsg, so the test can fire the
// same call the real onopen makes.
let capturedReconnect: (() => ClientMsg | null) | undefined
let capturedOnMessage: ((msg: ServerMsg) => void) | undefined

vi.mock('../hooks/webSocket.svelte', () => ({
  webSocket: (
    onMessage: (msg: ServerMsg) => void,
    getReconnectMsg?: () => ClientMsg | null,
  ) => {
    capturedOnMessage = onMessage
    capturedReconnect = getReconnectMsg
    return { send: stableSend, wsStatus: 'open', forceClose: stableForceClose }
  },
}))

vi.mock('../hooks/appEffects.svelte', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/appEffects.svelte')>()),
  gameAudio: () => {},
}))
vi.mock('../components/GameView.svelte', async () => ({
  default: (await import('./GameViewStub.svelte')).default,
}))

const { default: App } = await import('../App.svelte')

function renderApp() {
  return render(App)
}

function resetStore() {
  gameStore.setState({
    screen: 'lobby',
    roomCode: '',
    myIndex: -1,
    sessionToken: '',
    myNickname: '',
    restoreTarget: null,
    players: [],
    errorMsg: '',
  })
}

beforeEach(() => {
  sent.length = 0
  capturedReconnect = undefined
  capturedOnMessage = undefined
  window.sessionStorage.clear()
  resetStore()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('reload into a live match', () => {
  it('boots onto the reconnect screen instead of the lobby', () => {
    writeSession({ roomCode: 'ABC123', nickname: 'Bob', sessionToken: 'tok', target: 'game' })
    initSessionRestore()

    renderApp()

    expect(gameStore.getState().screen).toBe('restoring')
    expect(screen.getByText('ABC123')).toBeTruthy()
    expect(screen.queryByTestId('game')).toBeNull()
  })

  // The whole feature in one assertion: the reclaim goes out on the first open,
  // built from a store that has no roster and no seat index yet.
  it('sends a token-authenticated rejoin on the first socket open', () => {
    writeSession({ roomCode: 'ABC123', nickname: 'Bob', sessionToken: 'tok', target: 'game' })
    initSessionRestore()
    renderApp()

    expect(capturedReconnect?.()).toEqual({
      type: 'join_room',
      nickname: 'Bob',
      room_code: 'ABC123',
      session_token: 'tok',
    })
  })

  it('lands on the board when the server answers with the snapshot', () => {
    writeSession({ roomCode: 'ABC123', nickname: 'Bob', sessionToken: 'tok', target: 'game' })
    initSessionRestore()
    renderApp()

    act(() => {
      capturedOnMessage?.({
        type: 'player_reconnected',
        room_code: 'ABC123',
        player_id: 1,
        players: [
          { index: 0, nickname: 'Alice', hand_size: 4, connected: true },
          { index: 1, nickname: 'Bob', hand_size: 3, connected: true },
        ],
        state: {
          your_index: 1,
          hand: [{ color: 'red', kind: 'number', value: 7 }],
          players: [
            { index: 0, nickname: 'Alice', hand_size: 4, connected: true },
            { index: 1, nickname: 'Bob', hand_size: 3, connected: true },
          ],
          discard: { color: 'blue', kind: 'skip' },
          active_color: 'blue',
          turn: 1,
          direction: 1,
          pending_draw: 0,
          has_drawn: false,
          round_number: 2,
          match_format: 'BO3',
          max_players: 4,
        },
      } as ServerMsg)
    })

    const s = gameStore.getState()
    expect(s.screen).toBe('game')
    expect(s.restoreTarget).toBeNull()
    expect(s.myIndex).toBe(1)
    expect(s.myHand).toHaveLength(1)
    expect(screen.getByTestId('game')).toBeTruthy()
  })

  /**
   * The reclaim spends its token, and the answer carries the next one.
   *
   * The server rotates it on every successful reconnect and says why in
   * `hub/handleReconnect`: the old one has been on a socket that died, it is in
   * sessionStorage, and if the process restarted on the way it has also been
   * written to a snapshot on disk, so a one-shot proof is worth more than a
   * permanent one. That trade only holds because "the client already stores
   * whatever the server hands it" — and this branch did not. The seat came back
   * once, the record kept a token that had just been spent, and the *second*
   * reclaim of that tab (another reload, a dropped socket, a deploy) was refused
   * with `game already in progress`: the player was handed a lobby saying the
   * cards were already dealt at a table they were sitting at.
   */
  it('keeps the fresh token the reclaim was answered with', () => {
    writeSession({ roomCode: 'ABC123', nickname: 'Bob', sessionToken: 'tok', target: 'game' })
    initSessionRestore()
    renderApp()

    act(() => {
      capturedOnMessage?.({
        type: 'player_reconnected',
        room_code: 'ABC123',
        player_id: 1,
        session_token: 'tok2',
        players: [
          { index: 0, nickname: 'Alice', hand_size: 4, connected: true },
          { index: 1, nickname: 'Bob', hand_size: 3, connected: true },
        ],
        state: {
          your_index: 1,
          hand: [{ color: 'red', kind: 'number', value: 7 }],
          players: [
            { index: 0, nickname: 'Alice', hand_size: 4, connected: true },
            { index: 1, nickname: 'Bob', hand_size: 3, connected: true },
          ],
          discard: { color: 'blue', kind: 'skip' },
          active_color: 'blue',
          turn: 1,
          direction: 1,
          pending_draw: 0,
          has_drawn: false,
          round_number: 2,
          match_format: 'BO3',
          max_players: 4,
        },
      } as ServerMsg)
    })

    expect(gameStore.getState().sessionToken).toBe('tok2')
    // And it is the one the next reclaim would go out with, from the record as
    // well as from the store: the second reload is the one that used to fail.
    expect(readSession()?.sessionToken).toBe('tok2')
    expect(capturedReconnect?.()).toEqual({
      type: 'join_room',
      nickname: 'Bob',
      room_code: 'ABC123',
      session_token: 'tok2',
    })
  })

  // A refused reclaim ends the restore and takes the record with it: replaying
  // the same refusal on every load is how a tab becomes permanently unusable.
  it('a refusal drops the record and returns to the lobby with a reason', () => {
    writeSession({ roomCode: 'ABC123', nickname: 'Bob', sessionToken: 'tok', target: 'game' })
    initSessionRestore()
    renderApp()

    act(() => {
      capturedOnMessage?.({ type: 'error', error: 'invalid session token for reconnect' } as ServerMsg)
    })

    expect(gameStore.getState().screen).toBe('lobby')
    expect(gameStore.getState().errorMsg).toBe('invalid session token for reconnect')
    expect(window.sessionStorage.getItem(SESSION_KEY)).toBeNull()
  })

  // A server that never answers must not leave the player on a spinner with no
  // way out other than the reload button.
  it('gives up after RESTORE_TIMEOUT_MS', () => {
    vi.useFakeTimers()
    writeSession({ roomCode: 'ABC123', nickname: 'Bob', sessionToken: 'tok', target: 'game' })
    initSessionRestore()
    renderApp()

    expect(gameStore.getState().screen).toBe('restoring')
    act(() => { vi.advanceTimersByTime(RESTORE_TIMEOUT_MS + 1) })

    expect(gameStore.getState().screen).toBe('lobby')
    expect(readSession()).toBeNull()
  })

  it('restores a waiting room with a plain join', () => {
    writeSession({ roomCode: 'ABC123', nickname: 'Bob', sessionToken: 'tok', target: 'waiting' })
    initSessionRestore()
    renderApp()

    expect(capturedReconnect?.()).toEqual({
      type: 'join_room',
      nickname: 'Bob',
      room_code: 'ABC123',
    })

    act(() => {
      capturedOnMessage?.({
        type: 'room_joined',
        room_code: 'ABC123',
        player_id: 0,
        session_token: 'tok2',
        players: [{ index: 0, nickname: 'Bob', hand_size: 0, connected: true }],
        match_format: 'BO3',
        max_players: 4,
      } as ServerMsg)
    })

    expect(gameStore.getState().screen).toBe('waiting')
    expect(gameStore.getState().restoreTarget).toBeNull()
  })
})

describe('what gets persisted', () => {
  it('writes the record once the player is seated in a room', () => {
    renderApp()
    act(() => {
      capturedOnMessage?.({
        type: 'room_created',
        room_code: 'XYZ789',
        player_id: 0,
        session_token: 'tok',
        players: [{ index: 0, nickname: 'Alice', hand_size: 0, connected: true }],
        match_format: 'BO1',
        max_players: 10,
      } as ServerMsg)
    })

    expect(readSession()).toMatchObject({
      roomCode: 'XYZ789',
      nickname: 'Alice',
      sessionToken: 'tok',
      target: 'waiting',
    })
  })

  // Nothing to come back to: the seat is released the moment the match ends, so
  // a record left behind would greet the next load with a reconnect screen for a
  // game that is over.
  it('clears the record when the match ends', () => {
    renderApp()
    act(() => {
      capturedOnMessage?.({
        type: 'room_created',
        room_code: 'XYZ789',
        player_id: 0,
        session_token: 'tok',
        players: [{ index: 0, nickname: 'Alice', hand_size: 0, connected: true }],
        match_format: 'BO1',
        max_players: 10,
      } as ServerMsg)
    })
    expect(readSession()).not.toBeNull()

    act(() => { gameStore.getState().applyMatchEnd('Alice', []) })
    expect(readSession()).toBeNull()
  })

  it('never writes a record from the lobby', () => {
    renderApp()
    act(() => { gameStore.getState().setError('room not found') })
    expect(readSession()).toBeNull()
  })
})
