import { catchLiveUntil, isCatchLive } from '../../components/catchAvailability'
import { StateCreator } from './createStore'
import { deriveCatch } from './helpers'
import { GameStore } from './types'

/**
 * `catchTarget`, `unoTimerEnd`, `myDeclared` and `catchLive` are not state. They
 * are the answers to "which open window is the button offering", "have we
 * already called it" and "is the button pressable at all", read off
 * `catchWindows`, `declaredSeats`, `players` and our own seat, and they are
 * stored only because every screen reads them and a recomputation per render
 * would be noise.
 *
 * Stored derived state has one failure mode and this store had eight chances to
 * hit it: an action that changes `catchWindows` and forgets to spread
 * `deriveCatch(...)` leaves the button pointed at a window that is gone, or
 * pointed at nothing while a seat is catchable. Nothing fails, nothing logs,
 * and the loss is a reaction the player was entitled to.
 *
 * So no action derives them any more. Any write that touches `catchWindows`,
 * `players` or `myIndex` is completed here, which is the only way to make
 * forgetting impossible rather than merely unlikely.
 * `src/test/catchDerivation.test.ts` owns the rule.
 *
 * `catchLive` is the one that also reads the clock: a seat on its last card is
 * offered for as long as its window runs and not a moment longer, so beside
 * it the store keeps `catchLiveUntil`, the instant that answer changes by
 * itself. `GameView` arms one timer on it and calls `rereadCatchLive`, which
 * is a write naming `catchLive` and nothing else — enough to come back
 * through here (`components/catchAvailability.ts`).
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
        // An action that hands the state back unchanged is the store's own
        // "nothing to do", and it has to stay one: spreading it into a fresh
        // object here turned every no-op (a prune with nothing expired, a
        // player_left naming no seat) into a full-app invalidation.
        if (patch === state) return state
        // A write that names none of them cannot have changed the answers.
        // `myIndex` counts: an authoritative snapshot can re-seat us, and our
        // own window is never the one the button offers.
        if (
          !('catchWindows' in patch) &&
          !('myIndex' in patch) &&
          !('declaredSeats' in patch) &&
          !('players' in patch) &&
          !('onHookUntil' in patch) &&
          !('catchLive' in patch)
        ) {
          return patch
        }
        const merged = { ...state, ...patch }
        const now = Date.now()
        return {
          ...patch,
          ...deriveCatch(merged.catchWindows, merged.myIndex),
          myDeclared: merged.declaredSeats.includes(merged.myIndex),
          catchLive: isCatchLive(merged.players, merged.myIndex, merged.onHookUntil, now),
          catchLiveUntil: catchLiveUntil(merged.players, merged.myIndex, merged.onHookUntil, now),
        }
      })
    }) as typeof set

    // Writes that come from outside an action (a test seeding a board, the E2E
    // bridge) go through the same completion.
    store.setState = derivedSet
    return creator(derivedSet, get, store)
  }
