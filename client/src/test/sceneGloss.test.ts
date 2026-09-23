/**
 * Glass, paint and a wet street are glossy; everything else stays matte.
 *
 * The room is one lit material, so the gloss is a vertex attribute
 * (`BlockOptions.gloss`) and the material mixes the roughness by it and
 * mirrors the sky (`lighting.ts: skyEnvironment`) only where it is set. What
 * these pin: every geometry in the lit bucket carries the attribute (or the
 * merge refuses the whole bucket and the room is one colour short), a matte
 * block is exactly what it was before there was any gloss (its reflection is
 * weighted to nothing and the sky's irradiance is never added), and the
 * surfaces meant to shine do.
 */
import { describe, it, expect } from 'vitest'
import { Mesh, MeshStandardMaterial, ShaderChunk, type BufferGeometry } from 'three'
import { Kit } from '../components/scene/kit'
import { lightRig, type Weather } from '../components/scene/sky'
import { seededRng } from '../components/scene/rng'
import { skyDome } from '../components/scene/shade'
import { LOOK } from '../components/scene/look'

function kit(weather: Weather = 'clear', time: 'day' | 'night' = 'day') {
  return new Kit({ rig: lightRig(time, weather), rng: seededRng('gloss'), outline: 0.02, anchor: { sx: 0, sy: 0, a: 10, b: 5 } })
}

function litMesh(k: Kit): Mesh {
  const group = k.build()
  const lit = group.children.find((c) => (c as Mesh).material instanceof MeshStandardMaterial) as Mesh | undefined
  if (!lit) throw new Error('no lit mesh')
  return lit
}

function glossValues(geom: BufferGeometry): Set<number> {
  const a = geom.getAttribute('gloss')
  const out = new Set<number>()
  for (let i = 0; i < a.count; i++) out.add(Math.round(a.getX(i) * 100) / 100)
  return out
}

describe('the gloss of a surface', () => {
  it('rides every geometry of the lit bucket, so the bucket still merges', () => {
    const k = kit('rain')
    k.box(0, 0, 0, 1, 1, 1, 0x888888)
    k.tower(4, 0, 3, 5, 3, 0xccbbaa)
    k.car(-4, 0, 0)
    k.slab(0, 6, 4, 4, 0x555555)
    const lit = litMesh(k)
    const gloss = lit.geometry.getAttribute('gloss')
    expect(gloss).toBeTruthy()
    expect(gloss.count).toBe(lit.geometry.getAttribute('position').count)
  })

  it('is zero on an ordinary block, and a matte room is what it was before', () => {
    const k = kit()
    k.box(0, 0, 0, 1, 1, 1, 0x888888)
    k.tree(3, 3, { kind: 'sakura' })
    expect([...glossValues(litMesh(k).geometry)]).toEqual([0])
  })

  it('shines on dark window glass and on a car, and not on a lit window', () => {
    const k = kit()
    k.tower(0, 0, 3, 5, 3, 0xccbbaa)
    k.car(-6, 0, 0)
    const values = glossValues(litMesh(k).geometry)
    expect(values.has(Math.round(LOOK.material.glassGloss * 100) / 100)).toBe(true)
    expect(values.has(Math.round(LOOK.material.paintGloss * 100) / 100)).toBe(true)
  })

  it('lies on the open ground under rain and only then', () => {
    const dry = kit('clear')
    dry.slab(0, 0, 4, 4, 0x555555)
    expect([...glossValues(litMesh(dry).geometry)]).toEqual([0])
    for (const w of ['rain', 'storm'] as const) {
      const wet = kit(w)
      wet.slab(0, 0, 4, 4, 0x555555)
      expect([...glossValues(litMesh(wet).geometry)], w).toEqual([Math.round(LOOK.material.wetGloss * 100) / 100])
    }
  })
})

describe('the lit material', () => {
  it('finds the lines of three it edits: the sky is a reflection, never a second fill', () => {
    // The material drops the environment's irradiance and weights its
    // radiance by the gloss by editing three's own chunk. A three that renames
    // either line would leave the sky filling every matte block in silence.
    expect(ShaderChunk.lights_fragment_maps).toContain('iblIrradiance += getIBLIrradiance( geometryNormal );')
    expect(ShaderChunk.lights_fragment_maps).toContain('radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );')
  })

  it('mirrors the hour it is lit by', () => {
    const dusk = skyDome(lightRig('dusk', 'clear'))
    const night = skyDome(lightRig('night', 'clear'))
    expect(dusk.horizon).toBe(lightRig('dusk', 'clear').sky.horizon)
    expect(dusk.top).not.toBe(night.top)
  })
})
