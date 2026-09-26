/**
 * A light in the room is a light, not a coloured dot.
 *
 * Four things made every lamp, window and sign read as a flat patch of
 * colour, and each fails silently — the frame still renders, only duller:
 *
 * - the air and the mist were laid over a lamp exactly as over a wall, so a
 *   light in the haze sank to a pale square, and the bloom was added *before*
 *   the air, which took it away again;
 * - the bloom was one tight width, a rim round each light and nothing in the
 *   air round it;
 * - a drawn street lamp's bulb faces the ground under its arm, so from the
 *   table the lamp was an unlit post;
 * - a round halo was a flat translucent sphere: a pale disc pinned over the
 *   lamp, a frosted globe rather than a glow.
 *
 * And the brand's own sign was a 5×3 bitmap in blocks, which at the distance
 * it is read from came out a row of blobs.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { Mesh, type BufferGeometry } from 'three'
import { Kit } from '../components/scene/kit'
import type { View } from '../components/scene/view'
import { lightRig } from '../components/scene/sky'
import { seededRng } from '../components/scene/rng'
import { lampHead } from '../components/scene/models/bake'
import { neonText } from '../components/scene/maps/vista'
import { LOOK } from '../components/scene/look'

const read = (p: string) => readFileSync(join(process.cwd(), 'src', p), 'utf8').replace(/\r\n/g, '\n')

function kit(time: 'night' | 'day' = 'night') {
  const view = { eye: [0, 1.5, 10] } as unknown as View
  return new Kit({ rig: lightRig(time, 'clear'), rng: seededRng('lights'), outline: 0.02, view })
}

/** Every mesh of a built kit, with how it is drawn. */
function meshes(k: Kit) {
  const out: { geometry: BufferGeometry; additive: boolean; unlit: boolean }[] = []
  k.build().traverse((obj) => {
    const mesh = obj as Mesh
    if (!mesh.isMesh) return
    const m = mesh.material as { transparent?: boolean; type?: string; side?: number }
    out.push({ geometry: mesh.geometry, additive: !!m.transparent, unlit: m.type === 'MeshBasicMaterial' && !m.transparent && m.side !== 1 })
  })
  return out
}

describe('the composite', () => {
  const src = read('components/scene/post.ts')
  const main = src.slice(src.indexOf('const COMPOSITE_FRAG'), src.indexOf('const composite = shader'))

  it('adds the bloom after the air, so the air does not take the light away again', () => {
    const air = main.indexOf('col = mix(col, air, t)')
    const bloom = main.indexOf('texture2D(tBloom, uv).rgb * uBloom')
    expect(air).toBeGreaterThan(0)
    expect(bloom).toBeGreaterThan(air)
  })

  it('lets a light through the mist and the air, and only after dark', () => {
    expect(main).toMatch(/uMist \* low \* bank \* far, 0\.0, 0\.85\) \* \(1\.0 - emit\)/)
    expect(main).toMatch(/uHazeMax \* \(1\.0 - exp\(-dist \/ uHazeDist\)\) \* \(1\.0 - emit\)/)
    expect(src).toMatch(/uPierce: \{ value: rig\.lampsOn \? LOOK\.post\.pierce : 0 \}/)
  })

  it('lays a second, wide glow in the air round a light, and only after dark', () => {
    expect(main).toMatch(/texture2D\(tBloomWide, uv\)\.rgb \* uBloomWide/)
    expect(src).toMatch(/const bloomWide = opts\.bloom \? rig\.dark \* LOOK\.post\.bloomWide/)
    expect(LOOK.post.bloomWide).toBeGreaterThan(0)
  })
})

describe('a drawn street lamp', () => {
  it('has its light found at the end of its arm, underneath', () => {
    // A post two tenths wide up to 4, and an arm out to x = 1.5 at the top.
    const pts: number[] = []
    const quad = (x0: number, x1: number, y0: number, y1: number) => pts.push(x0, y0, 0, x1, y0, 0, x0, y1, 0, x1, y1, 0)
    quad(-0.1, 0.1, 0, 4)
    quad(0.1, 1.5, 3.8, 4)
    const [x, y, z] = lampHead({ position: new Float32Array(pts), h: 4 })
    expect(x).toBeGreaterThan(1.3)
    expect(y).toBeCloseTo(3.8, 5)
    expect(z).toBeCloseTo(0, 5)
  })
})

describe('a round halo', () => {
  it('thins to nothing at its rim, as seen from the table', () => {
    const k = kit()
    k.halo(0, 1.5, 0, 0.6, 0xffffff, 0.35, false)
    const halo = meshes(k).find((m) => m.additive)!
    const col = halo.geometry.getAttribute('color')
    const nrm = halo.geometry.getAttribute('normal')
    let facing = 0
    let rim = 1
    for (let i = 0; i < col.count; i++) {
      // The eye is straight down +z from the halo.
      const f = nrm.getZ(i)
      if (f > 0.95) facing = Math.max(facing, col.getX(i))
      if (Math.abs(f) < 0.05) rim = Math.min(rim, col.getX(i))
    }
    expect(facing).toBeGreaterThan(0.8)
    expect(rim).toBeLessThan(0.01)
  })
})

describe('a sign', () => {
  it('is bent tubes, not a bitmap of blocks, and no halo sphere over it', () => {
    const k = kit()
    neonText(k, 'LOCO!', 0, 0, 0, 1, 0xf0c46a)
    const all = meshes(k)
    expect(all.some((m) => m.additive)).toBe(false)
    const glow = all.find((m) => m.unlit)!
    // A 5×3 bitmap of 'LOCO!' was 44 lit cubes; the tubes are thin and
    // follow the letter, so they are many more pieces than that.
    const pieces = glow.geometry.getAttribute('position').count / 24
    expect(pieces).toBeGreaterThan(44)
  })

  it('by day keeps its colour a shade down, and glows at night', () => {
    const k = kit('day')
    neonText(k, 'LOCO!', 0, 0, 0, 1, 0xf0c46a)
    expect(meshes(k).some((m) => m.unlit)).toBe(false)
  })
})

describe('the fog over the room', () => {
  it('is the colour of the light in it, not a fixed white', () => {
    const css = read('components/scene/WeatherLayer.svelte')
    const veil = css.slice(css.indexOf('  .veil {'), css.indexOf('}', css.indexOf('  .veil {')))
    expect(veil).toMatch(/var\(--sky-horizon/)
    expect(veil).toMatch(/var\(--scene-dark/)
    expect(veil).not.toMatch(/rgba\(235, 240, 246, 0\.32\)/)
  })
})
