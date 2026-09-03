/**
 * Rune: the square of a village that has a wizard in it.
 *
 * Cobbles, half-timbered houses, a tavern with a lantern over its door, a
 * tower whose windows are the wrong colour, and four standing stones around
 * the square with something carved into them that glows after dark. Market
 * day: stalls, barrels, a cart, chickens' worth of people. A stream runs down
 * the left of the village under a stone bridge.
 *
 * The tavern is on the right, the tower top left, the well and the market
 * bottom left, the stream down the far left.
 */
import type { Builder } from './common'
import { crowd, roundPlaza, ring, along, at, PLAZA_R, INNER, MID, OUTER, FAR, FLOOR } from './common'
import { mix, scale } from '../sky'

export const rune: Builder = (k) => {
  const rng = k.rng
  const on = k.rig.lampsOn

  k.floor(0x5fa653, FLOOR)
  roundPlaza(k, PLAZA_R, 0x8d857a, 0x7c746a, 22)
  k.puddles(0, 0, PLAZA_R - 2, 22)

  for (const a of [0.35, 1.9, 3.5, 5.0]) {
    along(Math.cos(a) * PLAZA_R, Math.sin(a) * PLAZA_R, Math.cos(a) * 110, Math.sin(a) * 110, 30, (x, z) =>
      k.slab(x, z, 2.8, 2.6, k.ground(0x9c7f58), { rot: -a, h: 0.05 }),
    )
  }

  // ─── Houses ────────────────────────────────────────────────────────────
  const plasters = [0xf1e3c8, 0xe9d6b8, 0xf5e9d2, 0xdcc7a4, 0xead9c7]
  const roofs = [0x8b3a2a, 0x6b4a2b, 0x3f4a5c, 0x7a5a3a, 0x9a4a3a]
  const house = (x: number, z: number, w: number, h: number, d: number, rot: number) => {
    const plaster = rng.pick(plasters)
    const roof = rng.pick(roofs)
    k.box(x, 0, z, w, h, d, plaster, { rot })
    k.box(x, 0, z, w + 0.2, 0.7, d + 0.2, 0x6f6a62, { rot })
    const beam = 0x4a2e17
    for (const fx of [-1, 1]) {
      const px = x + ((fx * w) / 2) * Math.cos(rot)
      const pz = z - ((fx * w) / 2) * Math.sin(rot)
      k.box(px, 0.7, pz, 0.16, h - 0.7, 0.16, beam, { rot, outline: false, cap: false })
    }
    k.box(x, h - 0.2, z, w + 0.08, 0.16, d + 0.08, beam, { rot, outline: false, cap: false })
    k.box(x, h / 2 + 0.2, z, w + 0.08, 0.14, d + 0.08, beam, { rot, outline: false, cap: false })
    const cols = Math.max(1, Math.floor(w / 1.6))
    for (let c = 0; c < cols; c++) {
      const lx = -w / 2 + (c + 0.5) * (w / cols)
      const wx = x + lx * Math.cos(rot) + (d / 2 + 0.03) * Math.sin(rot)
      const wz = z - lx * Math.sin(rot) + (d / 2 + 0.03) * Math.cos(rot)
      const lit = rng.chance(k.rig.windowsLit)
      k.box(wx, 1.4, wz, 0.55, 0.6, 0.08, lit ? 0xffd98a : 0x2a3346, { rot, glow: lit, outline: false, cap: false })
      if (h > 3.4) {
        const lit2 = rng.chance(k.rig.windowsLit)
        k.box(wx, h - 1.4, wz, 0.55, 0.6, 0.08, lit2 ? 0xffd98a : 0x2a3346, { rot, glow: lit2, outline: false, cap: false })
      }
    }
    k.prism(x, h, z, w + 0.5, Math.min(w, d) * 0.55, d + 0.5, roof, { rot })
    k.box(x + w * 0.25 * Math.cos(rot), h, z - w * 0.25 * Math.sin(rot), 0.5, Math.min(w, d) * 0.55 + 0.5, 0.5, 0x6f6a62, { rot })
  }
  const onStream = (x: number, z: number) => Math.abs(x - z + 52) < 8
  ring(k, 14, MID + 4, (x, z, a) => { if (!onStream(x, z) && !(x > 14 && z < -8)) house(x, z, rng.range(4, 6.5), rng.range(3, 4.4), rng.range(3.5, 5), -a + Math.PI / 2) }, 0.14)
  ring(k, 20, OUTER + 4, (x, z, a) => { if (!onStream(x, z)) house(x, z, rng.range(4, 7), rng.range(3, 5), rng.range(4, 6), -a + Math.PI / 2 + rng.range(-0.3, 0.3)) }, 0.14)
  ring(k, 26, FAR + 6, (x, z, a) => { if (!onStream(x, z)) house(x, z, rng.range(4, 7), rng.range(3, 5), rng.range(4, 6), -a + Math.PI / 2 + rng.range(-0.3, 0.3)) }, 0.14)
  ring(k, 30, FAR + 26, (x, z, a) => house(x, z, rng.range(4, 7), rng.range(3, 5), rng.range(4, 6), -a + Math.PI / 2 + rng.range(-0.3, 0.3)), 0.14)

  // ─── The stream and its bridge, down the far left ──────────────────────
  {
    const water = k.rig.snow ? 0x9fd0e8 : 0x3f8fd6
    const rot = Math.PI / 4
    const [cx, cz] = at(-37, 0)
    k.slab(cx, cz, 220, 4.4, water, { rot, h: 0.04, y: -0.02 })
    for (let i = 0; i < 60; i++) {
      const t = rng.range(-100, 100)
      k.slab(cx + t * Math.cos(rot), cz - t * Math.sin(rot) + rng.range(-1.5, 1.5), rng.range(0.5, 1.2), 0.14, 0xbfe4f5, { rot, y: 0.02, h: 0.02 })
    }
    k.slab(cx + 2.4 * Math.sin(rot), cz + 2.4 * Math.cos(rot), 220, 0.5, 0x6f6a62, { rot, h: 0.3 })
    k.slab(cx - 2.4 * Math.sin(rot), cz - 2.4 * Math.cos(rot), 220, 0.5, 0x6f6a62, { rot, h: 0.3 })
    for (const [t, h] of [[-2.2, 0.35], [-1.2, 0.7], [0, 0.9], [1.2, 0.7], [2.2, 0.35]] as const) {
      k.box(cx + t * Math.sin(rot), 0, cz + t * Math.cos(rot), 3.4, h, 1.1, 0x8a847a, { rot: rot + Math.PI / 2 })
    }
    k.fence(cx - 1.6 * Math.cos(rot) - 3 * Math.sin(rot), cz + 1.6 * Math.sin(rot) - 3 * Math.cos(rot), cx - 1.6 * Math.cos(rot) + 3 * Math.sin(rot), cz + 1.6 * Math.sin(rot) + 3 * Math.cos(rot), 0x6f6a62, 0.7)
    k.fence(cx + 1.6 * Math.cos(rot) - 3 * Math.sin(rot), cz - 1.6 * Math.sin(rot) - 3 * Math.cos(rot), cx + 1.6 * Math.cos(rot) + 3 * Math.sin(rot), cz - 1.6 * Math.sin(rot) + 3 * Math.cos(rot), 0x6f6a62, 0.7)
    k.person(cx + 4 * Math.sin(rot), cz + 4 * Math.cos(rot), rot)
  }

  // ─── The tavern, on the right, facing the square ───────────────────────
  {
    const [tx, tz] = at(30.5, 1)
    const rot = Math.PI / 4
    house(tx, tz, 10, 4.8, 6.5, rot)
    house(tx + 4.5, tz - 5.5, 5, 3.4, 4, rot + 0.15)
    // The door, the sign and the lantern are on the face that looks at the
    // square, which is screen-left of the building.
    const [dx, dz] = at(30.5 - 4.6, 1)
    k.box(dx, 0, dz, 1.2, 2.2, 0.16, 0x3a2414, { rot, cap: false })
    k.box(dx + 1.2, 2.6, dz - 1.2, 1.2, 0.1, 0.1, 0x4a2e17, { rot, outline: false, cap: false })
    k.box(dx + 1.6, 1.8, dz - 1.6, 0.9, 0.7, 0.08, 0x8b3a2a, { rot })
    k.cyl(dx + 1.55, 2.05, dz - 1.65, 0.22, 0.1, 0xffab52, { seg: 8, axis: 'z', rot, glow: on, outline: false })
    k.lamp(dx - 1.8, dz + 0.6, { h: 2.2, style: 'lantern', color: 0xffab52, post: 0x4a2e17 })
    const [bx, bz] = at(27.5, -3)
    k.barrel(bx, bz)
    k.barrel(bx + 0.7, bz + 0.5)
    k.barrel(bx + 0.35, bz + 0.25, 0x8a5a2f, 0.8)
    const [ex, ez] = at(28, 4.5)
    k.bench(ex, ez, rot)
    k.person(ex - 0.6, ez - 0.6, rot + Math.PI, { hat: 0x2b1b12 })
    k.person(ex + 0.6, ez + 0.6, rot + Math.PI)
    k.crate(bx + 1.6, bz + 1.4, 0.6)
  }

  // ─── The wizard's tower, top left ──────────────────────────────────────
  {
    const [wx, wz] = at(-22, 15.5)
    k.cyl(wx, 0, wz, 3.2, 1.2, 0x6f6a62, { seg: 12 })
    k.cyl(wx, 1.2, wz, 2.6, 12, 0x8a8fa3, { seg: 12 })
    k.cyl(wx, 13.2, wz, 3.1, 0.8, 0x6f6a62, { seg: 12 })
    k.cone(wx, 14, wz, 3.2, 6, 0x3d2a6b, { seg: 12 })
    k.sphere(wx, 20.4, wz, 0.4, on ? 0xc56bff : 0x7a6aa0, { glow: on, seg: 6 })
    for (let i = 0; i < 5; i++) {
      const y = 3 + i * 2.3
      k.box(wx + 2.62, y, wz + 0.5 * (i % 2 ? 1 : -1), 0.1, 0.7, 0.45, on ? 0xc56bff : 0x2a3346, { glow: on, outline: false, cap: false })
      k.box(wx - 0.5 * (i % 2 ? 1 : -1), y, wz + 2.62, 0.45, 0.7, 0.1, on ? 0xc56bff : 0x2a3346, { glow: on, outline: false, cap: false })
    }
    if (on) k.halo(wx, 20.4, wz, 1.3, 0xc56bff, 0.4, false)
    k.tree(wx + 5, wz + 3, { kind: 'pine', h: 2.4, r: 1.2 })
    k.tree(wx - 4.8, wz - 1, { kind: 'pine', h: 2.0, r: 1.0 })
    k.cyl(wx + 2.4, 0, wz + 4, 0.5, 0.7, 0x1c1c1c, { seg: 8, rTop: 0.6 })
    if (on) k.halo(wx + 2.4, 0.75, wz + 4, 0.7, 0x7cffd0, 0.5, false)
    k.person(wx + 4, wz + 5, Math.PI / 4, { shirt: 0x3d2a6b, pants: 0x3d2a6b, hat: 0x3d2a6b })
  }

  // ─── The well and the market, bottom left and left ─────────────────────
  {
    const [wx, wz] = at(-31, -5)
    k.cyl(wx, 0, wz, 1.2, 0.9, 0x6f6a62, { seg: 10 })
    k.disc(wx, 0.9, wz, 0.9, 0x1c2536, { seg: 10 })
    k.box(wx - 1.1, 0, wz, 0.16, 2.6, 0.16, 0x4a2e17, { cap: false })
    k.box(wx + 1.1, 0, wz, 0.16, 2.6, 0.16, 0x4a2e17, { cap: false })
    k.prism(wx, 2.6, wz, 3, 0.9, 2, 0x6b4a2b)
    k.box(wx, 1.8, wz, 0.3, 0.3, 0.3, 0x8a8fa0, { outline: false })
    k.person(wx + 1.8, wz + 0.4, -Math.PI / 2)
  }
  const stallAt = (sx: number, sy: number, a: number, b: number) => {
    const [x, z] = at(sx, sy)
    k.stall(x, z, Math.atan2(-x, -z) + Math.PI, a, b)
  }
  stallAt(-30, 4, 0xff3d68, 0xfff5e6)
  stallAt(-33, 10, 0x3d9bff, 0xfff5e6)
  stallAt(-24, -16, 0x2fd18a, 0xfff5e6)
  stallAt(-31, -12, 0xffd23c, 0xfff5e6)
  {
    const [cx, cz] = at(-28, -17)
    k.box(cx, 0.5, cz, 2.6, 0.7, 1.4, 0x8a5a2f, { rot: 0.6 })
    k.cyl(cx + 0.8, 0.45, cz + 0.6, 0.45, 0.2, 0x4a2e17, { axis: 'z', rot: 0.6, seg: 8 })
    k.cyl(cx - 0.8, 0.45, cz - 0.6, 0.45, 0.2, 0x4a2e17, { axis: 'z', rot: 0.6, seg: 8 })
    k.box(cx, 1.2, cz, 2.2, 0.8, 1.2, 0xe0b04a, { rot: 0.6 })
    k.crate(cx + 2.4, cz - 1.5, 0.7)
    k.crate(cx + 3.1, cz - 1.0, 0.55)
    k.crate(cx + 2.7, cz - 1.25, 0.5, 0xb98a4d, 0.7, 0.4)
    for (let i = 0; i < 4; i++) k.cyl(cx - 4 + i * 1.1, 0, cz + 2 + (i % 2) * 0.8, 0.5, 1.0, 0xe0b04a, { axis: 'x', seg: 8 })
  }

  // ─── The standing stones, on the plaza's rim at the four diagonals ─────
  for (const [sx, sy] of [[-30, 8], [30, 8], [-30, -8], [30, -8]] as const) {
    const [x, z] = at(sx, sy)
    const a = Math.atan2(-x, -z)
    k.box(x, 0, z, 1.1, 2.8, 0.8, 0x6f7a8a, { rot: a })
    k.box(x, 0.8, z, 0.14, 1.3, 0.82, on ? 0x7cffd0 : 0x4a5a5a, { rot: a, glow: on, outline: false, cap: false })
    if (on) k.halo(x, 0, z, 2.6, 0x7cffd0, 0.3)
  }

  ring(k, 10, PLAZA_R + 3, (x, z) => { if (!onStream(x, z)) k.lamp(x, z, { h: 2.4, style: 'lantern', color: 0xffab52, post: 0x4a2e17 }) }, 0.05)
  ring(k, 16, INNER + 4, (x, z) => { if (!onStream(x, z)) k.tree(x, z, { kind: rng.chance(0.3) ? 'pine' : 'round', h: rng.range(1.2, 2), r: rng.range(0.8, 1.3) }) }, 0.3)
  ring(k, 22, MID + 9, (x, z) => { if (!onStream(x, z)) k.tree(x, z, { kind: rng.chance(0.5) ? 'pine' : 'round', h: rng.range(1.4, 2.4), r: rng.range(0.9, 1.4) }) }, 0.3)
  ring(k, 28, OUTER + 10, (x, z) => { if (!onStream(x, z)) k.tree(x, z, { kind: 'pine', h: rng.range(2, 3.4), r: rng.range(1.2, 1.8) }) }, 0.3)
  ring(k, 34, FAR + 16, (x, z) => { if (!onStream(x, z)) k.tree(x, z, { kind: 'pine', h: rng.range(2.4, 3.6), r: rng.range(1.4, 2) }) }, 0.3)
  for (let i = 0; i < 30; i++) {
    const a = rng.next() * Math.PI * 2, r = rng.range(INNER, FAR + 20)
    k.bush(Math.cos(a) * r, Math.sin(a) * r, rng.range(0.4, 0.8))
  }
  crowd(k, 26, PLAZA_R - 6, PLAZA_R + 4)
  for (let i = 0; i < 6; i++) k.rock(rng.range(-90, 90), rng.range(-90, 90), rng.range(0.5, 1.0), mix(0x8a8f99, 0x5fa653, 0.2))
  k.rock(-40, 30, 1.0, scale(0x8a8f99, 0.9))
}
