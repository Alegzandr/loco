/**
 * Everything planted on a room's middle ground casts its shadow.
 *
 * The sun's one map covers a box round the table (`LOOK.shadow.reach`, a
 * room's own `shadowReach` over it), and anything standing outside it casts
 * nothing: velvet's promenade of palms ran 22 tiles either side and out to
 * 160, the map stopped at 16 and 42, and not one palm had a shadow. A tree or
 * a street lamp is exactly what a viewer expects one from.
 *
 * And it stands on the ground it is planted in: velvet's boulevard lay a fifth
 * of a tile under the terrace, every palm and lamp on it stood at the
 * terrace's level, and the whole promenade floated over its street.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { solveView } from '../components/scene/view'
import { feltInViewport } from '../components/cards/layout'
import { LOOK } from '../components/scene/look'
import { Kit } from '../components/scene/kit'
import { BUILDERS } from '../components/scene/maps'
import { lightRig } from '../components/scene/sky'
import { seededRng } from '../components/scene/rng'
import type { Baked } from '../components/scene/models/bake'

const fake: Baked = { position: new Float32Array(9), normal: new Float32Array(9), color: new Float32Array(9), glow: new Uint8Array(3), index: Uint32Array.from([0, 1, 2]), smooth: new Float32Array(9), w: 0.01, h: 0.01, d: 0.01 }
const CASTERS = /^(nature\/tree_|roads\/light-)/

afterEach(() => vi.restoreAllMocks())

describe('the shadow map', () => {
  it('reaches every tree and street lamp a room plants', () => {
    const view = solveView(1600, 900, feltInViewport(1600, 900, 3), LOOK.vista.camera)
    const out: string[] = []
    for (const id of Object.keys(BUILDERS) as (keyof typeof BUILDERS)[]) {
      const rig = lightRig('dusk', 'clear', id)
      const r = rig.shadowReach
      const spy = vi.spyOn(Kit.prototype, 'model')
      const lib = { has: () => true, get: () => fake }
      BUILDERS[id](new Kit({ rig, rng: seededRng(`reach-${id}`), outline: 0.02, view, models: lib }))
      for (const [mid, x, z] of spy.mock.calls) {
        if (!CASTERS.test(mid)) continue
        if (Math.abs(x) > r.side || z < -r.back) out.push(`${id} ${mid} at ${x.toFixed(1)}, ${z.toFixed(1)}`)
      }
      spy.mockRestore()
    }
    expect(out).toEqual([])
  }, 120_000)

  it('finds every tree and street lamp standing on the ground under it', () => {
    const view = solveView(1600, 900, feltInViewport(1600, 900, 3), LOOK.vista.camera)
    const out: string[] = []
    for (const id of Object.keys(BUILDERS) as (keyof typeof BUILDERS)[]) {
      const model = vi.spyOn(Kit.prototype, 'model')
      const box = vi.spyOn(Kit.prototype, 'box')
      const lib = { has: () => true, get: () => fake }
      BUILDERS[id](new Kit({ rig: lightRig('day', 'clear', id), rng: seededRng(`ground-${id}`), outline: 0.02, view, models: lib }))
      // The ground is a slab laid across the frame: a box hundreds of tiles wide.
      const slabs = box.mock.calls.filter(([, , , w, , d]) => w >= 200 && d >= 200)
      for (const [mid, x, z, o] of model.mock.calls) {
        if (!CASTERS.test(mid)) continue
        const under = slabs.filter(([bx, , bz, w, , d]) => Math.abs(x - bx) <= w / 2 && Math.abs(z - bz) <= d / 2)
        if (!under.length) continue
        const top = Math.max(...under.map(([, by, , , h]) => by + h))
        const y = o?.y ?? 0
        if (Math.abs(y - top) > 0.01) out.push(`${id} ${mid} at ${x.toFixed(1)}, ${z.toFixed(1)}: stands at ${y}, ground at ${top.toFixed(2)}`)
      }
      vi.restoreAllMocks()
    }
    expect(out).toEqual([])
  }, 120_000)
})
