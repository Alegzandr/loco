import { describe, it, expect } from 'vitest'
import { FPS_SAMPLE_MS, startFpsMeter } from '../components/fpsMeter'

/** A hand-cranked `requestAnimationFrame`: each `frame(t)` runs what is queued at `t`. */
function crank() {
  let queued: FrameRequestCallback | null = null
  let cancelled = false
  return {
    raf: (cb: FrameRequestCallback) => ((queued = cb), 1),
    caf: () => {
      cancelled = true
      queued = null
    },
    frame(t: number) {
      const cb = queued
      queued = null
      cb?.(t)
    },
    get cancelled() {
      return cancelled
    },
  }
}

describe('the frame-rate reading', () => {
  it('counts frames over the span they took, not over the sampling period', () => {
    const c = crank()
    const seen: number[] = []
    startFpsMeter((f) => seen.push(f), c.raf, c.caf)
    // 60 Hz for a little over the sampling period.
    for (let i = 0; i <= 31; i++) c.frame(i * (1000 / 60))
    expect(seen).toEqual([60])
  })

  it('reads a stalled page as a stalled page', () => {
    const c = crank()
    const seen: number[] = []
    startFpsMeter((f) => seen.push(f), c.raf, c.caf)
    c.frame(0)
    c.frame(100)
    c.frame(FPS_SAMPLE_MS + 400)
    expect(seen).toEqual([2])
  })

  it('stops asking for frames once stopped', () => {
    const c = crank()
    const stop = startFpsMeter(() => {}, c.raf, c.caf)
    stop()
    expect(c.cancelled).toBe(true)
  })
})
