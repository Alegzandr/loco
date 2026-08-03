/**
 * The store, in forty lines, with no framework in it.
 *
 * This replaced zustand, and the reason is not weight: a store the whole client
 * reads had to be readable by both frameworks at once while the app crossed
 * from React to Svelte, and afterwards by neither in particular. That second
 * half is why it stayed once the crossing landed — the board is still read by
 * modules that render nothing (`appEffects`, `serverMessages`,
 * `sessionRestore`, the E2E bridge). What the dependency was giving us was
 * `getState`, `setState`, `subscribe` and a middleware slot: four things with no
 * framework in them, wrapped in a React binding we then had to work around in
 * every one of those readers.
 *
 * The semantics are deliberately zustand's, to the letter, because 209 reads
 * and writes in `gameStore.test.ts` and every action in `store/` were written
 * against them. `src/test/storeCore.test.ts` states each one that something in
 * this client depends on; that file is the proof this swap changed nothing.
 */

/** A write: a patch, or a function of the current state producing one. */
export type StateSetter<T> = (
  partial: T | Partial<T> | ((state: T) => T | Partial<T>),
  replace?: boolean,
) => void

export interface StoreApi<T> {
  getState: () => T
  /** The state as the creator first built it. Never follows the live state. */
  getInitialState: () => T
  setState: StateSetter<T>
  subscribe: (listener: (state: T, prevState: T) => void) => () => void
}

/**
 * Builds a piece of the state, given the three things an action needs: a way to
 * write, a way to read, and the store itself — which a middleware reassigns
 * `setState` on, so that writes arriving from outside an action are completed
 * the same way (see `deriveCatchMiddleware.ts`).
 *
 * `Slice` is what this creator contributes; `T` is the whole store it reads and
 * writes. The five families in `store/` each return their own actions and all
 * five write across the state, which is the split this second parameter names.
 */
export type StateCreator<T, Slice = T> = (
  set: StateSetter<T>,
  get: () => T,
  store: StoreApi<T>,
) => Slice

export function createStore<T extends object>(creator: StateCreator<T>): StoreApi<T> {
  let state: T
  const listeners = new Set<(state: T, prevState: T) => void>()

  const setState: StateSetter<T> = (partial, replace) => {
    const next = typeof partial === 'function' ? (partial as (s: T) => T | Partial<T>)(state) : partial
    // An action that decides there is nothing to do returns the state it was
    // given. Notifying anyway would re-render the board on every message the
    // server sends that changes nothing.
    if (Object.is(next, state)) return
    const prevState = state
    state = replace ? (next as T) : Object.assign({}, state, next)
    for (const listener of listeners) listener(state, prevState)
  }

  const api: StoreApi<T> = {
    getState: () => state,
    getInitialState: () => initial,
    setState,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }

  // The creator runs against `api` and may replace `api.setState` before this
  // returns, which is exactly what the derivation middleware does. Nothing may
  // read `api.setState` into a variable before this line, or that replacement
  // would apply to actions and to nothing else.
  state = creator(setState, api.getState, api)
  // Declared after the creator so it can never be anything but the first state,
  // and read from `getInitialState`'s closure above, which only runs later.
  const initial = state

  return api
}
