/**
 * Sakura: a hot-spring village under cherry trees.
 *
 * Raked gravel around the table, blocks of wooden houses with tiled roofs and
 * their gardens, a bathhouse with steam coming off its pool on the right, a
 * pagoda at the top, a torii at the bottom left, stone lanterns and strings of
 * paper ones, a stream through the village under red bridges. The trees are
 * in blossom in every season the server deals, because a village that is only
 * pink in April is a village nobody is dealt into in October. Snow here is
 * the postcard.
 */
import type { Builder } from './common'
import { MAPS } from '../../cards/maps'
import { cityGrid, lots, podium, crowd, at, along, FLOOR } from './common'
import { mix, cssHex } from '../sky'

const RED = 0xd23b3b
const WOOD = 0x4a3323
const PAPER = 0xf6efe0
const TILE = 0x334a66

export const sakura: Builder = (k) => {
  const rng = k.rng
  const on = k.rig.lampsOn
  const { sx, sy, a, b } = k.anchor

  k.floor(0x6aa84f, FLOOR)
  podium(k, { stone: 0x7a1f1f, step: 0xcfc7b5, floor: 0xd9d2c2, floor2: 0xcfc7b5, accent: 0xffb7d0, top: cssHex(MAPS.sakura.table.felt) })

  const woodHouse = (x: number, z: number, w: number, d: number, rot: number) => {
    const h = rng.range(2.8, 3.8)
    k.box(x, 0, z, w, h, d, rng.chance(0.5) ? WOOD : PAPER, { rot })
    k.prism(x, h, z, w + 1.4, 1.6, d + 1.4, TILE, { rot })
    k.box(x, h - 0.1, z, w + 1.6, 0.25, d + 1.6, mix(TILE, 0x000000, 0.35), { rot, outline: false, cap: false })
    const lit = rng.chance(k.rig.windowsLit)
    k.box(x + (d / 2 + 0.05) * Math.sin(rot), 0.9, z + (d / 2 + 0.05) * Math.cos(rot), 1.6, 1.2, 0.08, lit ? 0xffd98a : PAPER, { rot, glow: lit, outline: false, cap: false })
    if (rng.chance(0.5)) k.lantern(x + (d / 2 + 0.4) * Math.sin(rot) + 1, 2.2, z + (d / 2 + 0.4) * Math.cos(rot), 0xff5a3c, 0.22)
  }
  const stoneLantern = (x: number, z: number) => {
    k.box(x, 0, z, 0.9, 0.3, 0.9, 0x8a8f99)
    k.cyl(x, 0.3, z, 0.2, 1.2, 0x8a8f99, { seg: 6, cap: false })
    k.box(x, 1.5, z, 0.8, 0.16, 0.8, 0x8a8f99, { cap: false })
    k.box(x, 1.66, z, 0.55, 0.55, 0.55, on ? 0xffd98a : 0x6f7a8a, { glow: on, cap: false })
    k.cone(x, 2.21, z, 0.7, 0.5, 0x6f737d, { seg: 4 })
    if (on) k.halo(x, 0, z, 1.8, 0xffd98a, 0.28)
  }

  const bathSpot = { sx: sx + a + 10, sy: sy + 2 }
  const pagodaSpot = { sx: sx - 18, sy: sy + b + 8 }
  const toriiSpot = { sx: sx - a - 4, sy: sy - b - 5 }
  const near = (c: { sx: number; sy: number }, p: { sx: number; sy: number }, r: number) => Math.hypot(c.sx - p.sx, (c.sy - p.sy) / 0.53) < r

  cityGrid(k, {
    block: 12,
    road: 2.8,
    roadColor: 0x9a9488,
    dashes: false,
    lamp: undefined,
    people: 1.2,
    maxHeight: 5.5,
    water: { line: 2, axis: 'x', color: k.rig.snow ? 0xb8dcee : 0x6fbfe8, bank: 0x8a8f99, bridge: RED },
    fill: (c) => {
      if (near(c, bathSpot, 9) || near(c, pagodaSpot, 8)) return
      const ls = lots(c, 2, 2, 1.4)
      const houses = c.front ? 0 : rng.int(1, 3)
      ls.forEach((l, i) => {
        if (i < houses) {
          woodHouse(l.x, l.z, Math.min(l.w, rng.range(3.5, 5)), Math.min(l.d, rng.range(3, 4.5)), rng.pick([0, Math.PI / 2]))
        } else {
          const g = rng.next()
          if (g < 0.5) {
            k.tree(l.x, l.z, { kind: 'sakura', h: rng.range(1.4, 2.2), r: rng.range(1.0, 1.4), trunk: 0x3d2a1e })
            if (rng.chance(0.5)) stoneLantern(l.x + 1.8, l.z + 1.4)
          } else if (g < 0.75) {
            k.disc(l.x, 0, l.z, 1.8, 0x7fd1e8, { seg: 12 })
            for (let i = 0; i < 4; i++) k.slab(l.x + rng.range(-1, 1), l.z + rng.range(-1, 1), 0.4, 0.2, rng.chance(0.6) ? 0xff8a3c : 0xffffff, { y: 0.03, h: 0.02 })
            k.rock(l.x + 1.6, l.z - 1, 0.5)
            k.rock(l.x - 1.4, l.z + 1.2, 0.4)
          } else {
            for (let i = 0; i < 12; i++) k.cyl(l.x + rng.range(-1.6, 1.6), 0, l.z + rng.range(-1.6, 1.6), 0.09, rng.range(2.5, 4.5), 0x7bbf5a, { seg: 5, cap: false, outline: false })
          }
        }
      })
      k.fence(c.x - c.w / 2, c.z + c.d / 2, c.x + c.w / 2, c.z + c.d / 2, WOOD, 0.8)
    },
  })

  // ─── The bathhouse, on the right, its pool in front ────────────────────
  {
    const [bx, bz] = at(bathSpot.sx, bathSpot.sy)
    const rot = Math.PI / 4
    k.box(bx, 0, bz, 13, 0.6, 11, 0x8a847a, { rot })
    k.box(bx, 0.6, bz, 12, 4.4, 10, WOOD, { rot })
    for (let i = -2; i <= 2; i++) {
      const [px, pz] = at(bathSpot.sx - 6.03 / Math.SQRT2, bathSpot.sy + i * 1.25)
      k.box(px, 1.2, pz, 0.1, 2.5, 1.5, on ? mix(PAPER, 0xffd98a, 0.5) : PAPER, { rot, glow: on, outline: false, cap: false })
    }
    k.prism(bx, 5.0, bz, 14, 3.4, 12.5, TILE, { rot })
    k.box(bx, 4.8, bz, 14.2, 0.3, 12.7, mix(TILE, 0x000000, 0.3), { rot, outline: false, cap: false })
    k.box(bx, 8.4, bz, 14.4, 0.35, 0.6, mix(TILE, 0x000000, 0.4), { rot, cap: false })
    const [dx, dz] = at(bathSpot.sx - 4.4, bathSpot.sy)
    k.box(dx, 1.6, dz, 0.06, 1.4, 2.4, 0x2f4a8a, { rot, outline: false, cap: false })
    k.lantern(...at(bathSpot.sx - 4.6, bathSpot.sy + 2.2), 2.6, 0xff5a3c, 0.32)
    k.lantern(...at(bathSpot.sx - 4.6, bathSpot.sy - 2.2), 2.6, 0xff5a3c, 0.32)
    const [px, pz] = at(bathSpot.sx - 6.5, bathSpot.sy - 9)
    k.disc(px, 0, pz, 4.6, 0x8a8f99, { seg: 18 })
    k.disc(px, 0.12, pz, 4, 0x7fd1e8, { seg: 18 })
    for (let i = 0; i < 14; i++) {
      const t = (i / 14) * Math.PI * 2
      k.rock(px + Math.cos(t) * 4.3, pz + Math.sin(t) * 4.3, rng.range(0.35, 0.65), 0x8a8f99)
    }
    for (let i = 0; i < 9; i++) {
      const t = rng.next() * Math.PI * 2, r = rng.range(0, 2.8)
      k.sphere(px + Math.cos(t) * r, 0.5 + rng.range(0, 1.6), pz + Math.sin(t) * r, rng.range(0.3, 0.7), 0xffffff, { seg: 6, outline: false })
    }
    k.sphere(px - 1.4, 0.35, pz + 0.7, 0.22, 0xf3c9a5, { seg: 6 })
    k.sphere(px - 1.4, 0.5, pz + 0.7, 0.2, 0x2b1b12, { seg: 6, outline: false })
    k.sphere(px + 1.6, 0.35, pz - 0.9, 0.22, 0xd9a072, { seg: 6 })
    k.box(px + 1.6, 0.48, pz - 0.9, 0.5, 0.06, 0.4, 0xffffff, { outline: false, cap: false })
    k.sphere(px + 0.4, 0.35, pz + 1.8, 0.22, 0xa5683d, { seg: 6 })
    k.lamp(...at(bathSpot.sx - 10, bathSpot.sy - 12), { h: 1.6, style: 'lantern', color: 0xffd98a, post: 0x8a8f99 })
  }

  // ─── The pagoda at the top ─────────────────────────────────────────────
  {
    const [px, pz] = at(pagodaSpot.sx, pagodaSpot.sy)
    k.box(px, 0, pz, 9, 0.8, 9, 0x8a847a)
    for (let tier = 0; tier < 3; tier++) {
      const y = 0.8 + tier * 3.8
      const s = 7 - tier * 1.4
      k.box(px, y, pz, s, 2.8, s, RED)
      k.box(px, y + 0.4, pz, s + 0.08, 1.5, s + 0.08, PAPER, { outline: false, cap: false })
      for (let i = -1; i <= 1; i++) {
        k.box(px + i * (s / 3), y + 0.5, pz + s / 2 + 0.06, 1, 1.3, 0.08, on ? 0xffd98a : 0x2a3346, { glow: on, outline: false, cap: false })
        k.box(px + s / 2 + 0.06, y + 0.5, pz + i * (s / 3), 0.08, 1.3, 1, on ? 0xffd98a : 0x2a3346, { glow: on, outline: false, cap: false })
      }
      k.cone(px, y + 2.8, pz, (s + 3) * 0.72, 1.5, TILE, { seg: 4 })
      k.box(px, y + 2.7, pz, s + 3.2, 0.3, s + 3.2, mix(TILE, 0x000000, 0.35), { outline: false, cap: false })
    }
    k.cyl(px, 13.2, pz, 0.16, 3, 0xe0b45a, { seg: 6, cap: false })
    k.sphere(px, 16.3, pz, 0.4, 0xe0b45a, { seg: 6 })
    k.lantern(px + 4.8, 3.4, pz + 5, 0xff5a3c, 0.34)
    k.lantern(px - 5, 3.4, pz + 4.8, 0xff5a3c, 0.34)
    k.tree(px + 7, pz + 6, { kind: 'sakura', h: 2, r: 1.5, trunk: 0x3d2a1e })
    k.tree(px - 7, pz - 5, { kind: 'sakura', h: 1.8, r: 1.3, trunk: 0x3d2a1e })
  }

  // ─── The torii at the bottom left ──────────────────────────────────────
  {
    const [tx, tz] = at(toriiSpot.sx, toriiSpot.sy)
    const rot = Math.PI / 4
    for (const s of [-2.4, 2.4]) {
      const x = tx + s * Math.cos(rot), z = tz - s * Math.sin(rot)
      k.cyl(x, 0, z, 0.32, 5.6, RED, { seg: 8, cap: false })
      k.cyl(x, 0, z, 0.38, 0.5, 0x2a2a2a, { seg: 8 })
    }
    k.box(tx, 4.5, tz, 5.8, 0.35, 0.35, RED, { rot })
    k.box(tx, 5.4, tz, 7, 0.5, 0.5, RED, { rot })
    k.box(tx, 5.9, tz, 7.2, 0.18, 0.7, 0x2a2a2a, { rot, outline: false, cap: false })
    k.box(tx, 4.85, tz, 0.9, 0.55, 0.2, 0x2a2a2a, { rot, outline: false, cap: false })
    k.tree(...at(toriiSpot.sx - 4, toriiSpot.sy + 2), { kind: 'sakura', h: 2, r: 1.4, trunk: 0x3d2a1e })
  }

  // ─── Lanterns around the square ────────────────────────────────────────
  for (let i = 0; i < 12; i++) {
    const t = (i / 12) * Math.PI * 2
    const [x, z] = at(sx + Math.cos(t) * (a + 7), sy + Math.sin(t) * (b + 4.5))
    if (Math.cos(t) > 0.85) continue
    stoneLantern(x, z)
  }
  const P: [number, number][] = [at(sx - a - 3, sy + b + 4), at(sx + a + 3, sy + b + 4), at(sx + a + 3, sy - b - 4), at(sx - a - 3, sy - b - 4)]
  for (const [x, z] of P) k.cyl(x, 0, z, 0.12, 4, WOOD, { seg: 6, cap: false })
  for (let i = 0; i < 4; i++) {
    const [x1, z1] = P[i]
    const [x2, z2] = P[(i + 1) % 4]
    along(x1, z1, x2, z2, 22, (x, z, t) => {
      if (t === 0 || t === 1) return
      k.lantern(x, 3.4 - Math.sin(t * Math.PI) * 0.7, z, rng.chance(0.7) ? 0xff5a3c : 0xffffff, 0.24)
    })
  }
  const [cx, cz] = at(sx, sy)
  for (const [dsx, dsy] of [[-a - 6, -3], [-a + 5, -b - 6], [a - 4, b + 6]] as const) {
    const [x, z] = at(sx + dsx, sy + dsy)
    k.stall(x, z, Math.atan2(cx - x, cz - z) + Math.PI, rng.chance(0.5) ? RED : 0x2f4a8a, PAPER)
  }
  for (let i = 0; i < 6; i++) {
    const t = (i / 6) * Math.PI * 2 + 0.3
    const [x, z] = at(sx + Math.cos(t) * (a + 4), sy + Math.sin(t) * (b + 3))
    k.bench(x, z, Math.atan2(cx - x, cz - z) + Math.PI, WOOD)
  }
  crowd(k, 22, { shirt: undefined })
  const [catx, catz] = at(sx + a + 5.5, sy + 6)
  k.box(catx, 0.6, catz, 0.5, 0.25, 0.25, 0xff8a3c)
  k.sphere(catx + 0.25, 0.95, catz, 0.14, 0xff8a3c, { seg: 5 })
}
