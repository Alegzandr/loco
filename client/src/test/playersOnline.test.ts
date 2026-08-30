import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from './render'
import Lobby from '../components/Lobby.svelte'
import Searching from '../components/Searching.svelte'
import { en } from '../i18n/en'
import { gameStore } from '../hooks/gameStore'
import { createServerMessageHandler } from '../hooks/serverMessages'
import { PLAYERS_ONLINE_MIN, showPlayersOnline } from '../components/playersOnline'
import type { ServerMsg } from '../types/protocol'

// App is mounted whole below, and these are the two things it reaches for on
// the way up that a jsdom page cannot give it. Same seams, same reasons, as
// appSubscription.test.ts.
vi.mock('../hooks/webSocket.svelte', () => ({
  webSocket: () => ({ send: () => {}, wsStatus: 'open', forceClose: () => {} }),
}))
vi.mock('../hooks/appEffects.svelte', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/appEffects.svelte')>()),
  gameAudio: () => {},
}))

const { default: App } = await import('../App.svelte')

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

function renderSearching(playersOnline: number) {
  return render(Searching, {
    startedAt: Date.now(),
    nickname: 'Nova',
    onCancel: vi.fn(),
    onCreateTable: vi.fn(),
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

  // The wait is where the question the count answers is actually being asked,
  // so the plate is drawn there on the same terms and with the same floor. It
  // still counts connections and never the queue: no copy of its own.
  it('draws the same plate while the queue is being waited on', () => {
    renderSearching(37)
    expect(screen.getByText(en.playersOnline(37))).toBeInTheDocument()
  })

  it('draws nothing below the floor on the searching screen either', () => {
    renderSearching(1)
    // The cancel control is what says the screen is really there: a query that
    // finds nothing over markup that rendered nothing passes forever.
    expect(screen.getByText(en.searchCancel)).toBeInTheDocument()
    expect(screen.queryByText(en.playersOnline(1))).not.toBeInTheDocument()
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

// The two cases above mount the screens with the prop already in hand, which
// says the components draw it and nothing about who hands it to them. App is
// the only thing that does, the two mounts are twenty lines apart, and a prop
// missing from one of them is not a failure Svelte reports: an unknown prop is
// ignored, a prop nobody passes takes its default, and the screen renders
// perfectly with no count on it. So this half goes through the whole app.
describe('the count reaches both screens through App', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('on the entry screen', () => {
    gameStore.setState({ screen: 'lobby', playersOnline: 7 })
    render(App)
    expect(screen.getByText(en.playersOnline(7))).toBeInTheDocument()
  })

  it('on the wait for an opponent', () => {
    gameStore.setState({ screen: 'searching', searchStartedAt: Date.now(), playersOnline: 7 })
    render(App)
    expect(screen.getByText(en.searchCancel)).toBeInTheDocument()
    expect(screen.getByText(en.playersOnline(7))).toBeInTheDocument()
  })
})
