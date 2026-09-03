/**
 * Marina: a harbour front.
 *
 * The table stands on a wooden deck at the water's edge. The quay runs straight
 * across the top of the frame, the sea beyond it: a pier out to the boats, a
 * lighthouse on its rocks, buoys, a ferry in the channel. A row of narrow
 * painted houses faces the quay on either side, a fair has set up its wheel on
 * the right, and a beach with its umbrellas closes the bottom left. The sea is
 * what makes the weather here: a storm on the marina is the one that looks
 * like something.
 */
import type { Builder } from './common'
import { crowd, ring, at, PLAZA_R, INNER, OUTER, FAR, FLOOR } from './common'
import { mix, scale } from '../sky'

const SEA = 0x2c86c9
const DECK = 0xc49a62
const DECK2 = 0xb88c58
/** The quay's line on screen, in tiles up: just above the table's top edge. */
const QUAY = 14.5

export const marina: Builder = (k) => {
  const rng = k.rng
  const on = k.rig.lampsOn
  const screenY = (x: number, z: number) => (-(x + z) / Math.SQRT2) * 0.53
  const screenX = (x: number, z: number) => (x - z) / Math.SQRT2
  const atSea = (x: number, z: number) => screenY(x, z) > QUAY

  // The sea, below everything, and the waves on it.
  const sea = k.rig.wet ? mix(SEA, 0x1a3550, 0.4) : SEA
  k.box(0, -1.7, 0, FLOOR, 1, FLOOR, sea, { outline: false, cap: false })
  for (let i = 0; i < 320; i++) {
    const x = rng.range(-110, 110), z = rng.range(-110, 110)
    if (!atSea(x, z) || screenY(x, z) < QUAY + 1) continue
    k.slab(x, z, rng.range(0.6, 1.8), 0.16, mix(sea, 0xffffff, k.rig.weather === 'storm' ? 0.7 : 0.45), { y: -0.7, h: 0.03, rot: rng.range(-0.3, 0.3) })
  }

  // ─── The land: a diamond whose top edge is the quay ────────────────────
  {
    const L = 160
    const [cx, cz] = at(0, QUAY - (L / 2) * 0.53)
    k.box(cx, -0.7, cz, L, 0.7, L, 0x6b6660, { rot: Math.PI / 4, outline: true, cap: false })
    k.box(cx, 0, cz, L, 0.06, L, k.ground(0x9a948a), { rot: Math.PI / 4, outline: false, cap: false })
  }
  // The deck plaza: planks, on the diagonal like the quay.
  for (let i = -24; i <= 24; i++) {
    for (let j = -3; j <= 3; j++) {
      const sx = i * 1.5, sy = j * 4.4
      if (Math.abs(sx) < 26 && Math.abs(sy) < 11) continue
      if (sy > QUAY - 2.5) continue
      k.slab(...at(sx, sy), 1.3, 5.6, k.ground((i + j) % 2 ? DECK : DECK2), { h: 0.1, y: 0.02, rot: -Math.PI / 4 })
    }
  }
  k.disc(0, 0.12, 0, PLAZA_R - 2, k.ground(0x2c5f8a), { seg: 48 })
  k.disc(0, 0.15, 0, PLAZA_R - 3.2, k.ground(DECK), { seg: 48 })
  k.puddles(0, 0, PLAZA_R - 4, 22)
  // Bollards, lifebuoys and lamps along the quay.
  for (let sx = -60; sx <= 60; sx += 3.6) k.cyl(...at(sx, QUAY - 0.6), 0, 0.24, 0.7, 0x2a2f3a, { seg: 8 })
  for (let sx = -54; sx <= 54; sx += 12) k.cyl(...at(sx, QUAY + 0.2), -0.3, 0.55, 0.25, 0xd94c4c, { axis: 'x', rot: Math.PI / 4, seg: 8 })
  for (let sx = -48; sx <= 48; sx += 12) { if (Math.abs(sx + 18) > 4) k.lamp(...at(sx, QUAY - 1.6), { h: 2.8, color: 0xffe1a1, post: 0x2a2f3a }) }
  for (let i = 0; i < 8; i++) k.person(...at(rng.range(-40, 40), QUAY - 1.2 - rng.range(0, 1)), -Math.PI / 4 + Math.PI)

  // ─── The pier, straight out from the quay ──────────────────────────────
  {
    const PX = -18
    for (let t = 0; t < 20; t += 0.9) {
      k.slab(...at(PX, QUAY + t), 4.4, 1.2, DECK2, { y: 0.1, h: 0.14, rot: -Math.PI / 4 })
      if (Math.round(t * 10) % 36 === 0) {
        k.cyl(...at(PX - 2, QUAY + t), -1.6, 0.2, 1.9, 0x4a3323, { seg: 6, cap: false })
        k.cyl(...at(PX + 2, QUAY + t), -1.6, 0.2, 1.9, 0x4a3323, { seg: 6, cap: false })
      }
    }
    const [f1x, f1z] = at(PX - 2.2, QUAY + 0.5), [f2x, f2z] = at(PX - 2.2, QUAY + 19)
    k.fence(f1x, f1z, f2x, f2z, 0x6b4a2b, 0.8)
    for (let t = 3; t < 19; t += 5) k.lamp(...at(PX + 2.1, QUAY + t), { h: 2.6, color: 0xffe1a1, post: 0x2a2f3a })
    k.crate(...at(PX - 1, QUAY + 4), 0.7)
    k.crate(...at(PX - 0.3, QUAY + 5), 0.55)
    k.barrel(...at(PX - 1.2, QUAY + 8))
    k.person(...at(PX, QUAY + 14), Math.PI / 4 + Math.PI, { hat: 0xf4d35e })
    k.person(...at(PX + 1, QUAY + 9), Math.PI / 4 + Math.PI)
    k.box(...at(PX, QUAY + 19.6), 0.1, 4.6, 0.5, 1.6, 0x6b4a2b, { rot: -Math.PI / 4 })
  }

  // ─── Boats ─────────────────────────────────────────────────────────────
  const boat = (sx: number, sy: number, rot: number, hull: number, o: { sail?: boolean; cabin?: boolean; len?: number } = {}) => {
    const [x, z] = at(sx, sy)
    const len = o.len ?? 4.2
    k.box(x, -0.55, z, len, 0.9, 1.8, hull, { rot })
    k.box(x + (len / 2) * Math.cos(rot), -0.4, z - (len / 2) * Math.sin(rot), 1.0, 0.75, 1.2, hull, { rot: rot + Math.PI / 4 })
    k.box(x, 0.35, z, len - 0.2, 0.12, 1.6, mix(hull, 0xffffff, 0.5), { rot, outline: false, cap: false })
    if (o.cabin) {
      k.box(x - 0.4 * Math.cos(rot), 0.45, z + 0.4 * Math.sin(rot), 1.6, 1.0, 1.3, 0xf5f0e6, { rot })
      k.box(x - 0.4 * Math.cos(rot), 0.7, z + 0.4 * Math.sin(rot), 1.64, 0.4, 1.34, on ? 0xffe2a8 : 0x1a2233, { rot, glow: on, outline: false, cap: false })
      k.cyl(x - 0.6 * Math.cos(rot), 1.45, z + 0.6 * Math.sin(rot), 0.1, 0.6, 0x2a2f3a, { seg: 5, cap: false })
    }
    if (o.sail) {
      k.cyl(x, 0.4, z, 0.07, 4.4, 0x6b4a2b, { seg: 5, cap: false })
      k.box(x + 0.85 * Math.sin(rot), 1.4, z + 0.85 * Math.cos(rot), 0.06, 3.0, 1.6, 0xfaf6ee, { rot, cap: false })
      k.box(x - 0.6 * Math.sin(rot), 1.2, z - 0.6 * Math.cos(rot), 0.06, 2.2, 1.1, 0xff3d68, { rot, cap: false })
    }
    if (on) {
      k.sphere(x + (len / 2 + 0.3) * Math.cos(rot), 0.55, z - (len / 2 + 0.3) * Math.sin(rot), 0.12, 0x7cff6b, { glow: true, seg: 5, outline: false })
      k.halo(x, -0.68, z, len * 0.55, 0xffe2a8, 0.18)
    }
  }
  boat(-24, QUAY + 4, 0.2, 0xd94c4c, { sail: true })
  boat(-9, QUAY + 3.5, 1.0, 0x2f8fbf, { cabin: true })
  boat(-30, QUAY + 12, -0.6, 0xf4d35e, { sail: true })
  boat(2, QUAY + 9, 0.9, 0x2b2b2b, { cabin: true, len: 5.4 })
  boat(28, QUAY + 4, -1.1, 0xf5f0e6, { sail: true })
  boat(34, QUAY + 12, 0.3, 0x62b58a, { cabin: true })
  boat(-40, QUAY + 6, 1.4, 0xff8fb8, { sail: true })
  boat(20, QUAY + 16, 0.4, 0x2f8fbf, { sail: true })
  boat(-2, QUAY + 20, 2.2, 0xf0a34c, { sail: true })
  {
    const [fx, fz] = at(40, QUAY + 20)
    const rot = -0.4
    k.box(fx, -0.6, fz, 13, 1.4, 4, 0x2a3550, { rot })
    k.box(fx, 0.8, fz, 11, 1.4, 3.6, 0xf5f0e6, { rot })
    k.box(fx, 2.2, fz, 6, 1.3, 3, 0xf5f0e6, { rot })
    k.cyl(fx - 1, 3.5, fz, 0.55, 1.8, 0xd94c4c, { seg: 8, rTop: 0.45 })
    for (let i = -4; i <= 4; i++) k.box(fx + i * 1.2 * Math.cos(rot), 1.2, fz - i * 1.2 * Math.sin(rot) + 1.82, 0.6, 0.5, 0.06, on ? 0xffe2a8 : 0x1a2233, { rot, glow: on, outline: false, cap: false })
  }
  for (let i = 0; i < 12; i++) {
    const [x, z] = at(rng.range(-50, 50), QUAY + 3 + rng.range(0, 22))
    k.sphere(x, -0.55, z, 0.45, i % 2 ? 0xd94c4c : 0xf5f0e6, { seg: 7 })
    k.sphere(x, 0.1, z, 0.13, on ? 0xffd23c : 0x8a8f99, { glow: on, seg: 4, outline: false })
  }

  // ─── The lighthouse, top right, on its rocks ───────────────────────────
  {
    const [lx, lz] = at(12, QUAY + 5.5)
    ring(k, 11, 3.6, (x, z) => k.rock(lx + x, lz + z, rng.range(0.7, 1.4), 0x6f6a62), 0.2)
    k.cyl(lx, -0.7, lz, 3, 1.8, 0x6f6a62, { seg: 12 })
    for (let i = 0; i < 7; i++) k.cyl(lx, 1.1 + i * 1.6, lz, 1.7 - i * 0.09, 1.6, i % 2 ? 0xd94c4c : 0xf5f0e6, { seg: 12, cap: false })
    k.cyl(lx, 12.3, lz, 1.7, 0.3, 0x2a2f3a, { seg: 12 })
    k.fence(lx - 1.8, lz - 1.8, lx + 1.8, lz - 1.8, 0x2a2f3a, 0.6)
    k.fence(lx + 1.8, lz - 1.8, lx + 1.8, lz + 1.8, 0x2a2f3a, 0.6)
    k.cyl(lx, 12.6, lz, 1.0, 1.6, on ? 0xfff0b0 : 0xbfe3f0, { seg: 10, glow: on })
    k.cone(lx, 14.2, lz, 1.3, 1.0, 0xd94c4c, { seg: 10 })
    if (on) {
      k.halo(lx, 13.4, lz, 3, 0xfff0b0, 0.45, false)
      k.halo(lx, 13.4, lz, 6, 0xfff0b0, 0.2, false)
    }
    k.box(lx + 3.4, 0, lz + 1.4, 3, 2.2, 2.6, 0xf5f0e6, { rot: 0.3 })
    k.prism(lx + 3.4, 2.2, lz + 1.4, 3.6, 1.2, 3.2, 0xd94c4c, { rot: 0.3 })
  }

  // ─── The houses facing the quay, both sides ────────────────────────────
  const paints = [0xf0a34c, 0x5aa0d8, 0xe85c5c, 0xf4d35e, 0x62b58a, 0xd9a4c8, 0xf5f0e6]
  const rowHouse = (sx: number, sy: number, rot: number) => {
    const [x, z] = at(sx, sy)
    const h = rng.range(5, 8.5)
    const c = rng.pick(paints)
    k.box(x, 0, z, 4.4, h, 5.2, c, { rot })
    k.tower(x, z, 4.4, h, 5.2, c, { floorH: 1.7, roof: 'none', windows: false })
    for (let r = 0; r < Math.floor((h - 0.7) / 1.7); r++) {
      for (const t of [-1.3, 0, 1.3]) {
        const lit = rng.chance(k.rig.windowsLit)
        const wx = x + t * Math.cos(rot) - 2.63 * Math.sin(rot)
        const wz = z - t * Math.sin(rot) - 2.63 * Math.cos(rot)
        k.box(wx, 0.55 + r * 1.7, wz, 0.5, 0.62, 0.06, lit ? 0xffe2a8 : 0x1a2233, { rot, glow: lit, outline: false, cap: false })
      }
    }
    k.prism(x, h, z, 4.7, 2.2, 5.5, rng.pick([0x8b3a2a, 0x3f4a5c, 0x6b4a2b]), { rot: rot + Math.PI / 2 })
    k.box(x - 2.65 * Math.sin(rot), 0, z - 2.65 * Math.cos(rot), 1.0, 1.9, 0.1, scale(c, 0.5), { rot, outline: false, cap: false })
    if (rng.chance(0.5)) k.box(x - 3 * Math.sin(rot), 2.0, z - 3 * Math.cos(rot), 3.6, 0.08, 0.9, rng.pick([0xd94c4c, 0x2f8fbf, 0xf5f0e6]), { rot, outline: false, cap: false })
  }
  // Left row and right row, each a line down the frame's side, doors to the square.
  for (let i = 0; i < 8; i++) rowHouse(-34, 10 - i * 3.4, Math.PI / 4)
  for (let i = 0; i < 6; i++) rowHouse(-39, 12 - i * 3.6, Math.PI / 4)
  for (let i = 0; i < 4; i++) rowHouse(34, 10 - i * 3.4, -3 * Math.PI / 4)
  for (let i = 0; i < 5; i++) rowHouse(39, 12 - i * 3.6, -3 * Math.PI / 4)
  for (let i = 0; i < 7; i++) rowHouse(-30 + i * 4.6, -21, 0)
  for (let i = 0; i < 6; i++) rowHouse(20 + i * 4.6, -24, 0)
  k.road(...at(-31, -6), 60, 3, { rot: Math.PI / 4, color: 0x6f6a62, dashes: false })
  k.road(...at(31, -6), 60, 3, { rot: Math.PI / 4, color: 0x6f6a62, dashes: false })

  // ─── The fish market, the fair, the beach ──────────────────────────────
  k.stall(...at(-28, 11), -Math.PI / 4 + Math.PI, 0x2f8fbf, 0xf5f0e6)
  k.stall(...at(-31, 6), Math.PI / 2 - 0.3, 0x2f8fbf, 0xf5f0e6)
  k.crate(...at(-29, 8.5), 0.6, 0xbfe3f0)
  k.crate(...at(-28.4, 9.2), 0.5, 0xbfe3f0)
  for (let i = 0; i < 5; i++) k.box(...at(-29 + rng.range(-0.4, 0.4), 8.5 + rng.range(-0.3, 0.3)), 0.6, 0.4, 0.1, 0.16, 0x8fb8c8, { outline: false, cap: false })
  {
    const [wx, wz] = at(29, -16), r = 6
    k.box(wx - 2.6, 0, wz, 0.45, 7.2, 0.45, 0x2a2f3a, { tilt: 0.36, rot: Math.PI / 4 })
    k.box(wx + 2.6, 0, wz, 0.45, 7.2, 0.45, 0x2a2f3a, { tilt: -0.36, rot: Math.PI / 4 })
    k.cyl(wx, 7, wz, 0.55, 1.1, 0xd94c4c, { axis: 'z', rot: Math.PI / 4, seg: 10 })
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2
      k.box(wx, 7, wz, r, 0.18, 0.18, 0x9aa3b5, { tilt: a, rot: Math.PI / 4, outline: false, cap: false })
      const cx = wx + Math.cos(a) * r * Math.SQRT1_2, cz = wz - Math.cos(a) * r * Math.SQRT1_2, cy = 7 + Math.sin(a) * r
      k.box(cx, cy - 0.4, cz, 0.8, 0.8, 0.8, rng.pick(paints), { cap: false })
      if (on) k.sphere(cx, cy + 0.2, cz, 0.11, rng.pick([0xffd23c, 0xff3d68, 0x4fd6ff]), { glow: true, seg: 4, outline: false })
    }
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2
      k.sphere(wx + Math.cos(a) * (r + 0.55) * Math.SQRT1_2, 7 + Math.sin(a) * (r + 0.55), wz - Math.cos(a) * (r + 0.55) * Math.SQRT1_2, 0.11, on ? 0xfff0c0 : 0x9aa3b5, { glow: on, seg: 4, outline: false })
    }
    if (on) k.halo(wx + 0.5, 7, wz + 0.5, r + 1.2, 0xffd23c, 0.2, false)
    k.box(...at(29, -20), 0, 2.4, 1.3, 1.3, 0xf4d35e, { rot: Math.PI / 4 })
    k.person(...at(30.5, -20), -Math.PI / 4, { hat: 0xd94c4c })
    const [mx, mz] = at(21, -19)
    k.cyl(mx, 0, mz, 4, 0.5, 0xf5f0e6, { seg: 14 })
    k.cyl(mx, 0.5, mz, 0.3, 3, 0xd94c4c, { seg: 6, cap: false })
    k.cone(mx, 3.5, mz, 4.6, 1.6, 0xd94c4c, { seg: 14 })
    ring(k, 8, 2.8, (x, z) => {
      k.cyl(mx + x, 0.5, mz + z, 0.06, 3, 0xe0b45a, { seg: 4, cap: false, outline: false })
      k.box(mx + x, 1.2, mz + z, 0.9, 0.7, 0.5, rng.pick(paints), { cap: false })
    }, 0)
    if (on) k.halo(mx, 0.55, mz, 5, 0xffe2a8, 0.25)
  }
  {
    const [bx, bz] = at(-26, -17)
    k.box(bx, -0.7, bz, 30, 0.75, 16, 0xe8d6a8, { rot: Math.PI / 4, outline: true, cap: false })
    for (let i = 0; i < 9; i++) {
      const [x, z] = at(-34 + rng.range(0, 16), -14 - rng.range(0, 7))
      k.cyl(x, 0.05, z, 0.05, 2.2, 0xf5f0e6, { seg: 4, cap: false, outline: false })
      k.cone(x, 1.9, z, 1.2, 0.55, rng.pick([0xd94c4c, 0x2f8fbf, 0xf4d35e, 0xff3d68]), { seg: 8, cap: false })
      k.slab(x + 0.9, z + 0.7, 1.7, 0.9, rng.pick(paints), { y: 0.06, h: 0.03, rot: rng.range(-0.4, 0.4) })
    }
    const [cx, cz] = at(-20, -14)
    k.box(cx - 0.5, 0, cz, 0.2, 2.8, 0.2, 0xf5f0e6, { cap: false })
    k.box(cx + 0.5, 0, cz, 0.2, 2.8, 0.2, 0xf5f0e6, { cap: false })
    k.box(cx, 2.6, cz, 1.5, 0.5, 1.3, 0xd94c4c)
    k.person(cx, cz - 0.1, Math.PI, { shirt: 0xd94c4c, hat: 0xf5f0e6 })
    k.tree(...at(-24, -12), { kind: 'palm', h: 2.6 })
    k.tree(...at(-33, -13), { kind: 'palm', h: 3 })
    k.tree(...at(-29, -21), { kind: 'palm', h: 2.4 })
    for (let i = 0; i < 5; i++) k.person(...at(-33 + rng.range(0, 14), -15 - rng.range(0, 5)), rng.range(0, 6.3))
  }

  ring(k, 12, PLAZA_R - 1, (x, z) => { if (screenY(x, z) < QUAY - 3) k.lamp(x, z, { h: 2.6, color: 0xffe1a1, post: 0x2a2f3a }) }, 0.05)
  ring(k, 10, PLAZA_R - 8, (x, z, a) => k.bench(x, z, -a + Math.PI / 2, 0x6b4a2b), 0.02)
  ring(k, 10, INNER + 4, (x, z) => { if (screenY(x, z) < QUAY - 4 && Math.abs(screenX(x, z)) < 26 && screenY(x, z) > -12) k.tree(x, z, { kind: rng.chance(0.5) ? 'pine' : 'palm', h: rng.range(1.8, 2.6), r: 1.1 }) }, 0.3)
  ring(k, 16, OUTER + 8, (x, z) => { if (!atSea(x, z) && screenY(x, z) < -18) k.tree(x, z, { kind: 'pine', h: rng.range(2, 3), r: 1.3 }) }, 0.3)
  ring(k, 20, FAR + 12, (x, z) => { if (!atSea(x, z)) k.tree(x, z, { kind: 'pine', h: rng.range(2.2, 3.4), r: 1.4 }) }, 0.3)
  crowd(k, 26, PLAZA_R - 8, PLAZA_R)
}
