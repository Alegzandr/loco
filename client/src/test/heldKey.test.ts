import { describe, it, expect } from 'vitest'
import { renderHook, act } from './renderHook'
import { heldKey } from '../hooks/viewEffects.svelte'

type Mods = { shiftKey?: boolean; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean }

/** Dispatches a keydown and answers whether the page kept its default. */
const press = (key: string, opts: Mods & { repeat?: boolean } = {}) => {
  let allowed = true
  act(() => {
    allowed = window.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true, ...opts }))
  })
  return allowed
}

const release = (key: string, opts: Mods = {}) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keyup', { key, ...opts }))
  })

describe('heldKey', () => {
  // The scoreboard key of every competitive game: the press *is* the gesture,
  // so the panel is up on the first keydown and gone on the keyup. There is no
  // arming delay to wait through and nothing moves on the board on the way in.
  it('is true from the press and false again on the release', () => {
    const { result } = renderHook(() => heldKey('Tab'))
    expect(result.current).toBe(false)
    press('Tab')
    expect(result.current).toBe(true)
    release('Tab')
    expect(result.current).toBe(false)
  })

  // TAB stops being navigation while the board owns it. This is the assertion
  // behind that: the event is cancelled, so the focus never moves.
  it('swallows the key so the focus never moves', () => {
    renderHook(() => heldKey('Tab'))
    expect(press('Tab')).toBe(false)
    expect(press('Tab', { repeat: true })).toBe(false)
    release('Tab')
  })

  // The keyboard still has to get around the board, and this is how: Shift+TAB
  // is left completely alone, so every control is reachable in reverse order
  // and the table is not a keyboard trap. It opens nothing either — the
  // standings are the unmodified key.
  it('leaves Shift+TAB to the browser, and opens nothing on it', () => {
    const { result } = renderHook(() => heldKey('Tab'))
    expect(press('Tab', { shiftKey: true })).toBe(true)
    expect(result.current).toBe(false)
    release('Tab', { shiftKey: true })
  })

  // Ctrl+TAB switches browser tabs, Alt+TAB is the window manager's. A
  // combination that belongs to somebody else is never taken.
  it('leaves the other modifier combinations alone', () => {
    const { result } = renderHook(() => heldKey('Tab'))
    for (const mod of ['ctrlKey', 'altKey', 'metaKey'] as const) {
      expect(press('Tab', { [mod]: true }), mod).toBe(true)
      expect(result.current, mod).toBe(false)
      release('Tab')
    }
  })

  // A Shift pressed *during* a hold must not hand the key back: the repeats
  // would walk the focus backwards under an open panel.
  it('keeps the key once it is down, whatever a modifier says afterwards', () => {
    const { result } = renderHook(() => heldKey('Tab'))
    press('Tab')
    expect(result.current).toBe(true)
    expect(press('Tab', { repeat: true, shiftKey: true })).toBe(false)
    expect(result.current).toBe(true)
    release('Tab')
    expect(result.current).toBe(false)
  })

  it('ignores other keys', () => {
    const { result } = renderHook(() => heldKey('Tab'))
    expect(press('Shift')).toBe(true)
    expect(result.current).toBe(false)
  })

  // Alt-tabbing away swallows the keyup: without a blur reset the panel stays
  // pinned over the board with no way to dismiss it.
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
    // below is the same thing the score table does when a picker opens under a
    // held TAB — not a remount with a different argument, which would prove
    // nothing about a hold in progress.
    const { result, rerender } = renderHook((enabled) => heldKey('Tab', enabled), {
      initialProps: true,
    })
    press('Tab')
    expect(result.current).toBe(true)

    rerender(false)
    expect(result.current).toBe(false)
    // And the key goes back to the browser with the listener: inside a dialog
    // TAB is the dialog's.
    expect(press('Tab')).toBe(true)
    expect(result.current).toBe(false)
  })
})
