import { describe, it, expect } from 'vitest'
import { renderHook, act } from './renderHook'
import { heldKey } from '../hooks/viewEffects.svelte'

const press = (key: string) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key }))
  })

const release = (key: string) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keyup', { key }))
  })

describe('heldKey', () => {
  it('is true only while the key is down', () => {
    const { result } = renderHook(() => heldKey('Tab'))
    expect(result.current).toBe(false)
    press('Tab')
    expect(result.current).toBe(true)
    release('Tab')
    expect(result.current).toBe(false)
  })

  it('ignores other keys', () => {
    const { result } = renderHook(() => heldKey('Tab'))
    press('Shift')
    expect(result.current).toBe(false)
  })

  // Alt-tabbing away swallows the keyup: without a blur reset the overlay
  // stays pinned over the board with no way to dismiss it.
  it('releases when the window loses focus mid-hold', () => {
    const { result } = renderHook(() => heldKey('Tab'))
    press('Tab')
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
    expect(result.current).toBe(true)

    rerender(false)
    expect(result.current).toBe(false)
    press('Tab')
    expect(result.current).toBe(false)
  })
})
