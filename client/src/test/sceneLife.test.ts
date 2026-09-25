/**
 * What moves over a rendered room, and what it may not cost.
 *
 * `LifeLayer` carries sprites along routes with Web Animations; `life.ts` is
 * the arithmetic that turns a route on screen — projected by the render from
 * the route in the world, with a scale at every point — into keyframes in
 * pixels. The route's frame of reference is the render's own
 * (`TILES_ACROSS` across the longer side, the origin at the centre).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushSync } from 'svelte'
import { render } from './render'
import LifeLayer from '../components/scene/LifeLayer.svelte'
import type { PreparedScene } from '../components/scene/sceneCache'
import { resetMotionPref, setMotionPref } from '../hooks/motionPref'
import {
  routeKeyframes,
  cycleMs,
  tilePx,
  toPx,
  TILES_ACROSS,
  type Actor,
  type Sprite,
} from '../components/scene/life'

const read = (p: string) => readFileSync(join(process.cwd(), 'src', p), 'utf8')

const actor = (over: Partial<Actor>): Actor => ({ id: 'x', build: () => {}, world: [[0, 0, 0]], path: [[0, 0]], duration: 1000, ...over })

describe('a route in tiles lands where the render puts the tile', () => {
  it('measures a tile off the longer side, like the frame', () => {
    expect(tilePx(1920, 1080)).toBeCloseTo(1920 / TILES_ACROSS)
    expect(tilePx(390, 844)).toBeCloseTo(844 / TILES_ACROSS)
  })

  it('puts the origin at the centre and `sy` up', () => {
    const ppu = tilePx(1920, 1080)
    expect(toPx([0, 0], 1920, 1080, ppu)).toEqual([960, 540])
    const [x, y] = toPx([10, 5], 1920, 1080, ppu)
    expect(x).toBeGreaterThan(960)
    expect(y).toBeLessThan(540)
  })
})

describe('keyframes', () => {
  const ppu = tilePx(1920, 1080)

  it('weights a leg by its length so the thing moves at one speed', () => {
    const f = routeKeyframes(actor({ path: [[0, 0], [10, 0], [40, 0]], motion: 'pass', duration: 1000, every: 1000 }), 1920, 1080, ppu)
    expect(f.map((k) => k.offset)).toEqual([0, 0.25, 1])
  })

  it('walks a loop back to where it started rather than jumping there', () => {
    // 0 → 10 → 40 → 0: eighty tiles, and the way home is half of them.
    const f = routeKeyframes(actor({ path: [[0, 0], [10, 0], [40, 0]] }), 1920, 1080, ppu)
    expect(f.map((k) => k.offset)).toEqual([0, 0.125, 0.5, 1])
    expect(f[f.length - 1].transform).toBe(f[0].transform)
  })

  it('leaves the wrap to the fade when there is one', () => {
    // A cloud drifts one way and comes back on the other side of the frame,
    // invisible while it does: closing the ring would drift it back on screen.
    const f = routeKeyframes(actor({ path: [[-50, 0], [50, 0]], fade: true }), 1920, 1080, ppu)
    expect(f).toHaveLength(2)
    expect(f[0].opacity).toBe(0)
    expect(f[1].opacity).toBe(0)
  })

  it('goes there and back for a bounce', () => {
    const f = routeKeyframes(actor({ path: [[0, 0], [10, 0]], motion: 'bounce' }), 1920, 1080, ppu)
    expect(f[0].transform).toBe(f[f.length - 1].transform)
    expect(f.length).toBeGreaterThanOrEqual(3)
  })

  it('flips the sprite on a leg that heads left, and only then', () => {
    const f = routeKeyframes(actor({ path: [[0, 0], [10, 0]], motion: 'bounce', turn: true }), 1920, 1080, ppu)
    const flipped = f.filter((k) => k.transform.includes('scaleX(-1)'))
    const straight = f.filter((k) => !k.transform.includes('scaleX(-1)'))
    expect(flipped.length).toBeGreaterThan(0)
    expect(straight.length).toBeGreaterThan(0)
    const none = routeKeyframes(actor({ path: [[0, 0], [10, 0]], motion: 'pass', turn: true }), 1920, 1080, ppu)
    expect(none.some((k) => k.transform.includes('scaleX'))).toBe(false)
  })

  it('hides a pass for the rest of its cycle, and is whole while crossing', () => {
    const a = actor({ path: [[-50, 0], [50, 0]], motion: 'pass', duration: 1000, every: 4000 })
    const f = routeKeyframes(a, 1920, 1080, ppu)
    expect(cycleMs(a)).toBe(4000)
    // Every crossing frame says opacity 1 outright: a frame without it would
    // interpolate towards the hidden tail's 0 across the whole crossing.
    for (const k of f.filter((k) => k.offset <= 0.25)) expect(k.opacity).toBe(1)
    const crossed = f.find((k) => k.offset >= 0.25 && k.opacity === 0)
    expect(crossed).toBeDefined()
    expect(f[f.length - 1].opacity).toBe(0)
    expect(f[f.length - 1].offset).toBe(1)
  })

  it('never stretches a pass past its cycle, whatever period was written', () => {
    // A speed resolves the duration after the builder wrote `every`: a walker
    // whose crossing came out longer than its period put every keyframe past
    // offset 1, which Web Animations refuses outright.
    const a = actor({ path: [[-50, 0], [50, 0]], motion: 'pass', duration: 9000, every: 4000 })
    const f = routeKeyframes(a, 1920, 1080, ppu)
    for (const k of f) {
      expect(k.offset).toBeGreaterThanOrEqual(0)
      expect(k.offset).toBeLessThanOrEqual(1)
    }
    expect(cycleMs(a)).toBe(9000)
  })

  it('never hands the browser offsets that go backwards', () => {
    const a = actor({ path: [[-50, 0], [0, 3], [50, 0]], motion: 'pass', turn: true, fade: true, duration: 3000, every: 9000 })
    const f = routeKeyframes(a, 1920, 1080, ppu)
    for (let i = 1; i < f.length; i++) expect(f[i].offset).toBeGreaterThanOrEqual(f[i - 1].offset)
  })
})

describe('the layer', () => {
  const layer = read('components/scene/LifeLayer.svelte')
  const backdrop = read('components/scene/SceneBackdrop.svelte')
  const weather = read('components/scene/WeatherLayer.svelte')

  it('sits above both frames and under the weather', () => {
    const z = (src: string) => [...src.matchAll(/z-index:\s*(\d+)/g)].map((m) => Number(m[1]))
    expect(Math.min(...z(layer))).toBeGreaterThan(Math.max(...z(backdrop)))
    expect(Math.min(...z(weather))).toBeGreaterThan(Math.max(...z(layer)))
  })


  it('animates transforms and opacity, never layout', () => {
    // Every keyframe handed to `animate` is a transform, with opacity at most;
    // the one layout write is the canvas being sized once, before any motion.
    expect(layer).not.toMatch(/style\.(left|top)\s*=/)
    expect(layer).not.toMatch(/\{\s*(left|top|width|height):/)
    expect(layer).toMatch(/will-change:\s*transform/)
  })

  it('is scaled to the element rather than re-laid-out on a resize', () => {
    expect(layer).toMatch(/transform-origin:\s*0 0/)
    expect(layer).toMatch(/scale\(/)
  })

  it('carries the scale along the route on the same transform, so it is still one animation', () => {
    const f = routeKeyframes(actor({ path: [[0, 0], [10, 0]], scales: [1, 0.5], motion: 'bounce' }), 1920, 1080, tilePx(1920, 1080))
    expect(f[1].transform).toMatch(/^translate\([^)]*\) scale\(0\.5000\)$/)
    expect(layer).not.toMatch(/sprite\.mask/)
  })
})

/**
 * The layer itself, mounted: jsdom has no canvas and no Web Animations, so
 * `animate` is recorded here and the bitmap's context is refused, and what
 * is asserted is which element runs which animation, and when.
 */
describe('the layer, mounted', () => {
  type Run = { el: Element; keyframes: Keyframe[]; cancelled: boolean }
  let runs: Run[] = []

  beforeEach(() => {
    runs = []
    try {
      localStorage.clear()
    } catch {
      // No storage: the preference falls back to the system's, which jsdom says nothing about.
    }
    resetMotionPref()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    vi.spyOn(Element.prototype, 'animate').mockImplementation(function (this: Element, keyframes) {
      const run: Run = { el: this, keyframes: keyframes as Keyframe[], cancelled: false }
      runs.push(run)
      return { cancel: () => (run.cancelled = true) } as unknown as Animation
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    try {
      localStorage.clear()
    } catch {
      // As above.
    }
    resetMotionPref()
  })

  const sprite = (a: Partial<Actor>): Sprite => {
    const canvas = document.createElement('canvas')
    canvas.width = 20
    canvas.height = 30
    return { actor: actor(a), canvas, ox: 10, oy: 28 }
  }

  const scene = (sprites: Sprite[]) =>
    ({ key: 'k', size: { width: 1920, height: 1080, pixelRatio: 1 }, sprites }) as unknown as PreparedScene

  const running = () => runs.filter((r) => !r.cancelled)
  const on = (container: HTMLElement, id: string, sel: string) => container.querySelector(`[data-id="${id}"]${sel}`)!

  it('follows reduced motion as it is switched, mid-match', () => {
    const { container } = render(LifeLayer, { scene: scene([sprite({ id: 'walker', path: [[0, 0], [10, 0]], motion: 'bounce' })]), width: 1920, height: 1080 })
    const node = on(container, 'walker', '') as HTMLElement
    expect(running().map((r) => r.el)).toEqual([node])

    setMotionPref('reduce')
    flushSync()
    // Stopped where it stands on the first point of its route, and nothing runs.
    expect(running()).toHaveLength(0)
    expect(node.style.transform).toBe(routeKeyframes(actor({ path: [[0, 0], [10, 0]], motion: 'bounce' }), 1920, 1080, tilePx(1920, 1080))[0].transform)

    setMotionPref('full')
    flushSync()
    expect(running().map((r) => r.el)).toEqual([node])
    expect(node.style.transform).toBe('')
  })

  it('starts nothing at all when reduced motion is on from the start', () => {
    setMotionPref('reduce')
    render(LifeLayer, { scene: scene([sprite({ id: 'b', path: [[0, 0]], bob: { amp: 0.2, period: 800 }, spin: true })]), width: 1920, height: 1080 })
    expect(runs).toHaveLength(0)
  })

  it('lets a thing that stays put still bob and turn where it stands', () => {
    const { container } = render(LifeLayer, {
      scene: scene([sprite({ id: 'mill', path: [[3, 2]], bob: { amp: 0.2, period: 800 }, spin: true })]),
      width: 1920,
      height: 1080,
    })
    const node = on(container, 'mill', '') as HTMLElement
    // Placed, not carried: no route animation, and the static transform is its point.
    expect(node.style.transform).toMatch(/^translate\(/)
    expect(running().some((r) => r.el === node)).toBe(false)
    expect(running().some((r) => r.el === node.querySelector('.body'))).toBe(true)
    expect(running().some((r) => r.el === node.querySelector('.face'))).toBe(true)
  })

  it('never runs two transform animations on one element', () => {
    // Two animations writing one `transform` do not compose: the later wins,
    // and a bobbing thing that also spun did not bob.
    render(LifeLayer, {
      scene: scene([
        sprite({ id: 'all', path: [[0, 0], [10, 0]], bob: { amp: 0.2, period: 800 }, spin: true, puff: true }),
        sprite({ id: 'spun', path: [[0, 5], [10, 5]], bob: { amp: 0.2, period: 800 }, spin: true }),
      ]),
      width: 1920,
      height: 1080,
    })
    const byEl = new Map<Element, number>()
    for (const r of running()) if (r.keyframes.some((k) => 'transform' in k)) byEl.set(r.el, (byEl.get(r.el) ?? 0) + 1)
    expect(byEl.size).toBe(6)
    for (const n of byEl.values()) expect(n).toBe(1)
    // The one that spins and puffs turns inside the same keyframes it grows in.
    const face = running().find((r) => r.el.closest('[data-id="all"]') && r.el.classList.contains('face'))!
    expect(face.keyframes.every((k) => /scale\(/.test(String(k.transform)) && /rotate\(/.test(String(k.transform)))).toBe(true)
  })
})
