import { gameStore } from './gameStore'
import { audio } from '../audio/engine'
import { music } from '../audio/music'
import { playSfx, playDeal } from '../audio/sfx'
import { FANFARES, dealFor, intensityOf, sceneFor, soundsForTransition } from '../audio/gameSounds'
import { clearSession, touchSession, writeSession } from './sessionPersistence'
import type { RestoreTarget } from './sessionPersistence'
import { RESTORE_TIMEOUT_MS } from './sessionRestore'
import { live } from './live.svelte'
import { isStreamerMode, streamerModePref } from './streamerMode'
import { hapticsFor, vibrate } from './haptics'
import type { ClientMsg } from '../types/protocol'

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
      // Muted is muted: no context, no playback session, no scheduler. On iOS
      // a context declared as `playback` stops whatever the player had going in
      // another app, which is the one thing somebody who muted the game asked
      // not to happen. Unmuting is itself a gesture and unlocks on the spot.
      if (audio.getSettings().muted) return
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
      // The bed stops while the tab is hidden and comes back with it: a page
      // that plays audio is exempt from timer throttling, so a backgrounded
      // table went on building a bar of synthesis every 40 ms and playing it
      // out loud from behind another window. The effects are left alone —
      // the turn cue reaching a player who looked away is the point of it.
      music.setHidden(document.visibilityState === 'hidden')
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
      // The phone answers the same list: one pulse per moment, the strongest
      // cue's pattern. See hooks/haptics.ts.
      vibrate(hapticsFor(sounds))

      // Pull the bed down under the long fanfares. Two pieces of music competing
      // for the same moment makes both of them mush, and the fanfare is the one
      // people clip.
      if (sounds.some((n) => FANFARES.has(n))) music.duck(2400)

      // A fresh hand is a flourish of its own rather than one draw sound, on
      // the first round and on every round after it.
      const dealt = dealFor(before, next)
      if (dealt > 0) playDeal(dealt)

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
 * Tells the table when the host starts or stops streaming.
 *
 * Streamer mode is presentation everywhere else in this client, and this is the
 * one thing about it that cannot be: the table code is a single string shared by
 * everybody who can see it, so a host with it on screen is exposed by their
 * guests' screens as much as by their own. The server holds one answer per table
 * and broadcasts it; this is the only place that answer is ever asked for.
 *
 * Two moments send, and no others:
 *
 *  - the preference moved, at a table we are the host of;
 *  - we just opened a table with it already on, which is the host who set it
 *    yesterday and creates a table today.
 *
 * A change of seat deliberately sends nothing. `transfer_host` hands the table
 * to somebody whose own switch is probably off, and treating that as an
 * instruction would uncover the code for a host who is still sitting there
 * streaming. Their switch is theirs to touch when they want it.
 *
 * Hostless tables (matchmade, solo) never send: the server refuses the message
 * there, and an error the player did not ask for would land on the board.
 *
 * Nothing here reads the table's current answer to decide whether to speak. It
 * is tempting — it would swallow the ask that changes nothing — but it also
 * swallows the retry after one that never landed, and the server already
 * answers a repeat with silence.
 */
export function hostStreamerSync(send: (msg: ClientMsg) => void): void {
  $effect(() => {
    let lastPref = isStreamerMode()
    let lastCode = ''

    const sync = (s: ReturnType<typeof gameStore.getState>) => {
      const on = isStreamerMode()
      const prefMoved = on !== lastPref
      lastPref = on

      if (!s.roomCode || s.myIndex !== 0 || s.isMatchmade || s.isSolo) {
        // Not a table we speak for. The code is cleared so coming back to one
        // reads as new, which is what makes the second table of the evening
        // carry the preference too.
        lastCode = ''
        return
      }
      const newTable = s.roomCode !== lastCode
      lastCode = s.roomCode

      // A new table is only ever told the "on" half. Its answer is already off,
      // and sending the off half would make arriving at a table an instruction
      // about it — which is exactly what the seat change above must not become.
      if (prefMoved || (newTable && on)) {
        send({ type: 'set_streamer_mode', streamer_mode: on })
      }
    }

    sync(gameStore.getState())
    const unsubStore = gameStore.subscribe(sync)
    const unsubPref = streamerModePref.subscribe(() => sync(gameStore.getState()))
    return () => {
      unsubStore()
      unsubPref()
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
