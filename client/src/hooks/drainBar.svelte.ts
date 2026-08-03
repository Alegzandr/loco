/**
 * Fraction of the window left when the bar starts pulsing (turn timer only).
 *
 * Exported because `GameView` arms the same urgency on its own bar from the same
 * number: the two must not be able to disagree about when a countdown is urgent.
 */
export const URGENT_AT = 0.2

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
 * Empties a progress bar against a wall-clock deadline **without re-rendering
 * once**. It began as the Svelte half of a hook the React screens shared; that
 * half is the whole of it now, and the mechanism and the reasons are unchanged.
 *
 * The obvious implementation (a rAF loop writing a percentage into state) is
 * what this replaces, and it was the single most expensive thing the client
 * did: 60 updates per second for a whole 30-second turn, each one re-deriving a
 * board that did not change so a 6px bar could move one pixel. LOCO is a
 * reaction game; the main thread has to be free the instant a card lands.
 *
 * Instead the element is handed a CSS animation whose duration is the window
 * and whose (negative) delay is however much of it has already elapsed, so the
 * browser runs the drain on the compositor.
 *
 * `totalMs` defines what "full" means: a fixed number for fixed-duration
 * windows (the 5s catch window), or 'auto' to anchor it to whatever time
 * remained when the deadline became active (the turn timer, which the server
 * re-arms on a draw).
 *
 * Every argument is a getter rather than a value: this is called once, during
 * component setup, and has to keep seeing the current node and the current
 * deadline for the life of the component.
 */
export function drainBar(
  el: Live<HTMLElement | null>,
  deadline: Live<number | null>,
  totalMs: number | 'auto',
  /** Optional node whose `urgentClass` is toggled over the last URGENT_AT of the window. */
  urgentEl?: Live<HTMLElement | null>,
  urgentClass?: string,
): void {
  $effect(() => {
    const node = read(el)
    if (!node) return

    const urgent = urgentEl === undefined ? null : read(urgentEl)
    const clearUrgent = () => {
      if (urgent && urgentClass) urgent.classList.remove(urgentClass)
    }

    const stop = () => {
      node.classList.remove('loco-draining')
      clearUrgent()
    }

    const at = read(deadline)
    if (at === null) {
      stop()
      return
    }
    const remaining = at - Date.now()
    const total = totalMs === 'auto' ? remaining : totalMs
    if (total <= 0 || remaining <= 0) {
      stop()
      return
    }

    // Restart cleanly: drop the class, force a reflow so the browser forgets the
    // previous animation, then re-arm with the new timings. Mutating
    // duration/delay in place keeps the original start time and would land the
    // bar at the wrong point.
    node.classList.remove('loco-draining')
    void node.offsetWidth
    node.style.setProperty('--drain-ms', `${total}ms`)
    node.style.setProperty('--drain-delay', `${-(total - remaining)}ms`)
    node.classList.add('loco-draining')

    if (!urgent || !urgentClass) return
    clearUrgent()
    const untilUrgent = remaining - total * URGENT_AT
    if (untilUrgent <= 0) {
      urgent.classList.add(urgentClass)
      return
    }
    const id = setTimeout(() => urgent.classList.add(urgentClass), untilUrgent)
    return () => {
      clearTimeout(id)
      clearUrgent()
    }
  })
}
