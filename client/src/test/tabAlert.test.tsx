import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTabAlert, TAB_ALERT_PERIOD_MS } from '../hooks/useTabAlert'

/**
 * The whole point of these tests is the restraint, not the blinking: a title
 * that flashes while the player is looking at it is an ad, and one that keeps
 * flashing after they came back is a bug they have to fix by reloading.
 */

const ORIGINAL = 'LOCO'

/** jsdom's visibilityState is read-only, so it is redefined rather than set. */
function setVisibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { value, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('useTabAlert', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    document.title = ORIGINAL
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('leaves the title alone when the player is looking at the tab', () => {
    renderHook(() => useTabAlert('Opponent found', true))
    act(() => void vi.advanceTimersByTime(TAB_ALERT_PERIOD_MS * 4))
    expect(document.title).toBe(ORIGINAL)
  })

  it('alternates the title when the trigger fires on a hidden tab', () => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    renderHook(() => useTabAlert('Opponent found', true))
    expect(document.title).toBe('Opponent found')
    act(() => void vi.advanceTimersByTime(TAB_ALERT_PERIOD_MS))
    expect(document.title).toBe(ORIGINAL)
    act(() => void vi.advanceTimersByTime(TAB_ALERT_PERIOD_MS))
    expect(document.title).toBe('Opponent found')
  })

  it('stops and restores the real title the moment the player comes back', () => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    renderHook(() => useTabAlert('Opponent found', true))
    expect(document.title).toBe('Opponent found')

    act(() => setVisibility('visible'))
    expect(document.title).toBe(ORIGINAL)

    // And it stays put: the match is already under way, so a second round of
    // blinking would be at somebody who is watching the board.
    act(() => void vi.advanceTimersByTime(TAB_ALERT_PERIOD_MS * 4))
    expect(document.title).toBe(ORIGINAL)
  })

  it('restores the title on unmount', () => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    const { unmount } = renderHook(() => useTabAlert('Opponent found', true))
    expect(document.title).toBe('Opponent found')
    unmount()
    expect(document.title).toBe(ORIGINAL)
  })

  it('does nothing at all while the trigger is off', () => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    renderHook(() => useTabAlert('Opponent found', false))
    act(() => void vi.advanceTimersByTime(TAB_ALERT_PERIOD_MS * 4))
    expect(document.title).toBe(ORIGINAL)
  })
})
