/**
 * The table, made of the room's own materials (`docs/notes/visual.md`, "The
 * table"): the rim's grain as an image the CSS and the racetrack share, the
 * render's edge swept round the felt in the same material, and a pedestal
 * that belongs to one room.
 */
import { describe, expect, it } from 'vitest'
import { Mesh, MeshPhysicalMaterial, type Group } from 'three'
import { MAPS, MAP_IDS } from '../components/cards/maps'
import { rimSurface, tableCssVars, RIM_GLOSS } from '../components/cards/tableSurface'
import { feltInViewport } from '../components/cards/layout'
import { grainPixels } from '../components/scene/grain'
import { Kit, loftGeometry, sweepGeometry } from '../components/scene/kit'
import { CLOTH_INSET } from '../components/cards/layout'
import { tableFits, type PreparedScene } from '../components/scene/sceneCache'
import { LOOK } from '../components/scene/look'
import { seededRng } from '../components/scene/rng'
import { lightRig } from '../components/scene/sky'
import { solveView } from '../components/scene/view'
import { vistaTable } from '../components/scene/maps/vista'

const NO_INSETS = { top: 0, bottom: 0, left: 0, right: 0 }

describe('each room has a table of its own', () => {
  it('no two rooms share a material, an edge and a pedestal', () => {
    const tables = MAP_IDS.map((id) => MAPS[id].table)
    const pedestals = new Set(tables.map((t) => t.pedestal))
    expect(pedestals.size).toBe(MAP_IDS.length)
    const looks = new Set(tables.map((t) => `${t.rimKind}:${t.rim}:${t.edge}`))
    expect(looks.size).toBe(MAP_IDS.length)
  })

  it('knows how every rim material shines', () => {
    for (const id of MAP_IDS) {
      const g = RIM_GLOSS[MAPS[id].table.rimKind]
      expect(g, id).toBeGreaterThan(0)
      expect(g, id).toBeLessThanOrEqual(1)
    }
  })
})

describe('the rim drawn as its material', () => {
  it('is an SVG of noise in the rim\'s own colours, served as data', () => {
    for (const id of MAP_IDS) {
      const t = MAPS[id].table
      const s = rimSurface(t)
      expect(s.uri.startsWith('data:image/svg+xml,'), id).toBe(true)
      const svg = decodeURIComponent(s.uri.slice('data:image/svg+xml,'.length))
      expect(svg, id).toContain('feTurbulence')
      expect(svg, id).toContain(`flood-color='${t.rim}'`)
      expect(svg, id).toContain(`flood-color='${t.grain}'`)
      // The grain tiles: the noise is stitched at the tile's edges.
      expect(svg, id).toContain("stitchTiles='stitch'")
    }
  })

  it('is the same image every time: a table does not change between two seats', () => {
    expect(rimSurface(MAPS.velvet.table).uri).toBe(rimSurface(MAPS.velvet.table).uri)
  })

  it('hands the board every variable its CSS reads', () => {
    const vars = tableCssVars(MAPS.rune.table).join('; ')
    for (const name of ['--tbl-felt', '--tbl-felt-deep', '--tbl-rim', '--tbl-rim-light', '--tbl-inlay', '--tbl-rim-tex', '--tbl-rim-gloss']) {
      expect(vars).toContain(`${name}:`)
    }
  })
})

describe('the grain the render textures the table with', () => {
  it('is deterministic and in the material\'s colours', () => {
    const spec = { kind: 'straight' as const, base: 0x7a5130, grain: 0x3b2412 }
    const a = grainPixels(spec, 32)
    expect(a).toEqual(grainPixels(spec, 32))
    expect(a.length).toBe(32 * 32 * 4)
    for (let i = 0; i < a.length; i += 4) {
      // Every pixel lies between the two colours, channel by channel.
      expect(a[i]).toBeGreaterThanOrEqual(0x3b)
      expect(a[i]).toBeLessThanOrEqual(0x7a)
      expect(a[i + 3]).toBe(255)
    }
  })

  it('repeats without a seam', () => {
    // The last column runs into the first as smoothly as any two neighbours.
    const n = 64
    for (const kind of ['straight', 'burl', 'brushed', 'marble'] as const) {
      const px = grainPixels({ kind, base: 0x202020, grain: 0xe0e0e0 }, n)
      const at = (x: number, y: number) => px[(y * n + x) * 4]
      let seam = 0
      let inside = 0
      for (let y = 0; y < n; y++) {
        seam += Math.abs(at(n - 1, y) - at(0, y))
        inside += Math.abs(at(n / 2, y) - at(n / 2 - 1, y))
      }
      expect(seam, kind).toBeLessThan(inside * 3 + n * 8)
    }
  })
})

describe('the edge swept round the felt', () => {
  const circle = Array.from({ length: 48 }, (_, i): [number, number] => {
    const t = (i / 48) * Math.PI * 2
    return [Math.cos(t) * 2, Math.sin(t) * 3]
  })

  it('never stands wider than the felt, and its faces look out', () => {
    const g = sweepGeometry(circle, 0.9, [[0, 0], [0, -0.1], [-0.05, -0.15], [-0.5, -0.16]])
    const pos = g.getAttribute('position')
    const nor = g.getAttribute('normal')
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      // Inside the felt's own ellipse, to rounding.
      expect((x / 2) ** 2 + (z / 3) ** 2).toBeLessThanOrEqual(1.0001)
    }
    // On the vertical face, the normal points away from the middle.
    const i = 1
    expect(nor.getX(i) * pos.getX(i) + nor.getZ(i) * pos.getZ(i)).toBeGreaterThan(0)
  })

  it('runs the grain round the whole edge without a jump', () => {
    const g = sweepGeometry(circle, 0.9, [[0, 0], [0, -0.1]])
    const uv = g.getAttribute('uv')
    // One more ring than the outline has points, closing the seam at the full length.
    expect(uv.count).toBe((circle.length + 1) * 2)
    expect(uv.getX(uv.count - 1)).toBeGreaterThan(uv.getX(0))
    expect(uv.getX(0)).toBe(0)
    expect(LOOK.table.grainSpan[0]).toBeGreaterThan(0)
  })
})

describe('the top lofted through the rings round the felt', () => {
  const ring = (r: number, y: number): [number, number, number][] =>
    Array.from({ length: 32 }, (_, i) => {
      const t = (i / 32) * Math.PI * 2
      return [Math.cos(t) * 2 * r, y, -Math.sin(t) * 3 * r]
    })

  // Each triangle's winding says which way three.js lights it on a two-sided
  // material: a face wound against its normals is lit from behind, and a
  // cloth wound that way was black under a lamp straight over it.
  function facesAgree(rings: [number, number, number][][]) {
    const g = loftGeometry(rings)
    const pos = g.getAttribute('position')
    const nor = g.getAttribute('normal')
    const idx = g.getIndex()!
    for (let t = 0; t < idx.count; t += 3) {
      const [a, b, c] = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)]
      const ux = pos.getX(b) - pos.getX(a), uy = pos.getY(b) - pos.getY(a), uz = pos.getZ(b) - pos.getZ(a)
      const vx = pos.getX(c) - pos.getX(a), vy = pos.getY(c) - pos.getY(a), vz = pos.getZ(c) - pos.getZ(a)
      const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx
      if (Math.hypot(fx, fy, fz) < 1e-12) continue
      const nx = nor.getX(a) + nor.getX(b) + nor.getX(c)
      const ny = nor.getY(a) + nor.getY(b) + nor.getY(c)
      const nz = nor.getZ(a) + nor.getZ(b) + nor.getZ(c)
      expect(fx * nx + fy * ny + fz * nz).toBeGreaterThan(0)
    }
    return g
  }

  it('lays the cloth facing up, its middle included, wound the way its normals face', () => {
    const g = facesAgree([ring(0, 0.9), ring(0.5, 0.9), ring(1, 0.9)])
    const nor = g.getAttribute('normal')
    for (let i = 0; i < nor.count; i++) expect(nor.getY(i)).toBeCloseTo(1, 6)
  })

  it('rounds the rail up over its crown and out down its face', () => {
    const rings = [ring(0.9, 0.9), ring(0.9, 0.95), ring(0.95, 0.97), ring(1, 0.95), ring(1, 0.9)]
    const g = facesAgree(rings)
    const pos = g.getAttribute('position')
    const nor = g.getAttribute('normal')
    // Point 0 of each ring: the inner face looks in, the crown up, the outer face out.
    const at = (j: number) => ({ x: pos.getX(j), n: [nor.getX(j), nor.getY(j)] })
    expect(at(0).n[0] * at(0).x).toBeLessThan(0)
    expect(at(2).n[1]).toBeGreaterThan(0.9)
    expect(at(4).n[0] * at(4).x).toBeGreaterThan(0)
  })

  it('puts the cloth where the board lays the hands: the rail and the track are CLOTH_INSET', () => {
    expect(LOOK.table.rail.width + LOOK.table.rail.track).toBe(CLOTH_INSET)
  })
})

describe('the render is the table only while it lies under the felt', () => {
  const entry = { canvas: {} as HTMLCanvasElement, size: { width: 3200, height: 1800, pixelRatio: 2 }, felt: { cx: 800, cy: 420, rx: 560, ry: 300 } } as unknown as PreparedScene

  it('holds through a stretch the felt follows, and lets go when it does not', () => {
    expect(tableFits(entry, 1600, 900, { cx: 800, cy: 420, rx: 560, ry: 300 })).toBe(true)
    expect(tableFits(entry, 1760, 990, { cx: 880, cy: 462, rx: 616, ry: 330 })).toBe(true)
    expect(tableFits(entry, 1600, 900, { cx: 800, cy: 470, rx: 560, ry: 300 })).toBe(false)
    expect(tableFits({ ...entry, canvas: null }, 1600, 900, entry.felt)).toBe(false)
    expect(tableFits(null, 1600, 900, entry.felt)).toBe(false)
  })
})

describe('the render builds each room its table', () => {
  function build(id: (typeof MAP_IDS)[number]): Group {
    const felt = feltInViewport(1600, 900, 3, NO_INSETS)
    const view = solveView(1600, 900, felt, LOOK.vista.camera)
    const k = new Kit({ rig: lightRig('day', 'clear', id), rng: seededRng(id), outline: 0.02, view })
    vistaTable(k, MAPS[id].table)
    return k.build()
  }

  it('in physically based materials, the rim\'s one textured', () => {
    for (const id of MAP_IDS) {
      const g = build(id)
      const finished = g.children.filter((c): c is Mesh => c instanceof Mesh && c.material instanceof MeshPhysicalMaterial)
      // The rim, its metal, and what it stands on: at least three finishes.
      expect(finished.length, id).toBeGreaterThanOrEqual(3)
      expect(finished.some((m) => (m.material as MeshPhysicalMaterial).map !== null), id).toBe(true)
      expect(finished.some((m) => (m.material as MeshPhysicalMaterial).metalness === 1), id).toBe(true)
      for (const m of finished) expect(m.receiveShadow, id).toBe(true)
    }
  })
})
