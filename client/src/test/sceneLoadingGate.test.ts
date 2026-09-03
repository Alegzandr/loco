/**
 * The map-loading gate exists to hide the one expensive thing a match does, and
 * it only manages that if the room is built **once**, around the table it will
 * actually be dealt on.
 *
 * Three things ask `sceneCache` for the same room while a match opens: the gate
 * (which measures the wait), the screen it puts up, and the board mounted behind
 * it. They agree on a cache entry only when they agree on the render size *and*
 * on the felt the podium goes under — and each of those had a way of drifting
 * that cost a second full render on the main thread, at the exact moment the
 * gate lifted. Which is the freeze the gate is there to hide.
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderHook } from './renderHook'
import { sizeCloseEnough } from '../components/scene/sceneCache'

const NOTCH = { top: 59, right: 0, bottom: 34, left: 0 }

// No desktop browser reports a notch and jsdom has no `env()` at all, so the
// only way to test the board against one is to hand it the numbers. Same seam
// `safeArea.test.ts` uses, one level lower: this is about *when* the value is
// known, so the accessor under test has to be the real one.
vi.mock('../hooks/safeAreaInsets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/safeAreaInsets')>()),
  readInsets: () => NOTCH,
}))

const read = (p: string) => readFileSync(join(process.cwd(), 'src', p), 'utf8')

describe('the felt the room is built around is the final one', () => {
  it('knows the safe areas before the first effect runs', async () => {
    const { safeAreaInsets } = await import('../hooks/boardMetrics.svelte')
    let atSetup: unknown = null
    // Read during setup, which is when the preload solves the anchor it renders
    // the podium under. Seeded from `NO_INSETS` and filled in by an effect, this
    // is `{0,0,0,0}` — an anchor twenty pixels up the screen from the one the
    // board settles on, so the room was built, thrown away and built again.
    const { unmount } = renderHook(() => {
      const s = safeAreaInsets()
      atSetup = { ...s.current }
      return s
    })
    expect(atSetup).toEqual(NOTCH)
    unmount()
  })
})

describe('a frame near enough the size asked for is stretched, not re-rendered', () => {
  const size = (width: number, height: number) => ({ width, height, pixelRatio: 1 })

  it('accepts a handful of pixels either way', () => {
    // A scrollbar, a browser bar on its way out, a `dvh` that is not
    // `innerHeight`: all of them a percent or two.
    expect(sizeCloseEnough(size(1920, 1080), size(1905, 1080))).toBe(true)
    expect(sizeCloseEnough(size(780, 1688), size(780, 1660))).toBe(true)
  })

  it('refuses a real change of shape', () => {
    expect(sizeCloseEnough(size(1920, 1080), size(1280, 1080))).toBe(false)
    expect(sizeCloseEnough(size(1920, 1080), size(1920, 720))).toBe(false)
  })

  it('is what the backdrop asks before it orders another render', () => {
    const source = read('components/scene/SceneBackdrop.svelte')
    expect(source).toMatch(/sizeCloseEnough\(have\.size, target\)/)
    // By value, never by identity: the anchor is a `$derived` object, so an
    // unchanged viewport still hands out a new one on every re-run.
    expect(source).toMatch(/sameFelt\(have\.felt, felt\)/)
  })
})

describe('nothing pale is shown while the room is still being built', () => {
  it('darkens the sky the backdrop stands in until a frame lands', () => {
    const source = read('components/scene/SceneBackdrop.svelte')
    const bare = source.match(/\n {2}\.bare \{[\s\S]*?\n {2}\}/)
    expect(bare, '.bare rule not found').not.toBeNull()
    // A noon sky is a near-white, and a full screen of it under white type is
    // what the gate put up on every day map.
    expect(bare![0]).toMatch(/color-mix\(in srgb, var\(--sky-top\) \d+%, #07060f\)/)
    expect(bare![0]).toMatch(/color-mix\(in srgb, var\(--sky-horizon\) \d+%, #07060f\)/)
  })

  it('takes the room-void well down from the horizon before the page wears it', () => {
    // `--room-void` paints every band the page does not own — an iOS safe area,
    // the strip a floating browser bar reserves — and the loading screen itself.
    const source = read('components/cards/GameBoard.svelte')
    expect(source).toMatch(/hexCss\(mix\(rig\.sky\.horizon, 0x07060f, 0\.\d+\)\)/)
  })
})
