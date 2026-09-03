/**
 * Marina: a harbour front.
 *
 * The table stands on a deck at the water's edge. The quay runs across the
 * top of the frame, the sea beyond it: a pier out to the boats, a lighthouse
 * on its rocks, buoys, a ferry in the channel. Behind the quay, blocks of
 * narrow painted houses along canals, a fish market, a fair with its wheel on
 * the right, a beach with its umbrellas at the bottom left. The sea is what
 * makes the weather here: a storm on the marina is the one that looks like
 * something.
 */
import type { Builder } from './common'
import { MAPS } from '../../cards/maps'
import { cityGrid, lots, podium, crowd, at, screenOf, FLOOR } from './common'
import { mix, scale, cssHex } from '../sky'

const SEA = 0x2c86c9
const DECK = 0xc49a62
const DECK2 = 0xb88c58

export const marina: Builder = (k) => {
  const rng = k.rng
  const on = k.rig.lampsOn
  const { sx, sy, a, b } = k.anchor
  /** The quay's line on screen: just above the table's podium. */
  const QUAY = sy + b + 4
  const atSea = (x: number, z: number) => screenOf(x, z)[1] > QUAY

  const sea = k.rig.wet ? mix(SEA, 0x1a3550, 0.4) : SEA
  k.box(0, -1.7, 0, FLOOR, 1, FLOOR, sea, { outline: false, cap: false })
  for (let i = 0; i < 320; i++) {
    const x = rng.range(-110, 110), z = rng.range(-110, 110)
    if (screenOf(x, z)[1] < QUAY + 1) continue
    k.slab(x, z, rng.range(0.6, 1.8), 0.16, mix(sea, 0xffffff, k.rig.weather === 'storm' ? 0.7 : 0.45), { y: -0.7, h: 0.03, rot: rng.range(-0.3, 0.3) })
  }
  {
    const L = 170
    const [cx, cz] = at(0, QUAY - (L / 2) * 0.53)
    k.box(cx, -0.7, cz, L, 0.7, L, 0x6b6660, { rot: Math.PI / 4, outline: true, cap: false })
    k.box(cx, 0, cz, L, 0.06, L, k.ground(0x9a948a), { rot: Math.PI / 4, outline: false, cap: false })
  }
  podium(k, { stone: 0x6e5232, step: DECK2, floor: DECK, floor2: DECK2, accent: 0xffd166, top: cssHex(MAPS.marina.table.felt) })

  // Bollards, lifebuoys and lamps along the quay.
  for (let x = -60; x <= 60; x += 3.6) k.cyl(...at(x, QUAY - 0.6), 0, 0.24, 0.7, 0x2a2f3a, { seg: 8 })
  for (let x = -54; x <= 54; x += 12) k.cyl(...at(x, QUAY + 0.2), -0.3, 0.55, 0.25, 0xd94c4c, { axis: 'x', rot: Math.PI / 4, seg: 8 })
  for (let x = -48; x <= 48; x += 12) { if (Math.abs(x + 18) > 4) k.lamp(...at(x, QUAY - 1.6), { h: 2.8, color: 0xffe1a1, post: 0x2a2f3a }) }
  for (let i = 0; i < 8; i++) k.person(...at(rng.range(-40, 40), QUAY - 1.2 - rng.range(0, 1)), -Math.PI / 4 + Math.PI)

  // ─── The pier ──────────────────────────────────────────────────────────
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
  const boat = (bsx: number, bsy: number, rot: number, hull: number, o: { sail?: boolean; cabin?: boolean; len?: number } = {}) => {
    const [x, z] = at(bsx, bsy)
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
    for (let i = 0; i < 11; i++) {
      const t = (i / 11) * Math.PI * 2
      k.rock(lx + Math.cos(t) * 3.6, lz + Math.sin(t) * 3.6, rng.range(0.7, 1.4), 0x6f6a62)
    }
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

  // ─── The town behind the quay: blocks of painted houses along canals ───
  const paints = [0xf0a34c, 0x5aa0d8, 0xe85c5c, 0xf4d35e, 0x62b58a, 0xd9a4c8, 0xf5f0e6]
  const rowHouse = (x: number, z: number, w: number, d: number, rot: number) => {
    const h = rng.range(4.5, 8)
    const c = rng.pick(paints)
    k.box(x, 0, z, w, h, d, c, { rot })
    for (let r = 0; r < Math.floor((h - 0.7) / 1.7); r++) {
      for (const t of [-1.2, 0, 1.2]) {
        const lit = rng.chance(k.rig.windowsLit)
        const wx = x + t * Math.cos(rot) + (d / 2 + 0.03) * Math.sin(rot)
        const wz = z - t * Math.sin(rot) + (d / 2 + 0.03) * Math.cos(rot)
        k.box(wx, 0.55 + r * 1.7, wz, 0.5, 0.62, 0.06, lit ? 0xffe2a8 : 0x1a2233, { rot, glow: lit, outline: false, cap: false })
      }
    }
    k.prism(x, h, z, w + 0.3, 2, d + 0.3, rng.pick([0x8b3a2a, 0x3f4a5c, 0x6b4a2b]), { rot: rot + Math.PI / 2 })
    k.box(x + (d / 2 + 0.05) * Math.sin(rot) - 1.5 * Math.cos(rot), 0, z + (d / 2 + 0.05) * Math.cos(rot) + 1.5 * Math.sin(rot), 1.0, 1.9, 0.1, scale(c, 0.5), { rot, outline: false, cap: false })
    if (rng.chance(0.5)) k.box(x + (d / 2 + 0.5) * Math.sin(rot), 2.0, z + (d / 2 + 0.5) * Math.cos(rot), 3.4, 0.08, 0.9, rng.pick([0xd94c4c, 0x2f8fbf, 0xf5f0e6]), { rot, outline: false, cap: false })
  }
  const wheelSpot = { sx: sx + a + 9, sy: sy - b - 4 }
  const beachSpot = { sx: sx - a - 8, sy: sy - b - 5 }
  const near = (c: { sx: number; sy: number }, p: { sx: number; sy: number }, r: number) => Math.hypot(c.sx - p.sx, (c.sy - p.sy) / 0.53) < r

  cityGrid(k, {
    block: 11,
    road: 3.2,
    roadColor: 0x6f6a62,
    sidewalk: 0x9a948a,
    dashes: false,
    cars: [0xd94c4c, 0x2f8fbf, 0xf4d35e, 0xf5f0e6],
    carDensity: 0.3,
    lamp: { h: 2.8, color: 0xffe1a1, post: 0x2a2f3a },
    people: 1.5,
    maxHeight: 10,
    water: { line: 1, axis: 'x', color: sea, bank: 0x6b6660, bridge: 0x8a847a },
    land: (c) => !atSea(c.x, c.z) && screenOf(c.x, c.z)[1] < QUAY - 6,
    fill: (c) => {
      if (near(c, wheelSpot, 9) || near(c, beachSpot, 8)) return
      if (c.front) {
        // The market: stalls, crates and umbrellas, nothing over a storey.
        for (const l of lots(c, 2, 2, 1)) {
          const r = rng.next()
          if (r < 0.4) k.stall(l.x, l.z, rng.pick([0, Math.PI / 2, Math.PI]), 0x2f8fbf, 0xf5f0e6)
          else if (r < 0.7) {
            k.crate(l.x, l.z, 0.7, 0xbfe3f0)
            k.crate(l.x + 1, l.z + 0.6, 0.55, 0xbfe3f0)
            k.barrel(l.x - 1, l.z + 0.8)
          } else {
            k.cyl(l.x, 0.05, l.z, 0.05, 2.2, 0xf5f0e6, { seg: 4, cap: false, outline: false })
            k.cone(l.x, 1.9, l.z, 1.2, 0.55, rng.pick([0xd94c4c, 0x2f8fbf, 0xf4d35e]), { seg: 8, cap: false })
            k.bench(l.x + 1.4, l.z, 0, 0x6b4a2b)
          }
        }
        return
      }
      // Row houses shoulder to shoulder along the block's camera-facing sides.
      const n = 3
      for (let i = 0; i < n; i++) {
        const t = -c.w / 2 + (i + 0.5) * (c.w / n)
        rowHouse(c.x + t, c.z + c.d / 2 - 2.2, c.w / n - 0.3, 4.4, 0)
        rowHouse(c.x + c.w / 2 - 2.2, c.z - c.d / 2 + (i + 0.5) * (c.d / n) - 0.0, 4.4, c.d / n - 0.3, Math.PI / 2)
      }
      const [g] = lots(c, 2, 2, 0)
      if (rng.chance(0.6)) k.tree(g.x - 0.5, g.z - 0.5, { kind: rng.chance(0.5) ? 'pine' : 'palm', h: rng.range(1.8, 2.6), r: 1.1 })
      if (rng.chance(0.4)) k.barrel(g.x + 1.5, g.z - 1)
    },
  })

  // ─── The fish market, the fair, the beach ──────────────────────────────
  const [cx, cz] = at(sx, sy)
  for (const [dsx, dsy] of [[-a - 5, 4], [-a - 8, -1]] as const) {
    const [x, z] = at(sx + dsx, sy + dsy)
    k.stall(x, z, Math.atan2(cx - x, cz - z) + Math.PI, 0x2f8fbf, 0xf5f0e6)
  }
  k.crate(...at(sx - a - 6, sy + 1), 0.6, 0xbfe3f0)
  k.crate(...at(sx - a - 5.4, sy + 1.6), 0.5, 0xbfe3f0)
  {
    const [wx, wz] = at(wheelSpot.sx, wheelSpot.sy), r = 6
    k.box(wx - 2.6, 0, wz, 0.45, 7.2, 0.45, 0x2a2f3a, { tilt: 0.36, rot: Math.PI / 4 })
    k.box(wx + 2.6, 0, wz, 0.45, 7.2, 0.45, 0x2a2f3a, { tilt: -0.36, rot: Math.PI / 4 })
    k.cyl(wx, 7, wz, 0.55, 1.1, 0xd94c4c, { axis: 'z', rot: Math.PI / 4, seg: 10 })
    for (let i = 0; i < 12; i++) {
      const t = (i / 12) * Math.PI * 2
      k.box(wx, 7, wz, r, 0.18, 0.18, 0x9aa3b5, { tilt: t, rot: Math.PI / 4, outline: false, cap: false })
      const px = wx + Math.cos(t) * r * Math.SQRT1_2, pz = wz - Math.cos(t) * r * Math.SQRT1_2, py = 7 + Math.sin(t) * r
      k.box(px, py - 0.4, pz, 0.8, 0.8, 0.8, rng.pick(paints), { cap: false })
      if (on) k.sphere(px, py + 0.2, pz, 0.11, rng.pick([0xffd23c, 0xff3d68, 0x4fd6ff]), { glow: true, seg: 4, outline: false })
    }
    for (let i = 0; i < 28; i++) {
      const t = (i / 28) * Math.PI * 2
      k.sphere(wx + Math.cos(t) * (r + 0.55) * Math.SQRT1_2, 7 + Math.sin(t) * (r + 0.55), wz - Math.cos(t) * (r + 0.55) * Math.SQRT1_2, 0.11, on ? 0xfff0c0 : 0x9aa3b5, { glow: on, seg: 4, outline: false })
    }
    if (on) k.halo(wx + 0.5, 7, wz + 0.5, r + 1.2, 0xffd23c, 0.2, false)
    k.box(...at(wheelSpot.sx, wheelSpot.sy - 4), 0, 2.4, 1.3, 1.3, 0xf4d35e, { rot: Math.PI / 4 })
    k.person(...at(wheelSpot.sx + 1.5, wheelSpot.sy - 4), -Math.PI / 4, { hat: 0xd94c4c })
    const [mx, mz] = at(wheelSpot.sx - 8, wheelSpot.sy - 3)
    k.cyl(mx, 0, mz, 4, 0.5, 0xf5f0e6, { seg: 14 })
    k.cyl(mx, 0.5, mz, 0.3, 3, 0xd94c4c, { seg: 6, cap: false })
    k.cone(mx, 3.5, mz, 4.6, 1.6, 0xd94c4c, { seg: 14 })
    for (let i = 0; i < 8; i++) {
      const t = (i / 8) * Math.PI * 2
      k.cyl(mx + Math.cos(t) * 2.8, 0.5, mz + Math.sin(t) * 2.8, 0.06, 3, 0xe0b45a, { seg: 4, cap: false, outline: false })
      k.box(mx + Math.cos(t) * 2.8, 1.2, mz + Math.sin(t) * 2.8, 0.9, 0.7, 0.5, rng.pick(paints), { cap: false })
    }
    if (on) k.halo(mx, 0.55, mz, 5, 0xffe2a8, 0.25)
  }
  {
    const [bx, bz] = at(beachSpot.sx, beachSpot.sy)
    k.box(bx, -0.7, bz, 26, 0.75, 16, 0xe8d6a8, { rot: Math.PI / 4, outline: true, cap: false })
    for (let i = 0; i < 8; i++) {
      const [x, z] = at(beachSpot.sx - 7 + rng.range(0, 14), beachSpot.sy + 2 - rng.range(0, 6))
      k.cyl(x, 0.05, z, 0.05, 2.2, 0xf5f0e6, { seg: 4, cap: false, outline: false })
      k.cone(x, 1.9, z, 1.2, 0.55, rng.pick([0xd94c4c, 0x2f8fbf, 0xf4d35e, 0xff3d68]), { seg: 8, cap: false })
      k.slab(x + 0.9, z + 0.7, 1.7, 0.9, rng.pick(paints), { y: 0.06, h: 0.03, rot: rng.range(-0.4, 0.4) })
    }
    const [lx, lz] = at(beachSpot.sx + 4, beachSpot.sy + 3)
    k.box(lx - 0.5, 0, lz, 0.2, 2.8, 0.2, 0xf5f0e6, { cap: false })
    k.box(lx + 0.5, 0, lz, 0.2, 2.8, 0.2, 0xf5f0e6, { cap: false })
    k.box(lx, 2.6, lz, 1.5, 0.5, 1.3, 0xd94c4c)
    k.person(lx, lz - 0.1, Math.PI, { shirt: 0xd94c4c, hat: 0xf5f0e6 })
    k.tree(...at(beachSpot.sx + 2, beachSpot.sy + 5), { kind: 'palm', h: 2.6 })
    k.tree(...at(beachSpot.sx - 7, beachSpot.sy + 3), { kind: 'palm', h: 3 })
    for (let i = 0; i < 5; i++) k.person(...at(beachSpot.sx - 6 + rng.range(0, 12), beachSpot.sy + 1 - rng.range(0, 5)), rng.range(0, 6.3))
  }
  for (let i = 0; i < 10; i++) {
    const t = (i / 10) * Math.PI * 2
    const [x, z] = at(sx + Math.cos(t) * (a + 7), sy + Math.sin(t) * (b + 4.5))
    if (screenOf(x, z)[1] > QUAY - 3) continue
    if (i % 2) k.lamp(x, z, { h: 2.6, color: 0xffe1a1, post: 0x2a2f3a })
    else k.bench(x, z, Math.atan2(cx - x, cz - z) + Math.PI, 0x6b4a2b)
  }
  crowd(k, 22)
}
