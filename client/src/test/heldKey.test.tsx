import { describe, it, expect } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useHeldKey } from '../hooks/useHeldKey'

const press = (key: string) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key }))
  })

const release = (key: string) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keyup', { key }))
  })

describe('useHeldKey', () => {
  it('is true only while the key is down', () => {
    const { result } = renderHook(() => useHeldKey('Tab'))
    expect(result.current).toBe(false)
    press('Tab')
    expect(result.current).toBe(true)
    release('Tab')
    expect(result.current).toBe(false)
  })

  it('ignores other keys', () => {
    const { result } = renderHook(() => useHeldKey('Tab'))
    press('Shift')
    expect(result.current).toBe(false)
  })

  // Alt-tabbing away swallows the keyup: without a blur reset the overlay
  // stays pinned over the board with no way to dismiss it.
  it('releases when the window loses focus mid-hold', () => {
    const { result } = renderHook(() => useHeldKey('Tab'))
    press('Tab')
    expect(result.current).toBe(true)
    act(() => {
      window.dispatchEvent(new Event('blur'))
    })
    expect(result.current).toBe(false)
  })

  it('stops listening when disabled, and drops a hold already in progress', () => {
    const { result, rerender } = renderHook(({ on }) => useHeldKey('Tab', on), {
      initialProps: { on: true },
    })
    press('Tab')
    expect(result.current).toBe(true)

    rerender({ on: false })
    expect(result.current).toBe(false)
    press('Tab')
    expect(result.current).toBe(false)
  })
})
