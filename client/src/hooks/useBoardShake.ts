import { useCallback, useEffect, type RefObject } from 'react'
import { prefersReducedMotion } from './useMotionPref'

/** An interception, or a Contre-LOCO! that landed: whichever just happened. */
interface Flash {
  at: number
}

// Interception: a rattle, the board knocked sideways by a card slammed onto it.
const INTERRUPT_FRAMES: Keyframe[] = [
  { transform: 'translate(0, 0)' },
  { transform: 'translate(-11px, 6px)' },
  { transform: 'translate(9px, -5px)' },
  { transform: 'translate(-6px, 3px)' },
  { transform: 'translate(3px, -2px)' },
  { transform: 'translate(0, 0)' },
]

// Contre-LOCO!: a single vertical thump, matching the stamp coming down. The
// two loudest moments in the game must not shake the screen the same way, or a
// clipped highlight cannot tell them apart with the sound off.
const CATCH_FRAMES: Keyframe[] = [
  { transform: 'translate(0, 0)' },
  { transform: 'translate(0, 14px)', offset: 0.35 },
  { transform: 'translate(0, -6px)', offset: 0.62 },
  { transform: 'translate(0, 0)' },
]

const INTERRUPT_MS = 420
const CATCH_MS = 340
// Held back to the frame the stamp actually lands on: a board that jumps while
// the verdict is still falling reads as two unrelated events.
const CATCH_DELAY_MS = 180

/**
 * The two shakes the board takes, driven through the Web Animations API rather
 * than a CSS class so a second one replays immediately. A class toggle would
 * need the element to remount, which would tear down the whole board.
 */
export function useBoardShake(
  el: RefObject<HTMLElement | null>,
  interruptFlash: Flash | null,
  catchFlash: Flash | null,
) {
  const shake = useCallback(
    (frames: Keyframe[], durationMs: number, delayMs = 0) => {
      if (prefersReducedMotion()) return
      const node = el.current
      // Guarded like kickBoard: the Web Animations API is absent under jsdom,
      // and a missing shake must never take the banner down with it.
      if (!node || typeof node.animate !== 'function') return
      node.animate(frames, { duration: durationMs, delay: delayMs, easing: 'ease-out' })
    },
    [el],
  )

  useEffect(() => {
    if (!interruptFlash) return
    shake(INTERRUPT_FRAMES, INTERRUPT_MS)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interruptFlash?.at])

  useEffect(() => {
    if (!catchFlash) return
    shake(CATCH_FRAMES, CATCH_MS, CATCH_DELAY_MS)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catchFlash?.at])
}
