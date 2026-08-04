/**
 * The half of "no accidental zoom at the table" that CSS cannot do.
 *
 * `touch-action: pan-x pan-y` under `[data-seated]` (layouts/Base.astro) is the
 * declaration, and Chrome honours it. WebKit does not for this gesture: on iOS,
 * pinch-to-zoom is a browser-level gesture that `touch-action` never reaches,
 * and the only thing that ever stopped it is refusing the non-standard
 * `gesturestart` event Safari raises when two fingers land. Every iPhone in this
 * game's audience is WebKit — Brave, Chrome and Firefox on iOS all are — so
 * without this the rule simply does not apply to most phones playing.
 *
 * Two things this deliberately is not:
 *
 *   - **Not the viewport tag.** `user-scalable=no` and `maximum-scale` are
 *     refused for the whole site (see `layouts/Base.astro`, and `a11y.test.ts`
 *     which fails on either): they would take pinch-zoom from `/`, from the prose
 *     behind its sheet and from every content page — the surfaces somebody reads
 *     rather than plays. Safari has ignored both since iOS 10 anyway, so the tag
 *     would have cost the accessibility of every page and fixed nothing on the
 *     device the complaint came from.
 *   - **Not unconditional.** The guard reads `data-seated` at event time, so it
 *     covers exactly the screens the attribute covers — waiting room, table,
 *     game over — and nothing before a seat is taken. Leaving the table gives
 *     the gesture back on the same frame.
 *
 * The listeners are non-passive on purpose: a passive one cannot call
 * `preventDefault`, which is the entire mechanism.
 */

/** WebKit's pinch gesture, in the three events it arrives as. */
const GESTURES = ['gesturestart', 'gesturechange', 'gestureend'] as const

let installed = false

function refuseWhileSeated(e: Event) {
  if (document.documentElement.hasAttribute('data-seated')) e.preventDefault()
}

/**
 * Refuse the pinch while a seat is taken. Idempotent, and a no-op outside a
 * browser.
 */
export function initPinchGuard(): void {
  if (installed || typeof document === 'undefined') return
  installed = true
  for (const type of GESTURES) {
    document.addEventListener(type, refuseWhileSeated, { passive: false })
  }
}
