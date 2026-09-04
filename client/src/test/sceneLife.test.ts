/**
 * What moves over a rendered room, and what it may not cost.
 *
 * `LifeLayer` carries sprites along routes with Web Animations; `life.ts` is
 * the arithmetic that turns a route in screen tiles into keyframes in pixels.
 * The route's frame of reference is the render's own (`TILES_ACROSS` across
 * the longer side, the origin at the centre), so a point that lands one tile
 * out is a boat one tile up the beach: pinned here against the same figures
 * `render.ts` composes the room with.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  routeKeyframes,
  cycleMs,
  tilePx,
  toPx,
  groundDist,
  routeLength,
  durationFor,
  trimRoute,
  selectActors,
  occluded,
  depthAt,
  PITCH_SIN,
  PITCH_COS,
  PERSON_BODY,
  TILES_ACROSS,
  type Actor,
  type DepthMap,
} from '../components/scene/life'

const read = (p: string) => readFileSync(join(process.cwd(), 'src', p), 'utf8')

const actor = (over: Partial<Actor>): Actor => ({ id: 'x', build: () => {}, path: [[0, 0]], duration: 1000, ...over })

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

  it('never hands the browser offsets that go backwards', () => {
    const a = actor({ path: [[-50, 0], [0, 3], [50, 0]], motion: 'pass', turn: true, fade: true, duration: 3000, every: 9000 })
    const f = routeKeyframes(a, 1920, 1080, ppu)
    for (let i = 1; i < f.length; i++) expect(f[i].offset).toBeGreaterThanOrEqual(f[i - 1].offset)
  })
})

describe('a thing on the ground moves at a speed', () => {
  it('measures a leg on the ground, where up the screen is farther than it looks', () => {
    expect(groundDist([0, 0], [10, 0])).toBeCloseTo(10)
    expect(groundDist([0, 0], [0, 10])).toBeCloseTo(10 / PITCH_SIN)
    // Weighted the same way: the leg up the screen takes the longer share.
    const f = routeKeyframes(actor({ path: [[0, 0], [10, 0], [10, 10]] }), 1920, 1080, tilePx(1920, 1080))
    expect(f[1].offset).toBeLessThan(0.5)
    // In the air the screen is the measure: a cloud drifts as drawn.
    expect(routeLength(actor({ flying: true, path: [[0, 0], [0, 10]], motion: 'pass' }))).toBeCloseTo(10)
  })

  it('resolves the duration from the speed and the route, there and back for a bounce', () => {
    expect(durationFor(actor({ path: [[0, 0], [15, 0]], motion: 'pass', speed: 3 }))).toBeCloseTo(5000)
    expect(durationFor(actor({ path: [[0, 0], [15, 0]], motion: 'bounce', speed: 3 }))).toBeCloseTo(10_000)
    expect(durationFor(actor({ path: [[0, 0], [15, 0]], duration: 777 }))).toBe(777)
  })
})

describe('a route is trimmed to where the thing can stand', () => {
  const walker = (over: Partial<Actor>): Actor => actor({ speed: 1, body: PERSON_BODY, ...over })
  const square: Actor['path'] = [[-10, -10], [10, -10], [10, 10], [-10, 10]]

  it('keeps a whole loop as a loop, and a pass fades', () => {
    const t = trimRoute(walker({ path: square, motion: 'loop' }), () => true)!
    expect(t.motion).toBe('loop')
    expect(t.path).toEqual(square)
    expect(t.duration).toBeCloseTo(routeLength(t) * 1000)
    expect(trimRoute(walker({ path: [[0, 0], [20, 0]], motion: 'pass' }), () => true)!.fade).toBe(true)
  })

  it('cuts a loop to its longest clear arc and walks it there and back', () => {
    // Nothing may stand on the top side (`sy > 5`).
    const t = trimRoute(walker({ path: square, motion: 'loop' }), (pt) => pt[1] < 5)!
    expect(t.motion).toBe('bounce')
    for (const pt of t.path) expect(pt[1]).toBeLessThan(5)
    // The arc runs round the bottom: down the left, along the bottom, up the right.
    expect(t.path.some((pt) => pt[0] < -9 && pt[1] < -9)).toBe(true)
    expect(t.path.some((pt) => pt[0] > 9 && pt[1] < -9)).toBe(true)
    expect(routeLength({ ...t, motion: 'pass' })).toBeGreaterThan(30)
  })

  it('drops a route with nowhere left to go, and one too short to be worth it', () => {
    expect(trimRoute(walker({ path: square, motion: 'loop' }), () => false)).toBeNull()
    expect(trimRoute(walker({ path: [[0, 0], [20, 0]], motion: 'pass' }), (pt) => pt[0] < 2)).toBeNull()
    expect(trimRoute(walker({ path: [[0, 0], [20, 0]], motion: 'pass', minLen: 30 }), () => true)).toBeNull()
  })

  it('leaves something in the air alone', () => {
    const cloud = actor({ flying: true, path: [[-50, 19], [50, 19]] })
    expect(trimRoute(cloud, () => false)!.path).toEqual(cloud.path)
  })

  it('walks the part it was told to', () => {
    const t = trimRoute(walker({ path: [[0, 0], [40, 0]], motion: 'bounce', part: [0.25, 0.75] }), () => true)!
    expect(t.path[0][0]).toBeCloseTo(10)
    expect(t.path[t.path.length - 1][0]).toBeCloseTo(30)
  })

  it('keeps the worthiest of a pick group and every other survivor', () => {
    const cands = [
      walker({ id: 'a', path: [[0, 0], [5, 0]], motion: 'pass', pick: { group: 'g', keep: 1 } }),
      walker({ id: 'b', path: [[0, 0], [30, 0]], motion: 'pass', pick: { group: 'g', keep: 1 } }),
      walker({ id: 'c', path: [[0, 0], [8, 0]], motion: 'pass' }),
    ]
    expect(selectActors(cands, () => true).map((a) => a.id).sort()).toEqual(['b', 'c'])
    // Worth can say otherwise than length.
    expect(selectActors(cands, () => true, (a) => (a.id === 'a' ? 100 : 1)).map((a) => a.id).sort()).toEqual(['a', 'c'])
  })
})

describe('the depth map says what stands in front', () => {
  // A 100×100 map over a 100×100 frame at one tile per ten pixels: flat ground
  // everywhere, then a wall raised across a band of the screen.
  const flat = (): DepthMap => {
    const w = 100
    const h = 100
    const map: DepthMap = { data: new Float32Array(w * h), w, h, scale: 1, fw: 100, fh: 100, ppu: 10, origin: 0.5, perTile: 0.001 }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) map.data[y * w + x] = depthAt(map, (h / 2 - y) / map.ppu, 0)
    return map
  }
  const wall = (map: DepthMap, sy: number, tall: number, nearer: number) => {
    // A wall standing on the ground at `sy`, `tall` tiles high: its pixels
    // carry the depth of its foot, `nearer` tiles toward the camera.
    for (let v = 0; v <= tall * PITCH_COS; v += 0.05) {
      const y = Math.round(map.h / 2 - (sy + v) * map.ppu)
      if (y < 0 || y >= map.h) continue
      for (let x = 0; x < map.w; x++) map.data[y * map.w + x] = depthAt(map, sy, 0) - nearer * PITCH_COS * map.perTile
    }
  }

  it('sees nothing on open ground', () => {
    expect(occluded(flat(), [0, 0], PERSON_BODY)).toBe(false)
    expect(occluded(flat(), [3, -2], PERSON_BODY)).toBe(false)
  })

  it('sees a wall in front of somebody, and not one behind them', () => {
    // A wall two tiles nearer whose silhouette crosses the person's.
    const front = flat()
    wall(front, -1, 3, 2)
    expect(occluded(front, [0, 0], PERSON_BODY)).toBe(true)
    // The same wall, but behind: its pixels are farther than the person's own.
    const behind = flat()
    wall(behind, 1, 3, -2)
    expect(occluded(behind, [0, 0], PERSON_BODY)).toBe(false)
  })

  it('knows nothing off the map, so nothing is in front there', () => {
    expect(occluded(flat(), [60, 60], PERSON_BODY)).toBe(false)
  })
})

describe('the render asks before it draws a sprite', () => {
  const render = read('components/scene/render.ts')

  it('reads the depth back and trims every candidate before the sprites are built', () => {
    expect(render).toMatch(/readRenderTargetPixels/)
    const trimmed = render.indexOf('selectActors(candidates')
    const sprites = render.indexOf('for (const [i, actor] of actors.entries())')
    expect(trimmed).toBeGreaterThan(0)
    expect(sprites).toBeGreaterThan(trimmed)
  })

  it('asks the ground plan as well as the depth', () => {
    expect(render).toMatch(/kit\.free\(/)
    expect(render).toMatch(/occluded\(depth/)
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

  it('holds the first frame of every route under reduced motion', () => {
    expect(layer).toMatch(/prefersReducedMotion\(\)/)
    // The static branch writes the first keyframe's transform and starts nothing.
    expect(layer).toMatch(/node\.style\.transform = frames\[0\]\.transform/)
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
})
