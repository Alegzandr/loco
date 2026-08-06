import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  BEAT_MS,
  STALE_MS,
  initTabLock,
  isTabActive,
  otherTabSeated,
  resetTabLock,
  setTabSeated,
  takeOverTab,
} from '../hooks/tabLock'

// One tab holds the game. These pin the election itself; the curtain it puts on
// screen, and the fact that a blocked tab opens no socket, are in
// `tabTaken.test.ts`.
//
// Everything here is written against `localStorage` rather than against a
// `BroadcastChannel`, which is the same order the module decides in: the channel
// only ever makes a handover instant, and a test that needed it would be pinning
// the optimisation instead of the guarantee.

const TAB_KEY = 'loco_tab'

interface TabRecord {
  id: string
  at: number
  seated: boolean
}

function readRecord(): TabRecord | null {
  const raw = localStorage.getItem(TAB_KEY)
  return raw ? (JSON.parse(raw) as TabRecord) : null
}

/** Another tab, beating right now. */
function otherTabHolds(seated = false, age = 0): void {
  localStorage.setItem(
    TAB_KEY,
    JSON.stringify({ id: 'other-tab', at: Date.now() - age, seated }),
  )
}

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-06T12:00:00Z'))
})

afterEach(() => {
  resetTabLock()
  vi.useRealTimers()
})

describe('electing the tab that holds the game', () => {
  it('takes it when nobody else has it', () => {
    expect(initTabLock()).toBe(true)
    expect(isTabActive()).toBe(true)
    expect(readRecord()?.at).toBe(Date.now())
  })

  it('stands aside for a tab that is beating', () => {
    otherTabHolds()
    initTabLock()

    expect(isTabActive()).toBe(false)
    // And it left the other tab's record alone. Overwriting it would make both
    // tabs owners, each having decided it was the last to write.
    expect(readRecord()?.id).toBe('other-tab')
  })

  // A tab that crashes, or that the OS kills, sends no release. A plain flag
  // would lock the game away for good; the record is a heartbeat for this.
  it('takes it from a record nobody is behind any more', () => {
    otherTabHolds(false, STALE_MS + 1)
    initTabLock()

    expect(isTabActive()).toBe(true)
    expect(readRecord()?.id).not.toBe('other-tab')
  })

  // A clock that moved backwards leaves a record dated in the future, and
  // "younger than STALE_MS" is true of it forever: the game would be unplayable
  // in every tab until somebody cleared storage by hand.
  it('treats a record from the future as nobody’s', () => {
    localStorage.setItem(
      TAB_KEY,
      JSON.stringify({ id: 'other-tab', at: Date.now() + 60_000, seated: false }),
    )
    initTabLock()

    expect(isTabActive()).toBe(true)
  })

  it('keeps saying it is there', () => {
    initTabLock()
    const first = readRecord()?.at

    vi.advanceTimersByTime(BEAT_MS * 2)

    expect(readRecord()?.at).toBeGreaterThan(first!)
  })

  // Two tabs opened in the same millisecond both wrote, and the last write won.
  // The loser finds out on its next beat rather than staying a second owner.
  it('yields when it finds somebody else’s record under its own', () => {
    initTabLock()
    expect(isTabActive()).toBe(true)

    otherTabHolds()
    vi.advanceTimersByTime(BEAT_MS)

    expect(isTabActive()).toBe(false)
  })
})

describe('the game coming back to a blocked tab', () => {
  it('arrives on its own when the other tab stops beating', () => {
    otherTabHolds()
    initTabLock()
    expect(isTabActive()).toBe(false)

    // Nothing is pressed here: the other tab simply went away.
    vi.advanceTimersByTime(STALE_MS + BEAT_MS)

    expect(isTabActive()).toBe(true)
  })

  it('arrives at once when the other tab clears its record', () => {
    otherTabHolds()
    initTabLock()

    localStorage.removeItem(TAB_KEY)
    window.dispatchEvent(new StorageEvent('storage', { key: TAB_KEY, newValue: null }))

    expect(isTabActive()).toBe(true)
  })

  it('is taken by the button on the curtain', () => {
    otherTabHolds(true)
    initTabLock()
    expect(isTabActive()).toBe(false)

    takeOverTab()

    expect(isTabActive()).toBe(true)
    expect(readRecord()?.id).not.toBe('other-tab')
  })
})

describe('what the curtain is told', () => {
  it('knows the other tab is at a table', () => {
    otherTabHolds(true)
    initTabLock()

    expect(otherTabSeated()).toBe(true)
  })

  it('knows it is not', () => {
    otherTabHolds(false)
    initTabLock()

    expect(otherTabSeated()).toBe(false)
  })

  // The other tab sat down after this one had already drawn the curtain. The
  // copy turns on this, so a stale answer is a player told that taking the game
  // costs nothing when it costs a match.
  it('follows the other tab sitting down', () => {
    otherTabHolds(false)
    initTabLock()
    expect(otherTabSeated()).toBe(false)

    otherTabHolds(true)
    vi.advanceTimersByTime(BEAT_MS)

    expect(otherTabSeated()).toBe(true)
  })

  it('publishes its own seat while it holds the game', () => {
    initTabLock()
    setTabSeated(true)

    expect(readRecord()?.seated).toBe(true)
  })
})

// A player wrongly shut out of the game is worse than two tabs, and it is the
// refusal they cannot argue with. Every one of these ends with the game playable.
describe('when in doubt, own it', () => {
  it('owns it when storage refuses to be written', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })

    expect(initTabLock()).toBe(true)

    setItem.mockRestore()
  })

  it('owns it when the record will not parse', () => {
    localStorage.setItem(TAB_KEY, 'not json')
    initTabLock()

    expect(isTabActive()).toBe(true)
  })

  it('owns it when the record is missing what it needs', () => {
    localStorage.setItem(TAB_KEY, JSON.stringify({ seated: true }))
    initTabLock()

    expect(isTabActive()).toBe(true)
  })

  it('owns it without a BroadcastChannel', () => {
    const original = globalThis.BroadcastChannel
    // @ts-expect-error deleting a global the module is expected to survive
    delete globalThis.BroadcastChannel

    otherTabHolds()
    initTabLock()
    // Still elected correctly: the channel is the instant handover, never the
    // decision.
    expect(isTabActive()).toBe(false)

    vi.advanceTimersByTime(STALE_MS + BEAT_MS)
    expect(isTabActive()).toBe(true)

    globalThis.BroadcastChannel = original
  })
})
