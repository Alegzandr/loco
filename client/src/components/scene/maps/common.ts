/**
 * What every diorama shares: the podium the table stands on, the street grid
 * a room is laid out on, and the scatter helpers that make a place look lived
 * in.
 *
 * Composition is done in screen space. The camera is isometric: screen right
 * is world `(1, -1)`, screen up is world `(-1, -1)`, and a ground point lands
 * at `sx = (x - z) / √2` across and `sy = -(x + z) / √2 · sin(pitch)` up, in
 * tiles; `at()` goes the other way. On a monitor the frame ends at `|sx| = 40`
 * and `|sy| = 22.5`; the table hides an ellipse around `k.anchor` (about
 * ±27 by ±12.5), the hand covers the bottom middle and the seat pills the top
 * middle. So the things meant to be seen stand in the two side bands (`sx`
 * ±28 to ±38) and the top band (`sy` 13 to 20), and the grid fills every
 * corner behind them. On a phone the sides are the table's edge and the top
 * and bottom bands are deep.
 */
import type { Kit, Anchor } from '../kit'
import type { Hex } from '../sky'
import { mix } from '../sky'

export type Builder = (k: Kit) => void

/** The ground's side, enough to run past every corner of every frame. */
export const FLOOR = 240
const PITCH_SIN = Math.sin((32 * Math.PI) / 180)

/** The ground point that lands at screen `(sx, sy)`, in tiles, `sy` up. */
export function at(sx: number, sy: number): [number, number] {
  const across = sx * Math.SQRT2
  const along = (-sy * Math.SQRT2) / PITCH_SIN
  return [(across + along) / 2, (along - across) / 2]
}

/** Where a ground point lands on screen. */
export function screenOf(x: number, z: number): [number, number] {
  return [(x - z) / Math.SQRT2, (-(x + z) / Math.SQRT2) * PITCH_SIN]
}

/** True inside the screen ellipse the table covers, plus `margin` tiles. */
export function underTable(k: Kit, x: number, z: number, margin = 0): boolean {
  const [sx, sy] = screenOf(x, z)
  const { anchor: a } = k
  const dx = (sx - a.sx) / (a.a + margin)
  const dy = (sy - a.sy) / (a.b + margin * PITCH_SIN)
  return dx * dx + dy * dy < 1
}

// ─── The podium ─────────────────────────────────────────────────────────────

export interface PodiumStyle {
  /** The drum's stone. */
  stone: Hex
  /** The steps around it. */
  step: Hex
  /** The plaza's floor under the steps, two tones. */
  floor: Hex
  floor2: Hex
  /** The light set into the drum's top edge, and pooled on the floor. */
  accent: Hex
  /**
   * The drum's top face: the room's felt, so the loading screen (which draws
   * no table) shows an empty table where the match will be dealt rather than
   * a dark drum, and a frame in which the CSS table is a pixel out lands on
   * its own colour.
   */
  top: Hex
  /** How tall the drum stands, in tiles. */
  height?: number
}

/**
 * What the table stands on: an elliptical drum whose top face lands exactly
 * under the CSS felt, two steps around it, and the plaza they sit on.
 *
 * This is the join between the two halves of the room. The felt is a screen
 * ellipse (`k.anchor`, from `layout.ts: feltInViewport`), a screen ellipse is
 * a ground ellipse with semi-axes `a` across and `b / sin(pitch)` along, and a
 * drum of height `h` shows its top `h · cos(pitch)` higher on screen than its
 * base — so the base is placed that far *below* the anchor and the top comes
 * out under the table to the pixel, with the drum's side showing beneath the
 * table's lower rim. The table's own CSS shadow then falls on the top step.
 */
export function podium(k: Kit, s: PodiumStyle): { cx: number; cz: number; r: number } {
  const { sx, sy, a, b } = k.anchor
  const h = s.height ?? 2.4
  const rot = Math.PI / 4
  const lift = h * Math.cos((32 * Math.PI) / 180)
  const along = (v: number) => v / PITCH_SIN
  // The plaza floor: a wide oval of paving around the steps.
  const [fx, fz] = at(sx, sy)
  const R = Math.max(a, b) + 14
  k.oval(fx, 0.02, fz, R + 4, along(b + 5) + 6, 0.08, k.ground(s.floor), { rot, outline: false, cap: false })
  for (let i = 0; i < 3; i++) {
    const ra = a + 5 + i * 3
    const rb = along(b + 2.5) + i * 3 * 0.9
    const n = Math.round(ra * 3)
    for (let j = 0; j < n; j++) {
      const t = (j / n) * Math.PI * 2
      const lx = Math.cos(t) * ra
      const lz = Math.sin(t) * rb
      const px = fx + lx * Math.cos(rot) + lz * Math.sin(rot)
      const pz = fz - lx * Math.sin(rot) + lz * Math.cos(rot)
      k.slab(px, pz, 1.4, 1.0, k.ground(j % 2 ? s.floor : s.floor2), { h: 0.06, y: 0.06, rot: rot - t })
    }
  }
  // Steps, then the drum, each placed so its top lands where the table is.
  const [s2x, s2z] = at(sx, sy - 0.8 * Math.cos((32 * Math.PI) / 180))
  k.oval(s2x, 0, s2z, a + 3.2, along(b + 1.7), 0.8, s.step, { rot })
  const [s1x, s1z] = at(sx, sy - 1.5 * Math.cos((32 * Math.PI) / 180))
  k.oval(s1x, 0.8, s1z, a + 1.6, along(b + 0.85), 0.7, mix(s.step, s.stone, 0.4), { rot })
  const [dx, dz] = at(sx, sy - lift)
  k.oval(dx, 1.5, dz, a - 0.2, along(b - 0.1), h - 1.5, s.stone, { rot })
  // The top face, then the inlay: a band of the room's light around its edge.
  k.oval(dx, h - 0.3, dz, a - 0.6, along(b - 0.3), 0.32, s.top, { rot, outline: false, cap: false })
  const on = k.rig.lampsOn
  k.oval(dx, h - 0.42, dz, a - 0.1, along(b - 0.05), 0.16, on ? s.accent : mix(s.accent, s.stone, 0.6), { rot, glow: on, outline: false, cap: false })
  if (on) {
    k.halo(fx, 0.12, fz, Math.max(a, b) + 6, s.accent, 0.16)
  }
  return { cx: fx, cz: fz, r: R }
}

// ─── The street grid ────────────────────────────────────────────────────────

export interface Cell {
  /** Centre and footprint of the block, in tiles. */
  x: number
  z: number
  w: number
  d: number
  /** Grid indices. */
  i: number
  j: number
  /** Where the block's centre lands on screen. */
  sx: number
  sy: number
  /** Distance from the table's centre on screen, in tiles across. */
  dist: number
  /**
   * The block stands in front of the table, close enough that a building of
   * the map's full height would rise into the felt. The table is drawn over
   * the render, so anything there would be cut by an object that is farther
   * from the camera than it is; a builder keeps this band low.
   */
  front: boolean
}

export interface GridSpec {
  /** A block's side, in tiles. */
  block: number
  /** A road's width, in tiles. */
  road: number
  /** Half the extent covered, in tiles. */
  extent?: number
  /** What is built on a block. */
  fill: (cell: Cell) => void
  /** Leaves the block empty (the plaza, the sea) when it returns false. */
  land?: (cell: Cell) => boolean
  roadColor: Hex
  sidewalk?: Hex
  dashes?: boolean
  /** Crosswalks at every intersection. */
  crossings?: boolean
  /** Cars, in these colours, scattered along the roads. */
  cars?: readonly Hex[]
  /** How many cars per road segment, on average. */
  carDensity?: number
  /** A lamp at every intersection's corner. */
  lamp?: Parameters<Kit['lamp']>[2]
  /** People per block, on average, on the sidewalks. */
  people?: number
  /** One road line is water instead, with a bridge at every crossing. */
  water?: { line: number; axis: 'x' | 'z'; color: Hex; bank: Hex; bridge: Hex }
  /** The tallest thing `fill` builds, in tiles: what decides the `front` band. */
  maxHeight?: number
}

/**
 * A city block grid over the whole floor, minus the plaza: roads on the lines,
 * `spec.fill` on the blocks, cars, crossings, lamps and people along the way.
 * What the example the room is modelled on is made of — many small buildings,
 * roads between them, something on every corner.
 */
export function cityGrid(k: Kit, spec: GridSpec) {
  const pitch = spec.block + spec.road
  const extent = spec.extent ?? 96
  const n = Math.ceil(extent / pitch)
  const { sx: ax, sy: ay } = k.anchor
  const cellAt = (i: number, j: number): Cell => {
    const x = i * pitch
    const z = j * pitch
    const [sx, sy] = screenOf(x, z)
    const { a, b } = k.anchor
    const rise = (spec.maxHeight ?? 6) * Math.cos((32 * Math.PI) / 180)
    const front = sy < ay && sy + rise > ay - b - 3 && Math.abs(sx - ax) < a + spec.block * 0.6
    return { x, z, w: spec.block, d: spec.block, i, j, sx, sy, dist: Math.hypot(sx - ax, (sy - ay) / PITCH_SIN), front }
  }
  const isLand = (c: Cell) => (spec.land ? spec.land(c) : true) && !underTable(k, c.x, c.z, 9)
  const isWater = (axis: 'x' | 'z', line: number) => spec.water && spec.water.axis === axis && spec.water.line === line

  // Roads, one segment per block side so the sea and the plaza can cut them.
  const half = pitch / 2
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const c = cellAt(i, j)
      if (!isLand(c) && underTable(k, c.x, c.z, 4)) continue
      const land = isLand(c) || (spec.land ? spec.land(c) : true)
      if (!land) continue
      // The segment along x on this block's -z side, and along z on its -x side.
      const rx = c.x, rz = c.z - half
      const ex = c.x - half, ez = c.z
      if (isWater('x', j)) {
        water(k, rx, rz, pitch, spec.road, 0, spec.water!)
      } else {
        k.road(rx, rz, pitch, spec.road, { color: spec.roadColor, sidewalk: spec.sidewalk, dashes: spec.dashes ?? true })
      }
      if (isWater('z', i)) {
        water(k, ex, ez, pitch, spec.road, Math.PI / 2, spec.water!)
      } else {
        k.road(ex, ez, pitch, spec.road, { rot: Math.PI / 2, color: spec.roadColor, sidewalk: spec.sidewalk, dashes: spec.dashes ?? true })
      }
      // The intersection at the block's -x -z corner: a bridge over water, or
      // a crossing and a lamp.
      const ix = c.x - half, iz = c.z - half
      if (isWater('x', j) || isWater('z', i)) {
        const along = isWater('x', j) ? Math.PI / 2 : 0
        bridge(k, ix, iz, spec.road + 1.2, spec.road, along, spec.water!)
      } else {
        if (spec.crossings) {
          for (const s of [-1, 1]) {
            for (let t = 0; t < 4; t++) {
              k.slab(ix + s * (spec.road / 2 + 0.6), iz - 1.2 + t * 0.8, 0.9, 0.4, 0xf2e6b5, { y: 0.06, h: 0.02 })
              k.slab(ix - 1.2 + t * 0.8, iz + s * (spec.road / 2 + 0.6), 0.4, 0.9, 0xf2e6b5, { y: 0.06, h: 0.02 })
            }
          }
        }
        if (spec.lamp && k.rng.chance(0.7)) k.lamp(ix + spec.road / 2 + 0.7, iz + spec.road / 2 + 0.7, spec.lamp)
      }
      // Cars on this block's two road segments.
      if (spec.cars && (spec.carDensity ?? 0.5) > 0) {
        const density = spec.carDensity ?? 0.5
        if (k.rng.chance(density) && !isWater('x', j)) {
          const side = k.rng.chance(0.5) ? 1 : -1
          const cx = rx + k.rng.range(-half + 2, half - 2)
          if (!underTable(k, cx, rz, 3)) k.car(cx, rz + side * (spec.road / 4), side > 0 ? 0 : Math.PI, k.rng.pick(spec.cars))
        }
        if (k.rng.chance(density) && !isWater('z', i)) {
          const side = k.rng.chance(0.5) ? 1 : -1
          const cz = ez + k.rng.range(-half + 2, half - 2)
          if (!underTable(k, ex, cz, 3)) k.car(ex + side * (spec.road / 4), cz, side > 0 ? Math.PI / 2 : -Math.PI / 2, k.rng.pick(spec.cars))
        }
      }
    }
  }

  // Blocks.
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const c = cellAt(i, j)
      if (!isLand(c)) continue
      spec.fill(c)
      if (spec.people) {
        const count = Math.round(k.rng.range(0, spec.people * 2))
        for (let p = 0; p < count; p++) {
          const edge = k.rng.int(0, 3)
          const t = k.rng.range(-spec.block / 2 + 1, spec.block / 2 - 1)
          const off = spec.block / 2 + 0.7
          const px = edge === 0 ? c.x + t : edge === 1 ? c.x + off : edge === 2 ? c.x + t : c.x - off
          const pz = edge === 0 ? c.z - off : edge === 1 ? c.z + t : edge === 2 ? c.z + off : c.z + t
          k.person(px, pz, k.rng.range(0, Math.PI * 2))
        }
      }
    }
  }
}

function water(k: Kit, x: number, z: number, len: number, w: number, rot: number, s: NonNullable<GridSpec['water']>) {
  k.slab(x, z, len, w + 1.4, s.color, { rot, y: -0.06, h: 0.06, outline: false })
  k.slab(x, z, len, w + 2.2, s.bank, { rot, y: -0.1, h: 0.02, outline: false })
  for (let i = 0; i < 6; i++) {
    const t = k.rng.range(-len / 2, len / 2)
    const off = k.rng.range(-w / 3, w / 3)
    k.slab(x + t * Math.cos(rot) + off * Math.sin(rot), z - t * Math.sin(rot) + off * Math.cos(rot), k.rng.range(0.4, 1), 0.14, mix(s.color, 0xffffff, 0.5), { rot, y: 0.01, h: 0.02, outline: false })
  }
}

function bridge(k: Kit, x: number, z: number, len: number, w: number, rot: number, s: NonNullable<GridSpec['water']>) {
  k.box(x, 0, z, len, 0.4, w, s.bridge, { rot })
  for (const side of [-1, 1]) {
    k.box(x + side * (w / 2) * Math.sin(rot), 0.4, z + side * (w / 2) * Math.cos(rot), len, 0.6, 0.12, s.bridge, { rot, cap: false, outline: false })
  }
}

/** Splits a block into `nx × nz` lots with a gap between them. */
export function lots(c: Cell, nx: number, nz: number, gap = 1): { x: number; z: number; w: number; d: number }[] {
  const out = []
  const w = (c.w - gap * (nx - 1)) / nx
  const d = (c.d - gap * (nz - 1)) / nz
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      out.push({ x: c.x - c.w / 2 + w / 2 + i * (w + gap), z: c.z - c.d / 2 + d / 2 + j * (d + gap), w, d })
    }
  }
  return out
}

/** Calls `fn` at `n` points on a ring of radius `r` around `(cx, cz)` (jittered). */
export function ring(k: Kit, n: number, r: number, fn: (x: number, z: number, angle: number, i: number) => void, jitter = 0.35, cx = 0, cz = 0) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + k.rng.range(-jitter, jitter)
    const rr = r + k.rng.range(-jitter * 2, jitter * 2)
    fn(cx + Math.cos(a) * rr, cz + Math.sin(a) * rr, a, i)
  }
}

/** People standing around the table's podium, facing it, on the plaza's rim. */
export function crowd(k: Kit, n: number, opts?: Parameters<Kit['person']>[3]) {
  const { sx, sy, a, b } = k.anchor
  for (let i = 0; i < n; i++) {
    const t = k.rng.next() * Math.PI * 2
    const m = k.rng.range(4, 9)
    const [x, z] = at(sx + Math.cos(t) * (a + m), sy + Math.sin(t) * (b + m * PITCH_SIN))
    const [cx, cz] = at(sx, sy)
    k.person(x, z, Math.atan2(cx - x, cz - z) + k.rng.range(-0.6, 0.6), opts)
  }
}

/** A run of the same small thing along a line, `n` of them. */
export function along(x1: number, z1: number, x2: number, z2: number, n: number, fn: (x: number, z: number, t: number) => void) {
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1)
    fn(x1 + (x2 - x1) * t, z1 + (z2 - z1) * t, t)
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
        k.box(x + lx * Math.cos(rot), ly - cell / 2, z - lx * Math.sin(rot), cell * 0.92, cell * 0.92, cell * 0.4, on ? color : 0x6a6f7a, { rot, glow: on, outline: !on, cap: false })
      }
    }
    cx += g[0].length + 1
  }
  if (on) k.halo(x, y + 2.5 * cell, z, cols * cell * 0.55, color, 0.25, false)
}

export type { Anchor }
