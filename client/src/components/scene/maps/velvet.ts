/**
 * Velvet: a square in a district of art-deco hotels.
 *
 * Cream stone stepped back tier on tier, gold trim, blocks of hotels and
 * shopfronts with awnings, a grand hotel with its marquee on the right of the
 * square, palms on every sidewalk, cars with running boards, doormen. The
 * chequer under the table is set on the diagonal, which is how a lobby floor
 * is laid. At dusk the whole thing goes amber; at noon it is white and the
 * shadows are hard.
 */
import type { Builder } from './common'
import { MAPS } from '../../cards/maps'
import { cityGrid, lots, podium, crowd, neonText, at, along, FLOOR } from './common'
import { mix, cssHex } from '../sky'

const GOLD = 0xe0b45a
const CREAM = 0xf0e6d2

export const velvet: Builder = (k) => {
  const rng = k.rng
  const on = k.rig.lampsOn
  const { sx, sy, a, b } = k.anchor

  k.floor(0xb9a58c, FLOOR)
  podium(k, { stone: 0x3a2410, step: 0xd9cdb5, floor: 0xf1e7d4, floor2: 0x7a2b3a, accent: GOLD, top: cssHex(MAPS.velvet.table.felt) })

  const facades = [0xd7c6a8, 0xc9b8d8, 0x9fc3c6, 0xe8c9b0, 0xf0e6d2, 0xb8c8d8, 0xe6d3c0]
  const hotel = (x: number, z: number, w: number, d: number, h: number) => {
    const c = rng.pick(facades)
    k.tower(x, z, w, h, d, c, { floorH: 1.5, trim: GOLD, roof: 'none', windowColor: 0xffe2a8 })
    k.tower(x, z, w * 0.62, Math.max(1.5, h * 0.3), d * 0.62, mix(c, 0xffffff, 0.3), { y: h, floorH: 1.5, trim: GOLD, roof: 'flat' })
    if (rng.chance(0.4)) {
      k.cyl(x, h * 1.3, z, 0.18, 2.6, GOLD, { seg: 6, cap: false })
      k.sphere(x, h * 1.3 + 2.8, z, 0.3, on ? 0xfff0c0 : GOLD, { glow: on, seg: 6 })
    }
    if (rng.chance(0.45)) {
      const c2 = rng.pick([0xff8fb8, 0x9fe8ff, 0xffd23c])
      k.box(x + w / 2 + 0.3, 1.5, z + d / 2 - 0.6, 0.5, h * 0.5, 0.25, 0x2a1a20)
      k.box(x + w / 2 + 0.58, 1.9, z + d / 2 - 0.6, 0.1, h * 0.45, 0.3, on ? c2 : mix(c2, 0x222222, 0.6), { glow: on, outline: false, cap: false })
    }
    // A shopfront with an awning on the face towards the camera.
    k.box(x, 0.3, z + d / 2 + 0.05, w * 0.75, 1.5, 0.08, on ? 0xffe2a8 : 0x2a3346, { glow: on, outline: false, cap: false })
    k.box(x, 2.2, z + d / 2 + 0.6, w * 0.8, 0.1, 1.3, rng.pick([0x7a2b3a, 0x2f8fbf, GOLD, 0x2fa07a]), { outline: false, cap: false })
  }

  const hotelSpot = { sx: sx + a + 10, sy: sy + 1 }
  const fountainSpot = { sx: sx - 8, sy: sy + b + 7 }
  const near = (c: { sx: number; sy: number }, p: { sx: number; sy: number }, r: number) => Math.hypot(c.sx - p.sx, (c.sy - p.sy) / 0.53) < r

  cityGrid(k, {
    block: 11,
    road: 3.6,
    roadColor: 0x3a3d48,
    sidewalk: 0xd9cdb5,
    dashes: true,
    crossings: true,
    cars: [0xd94c4c, 0x2f8fbf, 0xf4d35e, 0x2b2b2b, 0x8a5aa8, 0xf5f0e6],
    carDensity: 0.5,
    lamp: { h: 3.2, heads: 2, color: 0xfff0c0, post: 0x2a2a35 },
    people: 2,
    maxHeight: 18,
    fill: (c) => {
      if (near(c, hotelSpot, 9)) return
      if (c.front) {
        for (const l of lots(c, 2, 2, 1)) {
          const r = rng.next()
          if (r < 0.5) k.tree(l.x, l.z, { kind: 'palm', h: 2.4 })
          else if (r < 0.75) {
            k.box(l.x, 0, l.z, 1.1, 0.8, 1.1, 0x7a2b3a)
            k.bush(l.x, l.z, 0.5, 0x3f8f52)
          } else k.bench(l.x, l.z, rng.pick([0, Math.PI / 2]), 0x5a3a20)
        }
        return
      }
      const split = rng.chance(0.4) ? 1 : 2
      for (const l of lots(c, split, split, 1.2)) {
        if (split === 2 && rng.chance(0.2)) {
          k.tree(l.x, l.z, { kind: 'palm', h: 2.6 })
          k.bench(l.x + 1.5, l.z + 1.5, 0.4, 0x5a3a20)
          continue
        }
        hotel(l.x, l.z, l.w - rng.range(0, 1), l.d - rng.range(0, 1), c.dist < 40 ? rng.range(4, 9) : rng.range(6, 18))
      }
      k.tree(c.x - c.w / 2 - 0.9, c.z - c.d / 2 - 0.9, { kind: 'palm', h: rng.range(2.2, 3) })
    },
  })

  // ─── The grand hotel, on the right ─────────────────────────────────────
  {
    const [hx, hz] = at(hotelSpot.sx, hotelSpot.sy)
    const rot = Math.PI / 4
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
    const M = hotelSpot.sx - 8
    const [mx, mz] = at(M, hotelSpot.sy)
    k.box(mx, 3.4, mz, 4.5, 0.5, 9, 0x7a2b3a, { rot })
    k.box(mx, 3.9, mz, 4.1, 0.12, 8.6, GOLD, { rot, outline: false, cap: false })
    for (let i = 0; i < 13; i++) {
      const [x, z] = at(M - 1.55, hotelSpot.sy + (-4.3 + i * 0.72) * 0.375)
      k.sphere(x, 3.65, z, 0.14, on ? 0xfff0c0 : 0xd9c9a3, { glow: on, seg: 5, outline: false })
    }
    if (on) k.halo(mx, 0, mz, 6, 0xffe2a8, 0.28)
    const [px, pz] = at(M - 1.45, hotelSpot.sy)
    k.box(px, 4.0, pz, 0.35, 1.8, 7, 0x2a1a20, { rot })
    const [nx, nz] = at(M - 1.7, hotelSpot.sy)
    neonText(k, 'LOCO!', nx, 4.3, nz, 0.3, GOLD, rot)
    const [dx, dz] = at(M + 0.5, hotelSpot.sy)
    k.box(dx, 0, dz, 0.3, 3, 4, on ? 0xffe2a8 : 0x3a2a30, { rot, glow: on, outline: !on })
    k.person(...at(M - 1.8, hotelSpot.sy + 2.2), rot + Math.PI, { shirt: 0x7a2b3a, pants: 0x2a1a20, hat: 0x7a2b3a })
    k.person(...at(M - 1.8, hotelSpot.sy - 2.2), rot + Math.PI, { shirt: 0x7a2b3a, pants: 0x2a1a20, hat: 0x7a2b3a })
    k.tree(...at(M - 1, hotelSpot.sy + 5.5), { kind: 'palm', h: 2.8 })
    k.tree(...at(M - 1, hotelSpot.sy - 3.5), { kind: 'palm', h: 2.6 })
    const [cx, cz] = at(M - 5, hotelSpot.sy)
    k.slab(cx, cz, 7, 3, k.ground(0x9a1e34), { y: 0.1, h: 0.05, rot })
    for (let i = 0; i < 5; i++) {
      for (const s of [-1, 1]) {
        const [x, z] = at(M - 7.5 + i * 1.3, hotelSpot.sy + s * 1.1)
        k.cyl(x, 0, z, 0.06, 0.9, GOLD, { seg: 6, cap: false, outline: false })
        k.sphere(x, 0.95, z, 0.1, GOLD, { seg: 5, outline: false })
      }
    }
    k.car(...at(M + 0.5, hotelSpot.sy - 7), rot + Math.PI, 0x2b2b2b)
  }

  // ─── The fountain at the top, the benches, the guests ──────────────────
  {
    const [fx, fz] = at(fountainSpot.sx, fountainSpot.sy)
    k.cyl(fx, 0, fz, 3.6, 0.6, 0xd9cdb5, { seg: 16 })
    k.disc(fx, 0.6, fz, 3.1, 0x6fc3ff, { seg: 16 })
    k.cyl(fx, 0.6, fz, 0.6, 1.8, 0xd9cdb5, { seg: 8 })
    k.cyl(fx, 2.4, fz, 1.6, 0.3, 0xd9cdb5, { seg: 12 })
    k.disc(fx, 2.7, fz, 1.4, 0x6fc3ff, { seg: 12 })
    k.cyl(fx, 2.7, fz, 0.35, 1.3, 0xd9cdb5, { seg: 8 })
    k.sphere(fx, 4.2, fz, 0.4, GOLD, { seg: 6 })
    for (let i = 0; i < 10; i++) {
      const t = (i / 10) * Math.PI * 2
      k.sphere(fx + Math.cos(t) * 2.3, 1.0 + rng.range(0, 0.6), fz + Math.sin(t) * 2.3, 0.2, 0xdff4ff, { seg: 5, outline: false })
    }
    if (on) k.halo(fx, 0.62, fz, 3, 0x6fc3ff, 0.25)
  }
  for (let i = 0; i < 10; i++) {
    const t = (i / 10) * Math.PI * 2
    const [x, z] = at(sx + Math.cos(t) * (a + 8), sy + Math.sin(t) * (b + 5.5))
    const [cx, cz] = at(sx, sy)
    if (Math.abs(Math.cos(t)) > 0.9 && Math.cos(t) > 0) continue
    k.bench(x, z, Math.atan2(cx - x, cz - z) + Math.PI, 0x5a3a20)
    if (i % 2) k.lamp(x + 1.4, z - 1.4, { h: 3.0, heads: 2, color: 0xfff0c0, post: 0x2a2a35 })
    else {
      k.box(x - 1.4, 0, z + 1.4, 1.0, 0.8, 1.0, 0x7a2b3a)
      k.bush(x - 1.4, z + 1.4, 0.45, 0x3f8f52)
    }
  }
  along(...at(sx - a - 6, sy + b + 4), ...at(sx - a - 6, sy - b - 4), 4, (x, z) => k.tree(x, z, { kind: 'palm', h: 2.6 }))
  crowd(k, 24)
}
