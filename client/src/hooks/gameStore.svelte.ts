import { gameStore, type GameStore } from './gameStore'

/**
 * Svelte's window onto the game store, the counterpart of `gameStore()`.
 *
 * One subscription for the whole app, taken at module load and never torn down:
 * the store is a module (`store/createStore.ts`) and outlives every screen, so a
 * subscription that came and went with a component would only add a way for the
 * first frame after a mount to be stale.
 *
 * **One signal per field, not one for the store.** The store replaces its whole
 * state on every write, several times a second, and almost everything that reads
 * it watches one field. When this window was a single `$state.raw` holding the
 * snapshot, an effect reading `game.current.errorMsg` depended on the entire
 * match: every message the server sent re-ran it, and the effects that re-ran
 * were the ones owning timers, so a window measured in seconds never reached its
 * own end on a busy table (`live.svelte.ts` was the patch, field by field). Here
 * each top-level key is its own `$state.raw` cell, and a write moves only the
 * cells whose value is not `Object.is` the one before. Reading a field depends on
 * that field, wherever it is read from — an effect, a `$derived`, a template, or
 * a local holding `game.current`.
 *
 * `game.current` is one object for the life of the tab, a getter per key, typed
 * as the store. Spreading it, `JSON.stringify` and `Object.keys` all still see
 * the whole state, because each getter is enumerable; what no longer exists is a
 * *new identity per write*. Nothing in the client keys on that — but anything
 * that genuinely wants "the store moved" reads `game.snapshot`, which is the
 * store's own object and depends on every write, on purpose and by name.
 *
 * `$state.raw`, not `$state`: the store already replaces what it changes, so a
 * deep proxy would clone the board's identity on each read for nothing — and the
 * props handed down are compared by identity.
 */

interface Cell {
  get(): unknown
  set(value: unknown): void
}

/** One field's signal. A function, so each call is its own `$state.raw`. */
function cell(initial: unknown): Cell {
  let value = $state.raw(initial)
  return {
    get: () => value,
    set: (next) => {
      value = next
    },
  }
}

// A plain record, not a Map: the cells are the signals, and the set of keys is
// fixed at load (see the subscription), so nothing reactive reads the container.
const cells: Record<string, Cell> = Object.create(null)
let fields = 0
const view = {} as GameStore

function addField(key: string, initial: unknown): void {
  const c = cell(initial)
  cells[key] = c
  fields++
  Object.defineProperty(view, key, { get: c.get, enumerable: true, configurable: true })
}

let whole = $state.raw(gameStore.getState())
for (const [key, value] of Object.entries(whole)) addField(key, value)

gameStore.subscribe((next, prev) => {
  for (const key in cells) {
    const c = cells[key]
    // Compared with `prev`, never with `c.get()`: the app writes the store from
    // inside effects, and reading a cell there would make that effect depend on
    // it. The cells always hold `prev`, since every write comes through here.
    // A write that drops a key (`setState(x, true)`, which nothing in the app
    // does) reads as the key going to `undefined`, like any other change.
    const value = (next as unknown as Record<string, unknown>)[key]
    if (!Object.is(value, (prev as unknown as Record<string, unknown>)[key])) c.set(value)
  }
  // A key the initial state did not have. None exists — `GameState` has no
  // optional field and nothing replaces the state — but a field added that way
  // must still be readable and tracked rather than silently `undefined`.
  if (fields !== Object.keys(next).length) {
    for (const [key, value] of Object.entries(next)) if (!(key in cells)) addField(key, value)
  }
  whole = next
})

export const game: {
  /** The store, a field at a time: reading `x` depends on `x` alone. */
  readonly current: GameStore
  /** The store's whole state, which moves on every write. Rarely what you want. */
  readonly snapshot: GameStore
} = {
  current: view,
  get snapshot() {
    return whole
  },
}
