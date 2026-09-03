/**
 * The two joins between the room and the frame it is composed in.
 *
 * Both were wrong, and both failed silently — a room that is a few tiles out is
 * still a room, so nothing errors and nothing looks broken until somebody
 * measures the podium against the table it is supposed to be under.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, afterEach } from 'vitest'
import { anchorFor } from '../components/scene/render'
import { renderSizeFor, MAX_SIDE } from '../components/scene/sceneCache'
import { at, screenOf, screenSpan, mergeRuns, stringLights, SIDEWALK, WALK_LINE, KERB_LINE } from '../components/scene/maps/common'

const PITCH_SIN = Math.sin((32 * Math.PI) / 180)

const setDpr = (v: number) => {
  Object.defineProperty(globalThis, 'devicePixelRatio', { value: v, configurable: true })
}

afterEach(() => setDpr(1))

describe('the anchor is the same room whatever the screen is made of', () => {
  /**
   * `renderSizeFor` caps the bitmap's long side, and `anchorFor` divides CSS
   * pixels by the ratio it reports to find the felt inside that bitmap. Handing
   * back the ratio the *screen* asked for after cutting the size down put the
   * anchor eight tiles right of the table and a fifth too large on any display
   * denser than 1× wider than 1600 px — so the podium the whole room is
   * composed around was built somewhere the table is not, the harbour's boats
   * were moored on the beach, and every landmark stood off its mark. `make
   * visual` shoots at 1×, which is why it never showed.
   */
  it('puts the felt on the same tiles at every device pixel ratio', () => {
    // The felt of a 1920×1080 board, in CSS pixels.
    const felt = { cx: 960, cy: 537, rx: 656, ry: 268 }
    const base = (() => {
      setDpr(1)
      return anchorFor(felt, renderSizeFor(1920, 1080))
    })()

    for (const dpr of [1, 1.25, 1.5, 2, 3]) {
      setDpr(dpr)
      const a = anchorFor(felt, renderSizeFor(1920, 1080))
      for (const key of ['sx', 'sy', 'a', 'b'] as const) {
        expect(Math.abs(a[key] - base[key]), `${key} at dpr ${dpr}`).toBeLessThan(0.05)
      }
    }
  })

  it('keeps the bitmap inside the cap it declares', () => {
    setDpr(3)
    const size = renderSizeFor(1920, 1080)
    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(MAX_SIDE)
    // The ratio reports what the size was solved at, not what was asked for.
    expect(size.pixelRatio).toBeCloseTo(size.width / 1920, 5)
  })
})

describe('screenSpan lays a block out in screen tiles', () => {
  /**
   * `box(w, h, d)` is world-space, and at `rot = π/4` its `w` runs across the
   * frame one tile for one while its `d` runs up it at `sin(pitch)`. The
   * harbour's pier was written as "4.4 across by 1.2 along" and came out 1.2
   * tiles wide on screen, with its railing, its lamps and its cargo — all
   * placed in screen tiles either side of it — standing in the water.
   */
  const cornersOf = (s: ReturnType<typeof screenSpan>) => {
    const out: [number, number][] = []
    for (const sw of [-1, 1]) {
      for (const sd of [-1, 1]) {
        const lx = (sw * s.w) / 2
        const lz = (sd * s.d) / 2
        // rotateY(rot): (1,0,0) → (cos, 0, −sin), (0,0,1) → (sin, 0, cos)
        const x = s.x + lx * Math.cos(s.rot) + lz * Math.sin(s.rot)
        const z = s.z - lx * Math.sin(s.rot) + lz * Math.cos(s.rot)
        out.push(screenOf(x, z))
      }
    }
    return out
  }

  it('lands on exactly the screen rectangle it was given', () => {
    for (const [sx, sy, sw, sh] of [
      [-18, 12, 4.6, 17],
      [0, 0, 1, 1],
      [31, -6.5, 9, 2],
    ] as const) {
      const corners = cornersOf(screenSpan(sx, sy, sw, sh))
      const xs = corners.map((c) => c[0])
      const ys = corners.map((c) => c[1])
      expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(sw, 6)
      expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(sh, 6)
      expect((Math.max(...xs) + Math.min(...xs)) / 2).toBeCloseTo(sx, 6)
      expect((Math.max(...ys) + Math.min(...ys)) / 2).toBeCloseTo(sy, 6)
    }
  })

  it('agrees with `at` about where its centre is', () => {
    const s = screenSpan(7, -3, 5, 5)
    const [x, z] = at(7, -3)
    expect(s.x).toBeCloseTo(x, 9)
    expect(s.z).toBeCloseTo(z, 9)
    // And the screen ratio the two axes are solved at is the camera's pitch.
    expect(s.d * PITCH_SIN).toBeCloseTo(5, 9)
  })
})

describe('the street grid hands its streets to the things that move on them', () => {
  it('merges block-long segments into one run per street, and breaks a run where the street does', () => {
    const runs = mergeRuns([
      { axis: 'x', line: 0, at: 0, len: 10 },
      { axis: 'x', line: 0, at: 10, len: 10 },
      { axis: 'x', line: 0, at: 20, len: 10 },
      // The plaza took the segment at 30; the street resumes at 40.
      { axis: 'x', line: 0, at: 40, len: 10 },
      { axis: 'z', line: 5, at: 0, len: 10 },
    ])
    expect(runs).toEqual([
      { axis: 'x', line: 0, from: -5, to: 25 },
      { axis: 'x', line: 0, from: 35, to: 45 },
      { axis: 'z', line: 5, from: -5, to: 5 },
    ])
  })

  it('leaves room on the pavement for somebody walking past somebody standing', () => {
    // The walkers keep to the building line, the standers and the lamps to
    // the kerb; the ground plan's margin is 0.35 and a person claims about
    // 0.2 either side, so the two lines need 0.7 between them.
    expect(SIDEWALK - WALK_LINE - KERB_LINE).toBeGreaterThanOrEqual(0.7)
    expect(WALK_LINE).toBeGreaterThan(0.25)
    expect(KERB_LINE).toBeGreaterThan(0.2)
  })
})

describe('lights strung round the square follow the table, not the frame', () => {
  const ANCHOR = { sx: 0, sy: -2, a: 27, b: 10 }

  /** A kit that records where the posts went and how many lights each run got. */
  function probe() {
    const posts: [number, number][] = []
    const runs: { from: [number, number]; to: [number, number]; lights: number }[] = []
    const kit = {
      anchor: ANCHOR,
      cyl: (x: number, _y: number, z: number) => posts.push([x, z]),
      festoon: (x1: number, z1: number, _y: number, x2: number, z2: number, n: number) =>
        runs.push({ from: [x1, z1], to: [x2, z2], lights: n }),
    }
    stringLights(kit as unknown as Parameters<typeof stringLights>[0], {
      padX: 3,
      padY: 4,
      height: 4,
      post: 0x000000,
      cord: 0x000000,
      spacing: 1.6,
      hang: () => {},
    })
    return { posts, runs }
  }

  it('stands more posts than a rectangle has corners', () => {
    // Four posts round an oval table is a rectangle laid over an ellipse:
    // corners nothing else in the room has, two runs straight across the frame
    // and two straight up it. It read as a stray wireframe rather than bunting.
    const { posts } = probe()
    expect(posts.length).toBeGreaterThanOrEqual(8)
  })

  it('puts every post on the ring the table sits in the middle of', () => {
    const { posts } = probe()
    for (const [x, z] of posts) {
      const [sx, sy] = screenOf(x, z)
      const dx = (sx - ANCHOR.sx) / (ANCHOR.a + 3)
      const dy = (sy - ANCHOR.sy) / (ANCHOR.b + 4)
      expect(Math.hypot(dx, dy)).toBeCloseTo(1, 5)
    }
  })

  it('closes the ring, one run per post, evenly round it', () => {
    // Evenly spaced is what makes it a garland rather than a polygon: the four
    // corners of the old one were where the eye stopped.
    const { posts, runs } = probe()
    expect(runs.length).toBe(posts.length)
    const angle = ([x, z]: [number, number]) => {
      const [sx, sy] = screenOf(x, z)
      return Math.atan2((sy - ANCHOR.sy) / (ANCHOR.b + 4), (sx - ANCHOR.sx) / (ANCHOR.a + 3))
    }
    const turns = posts.map(angle).map((t) => (t + Math.PI * 2) % (Math.PI * 2)).sort((p, q) => p - q)
    const gaps = turns.map((t, i) => (i === 0 ? t + Math.PI * 2 - turns[turns.length - 1] : t - turns[i - 1]))
    for (const g of gaps) expect(g).toBeCloseTo((Math.PI * 2) / posts.length, 6)
  })

  it('hangs each run by its own length on screen', () => {
    // A run going up the frame is drawn shorter than one going across it, so a
    // count the builder guessed piled its lanterns on top of each other there
    // and spaced them out here.
    const { runs } = probe()
    const measured = runs.map((r) => {
      const [x1, y1] = screenOf(...r.from)
      const [x2, y2] = screenOf(...r.to)
      return { len: Math.hypot(x2 - x1, y2 - y1), lights: r.lights }
    })
    for (const m of measured) expect(m.lights).toBe(Math.max(2, Math.round(m.len / 1.6)))
    // And the runs really do differ in length, or the assertion above is free.
    const lens = measured.map((m) => m.len)
    expect(Math.max(...lens) / Math.min(...lens)).toBeGreaterThan(1.5)
  })

  it('is the only way a room strings them: no builder festoons a ring itself', () => {
    for (const map of ['neon', 'sakura', 'velvet', 'rune', 'orbit', 'marina']) {
      const src = readFileSync(join(process.cwd(), 'src', `components/scene/maps/${map}.ts`), 'utf8')
      expect(src, `${map} builds its own garland`).not.toMatch(/k\.festoon\(/)
    }
  })
})
