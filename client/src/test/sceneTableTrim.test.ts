/**
 * A table dressed in its painted strips.
 *
 * Beside a painted room the table's plain varnish read as a computer's, and
 * the table cannot be a painting: its shape is solved to the felt. What it is
 * made of can be (`TableMaterials.paint`, `Kit.band`, `vista.ts`). What these
 * pin: a strip is laid an even number of times round (it is mirrored end to
 * end, and an odd count meets itself the wrong way at the seam), its top row
 * is the table's outer edge, the table is dressed in both strips or in
 * neither, a room's lines of light stay over the painting, and every strip a
 * room names is the file it should be.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { join } from 'node:path'
import sharp from 'sharp'
import type { Texture } from 'three'
import { solveView } from '../components/scene/view'
import { feltInViewport } from '../components/cards/layout'
import { LOOK } from '../components/scene/look'
import { Kit, bandGeometry, type Finish } from '../components/scene/kit'
import { vistaTable } from '../components/scene/maps/vista'
import { MAPS, type MapId } from '../components/cards/maps'
import { lightRig } from '../components/scene/sky'
import { seededRng } from '../components/scene/rng'

const IDS = Object.keys(MAPS) as MapId[]
const FRAMES = [[1920, 1080], [390, 844], [844, 340]] as const

function kitFor(id: MapId, w: number, h: number, have: readonly string[]) {
  const view = solveView(w, h, feltInViewport(w, h, 3), LOOK.vista.camera)
  const paints = new Map<string, Texture>(have.map((a) => [a, {} as Texture]))
  return new Kit({ rig: lightRig('night', 'clear', id), rng: seededRng(`trim-${id}`), outline: 0.02, view, paints })
}

afterEach(() => vi.restoreAllMocks())

describe('a band', () => {
  it('runs its strip the given number of times round, top row first', () => {
    const ring = (r: number, y: number): [number, number, number][] => Array.from({ length: 8 }, (_, i) => [r * Math.cos((i / 8) * 2 * Math.PI), y, r * Math.sin((i / 8) * 2 * Math.PI)])
    const g = bandGeometry([ring(2, 1), ring(1.8, 1), ring(1.5, 1)], [0, 0.4, 1], 6)
    const uv = g.getAttribute('uv')
    // One column more than there are points, to close the seam without a jump.
    expect(uv.count).toBe(9 * 3)
    expect(uv.getX(0)).toBe(0)
    expect(uv.getX(uv.count - 1)).toBe(6)
    // The strip's top row is the image's top (`v` 1), and it is the first ring.
    expect(uv.getY(0)).toBe(1)
    expect(uv.getY(1)).toBeCloseTo(0.6, 6)
    expect(uv.getY(2)).toBe(0)
  })
})

describe('a painted table', () => {
  it('is named two strips by every room, each the file it should be', async () => {
    for (const id of IDS) {
      const paint = MAPS[id].table.paint
      expect(paint, id).toBeDefined()
      for (const part of ['rail', 'side'] as const) {
        const meta = await sharp(join(process.cwd(), 'src', 'assets', 'plates', `${id}-${part}.webp`)).metadata()
        expect([meta.width, meta.height], `${id} ${part}`).toEqual([1024, 256])
      }
    }
  })

  it('lays each strip an even number of times round, at every frame', () => {
    for (const id of IDS) {
      const paint = MAPS[id].table.paint!
      for (const [w, h] of FRAMES) {
        const band = vi.spyOn(Kit.prototype, 'band')
        const patch = vi.spyOn(Kit.prototype, 'patch')
        vistaTable(kitFor(id, w, h, [paint.rail, paint.side]), MAPS[id].table)
        expect(band.mock.calls.map(([, , , f]) => (f as Finish).paint), `${id} ${w}x${h}`).toEqual([paint.rail, paint.side])
        for (const [rings, at, repeats] of band.mock.calls) {
          expect(repeats % 2, `${id} ${w}x${h}`).toBe(0)
          expect(repeats, `${id} ${w}x${h}`).toBeGreaterThanOrEqual(2)
          // From the strip's top to its foot, one place a ring.
          expect(at).toHaveLength(rings.length)
          expect(at[0]).toBe(0)
          expect(at[at.length - 1]).toBe(1)
          for (let i = 1; i < at.length; i++) expect(at[i]).toBeGreaterThanOrEqual(at[i - 1])
        }
        // The painting carries its own ornaments: no lozenges let in over it.
        expect(patch.mock.calls, `${id} ${w}x${h}`).toHaveLength(0)
        band.mockRestore()
        patch.mockRestore()
      }
    }
  })

  it('is dressed in both strips or in neither', () => {
    for (const id of IDS) {
      const paint = MAPS[id].table.paint!
      for (const have of [[], [paint.rail], [paint.side]]) {
        const band = vi.spyOn(Kit.prototype, 'band')
        const patch = vi.spyOn(Kit.prototype, 'patch')
        vistaTable(kitFor(id, 1920, 1080, have), MAPS[id].table)
        expect(band.mock.calls, `${id} with ${have.length}`).toHaveLength(0)
        expect(patch.mock.calls, `${id} with ${have.length}`).toHaveLength(LOOK.table.rail.marks)
        band.mockRestore()
        patch.mockRestore()
      }
    }
  })

  it('keeps a room’s lines of light over the painting', () => {
    for (const id of IDS) {
      const paint = MAPS[id].table.paint!
      const loft = vi.spyOn(Kit.prototype, 'loft')
      vistaTable(kitFor(id, 1920, 1080, [paint.rail, paint.side]), MAPS[id].table)
      const lit = loft.mock.calls.filter(([, f]) => ((f as Finish).lit ?? 0) > 0)
      if (MAPS[id].table.glow) expect(lit, id).toHaveLength(2)
      else expect(lit, id).toHaveLength(0)
      loft.mockRestore()
    }
  })
})
