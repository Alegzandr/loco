/**
 * Where things may stand: the ground plan of a room, kept so nothing is built
 * inside anything else.
 *
 * Every prop the kit places claims a footprint — a rectangle on the ground,
 * rotated like the prop — and a claim that overlaps one already made is
 * refused. A builder asks before it builds and moves on when the answer is
 * no; a room composed this way has houses beside each other rather than
 * through each other, a boat that is not moored in a lighthouse, and a lamp
 * that is not standing in a tree. Zones (the table's plaza, the water, a road)
 * are claims too, made first, so nothing is built on them either.
 *
 * Overlap is the separating-axis test on two oriented rectangles, with a
 * margin so two things that merely touch are still two things. Pure
 * arithmetic, no three.js: `placer.test.ts`.
 */

export interface Footprint {
  /** Centre on the ground. */
  x: number
  z: number
  /** Extent along the prop's own axes. */
  w: number
  d: number
  /** Rotation about y, radians, the kit's convention. */
  rot: number
}

type Corners = [number, number][]

function corners(f: Footprint, margin: number): Corners {
  const c = Math.cos(f.rot)
  const s = Math.sin(f.rot)
  const hw = f.w / 2 + margin
  const hd = f.d / 2 + margin
  const out: Corners = []
  for (const [lx, lz] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]] as const) {
    // `rotateY(rot)` sends +x to (cos, 0, −sin) and +z to (sin, 0, cos).
    out.push([f.x + lx * c + lz * s, f.z - lx * s + lz * c])
  }
  return out
}

function axes(c: Corners): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i < 2; i++) {
    const dx = c[i + 1][0] - c[i][0]
    const dz = c[i + 1][1] - c[i][1]
    const len = Math.hypot(dx, dz) || 1
    out.push([-dz / len, dx / len])
  }
  return out
}

function project(c: Corners, [ax, az]: [number, number]): [number, number] {
  let lo = Infinity
  let hi = -Infinity
  for (const [x, z] of c) {
    const p = x * ax + z * az
    if (p < lo) lo = p
    if (p > hi) hi = p
  }
  return [lo, hi]
}

/** True when the two rectangles overlap, one of them grown by `margin`. */
export function overlaps(a: Footprint, b: Footprint, margin = 0): boolean {
  const ca = corners(a, margin)
  const cb = corners(b, 0)
  for (const axis of [...axes(ca), ...axes(cb)]) {
    const [alo, ahi] = project(ca, axis)
    const [blo, bhi] = project(cb, axis)
    if (ahi < blo || bhi < alo) return false
  }
  return true
}

export class Placer {
  private claims: Footprint[] = []
  /** Cells of a coarse grid, for not testing every claim against every ask. */
  private grid = new Map<string, Footprint[]>()
  private readonly cell = 8

  constructor(readonly margin = 0.3) {}

  private keysOf(f: Footprint): string[] {
    const r = Math.hypot(f.w, f.d) / 2 + this.margin
    const keys: string[] = []
    for (let i = Math.floor((f.x - r) / this.cell); i <= Math.floor((f.x + r) / this.cell); i++) {
      for (let j = Math.floor((f.z - r) / this.cell); j <= Math.floor((f.z + r) / this.cell); j++) keys.push(`${i},${j}`)
    }
    return keys
  }

  /** True when nothing claimed so far overlaps `f`. */
  free(f: Footprint): boolean {
    const seen = new Set<Footprint>()
    for (const key of this.keysOf(f)) {
      for (const other of this.grid.get(key) ?? []) {
        if (seen.has(other)) continue
        seen.add(other)
        if (overlaps(f, other, this.margin)) return false
      }
    }
    return true
  }

  /** Claims `f` unconditionally: a zone, or something already built. */
  claim(f: Footprint) {
    this.claims.push(f)
    for (const key of this.keysOf(f)) {
      const list = this.grid.get(key)
      if (list) list.push(f)
      else this.grid.set(key, [f])
    }
  }

  /** Claims `f` if it is free. The answer is whether it was. */
  place(f: Footprint): boolean {
    if (!this.free(f)) return false
    this.claim(f)
    return true
  }

  get count(): number {
    return this.claims.length
  }
}
