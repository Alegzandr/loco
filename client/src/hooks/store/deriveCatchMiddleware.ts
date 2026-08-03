import { StateCreator } from './createStore'
import { deriveCatch } from './helpers'
import { GameStore } from './types'

/**
 * `catchTarget` and `unoTimerEnd` are not state. They are the answer to "which
 * open window is the button offering", read off `catchWindows` and our own
 * seat, and they are stored only because every screen reads them and a
 * recomputation per render would be noise.
 *
 * Stored derived state has one failure mode and this store had eight chances to
 * hit it: an action that changes `catchWindows` and forgets to spread
 * `deriveCatch(...)` leaves the button pointed at a window that is gone, or
 * pointed at nothing while a seat is catchable. Nothing fails, nothing logs,
 * and the loss is a reaction the player was entitled to.
 *
 * So no action derives them any more. Any write that touches `catchWindows` or
 * `myIndex` is completed here, which is the only way to make forgetting
 * impossible rather than merely unlikely. `src/test/catchDerivation.test.ts`
 * owns the rule.
 */
type Creator = StateCreator<GameStore>

export const deriveCatchState =
  (creator: Creator): Creator =>
  (set, get, store) => {
    const derivedSet = ((partial: Parameters<typeof set>[0]) => {
      set((state) => {
        const patch =
          typeof partial === 'function'
            ? (partial as (s: GameStore) => Partial<GameStore>)(state)
            : (partial as Partial<GameStore>)
        // A write that names neither cannot have changed the answer. `myIndex`
        // counts: an authoritative snapshot can re-seat us, and our own window
        // is never the one the button offers.
        if (!('catchWindows' in patch) && !('myIndex' in patch)) return patch
        const merged = { ...state, ...patch }
        return { ...patch, ...deriveCatch(merged.catchWindows, merged.myIndex) }
      })
    }) as typeof set

    // Writes that come from outside an action (a test seeding a board, the E2E
    // bridge) go through the same completion.
    store.setState = derivedSet
    return creator(derivedSet, get, store)
  }
