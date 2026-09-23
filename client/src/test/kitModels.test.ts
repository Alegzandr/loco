/**
 * What the kit does with a drawn model: which way it faces, and what it does
 * when the placer refuses one.
 *
 * `personRot` is written for the block person, who faces +z at rot 0, and the
 * Kenney townsfolk face +z too (their `leg-left` bone stands at +x). An audit
 * once read a low-resolution sprite the wrong way round and turned every
 * drawn person a half turn, which sent them all walking backwards; a render
 * at four times the density settled it. The astronauts are the other way
 * round, and the one passer-by on the moon did walk backwards until
 * `ASTRONAUT_MODEL_YAW`. This pins both conventions.
 */
import { describe, it, expect } from 'vitest'
import { BackSide, Box3, Mesh, MeshBasicMaterial, Vector3 } from 'three'
import { Kit, ASTRONAUT_MODEL_YAW, spotChance } from '../components/scene/kit'
import { personRot } from '../components/scene/maps/actors'
import { lightRig } from '../components/scene/sky'
import { seededRng } from '../components/scene/rng'
import type { Baked } from '../components/scene/models/bake'
import type { ModelLib } from '../components/scene/models/lib'

/** A thin slab standing entirely in front of its origin, on +z (or -z): a face and nothing else. */
function faceOnly(side = 1): Baked {
  const position = Float32Array.from([-0.05, 0, 0.6 * side, 0.05, 0, 0.6 * side, 0, 1, 0.4 * side, 0, 1, 0.6 * side])
  const index = Uint32Array.from([0, 1, 2, 0, 2, 3])
  const normal = Float32Array.from([0, 0, side, 0, 0, side, 0, 0, side, 0, 0, side])
  return { position, normal, color: new Float32Array(12).fill(0.5), glow: new Uint8Array(4), index, smooth: normal, w: 0.1, h: 1, d: 0.2 }
}

function lib(ids: string[], side = 1): ModelLib {
  const b = faceOnly(side)
  return { get: (id) => (ids.includes(id) ? b : undefined), has: (id) => ids.includes(id) }
}

function kit(models: ModelLib) {
  return new Kit({ rig: lightRig('day', 'clear'), rng: seededRng('models'), outline: 0.02, shadows: false, models, anchor: { sx: 0, sy: 0, a: 10, b: 5 } })
}

function box(k: Kit): Box3 {
  const out = new Box3()
  k.build().traverse((o) => {
    const m = o as Mesh
    if (!m.isMesh) return
    m.geometry.computeBoundingBox()
    out.union(m.geometry.boundingBox!)
  })
  return out
}

const TOWNSFOLK = ['female-a', 'female-b', 'female-c', 'female-d', 'female-e', 'female-f', 'male-a', 'male-b', 'male-c', 'male-d', 'male-e', 'male-f'].flatMap((w) => [
  `people/character-${w}#idle`,
  `people/character-${w}#walk`,
])

describe('a drawn person', () => {
  it('faces the way it walks, whichever kit drew it', () => {
    // The townsfolk face +z like the block person; the astronauts (not
    // skinned, so their file says it plainly: the visor is on -z) face -z.
    for (const [ids, side] of [[TOWNSFOLK, 1], [['space/astronautA', 'space/astronautB'], -1]] as [string[], number][]) {
      for (const heading of [[1, 0], [0, 1], [-1, 0], [0, -1]] as [number, number][]) {
        const k = kit(lib(ids, side))
        k.person(0, 0, personRot(heading), { stride: 1 })
        const c = box(k).getCenter(new Vector3())
        // The face is half a tile out in front of the feet, along the heading.
        expect(Math.sign(Math.round(c.x * 10))).toBe(Math.sign(heading[0]))
        expect(Math.sign(Math.round(c.z * 10))).toBe(Math.sign(heading[1]))
      }
    }
  })
})

describe('the astronaut', () => {
  it('alone takes a half turn', () => {
    expect(ASTRONAUT_MODEL_YAW).toBeCloseTo(Math.PI, 10)
  })
})

describe('a model the placer refuses', () => {
  it('leaves the spot empty rather than drawing the block version inside what took it', () => {
    for (const [ids, place] of [
      [TOWNSFOLK, (k: Kit) => k.person(0, 0, 0)],
      [['nature/tree_default', 'nature/tree_oak', 'nature/tree_fat', 'nature/tree_detailed', 'nature/tree_tall', 'nature/tree_simple', 'nature/tree_plateau'], (k: Kit) => k.tree(0, 0)],
      [['nature/plant_bush', 'nature/plant_bushDetailed', 'nature/plant_bushLarge', 'nature/plant_bushSmall'], (k: Kit) => k.bush(0, 0)],
      [['nature/rock_smallA', 'nature/rock_smallB', 'nature/stone_smallA'], (k: Kit) => k.rock(0, 0)],
      [['pirate/crate', 'pirate/crate-bottles'], (k: Kit) => k.crate(0, 0)],
      [['pirate/barrel'], (k: Kit) => k.barrel(0, 0)],
      [['roads/light-curved', 'roads/light-curved-double'], (k: Kit) => k.lamp(0, 0)],
    ] as [string[], (k: Kit) => void][]) {
      const k = kit(lib(ids))
      k.claim(0, 0, 4, 4, 0)
      place(k)
      expect(box(k).isEmpty(), ids[0]).toBe(true)
    }
  })
})

describe('a model house after dark', () => {
  /** A house whose every face is a window. */
  function house(): ModelLib {
    const b = { ...faceOnly(), glow: new Uint8Array(4).fill(1) }
    return { get: (id) => (id === 'suburb/building-type-a' ? b : undefined), has: (id) => id === 'suburb/building-type-a' }
  }

  /** How many of `n` houses, one a spot, came out with their windows lit. */
  function litHouses(windowsLit: number, n = 400): number {
    let lit = 0
    for (let i = 0; i < n; i++) {
      const rig = { ...lightRig('night', 'clear'), windowsLit }
      const k = new Kit({ rig, rng: seededRng('house'), outline: 0.02, shadows: false, models: house(), anchor: { sx: 0, sy: 0, a: 10, b: 5 } })
      k.model('suburb/building-type-a', i * 3.7, i * 1.3, { collide: false })
      k.build().traverse((o) => {
        const m = o as Mesh
        if (m.isMesh && m.material instanceof MeshBasicMaterial && m.material.side !== BackSide && !m.material.transparent) lit++
      })
    }
    return lit / n
  }

  it('lights its windows with the hour, one house at a time, not every one of them', () => {
    // Lit whenever the lamps were, every house on the marina had every window lit.
    expect(litHouses(0)).toBe(0)
    const share = litHouses(0.45)
    expect(share).toBeGreaterThan(0.3)
    expect(share).toBeLessThan(0.6)
  })

  it('draws from where it stands, so the same house is lit on every render', () => {
    expect(spotChance(12.5, -3)).toBe(spotChance(12.5, -3))
    expect(spotChance(12.5, -3)).toBeGreaterThanOrEqual(0)
    expect(spotChance(12.5, -3)).toBeLessThan(1)
  })
})
