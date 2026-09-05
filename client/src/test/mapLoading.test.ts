import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from './render'
import { act } from './renderHook'
import GameView from '../components/GameView.svelte'
import { gameStore } from '../hooks/gameStore'
import type { CardDTO } from '../types/protocol'
import { MAP_BAR_FULL_MS } from '../hooks/mapPreload'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const red3: CardDTO = { color: 'red', kind: 'number', value: 3 }

function seat(index: number, nickname: string, handSize: number) {
  return { index, nickname, hand_size: handSize, connected: true }
}

function renderGame(onSend = vi.fn()) {
  render(GameView, { onSend: onSend, wsStatus: "open" },
  )
  return onSend
}

// The room is rendered by the scene engine, which needs a WebGL context jsdom
// does not have. Stubbing the cache's `prepareScene` is what makes "the client
// answers once its room is rendered" a thing this test can actually assert
// rather than wait on: a render can be held, released, or made to fail.
const renders = vi.hoisted(() => ({
  hold: false,
  fail: false,
  pending: [] as (() => void)[],
}))

vi.mock('../components/scene/sceneCache', () => ({
  renderSizeFor: (width: number, height: number) => ({ width, height, pixelRatio: 1 }),
  peekScene: () => null,
  clearSceneCache: () => {},
  prepareScene: (_spec: unknown, size: unknown, _felt: unknown, onProgress?: (p: number) => void) =>
    new Promise((resolve, reject) => {
      const settle = () => {
        if (renders.fail) {
          reject(new Error('boom'))
          return
        }
        onProgress?.(1)
        resolve({ key: 'stub', size, felt: _felt, canvas: null, rig: null })
      }
      if (renders.hold) renders.pending.push(settle)
      else settle()
    }),
}))

beforeEach(() => {
  Element.prototype.getBoundingClientRect = () =>
    ({ width: 1240, height: 790, top: 0, left: 0, right: 1240, bottom: 790, x: 0, y: 0 }) as DOMRect

  renders.hold = false
  renders.fail = false
  renders.pending = []

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
    mapTime: 'night',
    mapWeather: 'rain',
    mapLoading: { ready: [] },
    turnDeadline: null,
  })
})

afterEach(() => {
  act(() => {
    gameStore.setState({ mapId: '', mapTime: '', mapWeather: '', mapLoading: null })
  })
})

const flushRenders = () => {
  const queued = renders.pending
  renders.pending = []
  queued.forEach((fn) => fn())
}

describe('map loading screen', () => {
  it('introduces the room by name while the table is shut', async () => {
    renderGame()
    const screenEl = await screen.findByTestId('map-loading')
    expect(screenEl).toHaveAttribute('data-map', 'neon')
    expect(screen.getByRole('heading', { name: 'Neon' })).toBeInTheDocument()
    // The tagline is what turns a progress bar into a reveal.
    expect(screen.getByText(/rooftop terrace/i)).toBeInTheDocument()
    // And the hour and the sky are the part of it that changes from match to
    // match in the same room.
    expect(screen.getByTestId('map-moment')).toHaveTextContent('Night · Rain')
    expect(screenEl).toHaveAttribute('data-scene-time', 'night')
    expect(screenEl).toHaveAttribute('data-scene-weather', 'rain')
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

  it('answers map_ready once its room is rendered', async () => {
    renders.hold = true
    const onSend = renderGame()
    await screen.findByTestId('map-loading')
    expect(onSend).not.toHaveBeenCalledWith({ type: 'map_ready' })

    await act(async () => { flushRenders() })
    await waitFor(() => expect(onSend).toHaveBeenCalledWith({ type: 'map_ready' }))
  })

  // A load ends full or it does not read as a load. Nothing under the bar ever
  // reports one — the render stops at its last batch of sprites — so the screen
  // used to lift on a bar around nine tenths, which says the room was given up
  // on rather than finished. The bar is filled first and map_ready waits for it.
  it('fills the bar before it answers map_ready', async () => {
    renders.hold = true
    const onSend = renderGame()
    const panel = await screen.findByTestId('map-loading')
    const fill = () => panel.querySelector('.fill') as HTMLElement

    await act(async () => { flushRenders() })
    await waitFor(() => expect(fill().style.transform).toBe('scaleX(1)'))
    expect(onSend).not.toHaveBeenCalledWith({ type: 'map_ready' })

    await waitFor(() => expect(onSend).toHaveBeenCalledWith({ type: 'map_ready' }), { timeout: 2000 })
    expect(fill().style.transform).toBe('scaleX(1)')
  })

  // The hold has to outlast the travel it is paying for: the two live in
  // different files, so the number is read off the stylesheet rather than
  // trusted to be edited alongside it.
  it('holds the bar full for at least as long as the fill takes to travel', () => {
    const src = readFileSync(path.resolve(__dirname, '..', 'components', 'MapLoadingScreen.svelte'), 'utf8')
    const fill = src.slice(src.indexOf('.fill {'))
    const travel = /transition:\s*transform\s*([\d.]+)s/.exec(fill)
    expect(travel).not.toBeNull()
    expect(MAP_BAR_FULL_MS).toBeGreaterThanOrEqual(Number(travel![1]) * 1000)
  })

  // A render that fails (no WebGL, a lost context) must never strand a player:
  // the board falls back to the sky, which is a worse-looking match, not a
  // broken one. A client that never reports ready is the one outcome the gate
  // cannot survive.
  it('answers map_ready even when the render fails', async () => {
    renders.fail = true
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

  // The one that cost twenty seconds a match at every table with two humans in
  // it. Another seat arriving re-broadcasts the gate, the preload effect re-ran
  // on it, and its cleanup cancelled a download that was still in flight while
  // the once-per-map guard refused to start it again — so `done` never came,
  // map_ready was never sent, and the table opened on the server's 20s backstop
  // with this player still on the loading screen. A table with a bot never
  // showed it: nobody else was there to re-broadcast anything.
  it('still answers map_ready when a seat arrives mid-render', async () => {
    renders.hold = true
    const onSend = renderGame()
    await screen.findByTestId('map-loading')

    act(() => { gameStore.getState().applyMatchLoading([1]) })
    act(() => { gameStore.getState().applyMatchLoading([1, 2]) })

    await act(async () => { flushRenders() })
    await waitFor(() => expect(onSend).toHaveBeenCalledWith({ type: 'map_ready' }))
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
  // The scene is the room at its hour under its sky, and the table wears the
  // room's own materials: nothing here is a photograph any more, so what the
  // board carries is the three ids the backdrop renders from and the CSS
  // variables the felt and the rim are painted with.
  it('paints the room and dresses the table in it', async () => {
    renderGame()
    act(() => { gameStore.getState().applyMatchReady(0, null) })
    const board = screen.getByTestId('game-board')
    expect(board).toHaveAttribute('data-map', 'neon')
    expect(board).toHaveAttribute('data-scene-time', 'night')
    expect(board).toHaveAttribute('data-scene-weather', 'rain')
    expect(board.querySelector('[data-scene="neon:night:rain"]')).not.toBeNull()
    expect(board.style.getPropertyValue('--tbl-felt').trim()).toBe('#1a1530')
    expect(board.style.getPropertyValue('--map-accent').trim()).toBe('#c56bff')
    // The hour reaches the table as a tint and a dimming, never as a repaint.
    expect(board.style.getPropertyValue('--scene-dark').trim()).not.toBe('')
    expect(screen.getByTestId('table')).toBeInTheDocument()
  })

  it('falls back to the built-in felt with no map', () => {
    act(() => { gameStore.setState({ mapId: '', mapLoading: null }) })
    renderGame()
    const board = screen.getByTestId('game-board')
    expect(board).toHaveAttribute('data-map', '')
    expect(board.querySelector('[data-scene]')).toBeNull()
    expect(board.style.getPropertyValue('--tbl-felt')).toBe('')
    // The felt is still there: the tokens' near-black table is what the
    // variables fall back to.
    expect(screen.getByTestId('table')).toBeInTheDocument()
  })
})
