import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from './render'
import { act } from './renderHook'
import GameView from '../components/GameView.svelte'
import { gameStore } from '../hooks/gameStore'
import type { CardDTO } from '../types/protocol'

const red3: CardDTO = { color: 'red', kind: 'number', value: 3 }

function seat(index: number, nickname: string, handSize: number) {
  return { index, nickname, hand_size: handSize, connected: true }
}

function renderGame(onSend = vi.fn()) {
  render(GameView, { onSend: onSend, wsStatus: "open" },
  )
  return onSend
}

// Image.decode() does not exist in jsdom, and neither does any real decoding.
// Stubbing it is what makes "the client answers once its assets are in" a thing
// this test can actually assert rather than wait on.
let decodeResult: 'resolve' | 'reject' = 'resolve'
let pendingDecodes: (() => void)[] = []
let holdDecodes = false

beforeEach(() => {
  Element.prototype.getBoundingClientRect = () =>
    ({ width: 1240, height: 790, top: 0, left: 0, right: 1240, bottom: 790, x: 0, y: 0 }) as DOMRect

  decodeResult = 'resolve'
  pendingDecodes = []
  holdDecodes = false

  Object.defineProperty(HTMLImageElement.prototype, 'decode', {
    configurable: true,
    writable: true,
    value() {
      return new Promise<void>((resolve, reject) => {
        const settle = () => (decodeResult === 'resolve' ? resolve() : reject(new Error('boom')))
        if (holdDecodes) pendingDecodes.push(settle)
        else settle()
      })
    },
  })

  gameStore.setState({
    screen: 'game',
    myIndex: 0,
    myHand: [red3],
    players: [seat(0, 'Alice', 1), seat(1, 'Bob', 3), seat(2, 'Kiwi', 5)],
    discard: red3,
    activeColor: 'red',
    currentTurn: 0,
    direction: 1,
    pendingDraw: 0,
    hasDrawn: false,
    lastPlay: null,
    showRoundSummary: false,
    mapId: 'neon',
    mapLoading: { ready: [] },
    turnDeadline: null,
  })
})

afterEach(() => {
  act(() => {
    gameStore.setState({ mapId: '', mapLoading: null })
  })
})

const flushDecodes = () => {
  const queued = pendingDecodes
  pendingDecodes = []
  queued.forEach((fn) => fn())
}

describe('map loading screen', () => {
  it('introduces the room by name while the table is shut', async () => {
    renderGame()
    const screenEl = await screen.findByTestId('map-loading')
    expect(screenEl).toHaveAttribute('data-map', 'neon')
    expect(screen.getByRole('heading', { name: 'Neon' })).toBeInTheDocument()
    // The tagline is what turns a progress bar into a reveal.
    expect(screen.getByText(/rooftop club/i)).toBeInTheDocument()
  })

  // Without the roster a player cannot tell a slow download from a hung game,
  // which is the difference between waiting and reloading.
  it('names every seat and marks the ones that are in', async () => {
    renderGame()
    // Scoped to the overlay: the board is mounted behind it and its opponent
    // pills carry the same nicknames.
    const panel = within(await screen.findByTestId('map-loading'))
    for (const name of ['Alice', 'Bob', 'Kiwi']) {
      expect(panel.getByText(name)).toBeInTheDocument()
    }
    expect(panel.getByText('0 of 3 ready')).toBeInTheDocument()

    act(() => { gameStore.getState().applyMatchLoading([0, 2]) })
    expect(panel.getByText('2 of 3 ready')).toBeInTheDocument()
    expect(panel.getByText('Bob').closest('li')).toHaveAttribute('data-ready', 'false')
    expect(panel.getByText('Kiwi').closest('li')).toHaveAttribute('data-ready', 'true')
  })

  it('answers map_ready once its images are decoded', async () => {
    holdDecodes = true
    const onSend = renderGame()
    await screen.findByTestId('map-loading')
    expect(onSend).not.toHaveBeenCalledWith({ type: 'map_ready' })

    await act(async () => { flushDecodes() })
    await waitFor(() => expect(onSend).toHaveBeenCalledWith({ type: 'map_ready' }))
  })

  // A broken image must never strand a player: the board falls back to the felt,
  // which is a worse-looking match, not a broken one. A client that never
  // reports ready is the one outcome the gate cannot survive.
  it('answers map_ready even when the images fail to decode', async () => {
    decodeResult = 'reject'
    const onSend = renderGame()
    await waitFor(() => expect(onSend).toHaveBeenCalledWith({ type: 'map_ready' }))
  })

  // A map id this build has no art for is ready instantly: there is nothing to
  // fetch, and the board simply uses the built-in felt.
  it('answers map_ready immediately for an unknown map', async () => {
    act(() => { gameStore.setState({ mapId: 'atlantis' }) })
    const onSend = renderGame()
    await waitFor(() => expect(onSend).toHaveBeenCalledWith({ type: 'map_ready' }))
    expect(screen.queryByTestId('map-loading')).not.toBeInTheDocument()
  })

  // The gate re-broadcasts on every arrival, so keying the send on the message
  // object would pay one map_ready per opponent.
  it('answers exactly once however many progress updates arrive', async () => {
    const onSend = renderGame()
    await waitFor(() => expect(onSend).toHaveBeenCalledWith({ type: 'map_ready' }))
    act(() => { gameStore.getState().applyMatchLoading([0]) })
    act(() => { gameStore.getState().applyMatchLoading([0, 1]) })
    act(() => { gameStore.getState().applyMatchLoading([0, 1, 2]) })
    const readies = onSend.mock.calls.filter((c) => c[0]?.type === 'map_ready')
    expect(readies).toHaveLength(1)
  })

  it('lifts the screen and starts the clock when the table opens', async () => {
    renderGame()
    await screen.findByTestId('map-loading')

    const deadline = Date.now() + 30_000
    act(() => { gameStore.getState().applyMatchReady(1, deadline) })

    expect(screen.queryByTestId('map-loading')).not.toBeInTheDocument()
    expect(gameStore.getState().turnDeadline).toBe(deadline)
    expect(gameStore.getState().currentTurn).toBe(1)
  })

  // The board is mounted underneath the whole time: that is what makes the
  // table finished the instant the screen lifts, instead of building itself in
  // front of the player on the first turn.
  it('keeps the board mounted behind the screen', async () => {
    renderGame()
    await screen.findByTestId('map-loading')
    expect(screen.getByTestId('game-board')).toBeInTheDocument()
  })
})

describe('map on the board', () => {
  it('paints the room and drops the built-in felt', async () => {
    renderGame()
    act(() => { gameStore.getState().applyMatchReady(0, null) })
    const board = screen.getByTestId('game-board')
    expect(board).toHaveAttribute('data-map', 'neon')
    expect(board.style.backgroundImage).toContain('/maps/neon/room.webp')
  })

  it('falls back to the built-in felt with no map', () => {
    act(() => { gameStore.setState({ mapId: '', mapLoading: null }) })
    renderGame()
    expect(screen.getByTestId('game-board')).toHaveAttribute('data-map', '')
  })
})
