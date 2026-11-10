/**
 * How much weather this device is holding, measured rather than guessed.
 *
 * The room is a bitmap and the board's own animations stay on the compositor,
 * so the one thing a match costs per frame is the weather: up to eight
 * full-frame translucent layers under a storm, blended over each other sixty
 * times a second. A GPU worth the name does not notice. A machine compositing
 * in software, or an integrated chip driving a 4K panel, does: measured on the
 * showcase with the compositor in software, a storm on `high` draws at 35 fps
 * where the same board on a clear day holds 60, and every millisecond of the
 * difference is the sheets (`docs/notes/visual.md`, "The weather is shed").
 *
 * `autoTier` cannot know that. It reads memory and core count, and neither says
 * anything about fill rate. So under `auto` the weather is watched: the page's
 * cadence is sampled off `requestAnimationFrame` in short bursts, and a device
 * that is not holding `LOAD_FLOOR_FPS` gives up one step of sheets, then, if
 * that was not enough, the other. **Only the sheets**: the graphics tier
 * itself never moves, because it is part of the room's cache key and moving
 * it would render the room again, which is a second of main thread spent to
 * save frames.
 *
 * Three decisions that are easy to undo by accident:
 *
 * - **The cadence is a mean with the hitches left out, never frames over time
 *   and never the median.** A deal, a resize's re-render or a garbage
 *   collection is a few long frames; a compositor out of fill rate is every
 *   frame. So a frame `LOAD_HITCH` times the window's median is dropped and
 *   the rest is averaged. The median alone was tried first and is fooled by
 *   the display: a device missing every other refresh alternates 16.7 and
 *   33.3 ms, which is 45 fps with a median of 60. Cutting a fixed share of the
 *   slowest frames was tried second and flatters the same device by two
 *   frames a second, which is the width of the decision. A gap over
 *   `LOAD_GAP_MS` is a tab that was hidden and throws its whole window away.
 * - **Shedding is one-way for the life of the tab.** Giving a sheet back the
 *   moment the rate recovers is how a layer ends up blinking in and out for a
 *   whole match. A detection is not a choice either, so it is never stored.
 * - **It samples in bursts and then sleeps.** A `requestAnimationFrame` loop
 *   left running asks the main thread for a frame the compositor's animations
 *   did not need, for twenty minutes. A device that held its rate over a burst
 *   is left alone for `LOAD_RECHECK_MS`.
 *
 * A browser capped at 30 fps (a phone in low-power mode) reads as a device
 * that cannot hold the floor, and loses its extra sheets. That is the right
 * answer for the wrong reason, and it is accepted: it asked to spend less.
 *
 * Framework-free: `hooks/uiPrefs.svelte.ts` is Svelte's window onto it.
 */
import type { GraphicsTier } from '../../hooks/graphicsPref'

/** One sample of the cadence. Long enough to hold ~70 frames at the floor. */
export const LOAD_WINDOW_MS = 1500
/** Left alone after the room lands: the gate lifting and the deal are not the weather. */
export const LOAD_GRACE_MS = 4000
/** Under this the sheets are costing the board its frames. */
export const LOAD_FLOOR_FPS = 50
/** Consecutive windows under the floor before a step is shed. */
export const LOAD_BAD_WINDOWS = 2
/** Consecutive windows over it before the burst ends. */
export const LOAD_GOOD_WINDOWS = 3
/** How long a device that held its rate is left alone. */
export const LOAD_RECHECK_MS = 30_000
/** An interval this long is a hidden tab, not a slow frame. */
export const LOAD_GAP_MS = 1000
/** A frame this many times the window's median is a hitch, and is left out of the mean. */
export const LOAD_HITCH = 4
/** A window with fewer intervals than this says nothing. */
export const LOAD_MIN_FRAMES = 4

const LADDER: readonly GraphicsTier[] = ['high', 'medium', 'light']
/** Steps there are to shed: `high` to `light`. */
export const MAX_SHED = LADDER.length - 1

let shed = 0
const listeners = new Set<() => void>()

/** How many steps of weather this tab has given up. */
export function getWeatherShed(): number {
  return shed
}

export function subscribeWeatherShed(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** Test seam. */
export function resetWeatherShed(): void {
  shed = 0
  listeners.forEach((l) => l())
}

/**
 * Gives one step up, **from the level the caller measured at**: two governors
 * can be alive at once (the loading screen's room and the board's), and both
 * reaching the same verdict in the same second is one step, not two.
 */
export function shedWeatherFrom(level: number): void {
  if (level !== shed || shed >= MAX_SHED) return
  shed++
  listeners.forEach((l) => l())
}

/** The tier the weather is drawn at: the graphics tier, down by what was shed. */
export function weatherTier(tier: GraphicsTier, steps: number): GraphicsTier {
  return LADDER[Math.min(LADDER.length - 1, LADDER.indexOf(tier) + Math.max(0, steps))]
}

/** What a window of frame intervals says: `null` when it says nothing. */
export function windowVerdict(intervals: readonly number[]): 'good' | 'bad' | null {
  if (intervals.length < LOAD_MIN_FRAMES) return null
  if (intervals.some((d) => d > LOAD_GAP_MS)) return null
  const sorted = [...intervals].sort((a, b) => a - b)
  const hitch = sorted[sorted.length >> 1] * LOAD_HITCH
  const kept = sorted.filter((d) => d < hitch)
  const mean = kept.reduce((s, d) => s + d, 0) / kept.length
  return 1000 / mean < LOAD_FLOOR_FPS ? 'bad' : 'good'
}

export interface GovernorClock {
  raf: (cb: FrameRequestCallback) => number
  caf: (id: number) => void
  setTimer: (cb: () => void, ms: number) => unknown
  clearTimer: (id: unknown) => void
}

const realClock = (): GovernorClock => ({
  raf: (cb) => requestAnimationFrame(cb),
  caf: (id) => cancelAnimationFrame(id),
  setTimer: (cb, ms) => setTimeout(cb, ms),
  clearTimer: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
})

/**
 * Watches the cadence and sheds one step if the device is not holding it.
 * Stops itself once it has: whoever started it is told through the
 * subscription and starts another if there is still something to shed, which
 * is also what gives the lighter weather its own grace period.
 */
export function startWeatherGovernor(clock: GovernorClock = realClock()): () => void {
  const level = shed
  let frame = 0
  let timer: unknown = null
  let stopped = false

  const burst = () => {
    timer = null
    let from = -1
    let last = -1
    let intervals: number[] = []
    let bad = 0
    let good = 0
    const tick = (now: number) => {
      if (stopped) return
      if (last >= 0) intervals.push(now - last)
      if (from < 0) from = now
      last = now
      if (now - from >= LOAD_WINDOW_MS) {
        const verdict = windowVerdict(intervals)
        from = now
        intervals = []
        if (verdict === 'bad') {
          good = 0
          if (++bad >= LOAD_BAD_WINDOWS) {
            stopped = true
            shedWeatherFrom(level)
            return
          }
        } else if (verdict === 'good') {
          bad = 0
          if (++good >= LOAD_GOOD_WINDOWS) {
            timer = clock.setTimer(burst, LOAD_RECHECK_MS)
            return
          }
        }
      }
      frame = clock.raf(tick)
    }
    frame = clock.raf(tick)
  }

  timer = clock.setTimer(burst, LOAD_GRACE_MS)
  return () => {
    stopped = true
    clock.caf(frame)
    if (timer !== null) clock.clearTimer(timer)
  }
}
