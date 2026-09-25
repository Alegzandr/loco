/**
 * What the rooms seen from the table share (`view.ts`, `docs/notes/visual.md`,
 * "The view"): the table under the felt, and the pieces a far ground is made
 * of — hills laid in layers, a skyline of towers.
 *
 * A room seen from the table is composed in three grounds, and every builder
 * keeps to them: a **near** of a few metres that frames the picture at its
 * two edges and is the only thing drawn at full weight; a **middle** that is
 * most of what shows between the seat pills; a **far** of silhouettes the air
 * greys a step per layer (`LOOK.vista.haze`), under the sky of the hour and
 * its body. World axes as the kit's, the table's centre at the origin, a tile
 * a metre; the camera stands at `+z` and looks towards `-z`.
 */
import type { Finish, Kit } from '../kit'
import type { Actor } from '../life'
import type { EdgeProfile, TableMaterials } from '../../cards/maps'
import { RIM_GLOSS } from '../../cards/tableSurface'
import { cssHex, mix, scale, type Hex } from '../sky'
import { LOOK } from '../look'
import type { V3 } from '../view'

/** Builds the room, and says what moves in it (`vistaLife.ts`), or nothing does. */
export type Builder = (k: Kit) => Actor[] | void

/**
 * The table's edge in section, `[out, up]` from the top down (`Kit.sweep`):
 * `out` along the outline's outward normal and never past it — the CSS rim
 * is the top, and nothing may be wider than the felt — `up` from the top.
 * Each ends turning in under the table.
 */
const EDGES: Record<EdgeProfile, [number, number][]> = {
  // A thin lip over a long bevel cut away underneath: the modern table.
  knife: [[0, 0], [0, -0.03], [-0.01, -0.045], [-0.14, -0.1], [-0.55, -0.11]],
  // A slab of wood, square, its lower arris eased.
  square: [[0, 0], [0, -0.1], [-0.01, -0.115], [-0.025, -0.12], [-0.55, -0.12]],
  // A cove then a round: the cabinetmaker's moulding.
  ogee: [[0, 0], [0, -0.015], [-0.02, -0.035], [-0.04, -0.06], [-0.035, -0.085], [-0.015, -0.105], [0, -0.13], [-0.004, -0.15], [-0.02, -0.165], [-0.55, -0.17]],
  // A short face, then a quarter round rolling in under the table.
  bullnose: [
    [0, 0],
    [0, -0.03],
    ...Array.from({ length: 6 }, (_, i): [number, number] => {
      const t = (-(i + 1) * Math.PI) / 12
      return [-0.065 + 0.065 * Math.cos(t), -0.03 + 0.065 * Math.sin(t)]
    }),
    [-0.55, -0.095],
  ],
}

/** Where the metal band runs round the edge's face, `[from, to]` up from the top: where the face is vertical. */
const BANDS: Record<EdgeProfile, [number, number]> = {
  knife: [-0.012, -0.024],
  square: [-0.082, -0.094],
  ogee: [-0.128, -0.142],
  bullnose: [-0.006, -0.018],
}

/** The rim's material as the render's finish: the same wood, lacquer or metal the CSS draws. */
function rimFinish(m: TableMaterials): Finish {
  const color = cssHex(m.rim)
  const grainColor = cssHex(m.grain)
  switch (m.rimKind) {
    case 'lacquer':
      return { kind: 'lacquer', color, grain: 'lacquer', grainColor, fleck: m.fleck ? cssHex(m.fleck) : undefined }
    case 'titanium':
      return { kind: 'brushed', color, grain: 'brushed', grainColor }
    case 'burl':
      return { kind: 'wood', color, grain: 'burl', grainColor, coat: RIM_GLOSS.burl * 0.5 }
    case 'oak':
    case 'teak':
      return { kind: 'wood', color, grain: 'straight', grainColor, coat: RIM_GLOSS[m.rimKind] * 0.5 }
  }
}

/**
 * The table: its top is the felt cast back onto its plane (`View.tableOutline`),
 * so the CSS table — felt, rim and all — lands on it to the pixel. What the
 * render adds is what the CSS cannot draw from where the camera stands, in the
 * room's own materials (`TableMaterials`, `docs/notes/visual.md`, "The
 * table"): the edge going down, swept in its profile and banded in metal; the
 * skirt under it; and what it stands on, turned, one per room — a chrome
 * tulip, two oak balusters, a stepped marble column, a titanium tripod, four
 * lacquered legs, a capstan.
 */
export function vistaTable(k: Kit, m: TableMaterials) {
  const view = k.view
  if (!view) return
  const top = view.tableTop
  const outline: [number, number][] = view.tableOutline(128).map(([x, , z]) => [x, z])
  let cx = 0
  let cz = 0
  for (const [x, z] of outline) {
    cx += x
    cz += z
  }
  cx /= outline.length
  cz /= outline.length
  const rim = rimFinish(m)
  const metal: Finish = { kind: 'metal', color: cssHex(m.inlay) }
  const base = cssHex(m.base)

  // The top: the cloth, the racetrack round it and the rail round that, each
  // an ellipse concentric with the felt on screen (`tableOutline`'s inset)
  // cast onto the table, so the lines are the ones the player judged right
  // and the light on them is the room's. Widths are board pixels, the ones
  // the hands are laid against (`CLOTH_INSET`); without the board's scale
  // (the rooms page) a felt is taken to be the board's widest.
  const look = LOOK.table.rail
  const px = view.felt.unit ?? view.felt.rx / 550
  const N = 160
  const ring = (inset: number, up: number): V3[] => view.tableOutline(N, inset * px).map(([x, , z]) => [x, top + up, z])
  const railIn = look.width
  const feltIn = railIn + look.track
  const lip = 0.004
  // The cloth, from its middle out: the felt ring drawn in towards its centre.
  const edge = ring(feltIn, 0)
  let fx = 0
  let fz = 0
  for (const [x, , z] of edge) {
    fx += x
    fz += z
  }
  fx /= edge.length
  fz /= edge.length
  const toward = (s: number): V3[] => edge.map(([x, y, z]) => [fx + (x - fx) * s, y, fz + (z - fz) * s])
  k.loft([toward(0), toward(0.4), toward(0.75), edge], { kind: 'cloth', color: cssHex(m.felt) })
  // The metal filet at the cloth's edge, a step up to the racetrack.
  k.loft([edge, ring(feltIn, lip), ring(feltIn - look.filet, lip)], metal)
  // The racetrack: the rail's material stained a shade darker, flush.
  const track: Finish = { ...rim, color: scale(rim.color, 0.72), grainColor: rim.grainColor === undefined ? undefined : scale(rim.grainColor, 0.72) }
  k.loft([ring(feltIn - look.filet, lip), ring(railIn, lip)], track)
  // The rail: a rounded section rising off the racetrack and rolling over
  // into the edge's face, so the edge swept below it carries straight on.
  const crown: V3[][] = []
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * Math.PI
    const w = (1 - Math.cos(a)) / 2
    crown.push(ring(railIn * (1 - w), lip + (look.height - lip) * Math.pow(Math.sin(a), 0.55)))
  }
  k.loft(crown, rim)
  k.sweep(outline, top, EDGES[m.edge], rim)
  const [b0, b1] = BANDS[m.edge]
  k.sweep(outline, top, [[0.003, b0], [0.004, (b0 + b1) / 2], [0.003, b1]], metal)
  // The skirt, set back under the edge: what the edge's shadow falls on.
  const skirt = LOOK.table.skirt
  k.sweep(outline, top, [[-0.5, -0.08], [-0.5, -0.08 - skirt], [-0.9, -0.08 - skirt]], rim)

  const h = top - 0.08 - skirt
  switch (m.pedestal) {
    case 'tulip': {
      const chrome: Finish = { kind: 'metal', color: base }
      k.lathe(cx, 0, cz, [[0, 0], [1.3, 0], [1.3, 0.02], [1.2, 0.05], [0.8, 0.1], [0.4, 0.18], [0.2, 0.3], [0.16, 0.42], [0.2, 0.5], [0.45, 0.56], [0.7, h], [0, h]], chrome, { seg: 64 })
      break
    }
    case 'turned': {
      const oak: Finish = { ...rim, color: base }
      for (const s of [-1, 1]) {
        const z = cz + s * 1.6
        k.lathe(cx, 0, z, [[0, 0], [0.32, 0], [0.32, 0.06], [0.24, 0.08], [0.2, 0.12], [0.28, 0.2], [0.3, 0.26], [0.22, 0.34], [0.14, 0.4], [0.16, 0.48], [0.22, 0.52], [0.22, h], [0, h]], oak, { seg: 32 })
        k.lathe(cx, 0, z, [[0.33, 0], [0.33, 0.045]], metal, { seg: 32 })
      }
      k.finishBox(cx, 0.1, cz, 0.18, 0.12, 3.2, oak)
      break
    }
    case 'deco': {
      const marble: Finish = { kind: 'marble', color: base, grain: 'marble', grainColor: m.baseVein ? cssHex(m.baseVein) : mix(base, 0xffffff, 0.7) }
      k.lathe(cx, 0, cz, [[0, 0], [1.1, 0], [1.1, 0.06], [0.9, 0.06], [0.9, 0.12], [0.7, 0.12], [0.7, 0.16], [0.34, 0.16], [0.34, 0.5], [0.55, 0.5], [0.55, h], [0, h]], marble, { seg: 64 })
      for (const [r, y] of [[1.105, 0.05], [0.905, 0.11], [0.345, 0.3], [0.555, 0.52]] as const) {
        k.lathe(cx, 0, cz, [[r, y], [r, y + 0.012]], metal, { seg: 64 })
      }
      break
    }
    case 'tripod': {
      const ti: Finish = { kind: 'brushed', color: base, grain: 'brushed', grainColor: mix(base, 0x000000, 0.3) }
      k.lathe(cx, 0, cz, [[0, 0.4], [0.26, 0.4], [0.28, 0.44], [0.24, h], [0, h]], ti, { seg: 48 })
      for (let i = 0; i < 3; i++) {
        const phi = (i / 3) * Math.PI * 2 + Math.PI / 2
        const fx = cx + 1.1 * Math.cos(phi)
        const fz = cz + 1.1 * Math.sin(phi)
        const tilt = Math.atan2(0.95, 0.46)
        k.lathe(fx, 0.02, fz, [[0.055, 0], [0.05, Math.hypot(0.95, 0.46)]], ti, { seg: 16, tilt, rot: -phi })
        k.lathe(fx, 0, fz, [[0, 0], [0.16, 0], [0.14, 0.04], [0, 0.04]], metal, { seg: 24 })
      }
      break
    }
    case 'legs': {
      const black: Finish = { kind: 'lacquer', color: base, grain: 'lacquer', grainColor: mix(base, 0x000000, 0.4) }
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const x = cx + sx * 1.35
        const z = cz + sz * 2.1
        k.lathe(x, 0, z, [[0.16, 0], [0.13, h]], black, { seg: 4 })
        k.lathe(x, 0, z, [[0.175, 0], [0.175, 0.06], [0, 0.06]], metal, { seg: 4 })
      }
      break
    }
    case 'capstan': {
      const wood: Finish = { kind: 'wood', color: base, grain: 'straight', grainColor: mix(base, 0x000000, 0.45), coat: 0.8 }
      k.lathe(cx, 0, cz, [[0, 0], [1.0, 0], [1.0, 0.06], [0.8, 0.08], [0.55, 0.12], [0.45, 0.2], [0.5, 0.3], [0.45, 0.4], [0.42, 0.5], [0.6, 0.56], [0.6, h], [0, h]], wood, { seg: 48 })
      for (const [r, y] of [[1.005, 0.0], [0.505, 0.28], [0.605, 0.555]] as const) {
        k.lathe(cx, 0, cz, [[r, y], [r, y + 0.04]], metal, { seg: 48 })
      }
      break
    }
  }
}

/**
 * A run of hills: low, wide mounds, never peaks — overlapping flat cones, the
 * biggest in the middle of the run, falling away at both ends. Unoutlined:
 * at this distance the air draws the edge.
 */
export function hills(k: Kit, x0: number, x1: number, z: number, h: number, color: Hex, n: number, base = -3) {
  const rng = k.rng
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1)
    const x = x0 + (x1 - x0) * t + rng.range(-30, 30)
    const swell = Math.sin(Math.PI * (0.15 + 0.7 * t))
    const r = (Math.abs(x1 - x0) / n) * rng.range(1.3, 1.8)
    k.cone(x, base, z + rng.range(-60, 60), r, h * swell * rng.range(0.8, 1.1), mix(color, 0x000000, rng.range(0, 0.08)), { seg: 14, outline: false })
  }
}

export interface SkylineOptions {
  /** Across the frame, world x, and how deep the band runs. */
  x0: number
  x1: number
  z0: number
  z1: number
  /** Storeys: the range of heights, tiles. */
  h: [number, number]
  /** How wide a tower is, tiles. */
  w: [number, number]
  count: number
  colors: readonly Hex[]
  /** The colour of a lit window. */
  window?: Hex
  /**
   * How many of the hour's lit windows this band draws, 0–1: a far band is a
   * silhouette with a few lights, and every pane in it is a box to build.
   */
  windows?: number
  /** Draw the floors' glass bands (on by default): off for a band too far to show them. */
  ribbons?: boolean
  /** A few towers taller than the rest: how many, and how much taller. */
  spires?: { count: number; h: [number, number] }
  /** A share of towers wearing a neon edge, and its colours. */
  neon?: { share: number; colors: readonly Hex[] }
  /** Stepped tops, one tier in how many: the deco skyline. */
  tiers?: number
  base?: number
  /** What stands at the foot of the band decides nothing: a tower is never placed inside another. */
  gap?: number
}

/**
 * A skyline: towers in a band, each a block with its windows as rows of lit
 * and dark panes (the hour's share lit, `rig.windowsLit`), a roof detail now
 * and then, and on some a neon edge. Windows are strips of glow proud of the
 * face towards the camera — at a few hundred metres a pane is a pixel, and a
 * strip is what reads.
 */
export function skyline(k: Kit, o: SkylineOptions) {
  const rng = k.rng
  const lit = k.rig.lampsOn ? k.rig.windowsLit * (o.windows ?? 1) : 0
  const win = o.window ?? 0xffd89a
  const base = o.base ?? 0
  const placed: [number, number, number][] = []
  const spires = o.spires?.count ?? 0
  for (let i = 0; i < o.count + spires; i++) {
    const spire = i >= o.count
    const x = rng.range(o.x0, o.x1)
    const z = rng.range(o.z0, o.z1)
    const w = rng.range(o.w[0], o.w[1])
    if (placed.some(([px, pz, pw]) => Math.abs(px - x) < (pw + w) / 2 + (o.gap ?? 1) && Math.abs(pz - z) < (pw + w) / 2 + (o.gap ?? 1))) continue
    placed.push([x, z, w])
    const h = spire && o.spires ? rng.range(o.spires.h[0], o.spires.h[1]) : rng.range(o.h[0], o.h[1]) * (0.6 + 0.4 * Math.sin(Math.PI * Math.min(1, Math.max(0, (x - o.x0) / (o.x1 - o.x0)))))
    const d = w * rng.range(0.8, 1.2)
    const color = rng.pick(o.colors)
    let y = base
    let tw = w
    let td = d
    let th = h
    const tiers = o.tiers && rng.chance(1 / o.tiers) ? 3 : 1
    for (let t = 0; t < tiers; t++) {
      const hh = tiers === 1 ? th : th * [0.6, 0.25, 0.15][t]
      k.box(x, y, z, tw, hh, td, color, { cap: true, outline: false })
      // A band of glass a floor on the face towards the camera — what gives a
      // tower its scale by day — and on it the panes lit tonight.
      const floors = (o.ribbons ?? true) ? Math.floor(hh / 3.4) : 0
      const cols = Math.max(1, Math.floor(tw / 2.6))
      for (let f = 0; f < floors; f++) {
        k.box(x, y + f * 3.4 + 1.1, z + td / 2 + 0.03, tw * 0.9, 1.4, 0.06, mix(color, 0x0a1830, 0.45), { outline: false, cap: false, gloss: 0.6 })
        if (lit <= 0) continue
        for (let c = 0; c < cols; c++) {
          if (!rng.chance(lit)) continue
          const cx = x - tw / 2 + (c + 0.5) * (tw / cols)
          k.box(cx, y + f * 3.4 + 1.1, z + td / 2 + 0.05, (tw / cols) * 0.55, 1.4, 0.1, mix(win, 0xffffff, rng.range(0, 0.3)), { glow: true, outline: false, cap: false })
        }
      }
      y += hh
      tw *= 0.72
      td *= 0.72
    }
    th = y - base
    if (o.neon && k.rig.lampsOn && rng.chance(o.neon.share)) {
      const nc = rng.pick(o.neon.colors)
      k.box(x - w / 2 - 0.1, base, z + d / 2 + 0.1, 0.35, th, 0.35, nc, { glow: true, outline: false, cap: false })
      k.box(x, base + th - 0.4, z + d / 2 + 0.1, w, 0.35, 0.35, nc, { glow: true, outline: false, cap: false })
    }
    if (rng.chance(0.3)) k.cyl(x, y, z, 0.3, h * 0.12, scale(color, 0.7), { seg: 5, outline: false, cap: false })
  }
}

/**
 * A small sailing boat at anchor: a hull narrowing to the bow, a cabin, a
 * mast with its sail furled along the boom. `rot` turns it about y; `s` scales it.
 */
export function sailboat(k: Kit, x: number, z: number, rot: number, s: number, hull: Hex, trim: Hex, sea: number) {
  const c = Math.cos(rot)
  const sn = Math.sin(rot)
  const at = (u: number): [number, number] => [x + u * c * s, z - u * sn * s]
  const y = sea - 0.15 * s
  const [hx, hz] = at(-0.4)
  k.box(hx, y, hz, 5.2 * s, 0.9 * s, 1.9 * s, hull, { rot, cap: false })
  const [bx, bz] = at(2.6)
  k.cyl(bx, y, bz, 0.95 * s, 0.9 * s, hull, { seg: 3, rTop: 0.95 * s, cap: false })
  k.box(hx, y + 0.88 * s, hz, 5.3 * s, 0.1 * s, 2.0 * s, trim, { rot, cap: false, outline: false })
  const [cx, cz] = at(-0.9)
  k.box(cx, y + 0.9 * s, cz, 1.8 * s, 0.6 * s, 1.3 * s, 0xf1e9dc, { rot, cap: true })
  const [mx, mz] = at(0.5)
  k.cyl(mx, y + 0.9 * s, mz, 0.07 * s, 7.5 * s, 0xd9d4c8, { seg: 5, cap: false })
  const [sx, sz] = at(-0.9)
  k.cyl(sx, y + 1.9 * s, sz, 0.16 * s, 2.8 * s, 0xf1e9dc, { seg: 6, axis: 'x', rot, cap: false })
}

/** Planks laid across, parallel to the frame: level lines that lead the eye to the horizon. */
export function deck(k: Kit, z0: number, z1: number, width: number, a: Hex, b: Hex, o: { y?: number; plank?: number } = {}) {
  const rng = k.rng
  const step = o.plank ?? 0.42
  for (let z = z0; z < z1; z += step) {
    const tone = rng.chance(0.3) ? b : mix(a, b, rng.range(0, 0.4))
    k.box(0, (o.y ?? 0) - 0.12, z + step / 2, width, 0.12, step * 0.9, k.ground(tone), { outline: false, cap: true, gloss: k.wetGloss() })
  }
}

/** A 5-row bitmap font, enough to spell a sign. */
const GLYPHS: Record<string, string[]> = {
  L: ['#..', '#..', '#..', '#..', '###'],
  O: ['###', '#.#', '#.#', '#.#', '###'],
  C: ['###', '#..', '#..', '#..', '###'],
  '!': ['#', '#', '#', '.', '#'],
  ' ': ['.', '.', '.', '.', '.'],
}

/**
 * A word as lit blocks on a vertical panel facing +z (rot 0). `cell` is the
 * size of one pixel; `x, z` the panel's centre, `y` its bottom.
 */
export function neonText(k: Kit, text: string, x: number, y: number, z: number, cell: number, color: Hex, rot = 0) {
  const cols = [...text].reduce((w, ch) => w + (GLYPHS[ch]?.[0].length ?? 3) + 1, -1)
  let cx = -cols / 2
  const on = k.rig.lampsOn
  for (const ch of text) {
    const g = GLYPHS[ch] ?? GLYPHS[' ']
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < g[r].length; c++) {
        if (g[r][c] !== '#') continue
        const lx = (cx + c + 0.5) * cell
        const ly = y + (4 - r + 0.5) * cell
        // Unlit, the letters keep their colour a shade down: grey, the brand's
        // own sign was the one thing on the square nobody could read by day.
        k.box(x + lx * Math.cos(rot), ly - cell / 2, z - lx * Math.sin(rot), cell * 0.92, cell * 0.92, cell * 0.4, on ? color : mix(color, 0x2a2a35, 0.3), { rot, glow: on, outline: !on, cap: false })
      }
    }
    cx += g[0].length + 1
  }
  if (on) k.halo(x, y + 2.5 * cell, z, cols * cell * 0.55, color, 0.25, false)
}
