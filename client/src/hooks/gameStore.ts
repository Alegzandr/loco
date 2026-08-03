import { createStore } from './store/createStore'
import { deriveCatchState } from './store/deriveCatchMiddleware'
import { initialState } from './store/initialState'
import { createSessionActions } from './store/sessionActions'
import { createTableActions } from './store/tableActions'
import { createLocoActions } from './store/locoActions'
import { createMatchActions } from './store/matchActions'
import { createQueueActions } from './store/queueActions'
import type { GameStore } from './store/types'

// The store's whole surface, re-exported from here because this is the path
// every screen already imports: the value types, the two constants and the
// hand-pruning helper. `store/` is where the transitions live.
export * from './store/types'
export { removePlayedCards } from './store/helpers'

/**
 * One store, five families of transitions.
 *
 * The state is a single object because that is what it is: the client's mirror of
 * one match. Several actions write across the families on purpose, since an
 * authoritative snapshot settles the board, the declarations and the scoreboard in
 * the same breath. What is split here is the *reading*, not the state.
 *
 * Nothing in here is authoritative. Every field is either the server's last word
 * or a presentation detail derived from it, and anything a rule depends on is
 * refused server-side whatever this store says.
 *
 * `deriveCatchState` completes every write that touches `catchWindows` or
 * `myIndex`, so no action carries the derivation and none can forget it.
 *
 * Read it from a component through `gameStore.svelte.ts`, which holds the one
 * subscription the app needs; read it from anything that renders nothing —
 * `serverMessages`, the audio, the session mirror, the E2E bridge — straight off
 * this object.
 */
export const gameStore = createStore<GameStore>(
  deriveCatchState((...a) => ({
    ...initialState,
    ...createSessionActions(...a),
    ...createTableActions(...a),
    ...createLocoActions(...a),
    ...createMatchActions(...a),
    ...createQueueActions(...a),
  })),
)
