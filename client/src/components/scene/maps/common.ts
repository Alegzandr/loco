/**
 * What every diorama shares: the shape of the plaza the table sits on, and the
 * scatter helpers that make a place look lived in.
 *
 * The table is drawn in CSS over the centre of the frame and hides most of the
 * plaza on every screen, so every builder keeps `PLAZA_R` tiles around the
 * origin clear of anything taller than a bench, fills the plaza's floor with a
 * pattern that survives being mostly covered, and stands what is meant to be
 * seen between `INNER` and `OUTER`.
 */
import type { Kit } from '../kit'
import type { Hex } from '../sky'

export type Builder = (k: Kit) => void

/**
 * Where things stand.
 *
 * The camera is isometric: screen right is world `(1, -1)`, screen up is world
 * `(-1, -1)`, and a ground point lands at `sx = (x - z) / √2` across and
 * `sy = -(x + z) / √2 · sin(pitch)` up, in tiles. Composition is done in that
 * screen space with `at()`, because that is where the table is: on a monitor
 * it hides `|sx| < 27` and `|sy| < 12.5`, the frame ends at `|sx| = 40` and
 * `|sy| = 22.5`, the hand covers the bottom middle and the seat pills the top
 * middle. So the things meant to be seen stand in the two side bands
 * (`sx` ±30 to ±38) and the top band (`sy` 14 to 20), and a ring of radius
 * `r` in world tiles shows as an ellipse `r` wide and `0.53 r` tall around the
 * table — INNER just outside it, OUTER at the frame's edge, FAR in its corners.
 * On a phone the sides are the table's edge and the top and bottom bands are
 * deep, so the rings are what a phone sees.
 */
export const PLAZA_R = 32
export const INNER = 34
export const MID = 40
export const OUTER = 50
export const FAR = 64
/** The ground's side, enough to run past every corner of every frame. */
export const FLOOR = 220
const PITCH_SIN = Math.sin((32 * Math.PI) / 180)

/** The ground point that lands at screen `(sx, sy)`, in tiles, `sy` up. */
export function at(sx: number, sy: number): [number, number] {
  const across = sx * Math.SQRT2
  const along = (-sy * Math.SQRT2) / PITCH_SIN
  return [(across + along) / 2, (along - across) / 2]
}

/** Calls `fn` at `n` points on a ring of radius `r` (jittered). */
export function ring(k: Kit, n: number, r: number, fn: (x: number, z: number, angle: number, i: number) => void, jitter = 0.35) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + k.rng.range(-jitter, jitter)
    const rr = r + k.rng.range(-jitter * 2, jitter * 2)
    fn(Math.cos(a) * rr, Math.sin(a) * rr, a, i)
  }
}

/** People standing around, facing roughly the centre. */
export function crowd(k: Kit, n: number, minR: number, maxR: number, opts?: Parameters<Kit['person']>[3]) {
  for (let i = 0; i < n; i++) {
    const a = k.rng.next() * Math.PI * 2
    const r = k.rng.range(minR, maxR)
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r
    k.person(x, z, Math.atan2(-x, -z) + k.rng.range(-0.8, 0.8), opts)
  }
}

/**
 * A chequered paving over a square, two tones. `skip` leaves out the tiles
 * within that radius of the centre: under the table, on every screen.
 */
export function paving(k: Kit, x: number, z: number, size: number, a: Hex, b: Hex, tile = 2, rot = 0, skip = 0) {
  const n = Math.round(size / tile)
  k.slab(x, z, size, size, k.ground(a), { h: 0.06, rot })
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const lx = -size / 2 + (i + 0.5) * tile
      const lz = -size / 2 + (j + 0.5) * tile
      if (Math.abs(lx - lz) < skip && Math.abs(lx + lz) < skip * 0.85) continue
      const px = x + lx * Math.cos(rot) + lz * Math.sin(rot)
      const pz = z - lx * Math.sin(rot) + lz * Math.cos(rot)
      k.slab(px, pz, tile - 0.08, tile - 0.08, k.ground((i + j) % 2 ? a : b), { h: 0.1, y: 0.02, rot })
    }
  }
}

/**
 * A round plaza of ringed paving, the pattern the table sits over. Only the
 * outer rings are drawn in slabs: the middle is under the table on every
 * screen, and a thousand slabs nobody sees are a second of build time.
 */
export function roundPlaza(k: Kit, r: number, a: Hex, b: Hex, from = 24) {
  k.disc(0, 0.02, 0, r, k.ground(a), { seg: 48 })
  for (let rr = from; rr < r; rr += 2.2) {
    const n = Math.max(8, Math.round(rr * 3.2))
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2
      k.slab(Math.cos(ang) * rr, Math.sin(ang) * rr, 1.6, 1.0, k.ground(i % 2 ? a : b), { h: 0.06, y: 0.04, rot: -ang })
    }
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
