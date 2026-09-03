/**
 * Turning a loaded model into something the kit can place: arithmetic on
 * buffers, no loader and no DOM, so it is testable.
 *
 * A Kenney model is one mesh, flat-shaded, painted by a 512 px palette
 * texture: every face's UV lands on one flat patch of colour. Baking that
 * colour into the vertices (`bakeColors`) is what lets an imported model go
 * through exactly the pipeline a block does — one unlit material, the tone
 * of the hour multiplied in by the kit, the merge into one mesh — instead of
 * a second material path with a texture, a light and its own look. A model
 * with no texture carries its colour as a material factor, read the same way.
 *
 * The outline is an inflated copy drawn back-face only, like every block's,
 * but a model's faces do not share vertices and a push along each face's own
 * normal opens the corners. `smoothNormals` averages the normals of every
 * face meeting at a position, which closes them (`hullFor`).
 */
import type { Hex } from '../sky'

export interface Baked {
  /** Tile units, the model's own origin, `y` from 0 at the ground. */
  position: Float32Array
  normal: Float32Array
  /** Base colour per vertex, 0–1. */
  color: Float32Array
  /** One flag per vertex: this face is a lit window, a lamp, a sign. */
  glow: Uint8Array
  index: Uint32Array
  /** Averaged over every face at the same position: what the outline is pushed along. */
  smooth: Float32Array
  /** Footprint and height, in tiles. */
  w: number
  h: number
  d: number
}

/** A colour's distance in 0–255 RGB space, cheap and good enough for a palette. */
export function colorDistance(r: number, g: number, b: number, hex: Hex): number {
  return Math.abs(r * 255 - ((hex >> 16) & 255)) + Math.abs(g * 255 - ((hex >> 8) & 255)) + Math.abs(b * 255 - (hex & 255))
}

/** True when the colour is within `tolerance` (summed channels, 0–765) of any key. */
export function matchesKey(r: number, g: number, b: number, keys: readonly Hex[], tolerance = 60): boolean {
  for (const k of keys) if (colorDistance(r, g, b, k) <= tolerance) return true
  return false
}

/**
 * Per-position averaged normals. Positions are matched to a thousandth, which
 * is far under a model's smallest feature and over any float noise.
 */
export function smoothNormals(position: Float32Array, index: Uint32Array): Float32Array {
  const n = position.length / 3
  const acc = new Map<string, [number, number, number]>()
  /** Which face directions a position has already counted: a quad is two triangles and must weigh as one face. */
  const seen = new Map<string, Set<string>>()
  const keyOf = (i: number) => `${Math.round(position[i * 3] * 1000)},${Math.round(position[i * 3 + 1] * 1000)},${Math.round(position[i * 3 + 2] * 1000)}`
  const keys: string[] = new Array(n)
  for (let i = 0; i < n; i++) keys[i] = keyOf(i)
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t], b = index[t + 1], c = index[t + 2]
    const ax = position[a * 3], ay = position[a * 3 + 1], az = position[a * 3 + 2]
    const bx = position[b * 3] - ax, by = position[b * 3 + 1] - ay, bz = position[b * 3 + 2] - az
    const cx = position[c * 3] - ax, cy = position[c * 3 + 1] - ay, cz = position[c * 3 + 2] - az
    let nx = by * cz - bz * cy, ny = bz * cx - bx * cz, nz = bx * cy - by * cx
    const len = Math.hypot(nx, ny, nz)
    if (len < 1e-12) continue
    nx /= len
    ny /= len
    nz /= len
    const fk = `${Math.round(nx * 100)},${Math.round(ny * 100)},${Math.round(nz * 100)}`
    for (const v of [a, b, c]) {
      const k = keys[v]
      let faces = seen.get(k)
      if (!faces) {
        faces = new Set()
        seen.set(k, faces)
      }
      if (faces.has(fk)) continue
      faces.add(fk)
      const s = acc.get(k)
      if (s) {
        s[0] += nx
        s[1] += ny
        s[2] += nz
      } else acc.set(k, [nx, ny, nz])
    }
  }
  const out = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const s = acc.get(keys[i])
    if (!s) continue
    const len = Math.hypot(s[0], s[1], s[2]) || 1
    out[i * 3] = s[0] / len
    out[i * 3 + 1] = s[1] / len
    out[i * 3 + 2] = s[2] / len
  }
  return out
}

/**
 * The outline hull: the positions pushed `t` along the smoothed normals, in
 * the same units as `position`.
 */
export function hullFor(b: Baked, t: number): Float32Array {
  const out = new Float32Array(b.position.length)
  for (let i = 0; i < b.position.length; i++) out[i] = b.position[i] + b.smooth[i] * t
  return out
}

/**
 * Splits the index into the faces that glow and the faces that do not, by the
 * flag of their first vertex: a Kenney face is one flat colour, so its three
 * vertices agree.
 */
export function splitGlow(b: Baked): { lit: Uint32Array; glow: Uint32Array } {
  const lit: number[] = []
  const glow: number[] = []
  for (let t = 0; t < b.index.length; t += 3) {
    const target = b.glow[b.index[t]] ? glow : lit
    target.push(b.index[t], b.index[t + 1], b.index[t + 2])
  }
  return { lit: Uint32Array.from(lit), glow: Uint32Array.from(glow) }
}

/** Bounds of a position buffer. */
export function bounds(position: Float32Array): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < position.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = position[i + k]
      if (v < min[k]) min[k] = v
      if (v > max[k]) max[k] = v
    }
  }
  return { min, max }
}
