import { RefObject, useEffect } from 'react'

/** Fraction of the window left when the bar starts pulsing (turn timer only). */
export const URGENT_AT = 0.2

// useDrainBar empties a progress bar against a wall-clock deadline **without
// re-rendering React once**.
//
// The obvious implementation (a requestAnimationFrame loop calling setState
// with a percentage) is what this replaces, and it was the single most
// expensive thing the client did: 60 state updates per second for the whole
// 30-second turn, each one re-rendering <GameView /> and with it the entire
// board (seat layout, hand slots, every card). LOCO is a reaction game; the
// main thread has to be free the instant a card lands, not busy re-deriving a
// layout that did not change so a 6px bar can move one pixel.
//
// Instead the element is handed a CSS animation whose duration is the window
// and whose (negative) delay is however much of it has already elapsed. The
// browser then runs the drain on the compositor: no JS per frame, no React
// work, and the bar keeps moving smoothly even while the main thread is busy
// dealing a hand.
//
// `totalMs` defines what "full" means: a fixed number for fixed-duration
// windows (the 5s catch window), or 'auto' to anchor it to whatever time
// remained when the deadline became active (the turn timer, which the server
// re-arms on a draw).
export function useDrainBar(
  ref: RefObject<HTMLElement | null>,
  deadline: number | null,
  totalMs: number | 'auto',
  /** Optional node whose `urgentClass` is toggled over the last URGENT_AT of the window. */
  urgentRef?: RefObject<HTMLElement | null>,
  urgentClass?: string,
): void {
  useEffect(() => {
    const el = ref.current
    if (!el) return

    const urgent = urgentRef?.current
    const clearUrgent = () => {
      if (urgent && urgentClass) urgent.classList.remove(urgentClass)
    }

    const stop = () => {
      el.classList.remove('loco-draining')
      clearUrgent()
    }

    if (deadline === null) {
      stop()
      return
    }
    const remaining = deadline - Date.now()
    const total = totalMs === 'auto' ? remaining : totalMs
    if (total <= 0 || remaining <= 0) {
      stop()
      return
    }

    // Restart cleanly: drop the class, force a reflow so the browser forgets
    // the previous animation, then re-arm with the new timings. Mutating
    // duration/delay in place keeps the original start time and would land the
    // bar at the wrong point.
    el.classList.remove('loco-draining')
    void el.offsetWidth
    el.style.setProperty('--drain-ms', `${total}ms`)
    el.style.setProperty('--drain-delay', `${-(total - remaining)}ms`)
    el.classList.add('loco-draining')

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
  }, [ref, deadline, totalMs, urgentRef, urgentClass])
}
