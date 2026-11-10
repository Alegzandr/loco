/**
 * The ground the table stands on, and the table's own top.
 *
 * Seen from a chair the floor round the table is the frame of the board, and
 * for a long time it was one material from edge to edge with a table set down
 * on it: no shade under the table (the lamp over it is the table's alone and
 * lights no floor), no drawing round its foot, a matte floor under every sky.
 * What these pin:
 *
 * - the table's shade lies on the floor in every room, at every hour, and it
 *   is darkest under the table and gone at its rim (`pools.ts: Shade`);
 * - every room lays an inlay round the table's foot, wider than the table,
 *   and lays none under snow, where there is no floor to see;
 * - a floor is polished only where the mirror's plane is the floor's: a room
 *   with water under it mirrors about the water's level, and a dry deck over
 *   it would show the room at the wrong height;
 * - the racetrack carries its lozenges, and a room with its own electricity
 *   turns the metal lines round the top into lines of light.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { solveView } from '../components/scene/view'
import { feltInViewport } from '../components/cards/layout'
import { LOOK } from '../components/scene/look'
import { Kit, type Finish } from '../components/scene/kit'
import { BUILDERS } from '../components/scene/maps'
import { MAPS, type MapId } from '../components/cards/maps'
import { lightRig } from '../components/scene/sky'
import { seededRng } from '../components/scene/rng'
import { splatPools } from '../components/scene/pools'
import type { Baked } from '../components/scene/models/bake'

const fake: Baked = { position: new Float32Array(9), normal: new Float32Array(9), color: new Float32Array(9), glow: new Uint8Array(3), index: Uint32Array.from([0, 1, 2]), smooth: new Float32Array(9), w: 0.01, h: 0.01, d: 0.01 }
const IDS = Object.keys(BUILDERS) as MapId[]
const view = () => solveView(1600, 900, feltInViewport(1600, 900, 3), LOOK.vista.camera)

function room(id: MapId, time: 'day' | 'dusk' | 'night' = 'dusk', weather: 'clear' | 'snow' = 'clear') {
  const k = new Kit({ rig: lightRig(time, weather, id), rng: seededRng(`ground-${id}`), outline: 0.02, view: view(), models: { has: () => true, get: () => fake }, lightPools: true })
  BUILDERS[id](k)
  return k
}

afterEach(() => vi.restoreAllMocks())

describe('the shade on the ground', () => {
  it('is darkest at its middle and nothing at its rim', () => {
    const map = splatPools([], [{ x: 0, z: 0, rx: 4, rz: 2, k: 0.5 }])!
    const left = (x: number, z: number) => {
      const i = Math.min(map.w - 1, Math.floor(((x - map.minX) / map.sizeX) * map.w))
      const j = Math.min(map.h - 1, Math.floor(((z - map.minZ) / map.sizeZ) * map.h))
      return map.data[(j * map.w + i) * 4 + 3] / 255
    }
    expect(left(0, 0)).toBeCloseTo(0.5, 1)
    expect(left(3.9, 0)).toBeGreaterThan(0.9)
    expect(left(0, 1.95)).toBeGreaterThan(0.9)
    expect(left(2, 0)).toBeLessThan(left(3.5, 0))
  })

  it('leaves the light alone where nothing stands over the ground', () => {
    const map = splatPools([{ x: 0, z: 0, r: 2, color: 0xffffff, k: 0.1 }])!
    for (let i = 0; i < map.w * map.h; i++) expect(map.data[i * 4 + 3]).toBe(255)
  })

  it('lies under the table in every room, by day as by night', () => {
    for (const id of IDS) {
      for (const time of ['day', 'night'] as const) {
        const k = room(id, time)
        expect(k.shades.length, `${id} ${time}`).toBeGreaterThan(0)
        const s = k.shades[0]
        // Wider than the table, which is `tableHalfWidth` either side of its middle.
        expect(s.rx, id).toBeGreaterThan(LOOK.vista.camera.tableHalfWidth)
        expect(s.k, id).toBe(LOOK.table.shade.dark)
        // By day there is no pool to carry it: the map is made for the shade alone.
        expect(splatPools(k.pools, k.shades), `${id} ${time}`).not.toBeNull()
      }
    }
  }, 120_000)
})

describe('the floor round the table', () => {
  it('carries an inlay wider than the table in every room, and none under snow', () => {
    for (const id of IDS) {
      const plate = vi.spyOn(Kit.prototype, 'plate')
      room(id)
      const reach = (o: readonly [number, number][]) => Math.max(...o.map(([x]) => Math.abs(x)))
      const bands = plate.mock.calls.filter(([o]) => reach(o) > LOOK.vista.camera.tableHalfWidth + 0.1)
      expect(bands.length, id).toBeGreaterThanOrEqual(3)
      plate.mockRestore()
      if (!MAPS[id].weathers.includes('snow')) continue
      const snowed = vi.spyOn(Kit.prototype, 'plate')
      room(id, 'day', 'snow')
      expect(snowed.mock.calls.filter(([o]) => reach(o) > LOOK.vista.camera.tableHalfWidth + 0.1), `${id} snow`).toHaveLength(0)
      snowed.mockRestore()
    }
  }, 120_000)

  it('is polished only where the mirror stands on it', () => {
    let polished = 0
    for (const id of IDS) {
      const k = room(id)
      if (k.polish > 0) {
        polished++
        expect(k.reflective, id).toBe(true)
        // The mirror flips the room about its lowest water, or about the floor.
        expect(k.waterLevel, id).toBe(0)
      }
      if (MAPS[id].weathers.includes('snow')) expect(room(id, 'day', 'snow').polish, `${id} snow`).toBe(0)
    }
    expect(polished).toBeGreaterThan(0)
  }, 120_000)
})

describe('the table top', () => {
  it('has its lozenges let into the racetrack', () => {
    for (const id of IDS) {
      const patch = vi.spyOn(Kit.prototype, 'patch')
      room(id)
      expect(patch.mock.calls, id).toHaveLength(LOOK.table.rail.marks)
      patch.mockRestore()
    }
  }, 120_000)

  it('draws its metal lines in light where the room has its own, and in metal elsewhere', () => {
    for (const id of IDS) {
      const loft = vi.spyOn(Kit.prototype, 'loft')
      room(id, 'night')
      const lit = loft.mock.calls.filter(([, f]) => ((f as Finish).lit ?? 0) > 0)
      if (MAPS[id].table.glow) expect(lit.length, id).toBeGreaterThanOrEqual(2)
      else expect(lit, id).toHaveLength(0)
      loft.mockRestore()
    }
  }, 120_000)
})
