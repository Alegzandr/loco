import { createBooleanPref } from './prefStore'
import type { SfxName } from '../audio/sfx'

/**
 * Haptics: the phone answering the hand.
 *
 * A card that lands, a call, a catch, a turn coming round — on a phone each of
 * these is also a pulse under the thumb, which is most of what separates a
 * game that feels held from a page that is tapped. Decided beside the sounds
 * (`hapticsFor` reads the same list `soundsForTransition` produced) so the two
 * can never disagree about what happened, and played by `gameAudio()` right
 * after the cues.
 *
 * Presentation only, never on the wire, and off by one switch: the preference
 * is stored inverted (`loco_haptics_off`) so a fresh install buzzes without
 * anybody having to find the setting. Absent `navigator.vibrate` — every
 * desktop browser, Safari on iOS — it is a no-op, and the panel does not offer
 * the switch at all.
 */
export const hapticsOffPref = createBooleanPref('loco_haptics_off')

export function setHaptics(on: boolean): void {
  hapticsOffPref.set(!on)
}

export function hapticsSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
}

/** Milliseconds, or an on/off pattern, per cue. Short: a pulse, never a buzz. */
const PATTERNS: Partial<Record<SfxName, number | number[]>> = {
  cardPlay: 12,
  cardDraw: 8,
  yourTurn: [18, 40, 18],
  unoDeclare: [24, 30, 24],
  unoCaught: [40, 40, 70],
  interrupt: 45,
  penalty: 30,
  error: 14,
  matchFound: [30, 50, 30, 50, 60],
  roundWin: [30, 40, 60],
  roundLose: 40,
  matchWin: [40, 50, 40, 50, 120],
  matchLose: 70,
}

/**
 * The pattern a transition owes, from the cues it played. The strongest cue
 * wins rather than the patterns being chained: a card play under a catch is
 * one moment, not two.
 */
export function hapticsFor(sounds: readonly SfxName[]): number | number[] | null {
  let best: number | number[] | null = null
  let bestWeight = -1
  for (const name of sounds) {
    const p = PATTERNS[name]
    if (p === undefined) continue
    const weight = typeof p === 'number' ? p : p.reduce((a, b) => a + b, 0)
    if (weight > bestWeight) {
      best = p
      bestWeight = weight
    }
  }
  return best
}

/** Plays a pattern if the device can and the player has not switched it off. */
export function vibrate(pattern: number | number[] | null): void {
  if (pattern === null || !hapticsSupported() || hapticsOffPref.get()) return
  try {
    navigator.vibrate(pattern)
  } catch {
    // A refused vibration is nothing to report.
  }
}
