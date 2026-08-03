import { flushSync } from 'svelte'
import { gameStore } from '../hooks/gameStore'

/**
 * A store write lands on screen before the next assertion.
 *
 * Half this suite seeds a board and then reads the DOM on the following line.
 * Svelte schedules its update on the microtask after the write, so without this
 * the assertion reads the frame before the one it is about.
 *
 * Subscribed rather than wrapped around `setState`: half the suite writes by
 * calling an *action* (`applyMatchLoading`, `applyMatchReady`), and an action
 * closed over the store's own setter. A listener catches every write whatever
 * spelled it.
 *
 * The order of the two subscriptions is the whole trick. `gameStore.svelte.ts`
 * holds the snapshot every component reads, and listeners fire in the order they
 * were added — so `setup.ts` imports it before calling this, and the flush below
 * runs after the snapshot it is meant to paint.
 *
 * And the guard is the rest of it. `flushSync()` drains batches until there are
 * none left, so calling it from inside a batch Svelte is already flushing takes
 * that batch out from under it: the effect that is mid-run finishes, Svelte goes
 * to schedule the next one, and `current_batch` is null. It surfaces as
 * `Cannot read properties of null (reading 'schedule')` from somewhere in the
 * component that happened to be mounted, which names neither the write nor this
 * file. The app does write the store from inside effects — `handleSend` clears
 * the last error before it sends — and those writes need no help from here:
 * Svelte is already going to paint them in the flush that is running.
 */
export function flushStoreWrites(): () => void {
  return gameStore.subscribe(() => {
    if ($effect.tracking()) return
    flushSync()
  })
}
