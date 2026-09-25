/**
 * The grain of the table's materials, as pixels: what the render's table is
 * textured with (`kit.ts: Kit.sweep` / `Kit.lathe`, `docs/notes/visual.md`,
 * "The table"). The CSS rim draws the same materials with its own noise
 * (`cards/tableSurface.ts`); this is its counterpart for the faces the CSS
 * cannot reach — the edge going down, the pedestal.
 *
 * Pure and seeded, three-free: a square RGBA tile that repeats without a seam
 * (the noise is periodic on the tile), the same every time for the same
 * material. `u` runs along the piece (along the edge, round the pedestal), `v`
 * across it.
 */
import type { Hex } from './sky'

export type GrainKind = 'straight' | 'burl' | 'lacquer' | 'brushed' | 'marble'

export interface GrainSpec {
  kind: GrainKind
  /** The material's colour. */
  base: Hex
  /** Its second colour: the rings, the depth, the scratches, the veins. */
  grain: Hex
  /** Metal sown in the finish, if any. */
  fleck?: Hex
  seed?: number
}

function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

/** Value noise on a lattice that wraps every `px` × `py` cells, so the tile repeats. */
function noise(x: number, y: number, px: number, py: number, seed: number): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  const w = (i: number, j: number) => hash(((x0 + i) % px + px) % px, ((y0 + j) % py + py) % py, seed)
  const a = w(0, 0) + (w(1, 0) - w(0, 0)) * sx
  const b = w(0, 1) + (w(1, 1) - w(0, 1)) * sx
  return a + (b - a) * sy
}

/** Octaves of that noise, `fx` × `fy` cells across the tile at the first. */
function fbm(u: number, v: number, fx: number, fy: number, octaves: number, seed: number): number {
  let sum = 0
  let amp = 0.5
  let norm = 0
  for (let o = 0; o < octaves; o++) {
    const k = 1 << o
    sum += amp * noise(u * fx * k, v * fy * k, fx * k, fy * k, seed + o * 17)
    norm += amp
    amp *= 0.5
  }
  return sum / norm
}

const channels = (c: Hex): [number, number, number] => [(c >> 16) & 255, (c >> 8) & 255, c & 255]

/** How much of `grain` over `base` at (u, v), 0–1, and whether a fleck lands there. */
function sample(kind: GrainKind, u: number, v: number, seed: number): [number, boolean] {
  switch (kind) {
    case 'straight': {
      // Rings running along u, wandering: the level lines of a stretched noise.
      const warp = fbm(u, v, 2, 6, 3, seed)
      const ring = Math.pow(0.5 + 0.5 * Math.cos(2 * Math.PI * (v * 9 + warp * 4)), 2.4)
      const pores = fbm(u, v, 8, 96, 2, seed + 101) > 0.62 ? 0.35 : 0
      return [Math.min(1, ring * 0.55 + pores), false]
    }
    case 'burl': {
      const n = fbm(u, v, 5, 5, 4, seed)
      const ring = Math.pow(0.5 + 0.5 * Math.cos(2 * Math.PI * n * 7), 1.5)
      const eye = fbm(u, v, 24, 24, 2, seed + 7) > 0.7 ? 0.8 : 0
      return [Math.min(1, ring * 0.6 + eye), false]
    }
    case 'lacquer': {
      const cloud = fbm(u, v, 3, 3, 3, seed)
      return [Math.max(0, cloud - 0.35) * 0.9, hash(Math.floor(u * 256), Math.floor(v * 256), seed + 3) > 0.985]
    }
    case 'brushed': {
      const line = fbm(u, v, 2, 128, 2, seed)
      return [Math.max(0, line - 0.3) * 0.8, false]
    }
    case 'marble': {
      const warp = fbm(u, v, 3, 3, 4, seed)
      const vein = Math.pow(1 - Math.abs(Math.sin((u * 2 + v + warp * 3) * Math.PI)), 10)
      const fine = Math.pow(1 - Math.abs(Math.sin((u * 5 - v * 2 + warp * 6) * Math.PI)), 24) * 0.5
      return [Math.min(1, vein + fine), false]
    }
  }
}

/** The tile, `size` × `size`, RGBA, sRGB bytes. */
export function grainPixels(spec: GrainSpec, size = 256): Uint8Array {
  const out = new Uint8Array(size * size * 4)
  const b = channels(spec.base)
  const g = channels(spec.grain)
  const f = spec.fleck === undefined ? null : channels(spec.fleck)
  const seed = spec.seed ?? 1
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [t, fleck] = sample(spec.kind, x / size, y / size, seed)
      const i = (y * size + x) * 4
      const c = fleck && f ? f : null
      out[i] = c ? c[0] : Math.round(b[0] + (g[0] - b[0]) * t)
      out[i + 1] = c ? c[1] : Math.round(b[1] + (g[1] - b[1]) * t)
      out[i + 2] = c ? c[2] : Math.round(b[2] + (g[2] - b[2]) * t)
      out[i + 3] = 255
    }
  }
  return out
}
