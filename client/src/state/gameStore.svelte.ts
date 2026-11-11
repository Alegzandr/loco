import { gameStore, type GameStore } from './gameStore'

/**
 * Svelte's window onto the game store, the counterpart of `gameStore()`.
 *
 * One subscription for the whole app, taken at module load and never torn down:
 * the store is a module (`store/createStore.ts`) and outlives every screen, so a
 * subscription that came and went with a component would only add a way for the
 * first frame after a mount to be stale.
 *
 * Reading the whole state is deliberate in the game view and nowhere else: it is
 * the one screen that genuinely displays most of it, and the expensive half — the
 * board — is a child with its own props. The rule that nothing subscribes to the
 * whole store still holds for everything above it.
 */
// `$state.raw`, not `$state`: the store already replaces the whole object on
// every write, so a deep proxy would clone the board's identity on each read for
// nothing — and the props handed down are compared by identity.
let snapshot = $state.raw(gameStore.getState())
gameStore.subscribe((next) => {
  snapshot = next
})

export const game: { readonly current: GameStore } = {
  get current() {
    return snapshot
  },
}
