import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from './renderHook'
import { heldKey, HELD_KEY_AFTER_MS } from '../hooks/viewEffects.svelte'

const press = (key: string, repeat = false) => {
  let allowed = true
  act(() => {
    allowed = window.dispatchEvent(new KeyboardEvent('keydown', { key, repeat, cancelable: true }))
  })
  return allowed
}

const release = (key: string) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keyup', { key }))
  })

const hold = () =>
  act(() => {
    vi.advanceTimersByTime(HELD_KEY_AFTER_MS + 1)
  })

describe('heldKey', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('is true only while the key is held, and not on a press', () => {
    const { result } = renderHook(() => heldKey('Tab'))
    expect(result.current).toBe(false)
    press('Tab')
    expect(result.current).toBe(false)
    hold()
    expect(result.current).toBe(true)
    release('Tab')
    expect(result.current).toBe(false)
  })

  // The first keydown is the browser's: on TAB that is the focus moving, which
  // is the only way a keyboard reaches a card or the bar. A press that is
  // released before the hold shows nothing and prevents nothing.
  it('leaves a short press to the browser', () => {
    const { result } = renderHook(() => heldKey('Tab'))
    expect(press('Tab')).toBe(true)
    release('Tab')
    hold()
    expect(result.current).toBe(false)
  })

  // Once held, the key's own repeats are swallowed so the focus stops cycling
  // under an open table; a repeat is also a hold in itself.
  it('swallows repeats and treats one as a hold', () => {
    const { result } = renderHook(() => heldKey('Tab'))
    expect(press('Tab', true)).toBe(false)
    expect(result.current).toBe(true)
    expect(press('Tab', true)).toBe(false)
    release('Tab')
    expect(result.current).toBe(false)
  })

  // Chrome resumes sequential focus from wherever the last focused node *was*,
  // and after a dismissed summary that is the end of the document: an
  // unsteered TAB walked out of the page, blurred the window and never held.
  it('steers a TAB pressed with nothing focused onto the first control', () => {
    const btn = document.createElement('button')
    btn.textContent = 'Draw'
    document.body.appendChild(btn)
    try {
      const { result } = renderHook(() => heldKey('Tab'))
      ;(document.activeElement as HTMLElement | null)?.blur?.()
      expect(press('Tab')).toBe(false)
      expect(document.activeElement).toBe(btn)
      hold()
      expect(result.current).toBe(true)
      release('Tab')
    } finally {
      btn.remove()
    }
  })

  it('ignores other keys', () => {
    const { result } = renderHook(() => heldKey('Tab'))
    press('Shift')
    hold()
    expect(result.current).toBe(false)
  })

  // Alt-tabbing away swallows the keyup: without a blur reset the overlay
  // stays pinned over the board with no way to dismiss it.
  it('releases when the window loses focus mid-hold', () => {
    const { result } = renderHook(() => heldKey('Tab'))
    press('Tab')
    hold()
    expect(result.current).toBe(true)
    act(() => {
      window.dispatchEvent(new Event('blur'))
    })
    expect(result.current).toBe(false)
  })

  it('stops listening when disabled, and drops a hold already in progress', () => {
    // `enabled` arrives as the accessor the hook already takes, so flipping it
    // below is the same thing the score table does when the match ends under a
    // held TAB — not a remount with a different argument, which would prove
    // nothing about a hold in progress.
    const { result, rerender } = renderHook((enabled) => heldKey('Tab', enabled), {
      initialProps: true,
    })
    press('Tab')
    hold()
    expect(result.current).toBe(true)

    rerender(false)
    expect(result.current).toBe(false)
    press('Tab')
    hold()
    expect(result.current).toBe(false)
  })
})
