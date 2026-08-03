import { gameStore } from './gameStore'
import { audio } from '../audio/engine'
import { music } from '../audio/music'
import { playSfx, playDeal } from '../audio/sfx'
import { FANFARES, intensityOf, sceneFor, soundsForTransition } from '../audio/gameSounds'
import { clearSession, touchSession, writeSession } from './sessionPersistence'
import type { RestoreTarget } from './sessionPersistence'
import { RESTORE_TIMEOUT_MS } from './sessionRestore'
import { live } from './live.svelte'

/**
 * The three app-level effects, ported from their `use*` hooks. All three are
 * subscriptions on a store that outlives every screen, so none of them reads
 * anything reactively: they are started once, when the app mounts.
 */

/** Single owner of every sound in the game. See `audio/gameSounds.ts`. */
export function gameAudio(): void {
  $effect(() => {
    // Browsers only allow an AudioContext to start inside a user gesture. Every
    // gesture retries, because the first one can land before the page is ready.
    //
    // The bed is started only after `unlock()` resolves: `resume()` is async, so
    // starting on the next line finds the context still not running and does
    // nothing at all, which on iOS costs the player a whole extra tap.
    const unlock = () => {
      void audio.unlock().then(() => {
        const s = gameStore.getState()
        const scene = sceneFor(s)
        music.setIntensity(intensityOf(s))
        if (scene !== 'off' && !music.isPlaying()) music.start(scene)
      })
    }

    // Coming back from another app is exactly when the context needs reclaiming
    // and is exactly when there is no gesture to hang it on: the player looks at
    // the board before touching it, so waiting for the next tap means the table is
    // silent for as long as they are only watching. Not a replacement for the
    // gesture handlers (a resume outside one can be refused), but the page keeps
    // its sticky activation, so in practice this is what turns the sound back on.
    // `focus` covers desktop tab switches, where `visibilitychange` does not fire.
    const wake = () => {
      if (document.visibilityState === 'hidden') return
      unlock()
    }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('focus', wake)
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
    return () => {
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('focus', wake)
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  })

  $effect(() => {
    let prev = gameStore.getState()

    const unsub = gameStore.subscribe((next) => {
      const before = prev
      prev = next

      const sounds = soundsForTransition(before, next)
      for (const name of sounds) playSfx(name)

      // Pull the bed down under the long fanfares. Two pieces of music competing
      // for the same moment makes both of them mush, and the fanfare is the one
      // people clip.
      if (sounds.some((n) => FANFARES.has(n))) music.duck(2400)

      // A fresh hand is a flourish of its own rather than one draw sound.
      if (next.screen === 'game' && before.screen !== 'game' && next.myHand.length > 0) {
        playDeal(next.myHand.length)
      }

      music.setIntensity(intensityOf(next))
      const scene = sceneFor(next)
      // start() is idempotent: it swaps the scene in place when the bed is already
      // running, so moving lobby→game changes the pacing without cutting the pad
      // mid-bar.
      if (scene === 'off') music.stop()
      else music.start(scene)
    })

    return () => {
      unsub()
      music.stop()
    }
  })
}

/**
 * Mirrors room + seat + token into sessionStorage so a reload can reclaim the
 * seat. See `sessionRestore.ts` for the whole rule.
 */
export function sessionPersistence(): void {
  $effect(() => {
    // The subscription fires on every store change, i.e. several times a second
    // during a match, and sessionStorage is synchronous. Only an actual change to
    // the four persisted fields may reach it. See "the realtime path": work added
    // here is work added between a tap and the wire.
    // Sentinel, not '': the first unusable state must still clear whatever an
    // earlier tab left behind, and only then start deduping.
    let lastWritten = 'unset'

    const persist = (s: ReturnType<typeof gameStore.getState>) => {
      // 'restoring' is neither state: the record that put us here is still valid
      // and must not be rewritten from a store that has not heard back yet.
      if (s.screen === 'restoring') return

      // 'matchfound' persists as 'game': the versus reveal is a real seat with a
      // real token, two seconds from a deal, and clearing the record there meant
      // a tab reloaded during the reveal came back to the lobby while the server
      // still had a table for it.
      const target: RestoreTarget | null =
        s.screen === 'game' || s.screen === 'matchfound'
          ? 'game'
          : s.screen === 'waiting'
            ? 'waiting'
            : null

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

    persist(gameStore.getState())
    const unsubscribe = gameStore.subscribe(persist)

    // The stored fields change once, at join time, so `at` would otherwise be the
    // join time and the staleness guard would measure the wrong interval entirely.
    // This is the moment it is actually measuring from. `pagehide` covers the
    // reload and the close (including bfcache, where `unload` never fires);
    // `visibilitychange` covers a mobile browser that kills a backgrounded tab
    // without warning.
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
  })
}

/**
 * Ends a reclaim that never landed. Separate from the persistence effect so the
 * timer is armed only while one is actually in flight, and is cancelled the
 * instant the store leaves the restoring screen.
 */
export function restoreTimeout(restoring: () => boolean, timeoutReason: string): void {
  // Through `live()` like every other timer in the client: the deadline is
  // measured from the moment the reclaim went out, and an effect that re-ran on
  // any store write would push it back by 12s each time. See `live.svelte.ts`.
  const inFlight = live(restoring)

  $effect(() => {
    if (!inFlight()) return
    const id = setTimeout(() => {
      gameStore.getState().abortRestore(timeoutReason)
    }, RESTORE_TIMEOUT_MS)
    return () => clearTimeout(id)
  })
}
