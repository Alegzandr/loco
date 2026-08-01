import { useEffect } from 'react'
import { useGameStore } from './useGameStore'
import {
  readSession,
  writeSession,
  touchSession,
  clearSession,
  type RestoreTarget,
} from './sessionPersistence'

/**
 * How long a reclaim may stay in flight before the player is handed back a
 * lobby. The server answers a valid rejoin in one round trip; anything past this
 * means it is down, unreachable, or the socket is still walking its backoff. A
 * spinner with no end is worse than a lobby with a reason.
 */
export const RESTORE_TIMEOUT_MS = 12_000

/**
 * Seeds the store from the persisted session, before the first render and
 * before the socket exists. Called once from main.tsx.
 */
export function initSessionRestore(): void {
  const session = readSession()
  if (!session) return
  useGameStore.getState().beginRestore(session)
}

/**
 * Keeps the persisted record in step with the session, and gives the reclaim a
 * deadline.
 *
 * The record is written from the store rather than from the messages that
 * produced it, so there is one condition deciding what is worth coming back to:
 * a room, a nickname, and a screen the server will still recognise. The lobby
 * has nothing to reclaim and a finished match has already released the seat, so
 * both clear it: a stale record is a reconnect screen shown to somebody who
 * only wanted to play again.
 */
export function useSessionPersistence(): void {
  useEffect(() => {
    // The subscription fires on every store change, i.e. several times a second
    // during a match, and sessionStorage is synchronous. Only an actual change
    // to the four persisted fields may reach it. See "the realtime path": work
    // added here is work added between a tap and the wire.
    // Sentinel, not '': the first unusable state must still clear whatever an
    // earlier tab left behind, and only then start deduping.
    let lastWritten = 'unset'

    const persist = (s: ReturnType<typeof useGameStore.getState>) => {
      // 'restoring' is neither state: the record that put us here is still valid
      // and must not be rewritten from a store that has not heard back yet.
      if (s.screen === 'restoring') return

      const target: RestoreTarget | null =
        s.screen === 'game' ? 'game' : s.screen === 'waiting' ? 'waiting' : null

      const nickname = s.players.find((p) => p.index === s.myIndex)?.nickname || s.myNickname
      // An in-match seat is only reclaimable with its token.
      const usable = target && s.roomCode && nickname && (target === 'waiting' || s.sessionToken)
      if (!usable) {
        if (lastWritten !== '') {
          lastWritten = ''
          clearSession()
        }
        return
      }

      const key = `${target}|${s.roomCode}|${nickname}|${s.sessionToken}`
      if (key === lastWritten) return
      lastWritten = key
      writeSession({ roomCode: s.roomCode, nickname, sessionToken: s.sessionToken, target })
    }

    persist(useGameStore.getState())
    const unsubscribe = useGameStore.subscribe(persist)

    // The stored fields change once, at join time, so `at` would otherwise be
    // the join time and the staleness guard would measure the wrong interval
    // entirely. This is the moment it is actually measuring from. `pagehide`
    // covers the reload and the close (including bfcache, where `unload` never
    // fires); `visibilitychange` covers a mobile browser that kills a
    // backgrounded tab without warning.
    const stamp = () => touchSession()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') stamp()
    }
    window.addEventListener('pagehide', stamp)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      unsubscribe()
      window.removeEventListener('pagehide', stamp)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])
}

/**
 * Ends a reclaim that never landed. Separate from the persistence effect so the
 * timer is armed only while one is actually in flight, and is cancelled the
 * instant the store leaves the restoring screen.
 */
export function useRestoreTimeout(timeoutReason: string): void {
  const restoring = useGameStore((s) => s.screen === 'restoring')

  useEffect(() => {
    if (!restoring) return
    const id = setTimeout(() => {
      useGameStore.getState().abortRestore(timeoutReason)
    }, RESTORE_TIMEOUT_MS)
    return () => clearTimeout(id)
  }, [restoring, timeoutReason])
}
