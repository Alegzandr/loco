/**
 * The room is lit, not drawn: a warm sun low over the diorama, a cool sky in
 * the shade, a long soft shadow beside every block. What these pin is the
 * shape of that light as numbers (`scene/shade.ts`, `scene/look.ts`) — the
 * sun warmer than the sky at every daylight hour, low enough at dawn and dusk
 * to throw a long shadow and never so low the shadow is a street, lighting at
 * least one of the two faces the camera sees, the shadow running away from
 * it — because a rig that drifts still renders a room, only a flat or a
 * silhouetted one, and nothing errors. Two of the failures below were seen:
 * a dusk sun from behind the city that lit nothing the camera looked at, and
 * a noon sun whose shadows fell away from the camera and read as no light.
 */
import { describe, it, expect } from 'vitest'
import { lightRig } from '../components/scene/sky'
import { convexHull, lightingFor, shadowHull, shadowRun, sunDirection, warmth, MAX_SHADOW_RUN } from '../components/scene/shade'
import { LOOK, WINDOWS_LIT_MAX, applyLookPatch, bumpLook, lookVersion, subscribeLook } from '../components/scene/look'

const HOURS = ['dawn', 'day', 'dusk', 'night'] as const

describe('the sun and the sky', () => {
  it('keep the warm/cool split: the sun warmer than the sky light, at every daylight hour', () => {
    for (const time of ['dawn', 'day', 'dusk'] as const) {
      const l = lightingFor(lightRig(time, 'clear'))
      expect(warmth(l.sun.color), time).toBeGreaterThan(warmth(l.sky.sky))
      // And the sky is on the cool side of neutral.
      expect(warmth(l.sky.sky), time).toBeLessThan(0)
    }
  })

  it('sit low at dawn and dusk and higher at noon, and never so low the shadow is a street', () => {
    const el = (t: (typeof HOURS)[number]) => lightRig(t, 'clear').sun.elevation
    expect(el('dawn')).toBeLessThan(el('day'))
    expect(el('dusk')).toBeLessThan(el('day'))
    for (const t of HOURS) {
      expect(el(t), t).toBeGreaterThanOrEqual(18)
      expect(el(t), t).toBeLessThanOrEqual(60)
    }
  })

  it('light at least one of the two faces the camera sees, at every hour', () => {
    // The camera stands at +x, +z: it sees the +x and the +z faces of a block.
    // A sun from behind the city lights neither and the room is a silhouette.
    for (const t of HOURS) {
      const [dx, , dz] = sunDirection(lightRig(t, 'clear'))
      expect(Math.max(dx, dz), t).toBeGreaterThan(0.35)
    }
  })

  it('throw the shadow where the camera can see it: never straight away up the frame', () => {
    // Screen x is the (1, -1) diagonal, screen up is the -(1, 1) diagonal. A
    // shadow running straight up the frame, away from the camera, hides
    // behind the thing that throws it.
    for (const t of HOURS) {
      const [rx, rz] = shadowRun(lightRig(t, 'clear'))
      const up = -(rx + rz) / Math.SQRT2
      const across = Math.abs(rx - rz) / Math.SQRT2
      expect(up, t).toBeLessThan(across + 0.2)
    }
  })

  it('dim under an overcast and keep the sun the brighter light', () => {
    for (const t of HOURS) {
      const clear = lightingFor(lightRig(t, 'clear'))
      const storm = lightingFor(lightRig(t, 'storm'))
      expect(storm.sun.intensity, t).toBeLessThan(clear.sun.intensity)
      expect(storm.shadowStrength, t).toBeLessThan(clear.shadowStrength)
      expect(clear.sun.intensity, t).toBeGreaterThan(clear.sky.intensity)
    }
  })

  it('lift the exposure with the dark, so a stormy night is still a room', () => {
    expect(lightingFor(lightRig('night', 'storm')).exposure).toBeGreaterThan(lightingFor(lightRig('day', 'clear')).exposure)
  })

  it('soften the shadow as the sun drops', () => {
    expect(lightingFor(lightRig('dusk', 'clear')).shadowRadius).toBeGreaterThan(lightingFor(lightRig('day', 'clear')).shadowRadius)
  })

  it('carry a rim from opposite the sun, cool, dim and without a shadow', () => {
    const l = lightingFor(lightRig('day', 'clear'))
    expect(l.rim).not.toBeNull()
    expect(l.rim!.direction[0] * l.sun.direction[0] + l.rim!.direction[2] * l.sun.direction[2]).toBeLessThan(0)
    expect(l.rim!.intensity).toBeLessThan(l.sun.intensity * 0.5)
    expect(warmth(l.rim!.color)).toBeLessThan(warmth(l.sun.color))
  })
})

describe('the windows after dark', () => {
  it('are mostly dark, at every hour: a district four fifths lit is a wall of light', () => {
    // What made the lit ones read, and what let the eye rest between them.
    expect(WINDOWS_LIT_MAX).toBeLessThanOrEqual(0.5)
    for (const t of HOURS) expect(LOOK.hours[t].windowsLit, t).toBeLessThanOrEqual(WINDOWS_LIT_MAX)
    // Still lit at all after dark, or the rule is free.
    expect(LOOK.hours.night.windowsLit).toBeGreaterThan(0)
  })
})

describe('the shadow on the ground', () => {
  const box = (x: number, y: number, z: number, w: number, h: number, d: number): [number, number, number][] => {
    const out: [number, number, number][] = []
    for (const dx of [-w / 2, w / 2]) for (const dy of [0, h]) for (const dz of [-d / 2, d / 2]) out.push([x + dx, y + dy, z + dz])
    return out
  }

  it('runs away from the sun, longer the lower it is, and no longer than the cap', () => {
    for (const t of HOURS) {
      const rig = lightRig(t, 'clear')
      const [sx, , sz] = sunDirection(rig)
      const [rx, rz] = shadowRun(rig)
      expect(rx * sx + rz * sz, t).toBeLessThan(0)
      expect(Math.hypot(rx, rz), t).toBeLessThanOrEqual(MAX_SHADOW_RUN)
    }
    expect(Math.hypot(...shadowRun(lightRig('dusk', 'clear')))).toBeGreaterThan(Math.hypot(...shadowRun(lightRig('day', 'clear'))))
  })

  it('reaches from the block’s own foot to where its top lands', () => {
    // The sprite pass sizes a bitmap by this before the shadow map has drawn
    // anything: a bitmap cut short is a shadow cut off at its edge.
    const rig = lightRig('day', 'clear')
    const run = shadowRun(rig)
    const hull = shadowHull(box(0, 0, 0, 2, 4, 2), run)!
    expect(hull).not.toBeNull()
    expect(hull.length).toBeGreaterThanOrEqual(4)
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
    const reach = Math.max(...hull.map(([x, z]) => x * run[0] + z * run[1])) / Math.hypot(...run)
    expect(reach).toBeGreaterThan(1 + 4 * Math.hypot(...run) * 0.9)
  })

  it('is nothing for a slab lying on the plane', () => {
    expect(shadowHull(box(0, 0, 0, 10, 0, 10), shadowRun(lightRig('day', 'clear')))).toBeNull()
  })

  it('wraps a convex hull without repeating the first point', () => {
    const hull = convexHull([[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0.5], [0.2, 0.8]])
    expect(hull.length).toBe(4)
    expect(new Set(hull.map((p) => p.join(','))).size).toBe(4)
  })
})

describe('the look', () => {
  it('ships with every debug view off', () => {
    expect(LOOK.debug).toBe('off')
  })

  it('keeps the occlusion, the shadow and the tone curve on', () => {
    expect(LOOK.ao.intensity).toBeGreaterThan(0)
    expect(LOOK.shadow.radius).toBeGreaterThan(0)
    expect(LOOK.tone.mapping).not.toBe('none')
  })

  it('publishes an edition on every change, and the rig reads the change', () => {
    const before = lookVersion()
    let heard = 0
    const off = subscribeLook(() => heard++)
    const day = LOOK.hours.day.sun.intensity
    applyLookPatch({ sun: { intensity: 2 } })
    expect(lookVersion()).toBe(before + 1)
    expect(heard).toBe(1)
    expect(lightRig('day', 'clear').sun.intensity).toBeCloseTo(day * 2)
    applyLookPatch({ sun: { intensity: 1 } })
    bumpLook()
    expect(lookVersion()).toBe(before + 3)
    off()
  })
})
