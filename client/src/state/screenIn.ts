import { cubicOut } from 'svelte/easing'
import type { TransitionConfig } from 'svelte/transition'
import { prefersReducedMotion } from './motionPref'

/**
 * How a screen arrives.
 *
 * The lobby, the wait, the reveal, the board and the game-over card used to
 * cut from one to the next in a single frame, which is how a page navigates
 * and not how a game moves between its rooms. An arrival is a short rise and
 * a fade — opacity and transform only, 240 ms, the ease every other entrance
 * here uses — and there is deliberately no departure: the old screen goes in
 * the frame the store says so, the new one settles over the next few, and
 * nothing the player can press is ever behind a screen on its way out.
 *
 * Under reduced motion the duration is zero: the cut is the readable state.
 */
export const SCREEN_IN_MS = 240

export function screenIn(_node: Element): TransitionConfig {
  if (prefersReducedMotion()) return { duration: 0 }
  return {
    duration: SCREEN_IN_MS,
    easing: cubicOut,
    css: (t) => `opacity: ${t}; transform: translateY(${(1 - t) * 10}px)`,
  }
}
