import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from './render'
import { act } from './renderHook'
import { URGENT_AT } from '../hooks/drainBar.svelte'
import Bar from './DrainBarProbe.svelte'

// The whole point of drainBar is that a 30-second countdown costs zero
// framework updates: the bar is handed a CSS animation whose duration is the
// window and whose negative delay is the part already elapsed.

const NOW = 1_700_000_000_000

describe('drainBar', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('arms the drain animation with the window and how much of it is gone', () => {
    const { getByTestId } = render(Bar, { deadline: NOW + 20_000, total: 30_000 })
    const fill = getByTestId('fill')
    expect(fill.classList.contains('loco-draining')).toBe(true)
    expect(fill.style.getPropertyValue('--drain-ms')).toBe('30000ms')
    // 10s of the 30s window has already elapsed.
    expect(fill.style.getPropertyValue('--drain-delay')).toBe('-10000ms')
  })

  it("anchors 'auto' to the time left when the deadline became active", () => {
    const { getByTestId } = render(Bar, { deadline: NOW + 12_000 })
    const fill = getByTestId('fill')
    expect(fill.style.getPropertyValue('--drain-ms')).toBe('12000ms')
    expect(fill.style.getPropertyValue('--drain-delay')).toBe('0ms')
  })

  it('never re-arms while the window runs down', () => {
    const { getByTestId } = render(Bar, { deadline: NOW + 30_000, total: 30_000 })
    // Arming is two `setProperty` calls, and they are the effect's whole
    // footprint on the DOM. Watching them from just after the first arm is how
    // this counts framework work without a render to count: anything that
    // re-runs the effect — a state write, a re-render, a getter that moved —
    // writes them again.
    const armed = vi.spyOn(getByTestId('fill').style, 'setProperty')

    act(() => {
      vi.advanceTimersByTime(20_000)
    })

    // Only the urgency flip is allowed to touch anything over those 20 seconds,
    // and it does so with a class. A per-frame percentage in state would have
    // rebuilt the board a thousand times by here.
    expect(armed).not.toHaveBeenCalled()
    armed.mockRestore()
  })

  it('marks the track urgent only over the last stretch of the window', () => {
    const { getByTestId } = render(Bar, { deadline: NOW + 10_000, total: 10_000 })
    const track = getByTestId('track')
    expect(track.classList.contains('urgent')).toBe(false)
    act(() => {
      vi.advanceTimersByTime(10_000 * (1 - URGENT_AT) - 1)
    })
    expect(track.classList.contains('urgent')).toBe(false)
    act(() => {
      vi.advanceTimersByTime(2)
    })
    expect(track.classList.contains('urgent')).toBe(true)
  })

  it('starts urgent when it is armed inside the last stretch (reconnect mid-turn)', () => {
    const { getByTestId } = render(Bar, { deadline: NOW + 1_000, total: 30_000 })
    expect(getByTestId('track').classList.contains('urgent')).toBe(true)
  })

  it('stands down when the deadline clears or has already passed', () => {
    const { getByTestId, rerender } = render(Bar, { deadline: NOW + 10_000, total: 10_000 })
    act(() => {
      vi.advanceTimersByTime(9_500)
    })
    expect(getByTestId('track').classList.contains('urgent')).toBe(true)
    rerender({ deadline: null })
    expect(getByTestId('fill').classList.contains('loco-draining')).toBe(false)
    expect(getByTestId('track').classList.contains('urgent')).toBe(false)
  })
})
