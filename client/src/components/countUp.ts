import { prefersReducedMotion } from '../hooks/motionPref'

/**
 * A number that arrives rather than appears.
 *
 * The points a round was worth, the total a match ended on: a figure that pops
 * into place is a spreadsheet cell, and one that climbs to its value in half a
 * second is a score being counted, which is the only thing the between-rounds
 * card is for. A Svelte action on the element that shows the number, keyed on
 * the value: `use:countUp={{ value, format }}`. It writes `textContent` itself
 * on animation frames — nothing continuous goes through reactive state — and
 * settles on the exact formatted value however it is interrupted. Reduced
 * motion, or no `requestAnimationFrame`, writes the value at once.
 */
export interface CountUpParams {
  value: number
  /** How the number is written; defaults to the plain integer. */
  format?: (n: number) => string
  /** ms of climb. */
  duration?: number
}

export const COUNT_UP_MS = 620

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)

export function countUp(node: HTMLElement, params: CountUpParams) {
  let shown = 0
  let frame: number | null = null

  const write = (n: number, format: CountUpParams['format']) => {
    node.textContent = format ? format(n) : String(n)
  }
  const stop = () => {
    if (frame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
    frame = null
  }

  const run = (p: CountUpParams) => {
    stop()
    const target = p.value
    const from = shown
    if (
      prefersReducedMotion() ||
      typeof requestAnimationFrame !== 'function' ||
      from === target
    ) {
      shown = target
      write(target, p.format)
      return
    }
    const duration = p.duration ?? COUNT_UP_MS
    let start: number | null = null
    const step = (now: number) => {
      if (start === null) start = now
      const t = Math.min(1, (now - start) / duration)
      shown = Math.round(from + (target - from) * easeOut(t))
      write(shown, p.format)
      if (t < 1) frame = requestAnimationFrame(step)
      else frame = null
    }
    frame = requestAnimationFrame(step)
  }

  run(params)
  return {
    update(next: CountUpParams) {
      run(next)
    },
    destroy() {
      stop()
    },
  }
}
