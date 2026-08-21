import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from './render'
import Lobby from '../components/Lobby.svelte'
import { gameStore } from '../hooks/gameStore'
import { createServerMessageHandler } from '../hooks/serverMessages'
import {
  LIVE_ROWS,
  formatViewers,
  hasLiveStreams,
  moreLiveCount,
  topLiveStreams,
} from '../components/liveStreams'
import { EXTERNAL_REL, TWITCH_CATEGORY, twitchCategory, twitchChannel } from '../components/twitchLinks'
import { en } from '../i18n/en'
import type { LiveStreamDTO, ServerMsg } from '../types/protocol'

function stream(login: string, viewers: number, thumb = ''): LiveStreamDTO {
  return { login, name: login, viewers, thumb }
}

function renderLobby(liveStreams: LiveStreamDTO[]) {
  return render(Lobby, {
    onSend: vi.fn(),
    onFindMatch: vi.fn(),
    onPlayBot: vi.fn(),
    error: '',
    onClearError: vi.fn(),
    liveStreams,
  })
}

const handle = createServerMessageHandler({ clear: () => {}, arm: () => {} })

describe('the live strip', () => {
  beforeEach(() => {
    localStorage.clear()
    gameStore.setState({ liveStreams: [] })
  })

  // The order is Twitch's own, biggest first, carried through the server
  // untouched. A version of this that sorted would pass a naive test and then
  // disagree with the category page it links to.
  it('cuts the list and never sorts it', () => {
    const list = [stream('c', 10), stream('a', 900), stream('b', 50), stream('d', 5)]
    expect(topLiveStreams(list).map((s) => s.login)).toEqual(['c', 'a', 'b'])
    expect(topLiveStreams(list, 2).map((s) => s.login)).toEqual(['c', 'a'])
    expect(topLiveStreams(list, 0)).toEqual([])
    // The input is not touched either.
    expect(list.map((s) => s.login)).toEqual(['c', 'a', 'b', 'd'])
  })

  it('counts what it did not draw, from what actually arrived', () => {
    expect(moreLiveCount([stream('a', 1), stream('b', 1)])).toBe(0)
    expect(moreLiveCount(Array.from({ length: 6 }, (_, i) => stream(`c${i}`, 1)))).toBe(6 - LIVE_ROWS)
  })

  // One channel live is one thing to watch, where one player online is "you
  // are alone" — so there is no floor here, only the empty case.
  it('has no floor above one', () => {
    expect(hasLiveStreams([])).toBe(false)
    expect(hasLiveStreams([stream('a', 0)])).toBe(true)
  })

  it('shortens a viewer count without inventing one', () => {
    expect(formatViewers(0, 'en')).toBe('0')
    expect(formatViewers(999, 'en')).toBe('999')
    expect(formatViewers(1234, 'en')).toBe('1.2K')
    expect(formatViewers(1234, 'fr')).toBe('1,2 k')
    expect(formatViewers(55800, 'en')).toBe('55.8K')
    expect(formatViewers(120400, 'en')).toBe('120K')
  })

  // Nobody live is nothing at all: no plate, no invitation, no line saying the
  // category is empty. Same reasoning that keeps the connected-player count off
  // the screen below its floor.
  it('is absent entirely when nobody is streaming', () => {
    renderLobby([])
    expect(screen.queryByLabelText(en.liveAria)).toBeNull()
    expect(screen.queryByText(en.liveHead)).toBeNull()
  })

  it('draws the top rows when somebody is', () => {
    renderLobby([stream('kisuke_', 1200), stream('someone', 40), stream('third', 3), stream('fourth', 1)])

    expect(screen.getByLabelText(en.liveAria)).toBeTruthy()
    expect(screen.getByText('kisuke_')).toBeTruthy()
    expect(screen.queryByText('fourth')).toBeNull()
    // What it did not draw is offered as a link to the page, never as a promise
    // about channels the server did not send.
    expect(screen.getAllByText(en.liveMore(1)).length).toBeGreaterThan(0)
  })

  // A link out of the game sits on the entry screen and nowhere else: once a
  // form is up it owns the screen, and an exit beside the nickname field is an
  // exit offered on the way in.
  it('is gone once a form is open', async () => {
    const { getByText, queryByLabelText } = renderLobby([stream('kisuke_', 1200)])
    getByText(en.createRoom).click()
    await Promise.resolve()
    expect(queryByLabelText(en.liveAria)).toBeNull()
  })

  // The picture is served by this origin. A Twitch URL in a src would be
  // refused by img-src 'self' and would tell Twitch that somebody opened the
  // page, which is the whole thing this design avoids.
  it('only ever draws a preview from this origin', () => {
    const { container } = renderLobby([stream('kisuke_', 1200, '/live-thumb/abc123')])
    const img = container.querySelector('img.thumb') as HTMLImageElement | null
    expect(img).not.toBeNull()
    expect(img!.getAttribute('src')!.startsWith('/')).toBe(true)
    // Written on the element, so a preview arriving late cannot resize the
    // strip on the screen the site's largest paint is measured on.
    expect(img!.getAttribute('width')).toBe('96')
    expect(img!.getAttribute('height')).toBe('54')
  })

  it('keeps the row when there is no picture', () => {
    const { container } = renderLobby([stream('kisuke_', 1200)])
    expect(container.querySelector('img.thumb')).toBeNull()
    expect(screen.getByText('kisuke_')).toBeTruthy()
  })

  it('carries the outgoing link with the attributes that make it safe', () => {
    const { container } = renderLobby([stream('kisuke_', 1200)])
    const link = container.querySelector('a.card') as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('https://www.twitch.tv/kisuke_')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
    expect(link.getAttribute('rel')).toContain('noreferrer')
  })

  // The wire message reaches the screen the same way players_online does.
  it('is filled from live_streams and survives leaving a table', () => {
    const msg: ServerMsg = {
      type: 'live_streams',
      live_streams: [{ login: 'kisuke_', name: 'Kisuke', viewers: 12, thumb: '' }],
    }
    handle(msg)
    expect(gameStore.getState().liveStreams).toHaveLength(1)

    // The list belongs to the socket, not to the seat.
    gameStore.getState().resetToHome()
    expect(gameStore.getState().liveStreams).toHaveLength(1)
  })

  it('reads an absent list as nobody live', () => {
    handle({ type: 'live_streams', live_streams: [{ login: 'a', name: 'a', viewers: 1, thumb: '' }] })
    handle({ type: 'live_streams' } as ServerMsg)
    expect(gameStore.getState().liveStreams).toEqual([])
  })
})

describe('outgoing links', () => {
  it('builds a channel URL only from something shaped like a login', () => {
    expect(twitchChannel('kisuke_')).toBe('https://www.twitch.tv/kisuke_')
    expect(twitchChannel('L0co9000')).toBe('https://www.twitch.tv/L0co9000')
    for (const bad of ['', 'a/b', '../evil', 'a?x=1', 'https://evil.example', 'a b', 'x'.repeat(26)]) {
      // An empty href navigates nowhere, which is the right failure for a row
      // that should never have arrived.
      expect(twitchChannel(bad)).toBe('')
    }
  })

  it('names the category as data rather than as a URL', () => {
    expect(TWITCH_CATEGORY).toBe('loco-2026')
    expect(twitchCategory()).toBe('https://www.twitch.tv/directory/category/loco-2026')
  })

  it('spells the rel every outgoing link carries', () => {
    expect(EXTERNAL_REL.split(' ')).toContain('noopener')
    expect(EXTERNAL_REL.split(' ')).toContain('noreferrer')
  })
})
