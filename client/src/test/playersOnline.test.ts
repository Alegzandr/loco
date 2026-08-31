import { readFileSync } from 'node:fs'
import path from 'node:path'
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

/**
 * One placement under 46rem, written into two files.
 *
 * The plate and the row it faces are both absolutely positioned, so at phone
 * widths they do not wrap, do not push and do not overflow: they simply overlap,
 * and the count is read half-covered by the gear and the speaker. That is what
 * the searching screen shipped, because the plate was left in the top-left
 * corner "at every width" on the grounds that this screen has no burger — true,
 * and beside the point, since the row opposite is three controls wide and one of
 * them is the "How to play" pill.
 *
 * jsdom lays nothing out and applies no component styles, so the collision is
 * invisible to a rendering test; the review is `make visual`. What can be pinned
 * is that both screens still make the same move at the same width, which is the
 * half that would be quietly dropped by an edit to one file.
 */
describe('the plate moves to the foot under 46rem', () => {
  const source = (file: string) =>
    readFileSync(path.resolve(__dirname, '..', 'components', file), 'utf8')

  /** The `.online` rule inside the 46rem media block, comments and gaps out. */
  function narrowPlacement(file: string): string {
    const block = /@media \(max-width: 46rem\)\s*\{\s*\.online\s*\{([^}]*)\}/.exec(
      source(file),
    )?.[1]
    expect(block, `${file} must move .online under 46rem`).toBeDefined()
    return (block ?? '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split(';')
      .map((d) => d.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .sort()
      .join(';')
  }

  it('the entry screen and the wait agree, declaration for declaration', () => {
    expect(narrowPlacement('Searching.svelte')).toBe(narrowPlacement('Lobby.svelte'))
  })

  it('and what they agree on is the foot of the screen, centred', () => {
    const placement = narrowPlacement('Lobby.svelte')
    expect(placement, 'off the top line').toMatch(/top: auto/)
    expect(placement, 'against the bottom edge, clear of the home indicator').toMatch(
      /bottom: calc\(var\(--space-lg\) \+ var\(--safe-bottom\)\)/,
    )
    // Anchored at the middle, an absolute box is offered the half of the line it
    // starts at: without this the count wraps inside its own plate.
    expect(placement, 'sized to its contents').toMatch(/width: max-content/)
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
