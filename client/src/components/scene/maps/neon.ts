/**
 * Neon: a square in a city of neon.
 *
 * The table stands on a podium in the middle of a night district: blocks of
 * towers with their windows lit, neon tubes on every edge, billboards, signs,
 * a bar with its stools, cars with their headlights on, string lights over the
 * square. At night it is the map this game was named for; at noon it is a
 * city under a hard sun with the tubes off, in lighter stone.
 */
import type { Builder } from './common'
import { MAPS } from '../../cards/maps'
import { cityGrid, lots, podium, crowd, neonText, at, along, screenOf, FLOOR } from './common'
import { mix, cssHex } from '../sky'

export const neon: Builder = (k) => {
  const rng = k.rng
  const on = k.rig.lampsOn
  // A city by day is not a night city with the lights off: the same towers
  // stand in lighter stone under the sun.
  const palette = on
    ? [0x1c2140, 0x2a1f4d, 0x141a33, 0x22284a, 0x1a2a3f, 0x2b2540, 0x2f2a55]
    : [0x5a628a, 0x6b5f96, 0x4f5a80, 0x6a7096, 0x55708a, 0x6f6690, 0x7a7ba0]
  const neonColors = [0xff3dd0, 0x4fd6ff, 0xffd23c, 0x7cff6b, 0xc56bff, 0xff3d68]
  const shopGlow = [0xff3dd0, 0x4fd6ff, 0xffd23c, 0xff8a3c]

  k.floor(on ? 0x14162a : 0x8b90a8, FLOOR)

  const { cx, cz } = podium(k, {
    stone: on ? 0x15121f : 0x3a3550,
    step: on ? 0x22203a : 0x6a6a8a,
    floor: on ? 0x33374a : 0x9aa0b8,
    floor2: on ? 0x2b2f40 : 0x8d93ac,
    accent: 0xc56bff, top: cssHex(MAPS.neon.table.felt),
  })

  const tower = (x: number, z: number, w: number, d: number, h: number) => {
    const color = rng.pick(palette)
    k.tower(x, z, w, h, d, color, { floorH: 1.6, windowColor: rng.chance(0.3) ? 0x9fe8ff : 0xffd98a, roof: 'flat', roofColor: mix(color, 0x000000, 0.3) })
    // Shopfront on the ground floor, facing the camera.
    const c = rng.pick(shopGlow)
    k.box(x, 0.3, z + d / 2 + 0.05, w * 0.8, 1.6, 0.08, on ? c : 0x2a3346, { glow: on, outline: false, cap: false })
    k.box(x, 2.0, z + d / 2 + 0.5, w * 0.86, 0.12, 1.0, mix(c, 0x111111, on ? 0.2 : 0.6), { outline: false, cap: false })
    if (rng.chance(0.6)) {
      const nc = rng.pick(neonColors)
      k.box(x + w / 2 + 0.06, h - 0.3, z, 0.1, 0.25, d, on ? nc : 0x3a3f52, { glow: on, outline: false, cap: false })
      k.box(x, h - 0.3, z + d / 2 + 0.06, w, 0.25, 0.1, on ? nc : 0x3a3f52, { glow: on, outline: false, cap: false })
      if (on) k.halo(x, h + 0.2, z, Math.max(w, d) * 0.7, nc, 0.18)
    }
    if (rng.chance(0.35)) {
      const nc = rng.pick(neonColors)
      k.box(x, h, z, w * 0.7, 0.12, 0.12, 0x2a2a35, { cap: false })
      k.box(x, h, z + 0.1, w * 0.7, Math.min(3, w * 0.4), 0.2, on ? nc : mix(nc, 0x222222, 0.7), { glow: on, cap: false })
    }
    if (rng.chance(0.3)) {
      const mh = rng.range(2, 5)
      k.cyl(x, h, z, 0.12, mh, 0x8a8fa0, { seg: 5, cap: false })
      k.sphere(x, h + mh + 0.15, z, 0.2, 0xff3b3b, { glow: true, seg: 6, outline: false })
      k.halo(x, h + mh + 0.15, z, 0.5, 0xff3b3b, 0.4, false)
    }
    if (rng.chance(0.4)) {
      k.box(x - w / 2 + 1, h, z - d / 2 + 1, 1.4, 0.9, 1.2, 0x8d94a3)
      k.cyl(x + w / 2 - 1.2, h, z + d / 2 - 1.2, 0.7, 1.4, 0x6b5039, { seg: 8 })
    }
  }
  // A vertical neon sign hung off a corner.
  const signpost = (x: number, z: number, h: number) => {
    const nc = rng.pick(neonColors)
    k.box(x, 1.5, z, 0.5, h, 0.3, 0x1e1830)
    k.box(x, 1.8, z + 0.2, 0.3, h - 0.6, 0.1, on ? nc : mix(nc, 0x222222, 0.6), { glow: on, outline: false, cap: false })
  }

  cityGrid(k, {
    block: 11,
    road: 3.6,
    roadColor: on ? 0x1a1d2e : 0x3f4450,
    sidewalk: on ? 0x2a2d3f : 0x8b90a8,
    dashes: true,
    crossings: true,
    cars: [0xff3d68, 0x3d9bff, 0xffd23c, 0xf5f0e6, 0x2b2b2b, 0xc56bff],
    carDensity: 0.55,
    lamp: { h: 3, style: 'box', color: 0xffe1a1, post: 0x2a2f3a },
    people: 2,
    maxHeight: 24,
    fill: (c) => {
      if (c.front) {
        // A pocket park: nothing here may rise into the table.
        for (const l of lots(c, 2, 2, 1)) {
          const r = rng.next()
          if (r < 0.5) k.tree(l.x, l.z, { kind: 'round', h: 1.2, r: 0.8, leaf: 0x2fbf7a })
          else if (r < 0.75) k.bench(l.x, l.z, rng.pick([0, Math.PI / 2]), 0x4a4f66)
          else {
            k.box(l.x, 0, l.z, 2.2, 2.0, 1.6, 0x2f2540, { rot: rng.pick([0, Math.PI / 2]) })
            k.box(l.x, 0.4, l.z + 0.83, 1.6, 1.0, 0.06, on ? rng.pick(shopGlow) : 0x2a3346, { glow: on, outline: false, cap: false })
          }
        }
        return
      }
      // Big towers away from the square, smaller ones beside it.
      const near = c.dist < 42
      const split = near ? 2 : rng.chance(0.5) ? 2 : 1
      for (const l of lots(c, split, split, 1.2)) {
        const h = near ? rng.range(4, 10) : rng.range(8, 24)
        tower(l.x, l.z, l.w - rng.range(0, 1.5), l.d - rng.range(0, 1.5), h)
      }
      if (rng.chance(0.5)) signpost(c.x + c.w / 2 - 0.2, c.z + c.d / 2 - 0.2, rng.range(3, 6))
      if (rng.chance(0.4)) k.tree(c.x - c.w / 2 - 0.9, c.z + c.d / 2 + 0.9, { kind: 'round', h: 1.2, r: 0.7, leaf: 0x2fbf7a })
    },
  })

  // ─── The square around the podium ──────────────────────────────────────
  const { a, b, sx, sy } = k.anchor
  // The sign, the brand, on a billboard at the top of the square.
  {
    const [px, pz] = at(sx + 3, sy + b + 8.5)
    const rot = Math.PI / 4
    k.box(px - 7 * Math.cos(rot), 0, pz + 7 * Math.sin(rot), 0.3, 6.2, 0.3, 0x2a2a35, { cap: false })
    k.box(px + 7 * Math.cos(rot), 0, pz - 7 * Math.sin(rot), 0.3, 6.2, 0.3, 0x2a2a35, { cap: false })
    k.box(px, 3.2, pz, 15, 3.4, 0.35, 0x101322, { rot })
    neonText(k, 'LOCO!', px + 0.25 * Math.sin(rot), 3.55, pz + 0.25 * Math.cos(rot), 0.5, 0xff3d68, rot)
  }
  // The bar on the left, its stools and its dance floor.
  {
    const rot = Math.PI / 4
    const [bx, bz] = at(sx - a - 6, sy + 1)
    k.box(bx, 0, bz, 7, 1.1, 1.3, 0x2f2540, { rot })
    k.box(bx, 1.1, bz, 7.2, 0.12, 1.5, 0xc56bff, { rot, glow: on, outline: !on, cap: false })
    const [wx, wz] = at(sx - a - 9, sy + 1)
    k.box(wx, 0, wz, 7, 2.8, 0.5, 0x1e1830, { rot })
    along(wx - 2.4, wz - 2.4, wx + 2.4, wz + 2.4, 9, (x, z) => k.box(x, 1.6, z, 0.24, 0.6, 0.24, rng.pick(neonColors), { glow: on, outline: false, cap: false }))
    const [tx, tz] = at(sx - a - 3.5, sy + 1)
    along(tx - 2, tz - 2, tx + 2, tz + 2, 5, (x, z) => {
      k.cyl(x, 0, z, 0.08, 0.7, 0x8a8fa0, { seg: 5, cap: false })
      k.cyl(x, 0.7, z, 0.32, 0.14, 0xff3d68, { seg: 8, cap: false })
    })
    k.person(...at(sx - a - 7.5, sy + 1.2), rot + Math.PI, { shirt: 0xffffff, pants: 0x1c1c1c })
    if (on) k.halo(bx, 0, bz, 5, 0xc56bff, 0.2)
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 4; j++) {
        const [fx, fz] = at(sx - a - 8 + i * 1.1, sy - 5 - j * 1.2)
        k.slab(fx, fz, 1.2, 1.2, on ? rng.pick(neonColors) : 0x3a3f52, { y: 0.12, h: 0.06, outline: false, rot })
      }
    }
    for (let i = 0; i < 6; i++) k.person(...at(sx - a - 8 + rng.range(0, 5), sy - 5 - rng.range(0, 4)), rng.range(0, 6.3))
  }
  // A food truck and a queue on the right.
  {
    const rot = -Math.PI / 4
    const [fx, fz] = at(sx + a + 6, sy - 1)
    k.box(fx, 0.35, fz, 5, 2.4, 2.2, 0xffd23c, { rot })
    k.box(fx, 2.75, fz, 5.2, 0.2, 2.4, 0x2a2a35, { rot })
    k.box(fx - 1.5 * Math.sin(rot) * 0 - 1.2 * Math.sin(rot), 1.4, fz - 1.2 * Math.cos(rot), 3, 0.9, 0.08, on ? 0xfff0c0 : 0x2a3346, { rot, glow: on, outline: false, cap: false })
    for (const s of [-1.6, 1.6]) k.cyl(fx + s * Math.cos(rot), 0.35, fz - s * Math.sin(rot), 0.35, 0.3, 0x1c1c1c, { axis: 'z', rot, seg: 8 })
    for (let i = 0; i < 4; i++) k.person(...at(sx + a + 3.5 - i * 1.1, sy - 1 - i * 0.9), rot + Math.PI)
    if (on) k.halo(fx, 0, fz, 3.4, 0xfff0c0, 0.22)
  }
  // String lights across the square, from four posts.
  const posts: [number, number][] = [at(sx - a - 3, sy + b + 5), at(sx + a + 3, sy + b + 5), at(sx + a + 3, sy - b - 5), at(sx - a - 3, sy - b - 5)]
  for (const [x, z] of posts) k.cyl(x, 0, z, 0.1, 3.8, 0x8a8fa0, { seg: 5, cap: false })
  for (let i = 0; i < 4; i++) {
    const [x1, z1] = posts[i]
    const [x2, z2] = posts[(i + 1) % 4]
    along(x1, z1, x2, z2, 26, (x, z, t) => {
      const sag = Math.sin(t * Math.PI) * 0.8
      k.sphere(x, 3.7 - sag, z, 0.13, on ? rng.pick([0xffe1a1, 0xff8fb8, 0x9fe8ff]) : 0x9aa3b5, { glow: on, seg: 5, outline: false })
    })
  }
  for (let i = 0; i < 8; i++) {
    const t = (i / 8) * Math.PI * 2
    const [x, z] = at(sx + Math.cos(t) * (a + 9), sy + Math.sin(t) * (b + 6))
    if (screenOf(x, z)[1] > sy + b + 7) continue
    k.box(x, 0, z, 1.2, 0.7, 1.2, 0x3a3e52)
    k.bush(x, z, 0.55, 0x2fbf7a)
  }
  crowd(k, 22)
  void cx
  void cz
}
