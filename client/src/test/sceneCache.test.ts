/**
 * The cache the gate, the loading screen and the board share.
 *
 * Four things about it failed without a sound. Three requests for one room
 * while a match opens, off three measurements a pixel apart, each started a
 * full render of its own — on the main thread, the second landing after the
 * gate lifted. A render that failed once (a context limit, a lost context) was
 * remembered as the room for the rest of the tab. A models fetch that stalled
 * held the render in flight forever. And eviction was by age of insertion, so
 * the frame on screen could be the one thrown out.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const engine = vi.hoisted(() => ({
  renders: 0,
  fail: false,
  modelsHang: false,
  /** Reports the mocked render makes, in [0, 1] of the render. */
  steps: [0.5] as number[],
}))

vi.mock('../components/scene/render', () => ({
  prepareModels: (_spec: unknown, onProgress?: (p: number) => void) => {
    if (engine.modelsHang) return new Promise(() => {})
    onProgress?.(1)
    return Promise.resolve({})
  },
  renderScene: async (_s: unknown, _z: unknown, _f: unknown, _m: unknown, _t: unknown, onProgress?: (p: number) => void) => {
    engine.renders++
    for (const p of engine.steps) {
      onProgress?.(p)
      await new Promise((r) => setTimeout(r, 5))
    }
    if (engine.fail) throw new Error('context lost')
    return { frame: document.createElement('canvas'), sprites: [] }
  },
}))

import { clearSceneCache, FAILED_TTL_MS, MODELS_TIMEOUT_MS, peekScene, prepareScene } from '../components/scene/sceneCache'
import { resolveScene } from '../components/cards/maps'

const spec = resolveScene('neon', 'night', 'clear')!
const other = (id: string) => resolveScene(id, 'day', 'clear')!
const felt = { cx: 400, cy: 300, rx: 200, ry: 100 }
const size = (width: number, height: number) => ({ width, height, pixelRatio: 1 })

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16))
  clearSceneCache()
  engine.renders = 0
  engine.fail = false
  engine.modelsHang = false
  engine.steps = [0.5]
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('one room is rendered once, however many ask for it', () => {
  it('joins a render in flight at a size a pixel off, rather than starting a second one', async () => {
    // The gate asks off the window, the loading screen off its own element.
    const gate = prepareScene(spec, size(1280, 720), felt, undefined, 'high')
    const seen: number[] = []
    const screen = prepareScene(spec, size(1279, 720), felt, (p) => seen.push(p), 'high')
    await vi.runAllTimersAsync()
    const [a, b] = await Promise.all([gate, screen])
    expect(engine.renders).toBe(1)
    expect(b).toBe(a)
    expect(a.canvas).not.toBeNull()
    // The joiner's bar is fed by the one render, and ends full.
    expect(seen.length).toBeGreaterThan(1)
    expect(seen.at(-1)).toBe(1)
  })

  it('answers a request a pixel off a finished frame from that frame', async () => {
    const first = prepareScene(spec, size(1280, 720), felt, undefined, 'high')
    await vi.runAllTimersAsync()
    const a = await first
    const b = await prepareScene(spec, size(1280, 719), felt, undefined, 'high')
    expect(b).toBe(a)
    expect(engine.renders).toBe(1)
  })

  it('does not join a render of another felt, another tier or another shape', async () => {
    // A millisecond apart, every one of them still in flight when the next
    // asks: Vitest hands the real module to the second of two dynamic imports
    // of a mocked one made in the same tick, which would render a real room.
    const renders: Promise<unknown>[] = []
    const ask = async (...args: Parameters<typeof prepareScene>) => {
      renders.push(prepareScene(...args))
      await vi.advanceTimersByTimeAsync(1)
    }
    await ask(spec, size(1280, 720), felt, undefined, 'high')
    await ask(spec, size(1280, 720), { ...felt, cx: 460 }, undefined, 'high')
    await ask(spec, size(1280, 720), felt, undefined, 'light')
    await ask(spec, size(720, 1280), felt, undefined, 'high')
    // And the pixel-off one still joins, with all four in the air.
    await ask(spec, size(1279, 720), felt, undefined, 'high')
    expect(engine.renders).toBe(0)
    await vi.runAllTimersAsync()
    await Promise.all(renders)
    expect(engine.renders).toBe(4)
  })
})

describe('a failed render is not the room for the rest of the tab', () => {
  it('answers from the failure for a moment, then tries again', async () => {
    engine.fail = true
    const first = prepareScene(spec, size(1280, 720), felt, undefined, 'high')
    await vi.runAllTimersAsync()
    expect((await first).canvas).toBeNull()
    expect(engine.renders).toBe(1)

    // A window being dragged does not retry it on every pixel…
    const again = await prepareScene(spec, size(1280, 720), felt, undefined, 'high')
    expect(again.canvas).toBeNull()
    expect(engine.renders).toBe(1)

    // …but the context that was lost is back a moment later, and so is the room.
    engine.fail = false
    vi.advanceTimersByTime(FAILED_TTL_MS)
    const later = prepareScene(spec, size(1280, 720), felt, undefined, 'high')
    await vi.runAllTimersAsync()
    expect((await later).canvas).not.toBeNull()
    expect(engine.renders).toBe(2)
  })

  it('never lets a failure put the sky over a frame the cache is holding', async () => {
    const good = prepareScene(spec, size(1280, 720), felt, undefined, 'high')
    await vi.runAllTimersAsync()
    const frame = await good
    engine.fail = true
    const bad = prepareScene(spec, size(800, 1280), felt, undefined, 'high')
    await vi.runAllTimersAsync()
    expect((await bad).canvas).toBeNull()
    // Peeking at the size that failed finds the frame, stretched, not the failure.
    expect(peekScene(spec, size(800, 1280), felt, 'high')).toBe(frame)
  })

  it('gives up on models that never arrive, and lets the next request try', async () => {
    engine.modelsHang = true
    const stuck = prepareScene(spec, size(1280, 720), felt, undefined, 'high')
    let entry: Awaited<typeof stuck> | null = null
    void stuck.then((e) => (entry = e))
    await vi.advanceTimersByTimeAsync(MODELS_TIMEOUT_MS - 1)
    expect(entry).toBeNull()
    await vi.advanceTimersByTimeAsync(1)
    expect(entry!.canvas).toBeNull()
    expect(engine.renders).toBe(0)

    engine.modelsHang = false
    vi.advanceTimersByTime(FAILED_TTL_MS)
    const next = prepareScene(spec, size(1280, 720), felt, undefined, 'high')
    await vi.runAllTimersAsync()
    expect((await next).canvas).not.toBeNull()
  })
})

describe('eviction', () => {
  it('throws out the frame used least recently, not the one put in first', async () => {
    const [a, b, c, d] = ['neon', 'rune', 'velvet', 'orbit'].map((id) => other(id))
    for (const s of [a, b, c]) {
      const p = prepareScene(s, size(1280, 720), felt, undefined, 'high')
      await vi.runAllTimersAsync()
      await p
    }
    // The first room is the one on screen, asked for again.
    await prepareScene(a, size(1280, 720), felt, undefined, 'high')
    const p = prepareScene(d, size(1280, 720), felt, undefined, 'high')
    await vi.runAllTimersAsync()
    await p
    expect(peekScene(a, size(1280, 720), felt, 'high')?.canvas).not.toBeNull()
    expect(peekScene(b, size(1280, 720), felt, 'high')).toBeNull()
  })
})
