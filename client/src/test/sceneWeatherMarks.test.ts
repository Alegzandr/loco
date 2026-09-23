/**
 * The weather leaves marks: rain lands in rings, snow banks against the walls
 * and keeps the ruts and the footprints of the street.
 *
 * What these pin: the rings are flat (seen at the room's pitch) and wrap like
 * every tile; the splash sheets rest at nothing, so reduced motion keeps the
 * rain and loses them; `light` draws none. The snow's marks come from a
 * sequence of their own, so a snowy room is the same room as a dry one — no
 * house moves because the road took ruts.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Box3, Mesh } from 'three'
import { Kit } from '../components/scene/kit'
import { lightRig, type Weather } from '../components/scene/sky'
import { seededRng } from '../components/scene/rng'
import { SPLASH_S, TILES, splashRings } from '../components/scene/weatherTiles'

const layer = readFileSync(join(process.cwd(), 'src', 'components', 'scene', 'WeatherLayer.svelte'), 'utf8')

describe('the rain landing', () => {
  it('is a few small rings to a tile, inside it, on a period of its own per sheet', () => {
    for (const kind of ['splashA', 'splashB'] as const) {
      const rings = splashRings(kind)
      expect(rings.length).toBeGreaterThan(8)
      for (const r of rings) {
        expect(r.x).toBeGreaterThanOrEqual(0)
        expect(r.x).toBeLessThan(TILES[kind].w)
        expect(r.r).toBeLessThan(5)
      }
    }
    expect(SPLASH_S.splashA).not.toBe(SPLASH_S.splashB)
  })

  it('rests at nothing, so reduced motion keeps the rain and loses the rings', () => {
    expect(layer).toMatch(/\.splash \{\s*opacity: 0;/)
    expect(layer).toMatch(/:root\[data-motion="reduce"\] \.sheet/)
  })

  it('is two sheets on high, one on medium and none on light', () => {
    expect(layer).toContain("tier === 'high' ? ['splashA', 'splashB'] : tier === 'medium' ? ['splashA'] : []")
  })
})

describe('the snow', () => {
  function kit(weather: Weather) {
    return new Kit({ rig: lightRig('day', weather), rng: seededRng('marks'), outline: 0.02, anchor: { sx: 0, sy: 0, a: 10, b: 5 } })
  }

  it('keeps ruts and footprints from a sequence of its own: the room is the same room', () => {
    const dry = kit('clear')
    const snowy = kit('snow')
    for (const k of [dry, snowy]) for (let i = 0; i < 8; i++) k.road(i * 12, 0, 11, 3.6, { sidewalk: 0x888888, sidewalkWidth: 1.4 })
    expect(snowy.rng.next()).toBe(dry.rng.next())
  })

  it('banks against the foot of a wall on the faces the camera sees, and not under a dry sky', () => {
    const extent = (w: Weather) => {
      const k = kit(w)
      k.box(0, 0, 0, 2, 3, 2, 0x996644)
      const box = new Box3()
      k.build().traverse((o) => {
        const m = o as Mesh
        if (m.isMesh) {
          m.geometry.computeBoundingBox()
          box.union(m.geometry.boundingBox!)
        }
      })
      return box
    }
    const dry = extent('clear')
    const snowy = extent('snow')
    expect(snowy.max.x).toBeGreaterThan(dry.max.x + 0.2)
    expect(snowy.max.z).toBeGreaterThan(dry.max.z + 0.2)
    // Only the two faces the camera sees.
    expect(snowy.min.x).toBeCloseTo(dry.min.x, 5)
  })
})
