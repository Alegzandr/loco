import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { countUp, COUNT_UP_MS } from '../components/countUp'
import { setMotionPref } from '../hooks/motionPref'

// Frames driven by hand: each call to `tick` is one animation frame at the
// given time, so the climb is asserted without a clock.
function frames() {
  const queue: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    queue.push(cb)
    return queue.length
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  return (now: number) => {
    const cb = queue.shift()
    cb?.(now)
  }
}

describe('countUp', () => {
  beforeEach(() => setMotionPref('full'))
  afterEach(() => {
    vi.unstubAllGlobals()
    setMotionPref('full')
  })

  it('climbs to the value and lands exactly on it', () => {
    const tick = frames()
    const el = document.createElement('span')
    countUp(el, { value: 120 })
    tick(0)
    expect(el.textContent).toBe('0')
    tick(COUNT_UP_MS / 2)
    const mid = Number(el.textContent)
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(120)
    tick(COUNT_UP_MS)
    expect(el.textContent).toBe('120')
  })

  it('formats through the caller', () => {
    const tick = frames()
    const el = document.createElement('span')
    countUp(el, { value: 40, format: (n) => `+${n}` })
    tick(0)
    tick(COUNT_UP_MS)
    expect(el.textContent).toBe('+40')
  })

  it('writes the value at once under reduced motion', () => {
    frames()
    setMotionPref('reduce')
    const el = document.createElement('span')
    countUp(el, { value: 77 })
    expect(el.textContent).toBe('77')
  })

  it('continues from where it is when the value moves', () => {
    const tick = frames()
    const el = document.createElement('span')
    const action = countUp(el, { value: 100 })
    tick(0)
    tick(COUNT_UP_MS)
    action.update({ value: 160 })
    tick(1000)
    expect(Number(el.textContent)).toBe(100)
    tick(1000 + COUNT_UP_MS)
    expect(el.textContent).toBe('160')
  })
})
