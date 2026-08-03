import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from './render'
import { act } from './renderHook'
import { gameStore } from '../hooks/gameStore'
import { gameViewStub } from './gameViewStub'

// The match screen is built once and then left alone: it is the most expensive
// tree in the app and the store underneath it changes several times a second.
// All of that is decided one level up, in App, which owns the tree — so these
// pin the parent half of the contract.
//
// Under React the contract was a `memo` and the danger was an unstable prop.
// Under Svelte the component is instantiated once by construction, and the way
// to lose that is structural: a `{#key}` around the board, or a keyed block
// whose key moves with the state. Same bug, different spelling, same test.

// The real hook's send/forceClose are stable for the life of the app. A mock
// handing back fresh arrows would make handleSend unstable by itself and
// quietly prove nothing.
const stableSend = () => {}
const stableForceClose = () => {}
vi.mock('../hooks/webSocket.svelte', () => ({
  webSocket: () => ({ send: stableSend, wsStatus: 'open', forceClose: stableForceClose }),
}))

vi.mock('../hooks/appEffects.svelte', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/appEffects.svelte')>()),
  gameAudio: () => {},
}))

vi.mock('../components/GameView.svelte', async () => ({
  default: (await import('./GameViewStub.svelte')).default,
}))

const { default: App } = await import('../App.svelte')

beforeEach(() => {
  gameViewStub.reset()
  gameStore.setState({
    screen: 'game',
    myIndex: 0,
    players: [{ index: 0, nickname: 'Alice', hand_size: 3, connected: true }],
    latencies: [],
  })
})

describe('App does not rebuild the match screen on board state', () => {
  // The latency broadcast is the cheap, frequent one: every 3 seconds, all
  // match long, for information that lives in a panel nobody has open.
  it('ignores a latency broadcast', () => {
    render(App)
    const before = gameViewStub.instances
    expect(before).toBe(1)

    act(() => {
      gameStore.getState().applyLatencies([{ player_index: 0, rtt_ms: 42 }])
    })

    expect(gameViewStub.instances).toBe(before)
  })

  it('ignores a hand change', () => {
    render(App)
    const before = gameViewStub.instances

    act(() => {
      gameStore.setState({ myHand: [{ color: 'red', kind: 'number', value: 5 }] })
    })

    expect(gameViewStub.instances).toBe(before)
  })

  // onSend reaching GameView with a new identity on every store change is what
  // rebuilt its callbacks and defeated the board's memo under React. Svelte
  // hands it straight to the same handlers, so an unstable one costs less here
  // — but it is still the sign that App re-derived a tree it was meant to keep.
  it('hands GameView the same onSend across store updates', () => {
    render(App)
    const first = gameViewStub.onSend
    expect(first).toBeTypeOf('function')

    act(() => {
      gameStore.getState().applyLatencies([{ player_index: 0, rtt_ms: 42 }])
      gameStore.getState().setError('illegal card play')
    })

    expect(gameViewStub.onSend).toBe(first)
  })

  // It must still follow what it does render.
  it('tears it down when the screen changes', () => {
    const { queryByTestId } = render(App)
    expect(queryByTestId('game')).toBeTruthy()

    act(() => gameStore.setState({ screen: 'lobby' }))
    expect(queryByTestId('game')).toBeNull()
  })

  // The home page carries a block of text under the game — what a crawler reads,
  // and the only links from `/` to the content pages. It is markup Astro
  // rendered, not the app's to unmount, so App marks the document and CSS hides
  // it. A board that can be scrolled off-screen mid-match is the bug this
  // prevents; nothing else would catch it, because the block does not exist in
  // any of the screens a component test renders.
  it('marks the document as seated for every screen but the lobby', () => {
    const root = document.documentElement
    const { unmount } = render(App)
    expect(root.getAttribute('data-seated')).toBe('1')

    act(() => gameStore.setState({ screen: 'lobby' }))
    expect(root.hasAttribute('data-seated')).toBe(false)

    act(() => gameStore.setState({ screen: 'waiting' }))
    expect(root.getAttribute('data-seated')).toBe('1')

    // And it lets go on the way out, or a showcase scene would inherit it.
    unmount()
    expect(root.hasAttribute('data-seated')).toBe(false)
  })
})
