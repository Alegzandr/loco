/**
 * The music steps behind a door while something is read over it, and comes
 * back when that shuts — on every path out, unmount included.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { music } from '../audio/music'
import { muffleBedWhile } from '../hooks/bedMuffle.svelte'
import { renderHook } from './renderHook'

describe('muffleBedWhile', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('muffles while open and lets go when it shuts', () => {
    const muffle = vi.spyOn(music, 'setMuffled')
    const view = renderHook((open) => muffleBedWhile(open), { initialProps: false })
    expect(muffle).not.toHaveBeenCalled()
    view.rerender(true)
    expect(muffle).toHaveBeenLastCalledWith(true)
    view.rerender(false)
    expect(muffle).toHaveBeenLastCalledWith(false)
    expect(muffle).toHaveBeenCalledTimes(2)
    view.unmount()
  })

  it('lets go when the panel is unmounted open', () => {
    // The rules modal is mounted only while open: its unmount is its close.
    const muffle = vi.spyOn(music, 'setMuffled')
    const view = renderHook(() => muffleBedWhile(() => true))
    expect(muffle).toHaveBeenLastCalledWith(true)
    view.unmount()
    expect(muffle).toHaveBeenLastCalledWith(false)
  })
})
