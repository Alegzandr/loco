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
import { offsetOutline, spotChance, type Finish, type Kit } from '../kit'
import type { Actor } from '../life'
import type { EdgeProfile, TableMaterials } from '../../cards/maps'
import { RIM_GLOSS } from '../../cards/tableSurface'
import { cssHex, mix, scale, type Hex } from '../sky'
import { LOOK } from '../look'
import type { V3 } from '../view'

/**
 * Dev only (`?bare=1`): the room without its table and without the floor's
 * inlay, which is what a painted plate is made from (`tools/plates`). Both
 * follow the felt, and the felt changes with the frame; a plate is one image.
 */
export const BARE = import.meta.env.DEV && typeof location !== 'undefined' && /[?&]bare=1/.test(location.search)

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

/**
 * How much of a wood's gloss the render takes as varnish. A quarter: at a
 * half, a low sun on the far rail came back as a white glint the bloom then
 * spread, and under a fog, with no sun in the sky to answer for it, that
 * glint was a smear on the table.
 */
const COAT = 0.25

/** The rim's material as the render's finish: the same wood, lacquer or metal the CSS draws. */
function rimFinish(m: TableMaterials): Finish {
  const color = cssHex(m.rim)
  // The grain's colour brought halfway to the rim's: at the materials' own
  // contrast a ring was a black stripe from where the player sits, and the
  // edge read as scratched rather than as wood.
  const grainColor = mix(cssHex(m.grain), color, 0.45)
  switch (m.rimKind) {
    case 'lacquer':
      return { kind: 'lacquer', color, grain: 'lacquer', grainColor, fleck: m.fleck ? cssHex(m.fleck) : undefined }
    case 'titanium':
      return { kind: 'brushed', color, grain: 'brushed', grainColor }
    case 'burl':
      return { kind: 'wood', color, grain: 'burl', grainColor, coat: RIM_GLOSS.burl * COAT }
    case 'oak':
    case 'teak':
      return { kind: 'wood', color, grain: 'straight', grainColor, coat: RIM_GLOSS[m.rimKind] * COAT }
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
  if (!view || BARE) return
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
  // The lines of metal round the top, which in a room that has them are
  // lines of light let into the rail.
  const line: Finish = m.glow ? { kind: 'metal', color: cssHex(m.glow), lit: LOOK.table.rail.lit * (k.rig.lampsOn ? 1 : 0.55) } : metal
  // The table's shade on the floor: the lamp over it is the table's alone and
  // lights no floor, so nothing else stands the table on the ground.
  {
    let rx = 0
    let rz = 0
    for (const [x, z] of outline) {
      rx = Math.max(rx, Math.abs(x - cx))
      rz = Math.max(rz, Math.abs(z - cz))
    }
    k.shade(cx, cz, rx * LOOK.table.shade.reach, rz * LOOK.table.shade.reach, LOOK.table.shade.dark)
  }
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
  if (m.paint && k.painted(m.paint.rail) && k.painted(m.paint.side)) {
    paintedTable(k, m, m.paint, outline, top, ring, railIn, feltIn, lip, rim, m.glow ? line : null)
    pedestal(k, m, outline, cx, cz, top - LOOK.table.apron, rim, metal, base)
    return
  }
  // The metal filet at the cloth's edge, a step up to the racetrack.
  k.loft([edge, ring(feltIn, lip), ring(feltIn - look.filet, lip)], line)
  // The racetrack: the rail's material stained a shade darker, flush.
  const track: Finish = { ...rim, color: scale(rim.color, 0.72), grainColor: rim.grainColor === undefined ? undefined : scale(rim.grainColor, 0.72) }
  k.loft([ring(feltIn - look.filet, lip), ring(railIn + look.filet, lip)], track)
  // A second filet at the rail's foot, and lozenges of the same metal let into
  // the racetrack all the way round: what says cabinetmaker rather than disc.
  k.loft([ring(railIn + look.filet, lip), ring(railIn + look.filet, lip + 0.002), ring(railIn, lip + 0.002)], line)
  {
    const mid = ring(railIn + look.filet + (look.track - 2 * look.filet) * 0.5, lip + 0.0015)
    const inner = ring(railIn + look.filet + (look.track - 2 * look.filet) * 0.84, lip + 0.0015)
    const outer = ring(railIn + look.filet + (look.track - 2 * look.filet) * 0.16, lip + 0.0015)
    const step = Math.round(N / look.marks)
    for (let i = Math.round(step / 2); i < N; i += step) {
      k.patch(mid[(i + N - 2) % N], outer[i], mid[(i + 2) % N], inner[i], metal)
    }
  }
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
  k.sweep(outline, top, [[0.003, b0], [0.004, (b0 + b1) / 2], [0.003, b1]], line)
  // The skirt, set back under the edge: what the edge's shadow falls on.
  const skirt = LOOK.table.skirt
  k.sweep(outline, top, [[-0.5, -0.08], [-0.5, -0.08 - skirt], [-0.9, -0.08 - skirt]], rim)

  pedestal(k, m, outline, cx, cz, top - 0.08 - skirt, rim, metal, base)
}

/**
 * The table dressed in its two painted strips (`TableMaterials.paint`): the
 * top of the rim as one band from the outer edge over the rail's crown and
 * across the racetrack to the cloth, and a straight apron under it. A strip
 * is a moulding four times as long as it is tall, laid as many times round as
 * keeps it near that shape (`LOOK.table.stretch` draws it out a little), an
 * even number: it is mirrored end to end.
 */
function paintedTable(
  k: Kit,
  m: TableMaterials,
  paint: { rail: string; side: string },
  outline: [number, number][],
  top: number,
  ring: (inset: number, up: number) => V3[],
  railIn: number,
  feltIn: number,
  lip: number,
  rim: Finish,
  line: Finish | null,
) {
  const look = LOOK.table.rail
  let around = 0
  for (let i = 0; i < outline.length; i++) {
    const [ax, az] = outline[i]
    const [bx, bz] = outline[(i + 1) % outline.length]
    around += Math.hypot(bx - ax, bz - az)
  }
  const times = (tall: number, stretch: number) => Math.max(2, 2 * Math.round(around / (8 * tall * stretch)))
  // The top: the crown from the outer edge inwards, then the racetrack, flush.
  const rings: V3[][] = []
  const at: number[] = []
  for (let i = 12; i >= 0; i--) {
    const a = (i / 12) * Math.PI
    const w = (1 - Math.cos(a)) / 2
    rings.push(ring(railIn * (1 - w), lip + (look.height - lip) * Math.pow(Math.sin(a), 0.55)))
    at.push((railIn * (1 - w)) / feltIn)
  }
  rings.push(ring(feltIn, lip))
  at.push(1)
  // How wide the band is on the table, metres: the outer ring to the cloth's.
  const wide = Math.hypot(rings[0][0][0] - rings[rings.length - 1][0][0], rings[0][0][2] - rings[rings.length - 1][0][2])
  k.band(rings, at, times(wide, LOOK.table.stretch.rail), { kind: 'painted', color: rim.color, paint: paint.rail })
  // A room with its own electricity keeps its two lines of light over the painting.
  if (line) {
    k.loft([ring(feltIn, lip + 0.001), ring(feltIn, lip + 0.003), ring(feltIn - look.filet, lip + 0.003)], line)
    k.loft([ring(railIn + look.filet, lip + 0.001), ring(railIn + look.filet, lip + 0.003), ring(railIn, lip + 0.003)], line)
  }
  // The apron: straight down from the edge, its foot eased in.
  const tall = LOOK.table.apron
  const face = (out: number, up: number): V3[] => offsetOutline(outline, out).map(([x, z]) => [x, top + up, z])
  k.band([face(0, lip), face(0, -tall * 0.5), face(-0.004, -tall * 0.94), face(-0.02, -tall)], [0, 0.5, 0.94, 1], times(tall, LOOK.table.stretch.side), { kind: 'painted', color: cssHex(m.rim), paint: paint.side })
  // What is under it, turning in to the pedestal: plain, and in shade.
  k.sweep(outline, top, [[-0.02, -tall], [-0.9, -tall]], rim)
}

/** What the table stands on, turned, one per room, under a top whose underside is at `h`. */
function pedestal(k: Kit, m: TableMaterials, outline: [number, number][], cx: number, cz: number, h: number, rim: Finish, metal: Finish, base: Hex) {
  // Where a foot may stand: the table's size is solved to the felt on screen,
  // so a foot set a fixed distance out lands outside a shallow table and its
  // top shows, cut square, in front of the edge. A foot aimed along (dx, dz)
  // is pulled in until it stands `inset` inside the outline in that direction,
  // under the skirt's flange (0.9 in) and never past it.
  const within = (dx: number, dz: number, inset: number): [number, number] => {
    const want = Math.hypot(dx, dz)
    if (want === 0) return [cx, cz]
    const a = Math.atan2(dz, dx)
    let reach = Infinity
    let best = Infinity
    for (const [x, z] of outline) {
      let d = Math.abs(Math.atan2(z - cz, x - cx) - a)
      if (d > Math.PI) d = 2 * Math.PI - d
      if (d < best) {
        best = d
        reach = Math.hypot(x - cx, z - cz)
      }
    }
    const r = Math.min(want, Math.max(0, reach - inset))
    return [cx + (dx / want) * r, cz + (dz / want) * r]
  }
  switch (m.pedestal) {
    case 'tulip': {
      const chrome: Finish = { kind: 'metal', color: base }
      k.lathe(cx, 0, cz, [[0, 0], [1.3, 0], [1.3, 0.02], [1.2, 0.05], [0.8, 0.1], [0.4, 0.18], [0.2, 0.3], [0.16, 0.42], [0.2, 0.5], [0.45, 0.56], [0.7, h], [0, h]], chrome, { seg: 64 })
      break
    }
    case 'turned': {
      const oak: Finish = { ...rim, color: base }
      const [, zFar] = within(0, -1.6, 1.1)
      const [, zNear] = within(0, 1.6, 1.1)
      for (const z of [zFar, zNear]) {
        k.lathe(cx, 0, z, [[0, 0], [0.32, 0], [0.32, 0.06], [0.24, 0.08], [0.2, 0.12], [0.28, 0.2], [0.3, 0.26], [0.22, 0.34], [0.14, 0.4], [0.16, 0.48], [0.22, 0.52], [0.22, h], [0, h]], oak, { seg: 32 })
        k.lathe(cx, 0, z, [[0.33, 0], [0.33, 0.045]], metal, { seg: 32 })
      }
      k.finishBox(cx, 0.1, (zFar + zNear) / 2, 0.18, 0.12, zNear - zFar, oak)
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
        const [x, z] = within(sx * 1.35, sz * 2.1, 1.1)
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

/** One band of the floor's inlay: how far past the table's plan it reaches, tiles, and what it is laid in. */
export interface InlayBand {
  out: number
  color: Hex
  gloss?: number
  /** A band of light let into the floor: unlit, and only after the lamps are on (its own colour taken down before). */
  glow?: boolean
}

/**
 * The floor's inlay round the table's foot: bands laid one in the other, each
 * the table's own plan grown by `out`, so the ground under the table is a
 * drawn thing and the table stands in the middle of it. The floor round the
 * table is the frame of the board from where the camera stands, and a frame
 * left one colour is a table set down anywhere.
 *
 * Widest first whatever the order given; each a hair over the one under it,
 * the lowest on the floor's own level `y`.
 */
export function groundInlay(k: Kit, bands: readonly InlayBand[], y = 0) {
  const view = k.view
  if (!view || k.rig.snow || BARE) return
  const plan: [number, number][] = view.tableOutline(96).map(([x, , z]) => [x, z])
  const sorted = [...bands].sort((p, q) => q.out - p.out)
  sorted.forEach((b, i) => {
    const lit = b.glow && k.rig.lampsOn
    const color = b.glow ? (lit ? b.color : mix(b.color, 0x16121c, 0.6)) : k.ground(b.color)
    k.plate(offsetOutline(plan, b.out), y - 0.05, 0.052 + i * 0.003, color, { outline: false, cap: false, glow: lit, gloss: lit ? undefined : (b.gloss ?? 0) + k.wetGloss() })
  })
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
  /** Set a crown on the plain towers (on by default): a setback, and on some a mast with its light. Off for a band too far to show one. */
  crowns?: boolean
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
      // Piers up the face, a shade lighter than the wall: what makes a tower
      // a tower and not a crate with holes in it.
      if (o.ribbons ?? true) {
        const piers = Math.max(2, Math.round(tw / 5))
        for (let p = 0; p <= piers; p++) k.box(x - tw / 2 + (p / piers) * tw, y, z + td / 2 + 0.1, 0.55, hh, 0.2, mix(color, 0xffffff, 0.16), { outline: false, cap: false })
      }
      for (let f = 0; f < floors; f++) {
        k.box(x, y + f * 3.4 + 1.1, z + td / 2 + 0.03, tw * 0.9, 1.4, 0.06, mix(color, 0x0a1830, 0.45), { outline: false, cap: false, gloss: 0.6 })
        if (lit <= 0) continue
        for (let c = 0; c < cols; c++) {
          if (!rng.chance(lit)) continue
          const cx = x - tw / 2 + (c + 0.5) * (tw / cols)
          // A pane taller than it is wide: a row of lit squares was a punch card.
          k.box(cx, y + f * 3.4 + 0.9, z + td / 2 + 0.05, (tw / cols) * 0.36, 1.9, 0.1, mix(win, 0xffffff, rng.range(0, 0.3)), { glow: true, outline: false, cap: false })
        }
      }
      y += hh
      tw *= 0.72
      td *= 0.72
    }
    // A crown on a plain tower: a setback, on some a second and a mast with
    // its light, on some a band of light under the cornice. Drawn from the
    // tower's own place, so the room's sequence is what it was.
    const crown = spotChance(x, z)
    if ((o.crowns ?? true) && tiers === 1 && crown < 0.62) {
      k.box(x, y, z, w * 0.72, h * 0.07, d * 0.72, scale(color, 0.94), { cap: true, outline: false })
      if (lit > 0 && crown > 0.12 && crown < 0.4) k.box(x, y - 1.3, z + d / 2 + 0.14, w * 0.92, 0.8, 0.2, win, { glow: true, outline: false, cap: false })
      y += h * 0.07
      if (crown < 0.28) {
        k.box(x, y, z, w * 0.44, h * 0.06, d * 0.44, scale(color, 0.9), { cap: true, outline: false })
        y += h * 0.06
        k.cyl(x, y, z, Math.max(0.3, w * 0.04), h * 0.2, scale(color, 0.8), { seg: 5, rTop: 0.06, outline: false, cap: false })
        if (k.rig.lampsOn) k.sphere(x, y + h * 0.2, z, Math.max(0.45, w * 0.03), 0xff3b4f, { glow: true, seg: 6, outline: false })
      }
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
export function deck(k: Kit, z0: number, z1: number, width: number, a: Hex, b: Hex, o: { y?: number; plank?: number; gloss?: number } = {}) {
  const rng = k.rng
  const step = o.plank ?? 0.42
  for (let z = z0; z < z1; z += step) {
    const tone = rng.chance(0.3) ? b : mix(a, b, rng.range(0, 0.4))
    k.box(0, (o.y ?? 0) - 0.12, z + step / 2, width, 0.12, step * 0.9, k.ground(tone), { outline: false, cap: true, gloss: (o.gloss ?? 0) + k.wetGloss() })
  }
}

/**
 * A turned pot, `r` across at its widest and `h` tall, in a finish: what a
 * shrub by the table stands in. A box with a bush on it was the nearest thing
 * in three rooms.
 */
export function pot(k: Kit, x: number, z: number, r: number, h: number, finish: Finish, band?: Finish) {
  k.lathe(x, 0, z, [[0, 0], [r * 0.62, 0], [r * 0.66, h * 0.05], [r * 0.6, h * 0.1], [r * 0.82, h * 0.5], [r, h * 0.86], [r * 1.04, h * 0.94], [r * 1.04, h], [r * 0.9, h], [r * 0.86, h * 0.9], [0, h * 0.9]], finish, { seg: 28 })
  if (band) k.lathe(x, 0, z, [[r * 1.045, h * 0.93], [r * 1.06, h * 0.965], [r * 1.045, h]], band, { seg: 28 })
}

/** A barrel, turned and hooped: staves bellied in the middle, two iron bands. */
export function cask(k: Kit, x: number, z: number, wood: Finish, iron: Finish, s = 1) {
  k.lathe(x, 0, z, [[0, 0], [0.3 * s, 0], [0.36 * s, 0.2 * s], [0.39 * s, 0.45 * s], [0.36 * s, 0.7 * s], [0.3 * s, 0.9 * s], [0.27 * s, 0.9 * s], [0.27 * s, 0.87 * s], [0, 0.87 * s]], wood, { seg: 20 })
  for (const [r, y] of [[0.345, 0.14], [0.375, 0.66]] as const) k.lathe(x, 0, z, [[r * s, y * s], [(r + 0.012) * s, (y + 0.035) * s], [r * s + 0.004, (y + 0.07) * s]], iron, { seg: 20 })
}

/**
 * A brazier: an iron bowl on three turned legs, coals in it and, after dark,
 * a fire over them with its light on the ground. By day it is cold iron.
 */
export function brazier(k: Kit, x: number, z: number, iron: Finish) {
  const on = k.rig.lampsOn
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5
    k.lathe(x + Math.cos(a) * 0.3, 0, z + Math.sin(a) * 0.3, [[0.05, 0], [0.03, 0.2], [0.04, 0.5], [0.03, 0.84]], iron, { seg: 8 })
  }
  k.lathe(x, 0.78, z, [[0, 0], [0.16, 0.01], [0.34, 0.1], [0.44, 0.24], [0.47, 0.34], [0.43, 0.34], [0.4, 0.26], [0.3, 0.15], [0, 0.12]], iron, { seg: 24 })
  k.cyl(x, 0.98, z, 0.36, 0.1, on ? 0xff7a2a : 0x2a2422, { seg: 12, glow: on, outline: false, cap: false })
  if (!on) return
  // The fire: a round body of flame under two tongues, a paler heart inside
  // it. Deep colours: the bloom takes them up, and a pale flame came out a
  // flat yellow triangle.
  k.sphere(x, 1.16, z, 0.24, 0xff5a14, { seg: 10, glow: true, outline: false })
  k.cone(x, 1.2, z, 0.2, 0.62, 0xff5a14, { seg: 10, glow: true, outline: false, cap: false })
  k.cone(x + 0.12, 1.14, z - 0.05, 0.11, 0.4, 0xff7a1e, { seg: 8, glow: true, outline: false, cap: false })
  k.sphere(x - 0.02, 1.15, z + 0.06, 0.13, 0xffa63a, { seg: 8, glow: true, outline: false })
  k.cone(x - 0.02, 1.18, z + 0.06, 0.1, 0.3, 0xffa63a, { seg: 8, glow: true, outline: false, cap: false })
  k.halo(x, 1.3, z, 0.7, 0xffa24a, 0.34, false)
  k.pool(x, z, 4.6, 0xffa050, 0.5)
}

/** A mooring bollard, cast: a waisted post under a mushroom head. */
export function bollard(k: Kit, x: number, z: number, iron: Finish) {
  k.lathe(x, 0, z, [[0, 0], [0.3, 0], [0.3, 0.05], [0.22, 0.08], [0.17, 0.3], [0.18, 0.5], [0.28, 0.56], [0.3, 0.64], [0.24, 0.72], [0.12, 0.77], [0, 0.78]], iron, { seg: 20 })
}

/**
 * A string of bulbs hung between two points, sagging: the cord in short
 * straight runs, a bulb at each joint, lit after dark.
 */
export function festoon(k: Kit, a: V3, b: V3, sag: number, n: number, color: Hex) {
  const on = k.rig.lampsOn
  const at = (t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t]
  for (let i = 0; i < n; i++) {
    const p = at(i / n)
    const q = at((i + 1) / n)
    const len = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2])
    const rot = -Math.atan2(q[2] - p[2], q[0] - p[0])
    const tilt = Math.atan2(q[1] - p[1], Math.hypot(q[0] - p[0], q[2] - p[2]))
    k.box((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2, len, 0.025, 0.025, 0x1c1a22, { rot, tilt: tilt || 1e-6, outline: false, cap: false })
    if (i > 0) k.sphere(p[0], p[1] - 0.09, p[2], 0.075, on ? mix(color, 0xffffff, 0.35) : mix(color, 0x8a8a92, 0.5), { glow: on, seg: 8, outline: false })
  }
}

type Stroke = readonly (readonly [number, number])[]

/** Half a stadium's end: `n` points round `(cx, cy)` at radius `r`, from `a0` to `a1` degrees. */
function arc(cx: number, cy: number, r: number, a0: number, a1: number, n = 8): [number, number][] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as [number, number]
  })
}

/**
 * The letters a sign spells, as the lines a glass tube is bent along: each
 * glyph is its width in cells and its strokes, in cells, five tall, the tube
 * running half a cell inside the glyph's box. A bitmap font in blocks was
 * what this was, and at the distance a sign is read from, with the bloom on
 * it, a letter of lit squares came out a row of blobs.
 */
const GLYPHS: Record<string, { w: number; strokes: Stroke[] }> = {
  L: { w: 3, strokes: [[[0.5, 4.5], [0.5, 0.5], [2.5, 0.5]]] },
  O: { w: 3, strokes: [[...arc(1.5, 3.5, 1, 0, 180), ...arc(1.5, 1.5, 1, 180, 360), [2.5, 3.5]]] },
  C: { w: 3, strokes: [[...arc(1.5, 3.5, 1, 25, 180), ...arc(1.5, 1.5, 1, 180, 335)]] },
  '!': { w: 1, strokes: [[[0.5, 4.5], [0.5, 1.9]], [[0.5, 0.75], [0.5, 0.45]]] },
  ' ': { w: 1, strokes: [] },
}

/**
 * A word in neon tubes on a dark panel facing +z (rot 0). `cell` is a fifth
 * of a letter's height; `x, z` the panel's centre, `y` its bottom.
 *
 * Lit, each tube is its colour with a core near white in front of it — the
 * way a tube looks, hot along the middle, and what the bloom takes up — and
 * the glow round the word is the bloom's, never a halo sphere laid over it.
 */
export function neonText(k: Kit, text: string, x: number, y: number, z: number, cell: number, color: Hex, rot = 0) {
  const cols = [...text].reduce((w, ch) => w + (GLYPHS[ch]?.w ?? 1) + 1, -1)
  const on = k.rig.lampsOn
  const cos = Math.cos(rot)
  const sin = Math.sin(rot)
  /** A point on the panel: `lx` across, `ly` up, `lz` out of it towards the viewer. */
  const at = (lx: number, lz: number) => [x + lx * cos + lz * sin, z - lx * sin + lz * cos] as const
  const r = cell * 0.2
  const tube = (ax: number, ay: number, bx: number, by: number, radius: number, lz: number, c: Hex, glow: boolean) => {
    const len = Math.hypot(bx - ax, by - ay) + radius * 1.6
    const tilt = Math.atan2(by - ay, bx - ax)
    const [px, pz] = at((ax + bx) / 2, lz)
    const py = (ay + by) / 2
    // A tilted block is placed by its centre, an upright one by its bottom.
    k.box(px, tilt ? py : py - radius, pz, len, radius * 2, radius * 2, c, { rot, tilt, glow, outline: !glow, cap: false })
  }
  // The panel the tubes are mounted on: dark, so a letter reads against it
  // by day as well as lit.
  const pw = (cols + 1.2) * cell
  const [bx, bz] = at(0, -r * 2.2)
  k.box(bx, y - 0.4 * cell, bz, pw, 5.8 * cell, 0.12 * cell + 0.05, mix(color, 0x16121c, 0.86), { rot, cap: false })
  // Unlit, the letters keep their colour a shade down: grey, the brand's
  // own sign was the one thing on the square nobody could read by day.
  const glass = on ? color : mix(color, 0x2a2a35, 0.3)
  const core = mix(color, 0xffffff, 0.55)
  let cx = -cols / 2
  for (const ch of text) {
    const g = GLYPHS[ch] ?? GLYPHS[' ']
    for (const stroke of g.strokes) {
      for (let i = 1; i < stroke.length; i++) {
        const [ax, ay] = stroke[i - 1]
        const [ex, ey] = stroke[i]
        const p0 = [(cx + ax) * cell, y + ay * cell] as const
        const p1 = [(cx + ex) * cell, y + ey * cell] as const
        tube(p0[0], p0[1], p1[0], p1[1], r, 0, glass, on)
        if (on) tube(p0[0], p0[1], p1[0], p1[1], r * 0.45, r * 0.75, core, true)
      }
    }
    cx += g.w + 1
  }
}
