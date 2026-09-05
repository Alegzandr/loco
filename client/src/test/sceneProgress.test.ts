/**
 * The loading bar moves while the room is built.
 *
 * The room is built and drawn on the main thread, and for most of a match's
 * opening that is the whole wait: the engine's chunk and the kits are cached
 * per tab, so on a rematch both land at once and the render is the bar. Done
 * in one synchronous stretch after a `setTimeout(0)`, the render froze the
 * thread before the browser had painted anything, and the bar was seen empty
 * and then full — "stuck", to the player watching it. Two things fix that and
 * both are pinned here: a report is followed by a real paint (two animation
 * frames), and the render itself reports between its phases.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextPaint } from '../components/scene/nextPaint'

const rendered = vi.hoisted(() => ({ steps: [] as number[] }))

vi.mock('../components/scene/render', () => ({
  prepareModels: async (_spec: unknown, onProgress?: (p: number) => void) => {
    onProgress?.(0.5)
    onProgress?.(1)
    return {}
  },
  renderScene: async (
    _spec: unknown,
    _size: unknown,
    _felt: unknown,
    _models: unknown,
    _tier: unknown,
    onProgress?: (p: number) => void,
  ) => {
    for (const p of rendered.steps) {
      onProgress?.(p)
      await nextPaint()
    }
    return { frame: null, sprites: [] }
  },
}))

/** A fake frame clock: `tick()` runs every callback queued by requestAnimationFrame. */
function fakeFrames() {
  let queue: FrameRequestCallback[] = []
  let frames = 0
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    queue.push(cb)
    return queue.length
  })
  return {
    tick() {
      const run = queue
      queue = []
      frames++
      for (const cb of run) cb(frames * 16)
    },
    get frames() {
      return frames
    },
    get pending() {
      return queue.length
    },
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('nextPaint', () => {
  it('resolves after two animation frames, never after one', async () => {
    const clock = fakeFrames()
    let done = false
    void nextPaint().then(() => (done = true))
    // The first callback runs *before* its frame is painted, so one frame is
    // not a paint.
    clock.tick()
    await Promise.resolve()
    expect(done).toBe(false)
    clock.tick()
    await Promise.resolve()
    expect(done).toBe(true)
  })

  it('falls back to a timer when no frame comes, so a hidden tab still renders', async () => {
    const clock = fakeFrames()
    let done = false
    void nextPaint(120).then(() => (done = true))
    expect(clock.pending).toBe(1)
    await vi.advanceTimersByTimeAsync(119)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(done).toBe(true)
  })
})

describe('prepareScene', () => {
  it('paints the bar before the build takes the thread, and reports every phase of the render', async () => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16))
    const { prepareScene, clearSceneCache, PROGRESS } = await import('../components/scene/sceneCache')
    const { resolveScene } = await import('../components/cards/maps')
    clearSceneCache()
    rendered.steps = [0.2, 0.35, 0.65, 0.75]

    const seen: number[] = []
    const spec = resolveScene('neon', 'night', 'clear')!
    const size = { width: 800, height: 600, pixelRatio: 1 }
    const felt = { cx: 400, cy: 300, rx: 200, ry: 100 }
    const p = prepareScene(spec, size, felt, (x) => seen.push(x), 'light')
    await vi.runAllTimersAsync()
    await p

    // Monotonic: the bar never runs backwards.
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1])
    // The models' stretch, then the render's phases mapped into what is left,
    // then done. The four render steps are what used to be one silent freeze.
    expect(seen[0]).toBe(PROGRESS.engine)
    expect(seen).toContain(PROGRESS.models)
    const inRender = seen.filter((x) => x > PROGRESS.models && x < 1)
    expect(inRender).toHaveLength(rendered.steps.length)
    expect(seen.at(-1)).toBe(1)
  })

  it('does not hand the thread to the render before the models report is painted', async () => {
    const clock = fakeFrames()
    const { prepareScene, clearSceneCache, PROGRESS } = await import('../components/scene/sceneCache')
    const { resolveScene } = await import('../components/cards/maps')
    clearSceneCache()
    rendered.steps = []

    const seen: number[] = []
    const spec = resolveScene('rune', 'day', 'clear')!
    const size = { width: 800, height: 600, pixelRatio: 1 }
    const felt = { cx: 400, cy: 300, rx: 200, ry: 100 }
    let settled = false
    const p = prepareScene(spec, size, felt, (x) => seen.push(x), 'light')
    void p.then(() => (settled = true))
    // Drain the microtasks of the (mocked) chunk and model loads.
    await vi.advanceTimersByTimeAsync(0)
    expect(seen).toContain(PROGRESS.models)
    // Nothing more happens until the browser has actually painted: a frame is
    // requested and the render waits on it.
    expect(clock.pending).toBe(1)
    expect(settled).toBe(false)
    clock.tick()
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)
    clock.tick()
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(true)
    expect(seen.at(-1)).toBe(1)
  })
})
