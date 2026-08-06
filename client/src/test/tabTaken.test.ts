import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from './render'
import { act } from './renderHook'
import { en } from '../i18n/en'
import { initTabLock, resetTabLock, takeOverTab } from '../hooks/tabLock'
import TabTaken from '../components/TabTaken.svelte'

// The point of the whole mechanism, asserted where it can actually fail: a tab
// that is not holding the game opens no socket. `webSocket()` is called at the
// top of App.svelte's script, so this is a question about what gets mounted, and
// `Root.svelte` is the only thing that answers it.
let socketsOpened = 0
vi.mock('../hooks/webSocket.svelte', () => ({
  webSocket: () => {
    socketsOpened += 1
    return { send: () => {}, wsStatus: 'open', forceClose: () => {} }
  },
}))

vi.mock('../hooks/appEffects.svelte', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/appEffects.svelte')>()),
  gameAudio: () => {},
}))

const { default: Root } = await import('../Root.svelte')

const TAB_KEY = 'loco_tab'

function otherTabHolds(seated: boolean): void {
  localStorage.setItem(TAB_KEY, JSON.stringify({ id: 'other-tab', at: Date.now(), seated }))
}

beforeEach(() => {
  localStorage.clear()
  socketsOpened = 0
})

afterEach(() => {
  resetTabLock()
})

describe('the tab that is not holding the game', () => {
  it('draws the curtain instead of the game, and opens no socket', () => {
    otherTabHolds(false)
    initTabLock()

    render(Root)

    expect(screen.getByText(en.tabTakenTitle)).toBeInTheDocument()
    expect(socketsOpened).toBe(0)
  })

  it('opens exactly one when it does hold the game', () => {
    initTabLock()

    render(Root)

    expect(screen.queryByText(en.tabTakenTitle)).not.toBeInTheDocument()
    expect(socketsOpened).toBe(1)
  })

  // The button is worth nothing if the app does not actually arrive behind it.
  it('brings the game here when the button is pressed', () => {
    otherTabHolds(false)
    initTabLock()
    render(Root)
    expect(socketsOpened).toBe(0)

    act(() => takeOverTab())

    expect(screen.queryByText(en.tabTakenTitle)).not.toBeInTheDocument()
    expect(socketsOpened).toBe(1)
  })
})

describe('what the curtain says', () => {
  it('offers the game when the other tab is on the menu', () => {
    render(TabTaken, { seated: false, onTake: () => {} })

    expect(screen.getByText(en.tabTakenHint)).toBeInTheDocument()
    expect(screen.queryByText(en.tabTakenHintSeated)).not.toBeInTheDocument()
  })

  // What the player cannot see from this screen is what pressing the button
  // costs the tab they are not looking at. Same rule as the board's leave note.
  it('says what it costs when the other tab is at a table', () => {
    render(TabTaken, { seated: true, onTake: () => {} })

    expect(screen.getByText(en.tabTakenHintSeated)).toBeInTheDocument()
    expect(screen.queryByText(en.tabTakenHint)).not.toBeInTheDocument()
  })

  it('has one control, and it takes the game', async () => {
    const onTake = vi.fn()
    render(TabTaken, { seated: false, onTake })

    await fireEvent.click(screen.getByRole('button', { name: en.tabTakenTake }))

    expect(onTake).toHaveBeenCalledTimes(1)
  })
})
