/**
 * A room fetches what it places, and nothing else.
 *
 * Every room used to load whole kits: 17.5 MB and 205 requests for the
 * marina, of which 7.9 MB stood in the room; orbit fetched the townsfolk, and
 * a person there is always an astronaut. `KITS` says which kits a room draws
 * from and `PLACED` which of their models the code can name at all.
 */
import { solveView } from '../components/scene/view'
import { feltInViewport } from '../components/cards/layout'
import { LOOK } from '../components/scene/look'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { Kit } from '../components/scene/kit'
import { BUILDERS, KITS, PLACED } from '../components/scene/maps'
import { lightRig } from '../components/scene/sky'
import { seededRng } from '../components/scene/rng'
import manifest from '../components/scene/models/manifest.json'
import type { Baked } from '../components/scene/models/bake'

const SCENE = join(__dirname, '../components/scene')
const KIT_NAMES = Object.keys(manifest.kits)

/** Every `'kit/name'` literal in the kit and the builders. */
function spelled(): Set<string> {
  const files = [join(SCENE, 'kit.ts'), ...readdirSync(join(SCENE, 'maps')).map((f) => join(SCENE, 'maps', f))]
  const out = new Set<string>()
  const re = new RegExp(`'((?:${KIT_NAMES.join('|')})/[A-Za-z0-9_-]+)'`, 'g')
  for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(re)) out.add(m[1])
  return out
}

const fake: Baked = { position: new Float32Array(9), normal: new Float32Array(9), color: new Float32Array(9), glow: new Uint8Array(3), index: Uint32Array.from([0, 1, 2]), smooth: new Float32Array(9), w: 0.01, h: 0.01, d: 0.01 }

describe('the models a room fetches', () => {
  it('include every model the code spells out', () => {
    const ids = spelled()
    expect(ids.size).toBeGreaterThan(20)
    for (const id of ids) expect(PLACED.has(id), id).toBe(true)
  })

  it('are all shipped', () => {
    for (const id of PLACED) {
      const [kit, name] = id.split('/') as [keyof typeof manifest.kits, string]
      expect((manifest.kits[kit]?.models as string[] | undefined)?.includes(name), id).toBe(true)
    }
  })

  it('come from kits the room actually places from', () => {
    const view = solveView(1600, 900, feltInViewport(1600, 900, 3), LOOK.vista.camera)
    for (const id of Object.keys(BUILDERS) as (keyof typeof BUILDERS)[]) {
      const ids = new Set<string>()
      for (const kit of KITS[id]) {
        for (const name of manifest.kits[kit].models) {
          if (!PLACED.has(`${kit}/${name}`)) continue
          if (kit === 'people') ids.add(`${kit}/${name}#idle`).add(`${kit}/${name}#walk`)
          else ids.add(`${kit}/${name}`)
        }
      }
      const used = new Set<string>()
      for (const t of ['day', 'night'] as const) {
        const lib = { has: (x: string) => ids.has(x), get: (x: string) => (ids.has(x) ? (used.add(x.split('/')[0]), fake) : undefined) }
        BUILDERS[id](new Kit({ rig: lightRig(t, 'clear', id), rng: seededRng(`models-${id}-${t}`), outline: 0.02, view, lightPools: true, models: lib }))
      }
      for (const kit of KITS[id]) expect(used.has(kit), `${id} loads ${kit} and places none of it`).toBe(true)
    }
  }, 120_000)
})
