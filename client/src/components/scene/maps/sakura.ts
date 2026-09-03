/**
 * Sakura: a hot-spring village under cherry trees.
 *
 * Raked gravel around the table, a bathhouse with steam coming off its pool,
 * a pagoda, a torii, stone lanterns and strings of paper ones, a red bridge
 * over a stream with koi in it. The trees are in blossom in every season the
 * server deals, because a village that is only pink in April is a village
 * nobody is dealt into in October. Snow here is the postcard.
 *
 * The bathhouse is on the right with its pool in front of it, the pagoda at
 * the top, the torii and its path at the bottom left, the stream down the far
 * left.
 */
import type { Builder } from './common'
import { crowd, roundPlaza, ring, along, at, PLAZA_R, INNER, MID, OUTER, FAR, FLOOR } from './common'
import { mix } from '../sky'

const RED = 0xd23b3b
const WOOD = 0x4a3323
const PAPER = 0xf6efe0
const TILE = 0x334a66

export const sakura: Builder = (k) => {
  const rng = k.rng
  const on = k.rig.lampsOn
  const screenX = (x: number, z: number) => (x - z) / Math.SQRT2
  const screenY = (x: number, z: number) => (-(x + z) / Math.SQRT2) * 0.53
  const free = (x: number, z: number) => {
    const sx = screenX(x, z), sy = screenY(x, z)
    if (Math.abs(sx + 38) < 6) return false
    if (sx > 24 && sy > -14 && sy < 10) return false
    if (Math.abs(sx + 20) < 10 && sy > 12) return false
    if (Math.abs(sx + 28) < 8 && sy < -10) return false
    return true
  }

  k.floor(0x6aa84f, FLOOR)
  roundPlaza(k, PLAZA_R, 0xd9d2c2, 0xcfc7b5, 22)
  k.puddles(0, 0, PLAZA_R - 2, 16)
  ring(k, 10, PLAZA_R - 6, (x, z) => k.disc(x, 0.08, z, rng.range(1, 2), k.ground(0x5f9a48), { seg: 10 }), 0.2)
  for (const a of [0.6, 2.2, 3.9, 5.4]) {
    along(Math.cos(a) * PLAZA_R, Math.sin(a) * PLAZA_R, Math.cos(a) * 100, Math.sin(a) * 100, 36, (x, z) =>
      k.disc(x + rng.range(-0.3, 0.3), 0.06, z + rng.range(-0.3, 0.3), 0.8, k.ground(0x9a9488), { seg: 8 }),
    )
  }

  // ─── The stream and the red bridge, down the far left ──────────────────
  {
    const water = k.rig.snow ? 0xb8dcee : 0x6fbfe8
    const rot = Math.PI / 4
    const [cx, cz] = at(-38, 0)
    k.slab(cx, cz, 220, 4.6, water, { rot, y: -0.02, h: 0.04 })
    for (let i = 0; i < 60; i++) {
      const t = rng.range(-100, 100)
      k.slab(cx + t * Math.cos(rot), cz - t * Math.sin(rot) + rng.range(-1.5, 1.5), rng.range(0.4, 1), 0.14, 0xdff4ff, { rot, y: 0.02, h: 0.02 })
    }
    for (let i = 0; i < 20; i++) {
      const t = rng.range(-30, 30)
      k.slab(cx + t * Math.cos(rot), cz - t * Math.sin(rot) + rng.range(-1.2, 1.2), 0.5, 0.22, rng.chance(0.6) ? 0xff8a3c : 0xffffff, { rot, y: 0.03, h: 0.03 })
    }
    along(cx - 100 * Math.cos(rot), cz + 100 * Math.sin(rot), cx + 100 * Math.cos(rot), cz - 100 * Math.sin(rot), 70, (x, z) => {
      k.rock(x + 2.6 * Math.sin(-rot), z + 2.6 * Math.cos(-rot), rng.range(0.25, 0.5), 0x8a8f99)
      k.rock(x - 2.6 * Math.sin(-rot), z - 2.6 * Math.cos(-rot), rng.range(0.25, 0.5), 0x8a8f99)
    })
    const arch = [[-3, 0.2], [-2, 0.6], [-1, 0.9], [0, 1.0], [1, 0.9], [2, 0.6], [3, 0.2]] as const
    for (const [t, h] of arch) {
      const px = cx + t * Math.sin(rot) * 1.1
      const pz = cz + t * Math.cos(rot) * 1.1
      k.box(px, 0, pz, 2.8, h + 0.2, 1.2, RED, { rot: rot + Math.PI / 2 })
      k.box(px, h + 0.2, pz, 2.6, 0.08, 1.15, mix(RED, 0x000000, 0.25), { rot: rot + Math.PI / 2, outline: false, cap: false })
      for (const s of [-1.3, 1.3]) {
        k.box(px + s * Math.cos(rot), h + 0.2, pz - s * Math.sin(rot), 0.14, 0.9, 0.14, RED, { cap: false })
      }
    }
    k.person(cx + 0.4, cz + 0.4, rot, { shirt: 0xffb7d0 })
  }

  // ─── The bathhouse, on the right, its pool in front ────────────────────
  {
    const [bx, bz] = at(33.5, 2)
    const rot = Math.PI / 4
    k.box(bx, 0, bz, 13, 0.6, 11, 0x8a847a, { rot })
    k.box(bx, 0.6, bz, 12, 4.4, 10, WOOD, { rot })
    // Paper panels on the face that looks at the square (screen-left).
    for (let i = -2; i <= 2; i++) {
      const [px, pz] = at(33.5 - 6.03 / Math.SQRT2, 2 + i * 1.25)
      k.box(px, 1.2, pz, 0.1, 2.5, 1.5, on ? mix(PAPER, 0xffd98a, 0.5) : PAPER, { rot, glow: on, outline: false, cap: false })
    }
    k.prism(bx, 5.0, bz, 14, 3.4, 12.5, TILE, { rot })
    k.box(bx, 4.8, bz, 14.2, 0.3, 12.7, mix(TILE, 0x000000, 0.3), { rot, outline: false, cap: false })
    k.box(bx, 8.4, bz, 14.4, 0.35, 0.6, mix(TILE, 0x000000, 0.4), { rot, cap: false })
    const [dx, dz] = at(29.1, 2)
    k.box(dx, 1.6, dz, 0.06, 1.4, 2.4, 0x2f4a8a, { rot, outline: false, cap: false })
    k.lantern(...at(28.9, 4.2), 2.6, 0xff5a3c, 0.32)
    k.lantern(...at(28.9, -0.2), 2.6, 0xff5a3c, 0.32)
    const [px, pz] = at(29, -9)
    k.disc(px, 0, pz, 4.6, 0x8a8f99, { seg: 18 })
    k.disc(px, 0.12, pz, 4, 0x7fd1e8, { seg: 18 })
    ring(k, 14, 4.3, (x, z) => k.rock(px + x, pz + z, rng.range(0.35, 0.65), 0x8a8f99), 0.1)
    for (let i = 0; i < 9; i++) {
      const a = rng.next() * Math.PI * 2, r = rng.range(0, 2.8)
      k.sphere(px + Math.cos(a) * r, 0.5 + rng.range(0, 1.6), pz + Math.sin(a) * r, rng.range(0.3, 0.7), 0xffffff, { seg: 6, outline: false })
    }
    k.sphere(px - 1.4, 0.35, pz + 0.7, 0.22, 0xf3c9a5, { seg: 6 })
    k.sphere(px - 1.4, 0.5, pz + 0.7, 0.2, 0x2b1b12, { seg: 6, outline: false })
    k.sphere(px + 1.6, 0.35, pz - 0.9, 0.22, 0xd9a072, { seg: 6 })
    k.box(px + 1.6, 0.48, pz - 0.9, 0.5, 0.06, 0.4, 0xffffff, { outline: false, cap: false })
    k.sphere(px + 0.4, 0.35, pz + 1.8, 0.22, 0xa5683d, { seg: 6 })
    k.lamp(...at(25, -12), { h: 1.6, style: 'lantern', color: 0xffd98a, post: 0x8a8f99 })
    const [f1x, f1z] = at(24, -6), [f2x, f2z] = at(24, -13)
    k.fence(f1x, f1z, f2x, f2z, WOOD, 1.2)
    k.person(...at(27, -5), rot + Math.PI, { shirt: 0xffffff })
  }

  // ─── The pagoda at the top ─────────────────────────────────────────────
  {
    const [px, pz] = at(-19, 15.5)
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
    const [sx, sz] = at(-8, 15.5)
    k.box(sx, 0, sz, 3, 2.2, 2.6, WOOD, { rot: 0.3 })
    k.prism(sx, 2.2, sz, 4, 1.4, 3.6, TILE, { rot: 0.3 })
    k.box(sx + 1.2, 0, sz + 1.8, 1.2, 0.8, 0.8, WOOD, { rot: 0.3 })
    k.person(...at(-7, 13.5), Math.PI / 4)
  }

  // ─── The torii and its path, bottom left ───────────────────────────────
  {
    const [tx, tz] = at(-28, -15)
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
    for (let i = 1; i < 14; i++) k.slab(...at(-28 - i * 0.9, -15 - i * 1.6), 2.6, 2.6, k.ground(0x9a9488), { rot, h: 0.05 })
    k.tree(...at(-31, -12), { kind: 'sakura', h: 2, r: 1.4, trunk: 0x3d2a1e })
    k.tree(...at(-24, -18), { kind: 'sakura', h: 1.8, r: 1.3, trunk: 0x3d2a1e })
    for (let i = 0; i < 50; i++) {
      const [x, z] = at(-34 + rng.range(-3, 3), -17 + rng.range(-3, 3))
      k.cyl(x, 0, z, 0.09, rng.range(2.5, 5), 0x7bbf5a, { seg: 5, cap: false, outline: false })
    }
  }

  // ─── Stone lanterns, paper lanterns, tea stalls ────────────────────────
  const stoneLantern = (x: number, z: number) => {
    k.box(x, 0, z, 0.9, 0.3, 0.9, 0x8a8f99)
    k.cyl(x, 0.3, z, 0.2, 1.2, 0x8a8f99, { seg: 6, cap: false })
    k.box(x, 1.5, z, 0.8, 0.16, 0.8, 0x8a8f99, { cap: false })
    k.box(x, 1.66, z, 0.55, 0.55, 0.55, on ? 0xffd98a : 0x6f7a8a, { glow: on, cap: false })
    k.cone(x, 2.21, z, 0.7, 0.5, 0x6f737d, { seg: 4 })
    if (on) k.halo(x, 0, z, 1.8, 0xffd98a, 0.28)
  }
  ring(k, 12, PLAZA_R + 1.5, (x, z) => { if (free(x, z)) stoneLantern(x, z) }, 0.05)
  const P = PLAZA_R - 6
  const posts: [number, number][] = [[-P, -P], [P, -P], [P, P], [-P, P]]
  for (const [x, z] of posts) k.cyl(x, 0, z, 0.12, 4, WOOD, { seg: 6, cap: false })
  for (let i = 0; i < 4; i++) {
    const [x1, z1] = posts[i]
    const [x2, z2] = posts[(i + 1) % 4]
    along(x1, z1, x2, z2, 24, (x, z, t) => {
      if (t === 0 || t === 1) return
      k.lantern(x, 3.3 - Math.sin(t * Math.PI) * 0.7, z, rng.chance(0.7) ? 0xff5a3c : 0xffffff, 0.24)
    })
  }
  const stallAt = (sx: number, sy: number, a: number, b: number) => {
    const [x, z] = at(sx, sy)
    k.stall(x, z, Math.atan2(-x, -z) + Math.PI, a, b)
  }
  stallAt(-31, 6, RED, PAPER)
  stallAt(-33, 12, 0x2f4a8a, PAPER)
  stallAt(22, -16, RED, PAPER)
  ring(k, 8, PLAZA_R - 8, (x, z, a) => k.bench(x, z, -a + Math.PI / 2, WOOD), 0.02)

  // ─── Trees, and the village beyond ─────────────────────────────────────
  ring(k, 20, INNER + 3, (x, z) => { if (free(x, z)) k.tree(x, z, { kind: 'sakura', h: rng.range(1.4, 2.2), r: rng.range(1.0, 1.5), trunk: 0x3d2a1e }) }, 0.3)
  ring(k, 26, MID + 7, (x, z) => { if (free(x, z)) k.tree(x, z, { kind: rng.chance(0.6) ? 'sakura' : 'pine', h: rng.range(1.8, 3), r: rng.range(1.2, 1.8) }) }, 0.3)
  ring(k, 30, OUTER + 8, (x, z) => { if (free(x, z)) k.tree(x, z, { kind: rng.chance(0.5) ? 'sakura' : 'pine', h: rng.range(2, 3.2), r: rng.range(1.2, 1.9) }) }, 0.3)
  ring(k, 34, FAR + 14, (x, z) => k.tree(x, z, { kind: 'pine', h: rng.range(2.4, 3.6), r: rng.range(1.4, 2.1) }), 0.3)
  const houseAt = (x: number, z: number, a: number) => {
    const w = rng.range(4, 6.5), d = rng.range(3.5, 5.5), h = rng.range(2.8, 3.8)
    const rot = -a + Math.PI / 2
    k.box(x, 0, z, w, h, d, rng.chance(0.5) ? WOOD : PAPER, { rot })
    k.prism(x, h, z, w + 1.4, 1.6, d + 1.4, TILE, { rot })
    k.box(x, h - 0.1, z, w + 1.6, 0.25, d + 1.6, mix(TILE, 0x000000, 0.35), { rot, outline: false, cap: false })
    const lit = rng.chance(k.rig.windowsLit)
    k.box(x + (d / 2 + 0.05) * Math.sin(rot), 0.9, z + (d / 2 + 0.05) * Math.cos(rot), 1.6, 1.2, 0.08, lit ? 0xffd98a : PAPER, { rot, glow: lit, outline: false, cap: false })
  }
  ring(k, 14, OUTER, (x, z, a) => { if (free(x, z)) houseAt(x, z, a) }, 0.2)
  ring(k, 20, FAR + 4, (x, z, a) => { if (free(x, z)) houseAt(x, z, a) }, 0.2)
  ring(k, 24, FAR + 26, (x, z, a) => houseAt(x, z, a), 0.2)
  crowd(k, 22, PLAZA_R - 8, PLAZA_R + 2, { shirt: undefined })
  for (let i = 0; i < 8; i++) k.person(...at(rng.range(-24, 24), 13 + rng.range(-1, 1)), rng.range(0, 6.3), { shirt: rng.pick([RED, 0x2f4a8a, PAPER, 0xffb7d0]) })
  const [catx, catz] = at(28, 7)
  k.box(catx, 0.6, catz, 0.5, 0.25, 0.25, 0xff8a3c)
  k.sphere(catx + 0.25, 0.95, catz, 0.14, 0xff8a3c, { seg: 5 })
}
