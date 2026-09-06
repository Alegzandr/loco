/**
 * Sakura: a hot-spring village under cherry trees.
 *
 * Raked gravel around the table, wooden houses with tiled roofs standing in
 * gardens, with more garden than house — a cherry tree, a pond, a bed of
 * flowers where a house is not — a bathhouse with steam coming off its pool
 * on the right, a pagoda at the top, a torii at the bottom left, stone
 * lanterns, a stream through the village under red bridges. The trees are in
 * blossom in every season the server deals, because a village that is only
 * pink in April is a village nobody is dealt into in October. Snow here is
 * the postcard. It was three houses to a block and paper lanterns strung
 * over the square, and read as a carpet of dark roofs; the gardens are the
 * village.
 */
import type { Builder } from './common'
import { MAPS } from '../../cards/maps'
import { cityGrid, lots, podium, crowd, at, FLOOR } from './common'
import { mix, cssHex } from '../sky'
import type { Actor } from '../life'
import { bird, cloud, over, puff, streetWalkers } from './actors'

const RED = 0xd23b3b
const WOOD = 0x4a3323
const PAPER = 0xf6efe0
const TILE = 0x334a66

export const sakura: Builder = (k) => {
  const rng = k.rng
  const on = k.rig.lampsOn
  const { sx, sy, a, b } = k.anchor

  k.floor(0x6aa84f, FLOOR)
  const plaza = podium(k, { stone: 0x7a1f1f, step: 0xcfc7b5, floor: 0xd9d2c2, floor2: 0xcfc7b5, accent: 0xffb7d0, top: cssHex(MAPS.sakura.table.felt) })

  const woodHouse = (x: number, z: number, w: number, d: number, rot: number) => {
    const h = rng.range(2.8, 3.8)
    k.box(x, 0, z, w, h, d, rng.chance(0.5) ? WOOD : PAPER, { rot })
    k.prism(x, h, z, w + 1.4, 1.6, d + 1.4, TILE, { rot })
    k.box(x, h - 0.1, z, w + 1.6, 0.25, d + 1.6, mix(TILE, 0x000000, 0.35), { rot, outline: false, cap: false })
    const lit = rng.chance(k.rig.windowsLit)
    k.box(x + (d / 2 + 0.05) * Math.sin(rot), 0.9, z + (d / 2 + 0.05) * Math.cos(rot), 1.6, 1.2, 0.08, lit ? 0xffd98a : PAPER, { rot, glow: lit, outline: false, cap: false })
    if (rng.chance(0.5)) {
      // Hung on a cord under the eave, at the end of the porch. The `+ 1` that
      // used to sit on x whichever way the house faced put it beside the
      // building rather than over its door, hanging from nothing at all.
      const lx = x + (d / 2 + 0.35) * Math.sin(rot) + (w / 2 - 0.7) * Math.cos(rot)
      const lz = z + (d / 2 + 0.35) * Math.cos(rot) - (w / 2 - 0.7) * Math.sin(rot)
      k.cyl(lx, 2.35, lz, 0.03, h - 2.35, 0x2a2a2a, { seg: 4, cap: false, outline: false })
      k.lantern(lx, 2.0, lz, 0xff5a3c, 0.22)
    }
  }
  const stoneLantern = (x: number, z: number) => {
    k.box(x, 0, z, 0.9, 0.3, 0.9, 0x8a8f99)
    k.cyl(x, 0.3, z, 0.2, 1.2, 0x8a8f99, { seg: 6, cap: false })
    k.box(x, 1.5, z, 0.8, 0.16, 0.8, 0x8a8f99, { cap: false })
    k.box(x, 1.66, z, 0.55, 0.55, 0.55, on ? 0xffd98a : 0x6f7a8a, { glow: on, cap: false })
    k.cone(x, 2.21, z, 0.7, 0.5, 0x6f737d, { seg: 4 })
    if (on) k.halo(x, 0, z, 1.8, 0xffd98a, 0.28)
  }

  // Twelve and a half out: the bathhouse is fourteen by twelve and a half, which
  // is nine and a half across the frame, and at ten its near wall was on the
  // felt's rim — where the table cuts it.
  const bathSpot = { sx: sx + a + 12.5, sy: sy + 2 }
  const pagodaSpot = { sx: sx - 18, sy: sy + b + 8 }
  const toriiSpot = { sx: sx - a - 4, sy: sy - b - 5 }
  const near = (c: { sx: number; sy: number }, p: { sx: number; sy: number }, r: number) => Math.hypot(c.sx - p.sx, (c.sy - p.sy) / 0.53) < r

  /** An unbuilt block: a cherry tree or two, a pond now and then, a stone lantern. */
  const garden = (x: number, z: number, w: number) => {
    k.tree(x + rng.range(-w / 4, w / 4), z + rng.range(-w / 4, w / 4), { kind: 'sakura', h: rng.range(1.6, 2.2), r: rng.range(1.1, 1.5), trunk: 0x3d2a1e })
    const g = rng.next()
    if (g < 0.35) {
      const px = x + rng.range(-2, 2), pz = z + rng.range(-2, 2)
      k.disc(px, 0, pz, 1.8, 0x7fd1e8, { seg: 12 })
      k.rock(px + 1.6, pz - 1, 0.5)
      k.rock(px - 1.4, pz + 1.2, 0.4)
    } else if (g < 0.6) {
      k.tree(x + rng.range(-w / 3, w / 3), z + rng.range(-w / 3, w / 3), { kind: 'sakura', h: rng.range(1.4, 2), r: rng.range(1.0, 1.3), trunk: 0x3d2a1e })
    } else if (g < 0.8) {
      stoneLantern(x + rng.range(-3, 3), z + rng.range(-3, 3))
    }
  }

  const plan = cityGrid(k, {
    block: 12,
    road: 2.8,
    roadColor: 0x9a9488,
    dashes: false,
    lamp: undefined,
    people: 0.2,
    maxHeight: 5.5,
    water: { line: 2, axis: 'x', color: k.rig.snow ? 0xb8dcee : 0x6fbfe8, bank: 0x8a8f99, bridge: RED },
    plaza,
    density: (c) => (c.front ? 1 : c.dist < 40 ? 0.45 : 0.7),
    open: (c) => {
      if (near(c, bathSpot, 9) || near(c, pagodaSpot, 8)) return
      garden(c.x, c.z, c.w)
    },
    fill: (c) => {
      if (near(c, bathSpot, 9) || near(c, pagodaSpot, 8)) return
      const ls = lots(c, 2, 2, 1.4)
      // One house near the square, one or two at the edge, none in front.
      const houses = c.front ? 0 : c.dist < 40 ? 1 : rng.int(1, 2)
      ls.forEach((l, i) => {
        if (i < houses) {
          woodHouse(l.x, l.z, Math.min(l.w, rng.range(3.5, 5)), Math.min(l.d, rng.range(3, 4.5)), rng.pick([0, Math.PI / 2]))
        } else {
          const g = rng.next()
          if (g < 0.5) {
            k.tree(l.x, l.z, { kind: 'sakura', h: rng.range(1.4, 2.2), r: rng.range(1.0, 1.4), trunk: 0x3d2a1e })
            if (rng.chance(0.5)) stoneLantern(l.x + 1.8, l.z + 1.4)
          } else if (g < 0.62) {
            k.flowerbed(l.x, l.z, Math.min(l.w - 1.2, 2.8), Math.min(l.d - 1.2, 2), { colors: [0xff8fb8, 0xffffff, 0xffc0d8, 0xf4d35e], kerb: 0x8a8f99 })
            k.rock(l.x + 1.8, l.z - 1.2, 0.4)
          } else if (g < 0.75) {
            k.disc(l.x, 0, l.z, 1.8, 0x7fd1e8, { seg: 12 })
            for (let i = 0; i < 4; i++) k.slab(l.x + rng.range(-1, 1), l.z + rng.range(-1, 1), 0.4, 0.2, rng.chance(0.6) ? 0xff8a3c : 0xffffff, { y: 0.03, h: 0.02 })
            k.rock(l.x + 1.6, l.z - 1, 0.5)
            k.rock(l.x - 1.4, l.z + 1.2, 0.4)
          } else {
            for (let i = 0; i < 8; i++) k.cyl(l.x + rng.range(-1.6, 1.6), 0, l.z + rng.range(-1.6, 1.6), 0.09, rng.range(2.5, 4.5), 0x7bbf5a, { seg: 5, cap: false, outline: false })
          }
        }
      })
      if (rng.chance(0.5)) k.fence(c.x - c.w / 2, c.z + c.d / 2, c.x + c.w / 2, c.z + c.d / 2, WOOD, 0.8)
    },
  })

  // ─── The bathhouse, on the right, its pool in front ────────────────────
  const poolSpot = at(bathSpot.sx - 6.5, bathSpot.sy - 9)
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
    const [px, pz] = poolSpot
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

  // ─── Lanterns around the square, and nothing strung over it ────────────
  for (let i = 0; i < 6; i++) {
    const t = (i / 6) * Math.PI * 2 + 0.5
    const [x, z] = at(sx + Math.cos(t) * (a + 7), sy + Math.sin(t) * (b + 4.5))
    if (Math.cos(t) > 0.85) continue
    stoneLantern(x, z)
  }
  const [cx, cz] = at(sx, sy)
  {
    const [x, z] = at(sx - a - 6, sy - 3)
    k.stall(x, z, Math.atan2(cx - x, cz - z) + Math.PI, RED, PAPER)
  }
  for (let i = 0; i < 4; i++) {
    const t = (i / 4) * Math.PI * 2 + 0.6
    const [x, z] = at(sx + Math.cos(t) * (a + 4), sy + Math.sin(t) * (b + 3))
    k.bench(x, z, Math.atan2(cx - x, cz - z) + Math.PI, WOOD)
  }
  crowd(k, 5, { shirt: undefined })

  // ─── What moves: steam off the pool, petals, a cat on the rim ──────────
  const life: Actor[] = []
  for (let i = 0; i < 3; i++) {
    const [px, pz] = poolSpot
    life.push(puff(k, `steam-${i}`, { at: over(px + (i - 1) * 1.6, pz + (i % 2) * 1.2, 0.4), rise: 2.2, duration: 3600 + i * 700, delay: i * 1200, size: 0.9, color: 0xf4f7fb }))
  }
  if (!k.rig.snow && k.rig.weather !== 'rain') {
    // Petals drifting down the side bands, each a small pink plate on the
    // wind, fading in at the top of its fall and out where it lands.
    for (let i = 0; i < 5; i++) {
      const side = i % 2 ? 1 : -1
      const px = sx + side * (a + rng.range(2, 12))
      life.push({
        id: `petal-${i}`,
        flying: true,
        fade: true,
        motion: 'loop',
        path: [[px, sy + rng.range(12, 20)], [px + rng.range(2, 5), sy + rng.range(2, 6)], [px + rng.range(-1, 6), sy - rng.range(6, 10)]],
        duration: rng.range(11_000, 16_000),
        delay: rng.range(0, 12_000),
        bob: { amp: 0.25, period: rng.range(1400, 2200) },
        build: (kk) => kk.box(0, 6, 0, 0.36, 0.06, 0.28, rng.pick([0xf5a3c7, 0xffc0d8, 0xff8fb8]), { rot: rng.range(0, 3), tilt: 0.4, outline: false, cap: false }),
      })
    }
  }
  life.push({
    id: 'cat',
    path: [[sx + a + 4, sy + 7], [sx + a + 9, sy + 4]],
    duration: 22_000,
    motion: 'bounce',
    turn: true,
    build: (kk) => {
      const rot = Math.PI / 4
      kk.box(0, 0.25, 0, 0.5, 0.25, 0.25, 0xff8a3c, { rot })
      kk.sphere(0.25 * Math.cos(rot), 0.55, -0.25 * Math.sin(rot), 0.14, 0xff8a3c, { seg: 5 })
      kk.box(-0.3 * Math.cos(rot), 0.4, 0.3 * Math.sin(rot), 0.25, 0.06, 0.06, 0xff8a3c, { rot, tilt: 0.7, outline: false, cap: false })
    },
  })
  if (k.rig.weather === 'clear' || k.rig.weather === 'cloudy') {
    life.push(cloud(k, 'cloud-0', { sy: 19, size: 1.0, duration: 200_000 }))
    life.push(cloud(k, 'cloud-1', { sy: 16, size: 0.7, duration: 250_000, delay: 120_000, from: 50, to: -50 }))
    life.push(bird(k, 'bird-0', { path: [[-50, 16], [-15, 19], [25, 15], [50, 18]], duration: 36_000, color: 0x2a2a2a }))
  }
  life.push(...streetWalkers(k, plan, 2))
  return life
}
