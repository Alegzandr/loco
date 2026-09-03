/**
 * Velvet: a boulevard of art-deco hotels, and the square in front of the
 * grandest of them.
 *
 * Cream stone stepped back tier on tier, gold trim, a marquee with its bulbs,
 * palms in a row, cars with running boards, doormen. The chequer under the
 * table is set on the diagonal, which is how a lobby floor is laid. At dusk
 * the whole thing goes amber; at noon it is white and the shadows are hard.
 *
 * The hotel stands on the right of the square, the boulevard runs down the
 * left, the fountain is at the top.
 */
import type { Builder } from './common'
import { crowd, paving, ring, neonText, at, PLAZA_R, INNER, MID, OUTER, FAR, FLOOR } from './common'
import { mix } from '../sky'

const GOLD = 0xe0b45a
const CREAM = 0xf0e6d2
/** The boulevard's line on screen, in tiles across. */
const BLVD = -36

export const velvet: Builder = (k) => {
  const rng = k.rng
  const on = k.rig.lampsOn
  const rot = Math.PI / 4
  const screenX = (x: number, z: number) => (x - z) / Math.SQRT2
  const screenY = (x: number, z: number) => (-(x + z) / Math.SQRT2) * 0.53
  const free = (x: number, z: number) => {
    const sx = screenX(x, z), sy = screenY(x, z)
    if (Math.abs(sx - BLVD) < 9) return false
    if (sx > 22 && Math.abs(sy - 1) < 14) return false
    if (Math.abs(sx + 8) < 9 && sy > 12 && sy < 24) return false
    return true
  }

  k.floor(0xb9a58c, FLOOR)
  paving(k, 0, 0, PLAZA_R * 2.2, 0xf1e7d4, 0x7a2b3a, 2.4, rot, 24)
  k.puddles(0, 0, PLAZA_R - 2, 22)

  // ─── The grand hotel, on the right ─────────────────────────────────────
  {
    const [hx, hz] = at(34.5, 1)
    k.tower(hx, hz, 16, 12, 16, CREAM, { floorH: 1.5, trim: GOLD, roof: 'none', windowColor: 0xffe2a8 })
    k.tower(hx, hz, 11, 5, 11, mix(CREAM, 0xffffff, 0.3), { y: 12, floorH: 1.5, trim: GOLD, roof: 'none' })
    k.tower(hx, hz, 7, 4, 7, mix(CREAM, 0xffffff, 0.5), { y: 17, floorH: 1.5, trim: GOLD, roof: 'none' })
    k.box(hx, 21, hz, 4, 3, 4, CREAM)
    k.cyl(hx, 24, hz, 0.3, 6, GOLD, { seg: 6, cap: false })
    k.sphere(hx, 30.3, hz, 0.45, on ? 0xfff0c0 : GOLD, { glow: on, seg: 8 })
    if (on) k.halo(hx, 30.3, hz, 1.4, 0xfff0c0, 0.4, false)
    for (let i = -3; i <= 3; i++) {
      k.box(hx + i * 2.2, 0.7, hz + 8.1, 0.3, 11, 0.25, GOLD, { outline: false, cap: false })
      k.box(hx - 8.1, 0.7, hz + i * 2.2, 0.25, 11, 0.3, GOLD, { outline: false, cap: false })
    }
    // The marquee over the doors, on the face that looks at the square. Its
    // lip runs along the screen's vertical, so the bulbs are placed in screen
    // space too.
    const [mx, mz] = at(26.5, 1)
    k.box(mx, 3.4, mz, 4.5, 0.5, 9, 0x7a2b3a, { rot })
    k.box(mx, 3.9, mz, 4.1, 0.12, 8.6, GOLD, { rot, outline: false, cap: false })
    for (let i = 0; i < 13; i++) {
      const [x, z] = at(24.95, 1 + (-4.3 + i * 0.72) * 0.375)
      k.sphere(x, 3.65, z, 0.14, on ? 0xfff0c0 : 0xd9c9a3, { glow: on, seg: 5, outline: false })
    }
    if (on) k.halo(mx, 0, mz, 6, 0xffe2a8, 0.28)
    const [px, pz] = at(25.05, 1)
    k.box(px, 4.0, pz, 0.35, 1.8, 7, 0x2a1a20, { rot })
    const [nx, nz] = at(24.8, 1)
    neonText(k, 'LOCO!', nx, 4.3, nz, 0.3, GOLD, rot)
    const [dx, dz] = at(27, 1)
    k.box(dx, 0, dz, 0.3, 3, 4, on ? 0xffe2a8 : 0x3a2a30, { rot, glow: on, outline: !on })
    k.person(...at(24.7, 3.2), rot + Math.PI, { shirt: 0x7a2b3a, pants: 0x2a1a20, hat: 0x7a2b3a })
    k.person(...at(24.7, -1.2), rot + Math.PI, { shirt: 0x7a2b3a, pants: 0x2a1a20, hat: 0x7a2b3a })
    k.tree(...at(25.6, 5.5), { kind: 'palm', h: 2.8 })
    k.tree(...at(25.6, -3.5), { kind: 'palm', h: 2.6 })
    const [cx, cz] = at(22.6, 1)
    k.slab(cx, cz, 8, 3, k.ground(0x9a1e34), { y: 0.1, h: 0.05, rot })
    for (let i = 0; i < 5; i++) {
      for (const s of [-1, 1]) {
        const [x, z] = at(20 + i * 1.5, 1 + s * 1.1)
        k.cyl(x, 0, z, 0.06, 0.9, GOLD, { seg: 6, cap: false, outline: false })
        k.sphere(x, 0.95, z, 0.1, GOLD, { seg: 5, outline: false })
      }
    }
    k.car(...at(27, -6.5), rot + Math.PI, 0x2b2b2b)
    k.person(...at(28.5, -8), rot, { shirt: 0x1c1c1c, hat: 0x1c1c1c })
  }

  // ─── The boulevard, down the left ──────────────────────────────────────
  {
    const [cx, cz] = at(BLVD, 0)
    k.road(cx, cz, 220, 6, { rot, sidewalk: 0xd9cdb5, color: 0x3a3d48 })
    const carColors = [0xd94c4c, 0x2f8fbf, 0xf4d35e, 0x2b2b2b, 0x8a5aa8, 0xf5f0e6]
    for (let i = 0; i < 12; i++) {
      const sy = -30 + i * 5.2 + rng.range(-1, 1)
      const side = i % 2 ? 1.2 : -1.2
      k.car(...at(BLVD + side, sy), i % 2 ? rot : rot + Math.PI, rng.pick(carColors))
    }
    for (let i = 0; i < 12; i++) {
      const sy = -30 + i * 5.4
      k.lamp(...at(BLVD + 3.6, sy), { h: 3.2, heads: 2, color: 0xfff0c0, post: 0x2a2a35 })
      k.tree(...at(BLVD + 3.8, sy + 2.7), { kind: 'palm', h: rng.range(2.4, 3.2) })
      k.tree(...at(BLVD - 3.8, sy + 1.2), { kind: 'palm', h: rng.range(2.4, 3.2) })
    }
    for (let i = 0; i < 8; i++) k.person(...at(BLVD + 3.2 + rng.range(-0.5, 0.5), rng.range(-20, 20)), rng.range(0, 6.3))
  }

  // ─── The other hotels ──────────────────────────────────────────────────
  const facades = [0xd7c6a8, 0xc9b8d8, 0x9fc3c6, 0xe8c9b0, 0xf0e6d2, 0xb8c8d8]
  const hotel = (x: number, z: number, big: boolean) => {
    const w = rng.range(7, 11)
    const d = rng.range(7, 10)
    const h = rng.range(big ? 10 : 6, big ? 20 : 12)
    const c = rng.pick(facades)
    k.tower(x, z, w, h, d, c, { floorH: 1.5, trim: GOLD, roof: 'none', windowColor: 0xffe2a8 })
    k.tower(x, z, w * 0.6, h * 0.3, d * 0.6, mix(c, 0xffffff, 0.3), { y: h, floorH: 1.5, trim: GOLD, roof: 'flat' })
    if (rng.chance(0.5)) {
      k.cyl(x, h * 1.3, z, 0.2, 3.5, GOLD, { seg: 6, cap: false })
      k.sphere(x, h * 1.3 + 3.7, z, 0.32, on ? 0xfff0c0 : GOLD, { glow: on, seg: 6 })
    }
    if (rng.chance(0.5)) {
      const c2 = rng.pick([0xff8fb8, 0x9fe8ff, 0xffd23c])
      k.box(x + w / 2 + 0.3, 2, z + d / 2 - 0.6, 0.5, h * 0.5, 0.25, 0x2a1a20)
      k.box(x + w / 2 + 0.58, 2.4, z + d / 2 - 0.6, 0.1, h * 0.45, 0.3, on ? c2 : mix(c2, 0x222222, 0.6), { glow: on, outline: false, cap: false })
    }
    k.box(x, 2.4, z + d / 2 + 0.6, w * 0.8, 0.1, 1.4, rng.pick([0x7a2b3a, 0x2f8fbf, GOLD]), { outline: false, cap: false })
  }
  ring(k, 14, MID + 4, (x, z) => { if (free(x, z)) hotel(x, z, true) }, 0.12)
  ring(k, 18, OUTER + 6, (x, z) => { if (free(x, z)) hotel(x, z, true) }, 0.12)
  ring(k, 22, FAR + 8, (x, z) => { if (free(x, z)) hotel(x, z, false) }, 0.12)
  ring(k, 26, FAR + 30, (x, z) => { if (free(x, z)) hotel(x, z, false) }, 0.12)

  // ─── The fountain at the top, the benches, the guests ──────────────────
  {
    const [fx, fz] = at(-8, 15.5)
    k.cyl(fx, 0, fz, 4, 0.6, 0xd9cdb5, { seg: 16 })
    k.disc(fx, 0.6, fz, 3.5, 0x6fc3ff, { seg: 16 })
    k.cyl(fx, 0.6, fz, 0.6, 1.8, 0xd9cdb5, { seg: 8 })
    k.cyl(fx, 2.4, fz, 1.8, 0.3, 0xd9cdb5, { seg: 12 })
    k.disc(fx, 2.7, fz, 1.6, 0x6fc3ff, { seg: 12 })
    k.cyl(fx, 2.7, fz, 0.35, 1.3, 0xd9cdb5, { seg: 8 })
    k.sphere(fx, 4.2, fz, 0.4, GOLD, { seg: 6 })
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2
      k.sphere(fx + Math.cos(a) * 2.6, 1.0 + rng.range(0, 0.6), fz + Math.sin(a) * 2.6, 0.2, 0xdff4ff, { seg: 5, outline: false })
    }
    if (on) k.halo(fx, 0.62, fz, 3.2, 0x6fc3ff, 0.25)
    ring(k, 6, 7, (x, z, a) => k.bench(fx + x, fz + z, -a + Math.PI / 2, 0x5a3a20), 0.02)
    for (let i = 0; i < 5; i++) k.person(fx + rng.range(-6, 6), fz + rng.range(-6, 6), rng.range(0, 6.3))
  }
  ring(k, 12, PLAZA_R - 4, (x, z, a) => k.bench(x, z, -a + Math.PI / 2, 0x5a3a20), 0.05)
  ring(k, 12, PLAZA_R + 1, (x, z) => {
    if (!free(x, z)) return
    k.box(x, 0, z, 1.1, 0.8, 1.1, 0x7a2b3a)
    k.bush(x, z, 0.5, 0x3f8f52)
  }, 0.4)
  ring(k, 10, PLAZA_R - 1, (x, z) => k.lamp(x, z, { h: 3.0, heads: 2, color: 0xfff0c0, post: 0x2a2a35 }), 0.05)
  ring(k, 8, INNER + 4, (x, z) => { if (free(x, z)) k.tree(x, z, { kind: 'palm', h: rng.range(2.2, 3) }) }, 0.2)
  crowd(k, 26, PLAZA_R - 8, PLAZA_R + 3)
}
