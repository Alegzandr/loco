import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from './render'
import { act } from './renderHook'
import { gameStore } from '../hooks/gameStore'
import type { ClientMsg } from '../types/protocol'

// A matchmade table with nobody left at it cannot deal a rematch: the agreement
// has one side. Rather than leave the player on a screen whose main button can
// never complete, App puts them back in the queue, and cancelling the search is
// how they leave instead. An ordinary table is left alone — there is a room, a
// code and a lobby to reopen, and nobody there queued for a stranger.

const sent: ClientMsg[] = []
const stableSend = (msg: ClientMsg) => {
  sent.push(msg)
}
const stableForceClose = () => {}
vi.mock('../hooks/webSocket.svelte', () => ({
  webSocket: () => ({ send: stableSend, wsStatus: 'open', forceClose: stableForceClose }),
}))
vi.mock('../hooks/appEffects.svelte', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/appEffects.svelte')>()),
  gameAudio: () => {},
}))

const { default: App } = await import('../App.svelte')

const alice = { index: 0, nickname: 'Alice', hand_size: 0, connected: true }
const bob = { index: 1, nickname: 'Bob', hand_size: 0, connected: true }

function seedGameOver(over: Partial<ReturnType<typeof gameStore.getState>>) {
  gameStore.setState({
    screen: 'gameover',
    myIndex: 0,
    myNickname: 'Alice',
    players: [alice, bob],
    matchOver: true,
    matchWinner: 'Alice',
    scoreboard: [],
    rematchOffers: [],
    rematchNeeded: 0,
    forfeitBy: null,
    isMatchmade: false,
    ...over,
  })
}

beforeEach(() => {
  sent.length = 0
})

describe('a matchmade table nobody is left at', () => {
  it('goes back to the queue by default', () => {
    seedGameOver({ isMatchmade: true, players: [alice], forfeitBy: 1 })
    render(App)

    expect(sent).toContainEqual({ type: 'find_match', nickname: 'Alice' })
    expect(gameStore.getState().screen).toBe('searching')
  })

  it('stays put while the opponent is still there to agree with', () => {
    seedGameOver({ isMatchmade: true })
    render(App)

    expect(sent).toHaveLength(0)
    expect(gameStore.getState().screen).toBe('gameover')
  })

  it('leaves an ordinary table alone, empty or not', () => {
    seedGameOver({ players: [alice] })
    render(App)

    expect(sent).toHaveLength(0)
    expect(gameStore.getState().screen).toBe('gameover')
  })
})

describe('asking for a rematch', () => {
  it('sends the ask and nothing else: the deal is the server’s to decide', () => {
    seedGameOver({})
    const { getByRole } = render(App)

    act(() => {
      getByRole('button', { name: /Rematch|Revanche/ }).click()
    })

    expect(sent).toEqual([{ type: 'rematch' }])
  })
})
