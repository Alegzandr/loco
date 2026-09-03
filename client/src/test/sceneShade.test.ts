/**
 * The room is drawn, not lit: three flat tones per block and a hard polygon of
 * shadow beside it, both arithmetic (`scene/shade.ts`) and both baked at build
 * time. What these pin is the shape of that arithmetic — the top brighter than
 * the lit side brighter than the shade, a shadow that lies away from the sun
 * and starts at the block's own foot — because a tone table that drifts still
 * renders a room, only a flatter or a muddier one, and nothing errors.
 */
import { describe, it, expect } from 'vitest'
import { lightRig } from '../components/scene/sky'
import { shadeFor, shadowHull, shadowRun, sunDirection, convexHull, SHADOW_PLANE_Y } from '../components/scene/shade'

const lum = ([r, g, b]: [number, number, number]) => 0.3 * r + 0.59 * g + 0.11 * b

describe('the three tones', () => {
  it('step down from the top to the lit side to the shade, at every hour', () => {
    for (const time of ['dawn', 'day', 'dusk', 'night'] as const) {
      const rig = lightRig(time, 'clear')
      const s = shadeFor(rig)
      const [ux, , uz] = sunDirection(rig)
      const h = Math.hypot(ux, uz)
      const top = lum(s.tone(0, 1, 0))
      const lit = lum(s.tone(ux / h, 0, uz / h))
      const shade = lum(s.tone(-ux / h, 0, -uz / h))
      const under = lum(s.tone(0, -1, 0))
      expect(top, time).toBeGreaterThan(lit)
      expect(lit, time).toBeGreaterThan(shade)
      expect(shade, time).toBeGreaterThan(under)
    }
  })

  it('leaves a step between the tones wide enough to read as light', () => {
    // The three were 1 / 0.84 / 0.66 — a sixth of a stop between the roof and
    // the wall in the sun, a fifth between that wall and the one in shade — and
    // a street of cubes at that spacing comes out as one flat wash of its own
    // colour. "There is no lighting" was the correct reading of it.
    for (const time of ['dawn', 'day', 'dusk', 'night'] as const) {
      const rig = lightRig(time, 'clear')
      const s = shadeFor(rig)
      const [ux, , uz] = sunDirection(rig)
      const h = Math.hypot(ux, uz)
      const top = lum(s.tone(0, 1, 0))
      const lit = lum(s.tone(ux / h, 0, uz / h))
      const shade = lum(s.tone(-ux / h, 0, -uz / h))
      expect(lit / top, time).toBeLessThan(0.8)
      expect(shade / lit, time).toBeLessThan(0.75)
    }
  })

  it('snaps a face to one of three tones rather than grading it', () => {
    const s = shadeFor(lightRig('day', 'clear'))
    const seen = new Set<string>()
    for (let i = 0; i < 64; i++) {
      const t = (i / 64) * Math.PI * 2
      seen.add(s.tone(Math.cos(t), 0, Math.sin(t)).join(','))
    }
    // Every horizontal normal is either the lit side or the shade.
    expect(seen.size).toBe(2)
  })

  it('is darker at night than at noon and never black', () => {
    const noon = lum(shadeFor(lightRig('day', 'clear')).tone(0, 1, 0))
    const night = lum(shadeFor(lightRig('night', 'storm')).tone(0, 1, 0))
    expect(night).toBeLessThan(noon)
    expect(night).toBeGreaterThan(0.25)
    expect(noon).toBeLessThanOrEqual(1)
  })

  it('throws a fainter shadow the darker the hour', () => {
    expect(shadeFor(lightRig('night', 'clear')).shadow.alpha).toBeLessThan(shadeFor(lightRig('day', 'clear')).shadow.alpha)
    expect(shadeFor(lightRig('day', 'fog')).shadow.alpha).toBeLessThan(shadeFor(lightRig('day', 'clear')).shadow.alpha)
  })
})

describe('the shadow on the ground', () => {
  const box = (x: number, y: number, z: number, w: number, h: number, d: number): [number, number, number][] => {
    const out: [number, number, number][] = []
    for (const dx of [-w / 2, w / 2]) for (const dy of [0, h]) for (const dz of [-d / 2, d / 2]) out.push([x + dx, y + dy, z + dz])
    return out
  }

  it('runs away from the sun, and no farther than the block is tall', () => {
    for (const time of ['dawn', 'day', 'dusk', 'night'] as const) {
      const rig = lightRig(time, 'clear')
      const [sx, , sz] = sunDirection(rig)
      const [rx, rz] = shadowRun(rig)
      // Opposite the sun on the ground plane.
      expect(rx * sx + rz * sz, time).toBeLessThan(0)
      expect(Math.hypot(rx, rz), time).toBeLessThanOrEqual(1.25)
      expect(Math.hypot(rx, rz), time).toBeGreaterThanOrEqual(0.3)
    }
  })

  it('covers the block’s own foot and reaches past it', () => {
    const rig = lightRig('day', 'clear')
    const run = shadowRun(rig)
    const hull = shadowHull(box(0, 0, 0, 2, 4, 2), run)!
    expect(hull).not.toBeNull()
    expect(hull.length).toBeGreaterThanOrEqual(4)
    // The foot: every ground corner of the box is inside or on the hull.
    const inside = (px: number, pz: number) => {
      let sign = 0
      for (let i = 0; i < hull.length; i++) {
        const [ax, az] = hull[i]
        const [bx, bz] = hull[(i + 1) % hull.length]
        const c = (bx - ax) * (pz - az) - (bz - az) * (px - ax)
        if (Math.abs(c) < 1e-9) continue
        if (sign === 0) sign = Math.sign(c)
        else if (Math.sign(c) !== sign) return false
      }
      return true
    }
    for (const [x, , z] of box(0, 0, 0, 2, 4, 2).filter(([, y]) => y === 0)) expect(inside(x, z)).toBe(true)
    // And it reaches: the far edge lies about the run's length times the
    // height beyond the foot.
    const reach = Math.max(...hull.map(([x, z]) => x * run[0] + z * run[1])) / Math.hypot(...run)
    expect(reach).toBeGreaterThan(1 + (4 - SHADOW_PLANE_Y) * Math.hypot(...run) * 0.9)
  })

  it('is nothing for a slab lying under the plane', () => {
    expect(shadowHull(box(0, 0, 0, 10, 0.08, 10), shadowRun(lightRig('day', 'clear')))).toBeNull()
  })

  it('wraps a convex hull without repeating the first point', () => {
    const hull = convexHull([[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0.5], [0.2, 0.8]])
    expect(hull.length).toBe(4)
    const keys = new Set(hull.map((p) => p.join(',')))
    expect(keys.size).toBe(4)
  })
})
