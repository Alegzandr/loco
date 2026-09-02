import { playSfx } from '../audio/sfx'
import { live, type Live } from './live.svelte'

/**
 * The small timing effects the game view is built out of, ported one for one
 * from their `use*` hooks. Each takes getters rather than values: they are called
 * once during component setup and have to keep seeing the current arguments.
 *
 * **Every one of those getters goes through `live()` before the effect reads
 * it.** They are handed fields of one snapshot that is replaced several times a
 * second, and an effect that re-runs on a field it is not watching re-arms the
 * timer it owns. See `live.svelte.ts` for what that costs on a busy board.
 */

/**
 * Seconds remaining (rounded up) while `active` is true, then `onExpire` exactly
 * once when totalMs has elapsed. Back to 0 when `active` goes false. Polled every
 * 250ms — fine for a second-resolution counter; a bar uses `drainBar` instead.
 */
export function countdown(
  active: Live<boolean>,
  totalMs: number,
  onExpire: () => void,
): { readonly current: number } {
  let remainingSec = $state(0)
  const isActive = live(active)

  $effect(() => {
    if (!isActive()) {
      remainingSec = 0
      return
    }
    remainingSec = Math.ceil(totalMs / 1000)
    const start = Date.now()
    const id = setInterval(() => {
      const remaining = totalMs - (Date.now() - start)
      if (remaining <= 0) {
        clearInterval(id)
        remainingSec = 0
        onExpire()
      } else {
        remainingSec = Math.ceil(remaining / 1000)
      }
    }, 250)
    return () => clearInterval(id)
  })

  return {
    get current() {
      return remainingSec
    },
  }
}

/**
 * True while `key` is physically held down, and the key is ours from the first
 * press: no delay, no focus moving underneath, nothing to discover.
 *
 * This is the scoreboard key every competitive game already taught the player —
 * hold it, the standings are there; let go, they are gone — and it only reads
 * that way if the press itself is the gesture. Arming it on a timer meant the
 * first beat of every press was the browser's, so the panel arrived late and the
 * focus ring had already jumped somewhere on the board on the way in.
 *
 * Three things it has to get right:
 *
 * - **The key is swallowed** (`preventDefault`), so TAB stops being navigation
 *   for as long as the board owns it. Callers pass `enabled: false` while a
 *   modal or a picker is up: inside a dialog TAB belongs to the dialog, and
 *   `components/dialogFocus.ts` is what cycles it there.
 * - **A modifier hands the key back.** Shift+TAB is left to the browser
 *   untouched, and it is deliberately the whole keyboard path through the
 *   board: every control is still reachable, in reverse order, and there is no
 *   keyboard trap. Ctrl/Alt/Meta go the same way — those combinations belong to
 *   the browser and the OS, never to us.
 * - **The keyup never arrives if the window loses focus mid-hold** (alt-tab, a
 *   notification stealing focus), so `blur` resets the state. Without it the
 *   panel stays stuck over the board with no way to dismiss it.
 */
export function heldKey(
  key: string,
  enabled: Live<boolean> = true,
): { readonly current: boolean } {
  let held = $state(false)
  const isEnabled = live(enabled)

  $effect(() => {
    if (!isEnabled()) {
      held = false
      return
    }
    const down = (e: KeyboardEvent) => {
      if (e.key !== key) return
      // Already down: swallow every repeat, whatever the modifiers now say. A
      // Shift pressed *during* a hold must not hand the key back and walk the
      // focus backwards under an open panel.
      if (held) {
        e.preventDefault()
        return
      }
      if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return
      e.preventDefault()
      held = true
    }
    const up = (e: KeyboardEvent) => {
      if (e.key !== key) return
      held = false
    }
    const release = () => {
      held = false
    }

    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', release)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', release)
    }
  })

  return {
    get current() {
      return held
    },
  }
}

/**
 * A piece of table news that takes itself off screen.
 *
 * `trigger` is the identity of the current notice (an `at` timestamp, or the
 * message itself) and the timer re-arms only when it changes — which is why it is
 * the only thing this reads reactively, and why it is read through `live()`.
 * Watching anything else, the callback or the snapshot the trigger was read off,
 * re-arms the timeout on every update and a notice on a busy board never reaches
 * the end of its own countdown.
 */
export function autoClear(trigger: Live<unknown>, ms: number, clear: () => void): void {
  const current = live(trigger)

  $effect(() => {
    if (!current()) return
    const id = setTimeout(clear, ms)
    return () => clearTimeout(id)
  })
}

const OVERLAY_MS = 600

/**
 * Orchestrates the post-reconnect visual recovery:
 *   1. show "Rebuilding table…" for OVERLAY_MS
 *   2. clear the isReconnecting flag so the board can fade back in
 *
 * The fade-in itself lives in `GameBoard.svelte` (keyed by an internal rebuildKey
 * that bumps when isReconnecting transitions back to false).
 *
 * Nothing but the timer ends this overlay, so anything that can swallow the timer
 * strands it over a live table. A guard flag once outlived the timer it was
 * guarding and the overlay never came down. The effect re-runs only when
 * `isReconnecting` actually changes, so re-arming on every run is both correct
 * and the whole guard that is needed. That last sentence is a claim about the
 * dependency, which is why the flag is read through `live()`: a reconnect lands
 * as a burst of writes and the match carries on underneath, so an effect
 * depending on the snapshot re-armed the 600ms timer on every message and the
 * curtain stayed over a table that was already back.
 */
export function reconnectAnimation(
  isReconnecting: Live<boolean>,
  onComplete: () => void,
): { readonly current: boolean } {
  let showOverlay = $state(false)
  const reconnecting = live(isReconnecting)

  $effect(() => {
    // A reconnect that resolves before the timer must take the overlay with it,
    // rather than leave it standing on a cancelled timeout.
    if (!reconnecting()) {
      showOverlay = false
      return
    }
    showOverlay = true
    const id = setTimeout(() => {
      showOverlay = false
      onComplete()
    }, OVERLAY_MS)
    return () => clearTimeout(id)
  })

  return {
    get current() {
      return showOverlay
    },
  }
}

/** Seconds of remaining turn time at which the countdown ticks start. */
const TURN_COUNTDOWN_FROM = 5

/**
 * Ticks over the last few seconds of our own turn.
 *
 * Time pressure is the one piece of state a spectator cannot read off the board,
 * and the bar at the top of the screen is not where anyone is looking.
 */
export function turnCountdownSfx(
  turnDeadline: Live<number | null>,
  isMyTurn: Live<boolean>,
): void {
  const deadlineAt = live(turnDeadline)
  const mine = live(isMyTurn)

  // One timeout per tick, each aimed at its own second, rather than a 200 ms
  // poll for the whole turn: a thirty-second turn is five ticks, not a hundred
  // and fifty wake-ups to find them. Absolute deadlines, like `drainBar`, so a
  // re-run of the effect lands the same ticks on the same instants.
  $effect(() => {
    const deadline = deadlineAt()
    if (deadline === null || !mine()) return
    const now = Date.now()
    const ids: number[] = []
    for (let left = TURN_COUNTDOWN_FROM; left >= 1; left--) {
      const at = deadline - left * 1000
      if (at < now) continue
      ids.push(window.setTimeout(() => playSfx('countdown'), at - now))
    }
    return () => ids.forEach(clearTimeout)
  })
}
