import { playSfx } from '../audio/sfx'

/**
 * A live getter, or a value that cannot change.
 *
 * The app hands these accessors getters, because what they watch moves. A test
 * that pins one of them in isolation hands a constant, and a constant needs no
 * subscription — so both spellings are accepted and only the getter is tracked.
 */
type Live<T> = T | (() => T)
const read = <T,>(v: Live<T>): T => (typeof v === 'function' ? (v as () => T)() : v)


/**
 * The small timing effects the game view is built out of, ported one for one
 * from their `use*` hooks. Each takes getters rather than values: they are called
 * once during component setup and have to keep seeing the current arguments.
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

  $effect(() => {
    if (!read(active)) {
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
 * True while `key` is physically held down.
 *
 * Two things this has to get right, both learned from how a held-key overlay
 * fails in practice:
 *
 * - The keyup never arrives if the window loses focus mid-hold (alt-tab, a
 *   notification stealing focus), so `blur` resets the state. Without it the
 *   overlay stays stuck over the board with no way to dismiss it.
 * - Taking a key that the browser already uses (Tab moves focus) means owning its
 *   default too, hence preventDefault. That is also why callers pass
 *   `enabled: false` while a modal or picker is open: inside a dialog, Tab
 *   belongs to the dialog.
 */
export function heldKey(key: string, enabled: Live<boolean> = true): { readonly current: boolean } {
  let held = $state(false)

  $effect(() => {
    if (!read(enabled)) {
      held = false
      return
    }
    const down = (e: KeyboardEvent) => {
      if (e.key !== key) return
      e.preventDefault()
      held = true
    }
    const up = (e: KeyboardEvent) => {
      if (e.key !== key) return
      e.preventDefault()
      held = false
    }
    const release = () => (held = false)

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
 * the only thing this reads reactively. Reading the callback too would re-arm the
 * timeout on every update, and a notice on a busy board would never reach the end
 * of its own countdown.
 */
export function autoClear(trigger: Live<unknown>, ms: number, clear: () => void): void {
  $effect(() => {
    if (!read(trigger)) return
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
 * and the whole guard that is needed.
 */
export function reconnectAnimation(
  isReconnecting: Live<boolean>,
  onComplete: () => void,
): { readonly current: boolean } {
  let showOverlay = $state(false)

  $effect(() => {
    // A reconnect that resolves before the timer must take the overlay with it,
    // rather than leave it standing on a cancelled timeout.
    if (!read(isReconnecting)) {
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
  $effect(() => {
    const deadline = read(turnDeadline)
    if (deadline === null || !read(isMyTurn)) return
    let lastTick = -1
    const id = setInterval(() => {
      const left = Math.ceil((deadline - Date.now()) / 1000)
      if (left <= 0 || left > TURN_COUNTDOWN_FROM || left === lastTick) return
      lastTick = left
      playSfx('countdown')
    }, 200)
    return () => clearInterval(id)
  })
}
