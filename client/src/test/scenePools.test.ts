/**
 * A lamp lights the ground; it does not paint a disc on it.
 *
 * The room's lamps used to leave an additive oval under every head. Now a
 * lamp-sized halo on the ground is a pool (`pools.ts`), splatted into one map
 * the lit material multiplies into the ground's own colour. What these pin:
 * the falloff (full at the centre, nothing at the rim), that a halo the size
 * of the plaza stays the wash it was (neon's purple ring vanished as light),
 * that a sprite keeps its disc (it has no ground of its own), and that a lit
 * window at street level spills onto the pavement in front of it.
 */
import { describe, it, expect } from 'vitest'
import { Mesh } from 'three'
import { Kit } from '../components/scene/kit'
import { lightRig } from '../components/scene/sky'
import { seededRng } from '../components/scene/rng'
import { LOOK } from '../components/scene/look'
import { POOL_RANGE, splatPools } from '../components/scene/pools'

function roomKit(time: 'day' | 'night' = 'night') {
  return new Kit({ rig: lightRig(time, 'clear'), rng: seededRng('pools'), outline: 0.02, anchor: { sx: 0, sy: 0, a: 10, b: 5 }, frame: { w: 80, h: 45 } })
}

function haloMeshes(k: Kit): number {
  let n = 0
  k.build().traverse((o) => {
    const m = (o as Mesh).material as { transparent?: boolean } | undefined
    if ((o as Mesh).isMesh && m?.transparent) n++
  })
  return n
}

describe('a pool of light', () => {
  it('is full at its centre and nothing at its rim', () => {
    const map = splatPools([{ x: 0, z: 0, r: 3, color: 0xffffff, k: 0.1 }])!
    const at = (x: number, z: number) => {
      const i = Math.min(map.w - 1, Math.floor(((x - map.minX) / map.sizeX) * map.w))
      const j = Math.min(map.h - 1, Math.floor(((z - map.minZ) / map.sizeZ) * map.h))
      return (map.data[(j * map.w + i) * 4] / 255) * POOL_RANGE
    }
    expect(at(0, 0)).toBeGreaterThan(0.1 * LOOK.pools.strength * 0.9)
    expect(at(2.9, 0)).toBeLessThan(at(1.5, 0))
    expect(at(-2.99, -0.05)).toBeLessThan(0.02)
  })

  it('is nothing at all by day, and no map is made', () => {
    const k = roomKit('day')
    k.lamp(0, 0, { style: 'globe' })
    expect(k.pools).toHaveLength(0)
    expect(splatPools(k.pools)).toBeNull()
  })

  it('takes a lamp-sized halo, and leaves no disc behind', () => {
    const k = roomKit()
    k.halo(0, 0, 0, 1.8, 0xffe1a1, 0.22)
    expect(k.pools).toHaveLength(1)
    expect(k.pools[0].r).toBeCloseTo(1.8 * LOOK.pools.reach, 6)
    expect(haloMeshes(k)).toBe(0)
  })

  it('leaves a halo the size of the plaza the wash it was', () => {
    const k = roomKit()
    k.halo(0, 0, 0, LOOK.pools.washFrom + 10, 0xc56bff, 0.16)
    expect(k.pools).toHaveLength(0)
    expect(haloMeshes(k)).toBe(1)
  })

  it('leaves a sprite its disc: a car carries its headlights on its own bitmap', () => {
    const sprite = new Kit({ rig: lightRig('night', 'clear'), rng: seededRng('car'), outline: 0.02, anchor: { sx: 0, sy: 0, a: 0, b: 0 } })
    sprite.halo(0, 0, 0, 1.2, 0xfff3c4, 0.2)
    expect(sprite.pools).toHaveLength(0)
    expect(haloMeshes(sprite)).toBe(1)
  })

  it('spills from a lit window at street level onto the pavement in front of it', () => {
    const k = roomKit()
    // Lit for certain: the share is the hour's, so ask until one lights.
    for (let i = 0; i < 40 && k.pools.length === 0; i++) k.window(0, 0.6, i * 3, 0.5, 0.6, 'z')
    expect(k.pools.length).toBeGreaterThan(0)
    const p = k.pools[0]
    expect(p.z).toBeGreaterThan(0)
  })
})
