/**
 * The store's own contract, tested apart from the game that rides on it.
 *
 * `hooks/store/createStore.ts` replaced a dependency, and a dependency's
 * semantics are not documented by the code that used them: `gameStore.test.ts`
 * exercises 209 reads and writes against this API without ever stating what the
 * API promises, so a replacement that got one of these details wrong would fail
 * there in a way that reads like a game bug. Each case below is a detail
 * something in this client actually depends on.
 */
import { describe, it, expect, vi } from 'vitest'
import { createStore, type StateCreator, type StoreApi } from '../hooks/store/createStore'

interface Counter {
  n: number
  label: string
  bump: () => void
}

const counter: StateCreator<Counter> = (set, get) => ({
  n: 0,
  label: 'zero',
  bump: () => set({ n: get().n + 1 }),
})

describe('createStore', () => {
  it('returns the state the creator built, actions included', () => {
    const store = createStore(counter)
    expect(store.getState().n).toBe(0)
    expect(typeof store.getState().bump).toBe('function')
  })

  it('merges a partial write rather than replacing the state', () => {
    // Every action in `store/` writes a partial: `set({ error: null })` must not
    // take the hand, the deck and the scoreboard with it.
    const store = createStore(counter)
    store.setState({ n: 3 })
    expect(store.getState()).toMatchObject({ n: 3, label: 'zero' })
  })

  it('gives a function write the current state', () => {
    const store = createStore(counter)
    store.setState({ n: 5 })
    store.setState((s) => ({ n: s.n * 2 }))
    expect(store.getState().n).toBe(10)
  })

  it('replaces wholesale when asked', () => {
    const store = createStore(counter)
    store.setState({ n: 9, label: 'nine', bump: () => {} }, true)
    expect(store.getState().n).toBe(9)
    expect(Object.keys(store.getState()).sort()).toEqual(['bump', 'label', 'n'])
  })

  it('notifies with the new state and the one before it', () => {
    const store = createStore(counter)
    const seen = vi.fn()
    store.subscribe(seen)
    store.setState({ n: 1 })
    // `gameAudio` diffs these two snapshots to decide which sounds to play,
    // and `e2eBridge`'s turn recorder reads the first argument. A listener
    // called with one argument would leave both silently comparing a value
    // against itself.
    expect(seen).toHaveBeenCalledTimes(1)
    expect(seen.mock.calls[0][0].n).toBe(1)
    expect(seen.mock.calls[0][1].n).toBe(0)
  })

  it('has already applied the write by the time a listener runs', () => {
    const store = createStore(counter)
    let readInside = -1
    store.subscribe(() => {
      readInside = store.getState().n
    })
    store.setState({ n: 7 })
    expect(readInside).toBe(7)
  })

  it('stops calling a listener that unsubscribed', () => {
    const store = createStore(counter)
    const seen = vi.fn()
    const off = store.subscribe(seen)
    store.setState({ n: 1 })
    off()
    store.setState({ n: 2 })
    expect(seen).toHaveBeenCalledTimes(1)
  })

  it('keeps the state the creator built available after any number of writes', () => {
    // `getInitialState` is what the React binding hands `useSyncExternalStore`
    // as its server snapshot, and it must not follow the live state.
    const store = createStore(counter)
    store.setState({ n: 42 })
    expect(store.getInitialState().n).toBe(0)
  })

  it('lets a middleware replace setState for writes made from outside', () => {
    // This is the whole mechanism behind `deriveCatchMiddleware`: the creator
    // receives the store object and reassigns `setState` on it, so a test
    // seeding a board or the E2E bridge writing directly goes through the same
    // completion an action does. It only works if the store publishes the
    // property the creator mutated rather than a copy taken before it ran.
    const middleware =
      (creator: StateCreator<Counter>): StateCreator<Counter> =>
      (set, get, store) => {
        const wrapped = ((partial: Parameters<typeof set>[0]) => {
          set((state) => {
            const patch =
              typeof partial === 'function'
                ? (partial as (s: Counter) => Partial<Counter>)(state)
                : (partial as Partial<Counter>)
            return { ...patch, label: `n=${patch.n ?? state.n}` }
          })
        }) as typeof set
        store.setState = wrapped
        return creator(wrapped, get, store)
      }

    const store: StoreApi<Counter> = createStore(middleware(counter))

    store.setState({ n: 4 })
    expect(store.getState().label).toBe('n=4')

    store.getState().bump()
    expect(store.getState()).toMatchObject({ n: 5, label: 'n=5' })
  })

  it('says nothing when a write produces the state it already had', () => {
    const store = createStore(counter)
    const seen = vi.fn()
    store.subscribe(seen)
    store.setState((s) => s)
    expect(seen).not.toHaveBeenCalled()
  })
})
