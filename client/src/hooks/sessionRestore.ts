import { gameStore } from './gameStore'
import { readSession } from './sessionPersistence'

/**
 * How long a reclaim may stay in flight before the player is handed back a
 * lobby. The server answers a valid rejoin in one round trip; anything past this
 * means it is down, unreachable, or the socket is still walking its backoff. A
 * spinner with no end is worse than a lobby with a reason.
 */
export const RESTORE_TIMEOUT_MS = 12_000

/**
 * Seeds the store from the persisted session, before the first render and before
 * the socket exists. Called once from `entry.ts`.
 */
export function initSessionRestore(): void {
  const session = readSession()
  if (!session) return
  gameStore.getState().beginRestore(session)
}

// The two effects that used to live here — mirroring the record into
// sessionStorage, and ending a reclaim that never landed — are
// `appEffects.svelte.ts`. What stays is the seed, which runs before anything is
// mounted at all, and the deadline both halves are measured against.
