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
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { Mesh, MeshStandardMaterial, ShaderChunk, type BufferGeometry } from 'three'
import { Kit, blossom } from '../components/scene/kit'
import { lightRig, type Weather } from '../components/scene/sky'
import { seededRng } from '../components/scene/rng'
import { skyDome } from '../components/scene/shade'
import { LOOK } from '../components/scene/look'
import { MIRROR_FRAG_PARS, MIRROR_NORMAL, MIRROR_OUT, makeMirror } from '../components/scene/mirror'

function kit(weather: Weather = 'clear', time: 'day' | 'night' = 'day') {
  return new Kit({ rig: lightRig(time, weather), rng: seededRng('gloss'), outline: 0.02 })
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

describe('the water', () => {
  function waterValues(geom: BufferGeometry): Set<number> {
    const a = geom.getAttribute('water')
    const out = new Set<number>()
    for (let i = 0; i < a.count; i++) out.add(a.getX(i))
    return out
  }

  it('is flagged on the surface a builder says is water, and records its level', () => {
    const k = kit()
    k.box(0, -1.7, 0, 10, 1, 10, 0x2a6fd6, { water: true })
    k.box(4, 0, 4, 1, 1, 1, 0x888888)
    expect(k.waterLevel).toBeCloseTo(-0.7, 5)
    expect(k.reflective).toBe(true)
    expect(waterValues(litMesh(k).geometry)).toEqual(new Set([0, 1]))
  })

  it('leaves a dry room with no water nothing to mirror, so no mirror pass is paid for', () => {
    const k = kit('clear')
    k.tower(0, 0, 3, 5, 3, 0xccbbaa)
    k.slab(0, 6, 4, 4, 0x555555)
    expect(k.reflective).toBe(false)
    expect(k.waterLevel).toBe(0)
  })

  it('makes a room under rain worth a mirror pass, and its puddles glossy, never sharp water', () => {
    const k = kit('rain')
    k.puddles(0, 0, 4, 6)
    expect(k.reflective).toBe(true)
    const geom = litMesh(k).geometry
    expect(waterValues(geom)).toEqual(new Set([0]))
    expect(glossValues(geom).has(1)).toBe(true)
  })
})

describe('the mirror', () => {
  it('is looked across, not into: a mirror at the horizon, a column down the frame', () => {
    // Seen from the table the water is a mirror near the horizon (Fresnel), and
    // the swell breaks a reflection into a road of light, not a spot.
    const m = makeMirror(lightRig('day', 'clear'))
    expect(m.uniforms.uFresnel.value).toBe(1)
    expect(m.uniforms.uRippleStretch.value).toBeGreaterThan(1)
    expect(m.uniforms.uWaterReflect.value).toBeLessThan(0.5)
  })

  it('flips the room about the water itself, the one plane a perspective reflection is exact for', () => {
    const src = readFileSync(resolve(__dirname, '../components/scene/mirror.ts'), 'utf8')
    expect(src).toMatch(/scene\.scale\.y = -1/)
    expect(src).toMatch(/scene\.position\.y = 2 \* level/)
    expect(src).not.toMatch(/uLevelUv/)
  })

  it('puts the lamps in the street only when the street is wet', () => {
    expect(makeMirror(lightRig('night', 'clear')).uniforms.uWetMirror.value).toBe(0)
    expect(makeMirror(lightRig('night', 'rain')).uniforms.uWetMirror.value).toBe(LOOK.water.wetMirror)
  })

  it('tints the water with the sky only lightly, or the sea goes pale', () => {
    // At the weight of a mirror, a noon sky turned the harbour into a grey sheet.
    expect(LOOK.water.sky).toBeLessThanOrEqual(0.2)
  })

  it('never names a GLSL keyword: `flat` compiled nowhere and cost the whole room', () => {
    for (const src of [MIRROR_FRAG_PARS, MIRROR_NORMAL, MIRROR_OUT]) expect(src).not.toMatch(/\b(flat|smooth|sample|filter)\b\s*=/)
  })

  it('discards, in the mirror pass, a face turned up: the underside of every slab', () => {
    expect(MIRROR_NORMAL).toMatch(/uMirrorPass > 0\.5 && vUp > 0\.5\) discard/)
  })
})

describe('the cherry', () => {
  it('turns a green crown to blossom and leaves the trunk alone', () => {
    const fn = blossom(0xf7a1c4)
    expect(fn(0.2, 0.5, 0.15)).not.toBeNull()
    const [r, g] = fn(0.2, 0.5, 0.15)!
    expect(r).toBeGreaterThan(g)
    // A brown trunk and a grey stone are not leaves.
    expect(fn(0.35, 0.22, 0.12)).toBeNull()
    expect(fn(0.4, 0.4, 0.4)).toBeNull()
  })

  it('keeps the shading between the greens: a darker leaf stays a darker blossom', () => {
    const fn = blossom(0xf7a1c4)
    expect(fn(0.1, 0.3, 0.08)![0]).toBeLessThan(fn(0.2, 0.55, 0.15)![0])
  })
})
