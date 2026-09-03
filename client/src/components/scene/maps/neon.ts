/**
 * Neon: a rooftop terrace above a neon city.
 *
 * The table stands on the roof of a tower. Around it the terrace carries what a
 * roof party carries (a bar, string lights, a helipad, the water tank nobody
 * moved), and past the railing the skyline drops away: towers rising from
 * thirty tiles below, some topping out above the terrace, every one of them
 * a grid of windows and an edge of neon. At night it is the map this game was
 * named for; at noon it is a city under a hard sun with the tubes off.
 *
 * The terrace is a square set on the diagonal, so its four corners point at
 * the four edges of the frame: the sign is at the top corner, the helipad on
 * the right, the bar on the left, the pool at the bottom under the hand.
 */
import type { Builder } from './common'
import { crowd, paving, ring, along, neonText, at, FLOOR, MID, OUTER, FAR } from './common'
import { mix } from '../sky'

const STREET = -36
/** Half the terrace's side. Its corners land at screen ±40 across and ±21 up. */
const H = 28

export const neon: Builder = (k) => {
  const rng = k.rng
  const on = k.rig.lampsOn

  // ─── The city below ────────────────────────────────────────────────────
  k.floor(on ? 0x0b0d1a : 0x3a3f52, FLOOR, STREET - 1)
  for (let i = -5; i <= 5; i++) {
    k.road(i * 22, 0, 4, FLOOR, { rot: Math.PI / 2, color: 0x1a1d2e, dashes: false })
    k.road(0, i * 22, FLOOR, 4, { color: 0x1a1d2e, dashes: false })
  }
  if (on) {
    for (let i = 0; i < 90; i++) {
      const alongX = rng.chance(0.5)
      const lane = rng.int(-5, 5) * 22 + rng.range(-1, 1)
      const p = rng.range(-110, 110)
      k.halo(alongX ? p : lane, STREET + 0.05, alongX ? lane : p, 1.1, rng.chance(0.5) ? 0xfff0c0 : 0xff4a4a, 0.5)
    }
  }

  // Night is what the map was named for, but a city by day is not a night city
  // with the lights off: the same towers stand in lighter stone under the sun.
  const palette = on
    ? [0x1c2140, 0x2a1f4d, 0x141a33, 0x22284a, 0x1a2a3f, 0x2b2540]
    : [0x5a628a, 0x6b5f96, 0x4f5a80, 0x6a7096, 0x55708a, 0x6f6690]
  const concrete = on ? 0x2a2d3f : 0x8b90a8
  const terraceA = on ? 0x33374a : 0x9aa0b8
  const terraceB = on ? 0x2b2f40 : 0x8d93ac
  const neonColors = [0xff3dd0, 0x4fd6ff, 0xffd23c, 0x7cff6b, 0xc56bff]
  const tower = (x: number, z: number, near: boolean) => {
    if (Math.max(Math.abs(x), Math.abs(z)) < H + 8) return
    const w = rng.range(7, 13)
    const d = rng.range(7, 13)
    const h = rng.range(near ? 22 : 14, near ? 52 : 44)
    const color = rng.pick(palette)
    k.tower(x, z, w, h, d, color, { y: STREET, floorH: 1.7, windows: near || k.rig.windowsLit > 0, windowColor: rng.chance(0.3) ? 0x9fe8ff : 0xffd98a, roof: 'flat', roofColor: mix(color, 0x000000, 0.3) })
    const top = STREET + h
    if (rng.chance(0.55)) {
      const c = rng.pick(neonColors)
      k.box(x + w / 2 + 0.06, top - 0.3, z, 0.1, 0.25, d, on ? c : 0x3a3f52, { glow: on, outline: false, cap: false })
      k.box(x, top - 0.3, z + d / 2 + 0.06, w, 0.25, 0.1, on ? c : 0x3a3f52, { glow: on, outline: false, cap: false })
      if (on) k.halo(x, top + 0.2, z, Math.max(w, d) * 0.7, c, 0.18)
    }
    if (rng.chance(0.35)) {
      const c = rng.pick(neonColors)
      k.box(x, top, z, w * 0.7, 0.12, 0.12, 0x2a2a35, { cap: false })
      k.box(x, top, z + 0.1, w * 0.7, w * 0.4, 0.2, on ? c : mix(c, 0x222222, 0.7), { glow: on, cap: false })
    }
    if (rng.chance(0.4)) {
      const mh = rng.range(3, 8)
      k.cyl(x, top, z, 0.12, mh, 0x8a8fa0, { seg: 5, cap: false })
      k.sphere(x, top + mh + 0.15, z, 0.22, 0xff3b3b, { glow: true, seg: 6, outline: false })
      k.halo(x, top + mh + 0.15, z, 0.55, 0xff3b3b, 0.4, false)
    }
  }
  ring(k, 20, MID + 6, (x, z) => tower(x, z, true), 0.1)
  ring(k, 26, OUTER + 8, (x, z) => tower(x, z, true), 0.1)
  ring(k, 30, FAR + 8, (x, z) => tower(x, z, false), 0.1)
  ring(k, 34, FAR + 32, (x, z) => tower(x, z, false), 0.1)

  // ─── Our tower and its terrace ─────────────────────────────────────────
  const T = H * 2
  k.box(0, STREET, 0, T + 2, -STREET - 3, T + 2, on ? 0x1a1d2e : 0x6f7590, { cap: false })
  k.box(0, -3, 0, T + 2.8, 3, T + 2.8, concrete, { cap: false })
  for (let i = -11; i <= 11; i++) {
    k.window((T + 2.8) / 2 + 0.02, -2.4, i * 2.4, 1.4, 1.5, 'x', 0xffe0a8)
    k.window(i * 2.4, -2.4, (T + 2.8) / 2 + 0.02, 1.4, 1.5, 'z', 0xffe0a8)
  }
  paving(k, 0, 0, T, terraceA, terraceB, 2, 0, 26)
  k.puddles(0, 0, 28, 16)

  const edge = H + 0.9
  const tube = (x: number, z: number, w: number, d: number, c: number) =>
    k.box(x, 0.12, z, w, 0.14, d, on ? c : 0x3a3f52, { glow: on, outline: false, cap: false })
  tube(0, edge, T + 1.8, 0.14, 0xff3dd0)
  tube(0, -edge, T + 1.8, 0.14, 0x4fd6ff)
  tube(edge, 0, 0.14, T + 1.8, 0xff3dd0)
  tube(-edge, 0, 0.14, T + 1.8, 0x4fd6ff)
  k.fence(-edge, -edge, edge, -edge, 0x9aa3b5, 1.0)
  k.fence(edge, -edge, edge, edge, 0x9aa3b5, 1.0)
  k.fence(edge, edge, -edge, edge, 0x9aa3b5, 1.0)
  k.fence(-edge, edge, -edge, -edge, 0x9aa3b5, 1.0)

  // Helipad, the right corner.
  {
    const [hx, hz] = at(32, -1)
    k.disc(hx, 0.1, hz, 4.4, 0x1f2230, { seg: 24 })
    k.disc(hx, 0.13, hz, 3.9, 0xf2e6b5, { seg: 24 })
    k.disc(hx, 0.16, hz, 3.4, 0x1f2230, { seg: 24 })
    k.slab(hx - 1.0, hz, 0.5, 2.8, 0xf2e6b5, { y: 0.17, h: 0.03 })
    k.slab(hx + 1.0, hz, 0.5, 2.8, 0xf2e6b5, { y: 0.17, h: 0.03 })
    k.slab(hx, hz, 1.5, 0.5, 0xf2e6b5, { y: 0.17, h: 0.03 })
    ring(k, 10, 4.6, (x, z) => k.box(hx + x, 0.12, hz + z, 0.24, 0.16, 0.24, on ? 0x7cff6b : 0x3f4a3f, { glow: on, outline: false, cap: false }), 0)
    k.box(hx, 0.4, hz, 3.4, 1.3, 1.5, 0x2a2f45, { rot: 0.4 })
    k.box(hx + 2.6, 0.9, hz - 1.1, 2.6, 0.5, 0.5, 0x2a2f45, { rot: 0.4 })
    k.cyl(hx, 1.7, hz, 0.12, 0.5, 0x8a8fa0, { seg: 5, cap: false })
    k.box(hx, 2.2, hz, 6, 0.08, 0.3, 0x9aa3b5, { rot: 0.9, outline: false, cap: false })
    k.box(hx, 2.2, hz, 6, 0.08, 0.3, 0x9aa3b5, { rot: 0.9 + Math.PI / 2, outline: false, cap: false })
    k.box(hx - 1.2, 0.9, hz + 0.5, 0.9, 0.5, 0.06, on ? 0xffe2a8 : 0x1a2233, { rot: 0.4, glow: on, outline: false, cap: false })
    k.person(hx - 4.5, hz + 1, Math.PI / 2, { shirt: 0xffd23c, hat: 0xffffff })
  }

  // Water tank, AC units and the plant room, up at the top corner beside the sign.
  {
    const [tx, tz] = at(-14, 15.5)
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.box(tx + dx * 1.3, 0, tz + dz * 1.3, 0.24, 2.8, 0.24, 0x5a4a3a, { cap: false })
    k.cyl(tx, 2.8, tz, 2.1, 3.2, 0x8b6a4c, { seg: 12 })
    k.cone(tx, 6.0, tz, 2.2, 1.0, 0x6b5039, { seg: 12 })
    const [px, pz] = at(-22, 14)
    k.box(px, 0, pz, 4.2, 2.4, 3.2, 0x2f3345)
    k.box(px, 2.4, pz, 0.4, 1.6, 0.4, 0x8a8fa0, { cap: false })
    for (let i = 0; i < 4; i++) {
      const [ax, az] = at(-6 + i * 2.2, 14)
      k.box(ax, 0, az, 1.8, 1.1, 1.5, 0x8d94a3)
      k.disc(ax, 1.1, az, 0.6, 0x3a3f4d, { seg: 12 })
    }
  }

  // The bar: the left corner.
  {
    const [bx, bz] = at(-32, 0)
    const rot = Math.PI / 4
    k.box(bx, 0, bz, 7, 1.1, 1.3, 0x2f2540, { rot })
    k.box(bx, 1.1, bz, 7.2, 0.12, 1.5, 0xc56bff, { rot, glow: on, outline: !on, cap: false })
    const [wx, wz] = at(-35, 0)
    k.box(wx, 0, wz, 7, 2.8, 0.5, 0x1e1830, { rot })
    along(wx - 2.4, wz - 2.4, wx + 2.4, wz + 2.4, 9, (x, z) => k.box(x, 1.6, z, 0.24, 0.6, 0.24, rng.pick([0x4fd6ff, 0xff3dd0, 0xffd23c, 0x7cff6b]), { glow: on, outline: false, cap: false }))
    const [sx, sz] = at(-29.5, 0)
    along(sx - 2, sz - 2, sx + 2, sz + 2, 5, (x, z) => {
      k.cyl(x, 0, z, 0.08, 0.7, 0x8a8fa0, { seg: 5, cap: false })
      k.cyl(x, 0.7, z, 0.32, 0.14, 0xff3d68, { seg: 8, cap: false })
    })
    k.person(...at(-33.5, 0.2), rot + Math.PI, { shirt: 0xffffff, pants: 0x1c1c1c })
    k.person(...at(-28.5, 1.4), rot)
    k.person(...at(-28.5, -1.2), rot)
    if (on) k.halo(bx, 0, bz, 5, 0xc56bff, 0.2)
    const [dx, dz] = at(-30, -9)
    k.box(dx, 0, dz, 3.2, 1.1, 1.2, 0x1e1830, { rot })
    k.person(...at(-31.5, -9.5), rot + Math.PI, { shirt: 0x1c1c1c, hair: 0xe0b04a, hat: 0x1c1c1c })
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 4; j++) {
        const [fx, fz] = at(-27 + i * 1.1, -6 - j * 1.3)
        k.slab(fx, fz, 1.2, 1.2, on ? rng.pick(neonColors) : 0x3a3f52, { y: 0.12, h: 0.06, outline: false, rot })
      }
    }
    for (let i = 0; i < 7; i++) k.person(...at(-27 + rng.range(0, 6), -6 - rng.range(0, 4)), rng.range(0, 6.3))
  }

  // Loungers and a pool at the bottom corner, under the hand but not always.
  {
    const [px, pz] = at(20, -17)
    k.box(px, 0, pz, 9, 0.5, 5.5, 0x9aa3b5, { rot: Math.PI / 4 })
    k.slab(px, pz, 8.4, 4.9, on ? 0x4fd6ff : 0x2fa8e0, { y: 0.5, h: 0.04, outline: false, rot: Math.PI / 4 })
    if (on) k.halo(px, 0.55, pz, 4.5, 0x4fd6ff, 0.3)
    for (let i = 0; i < 4; i++) k.bench(...at(28 + i * 2, -14 - i * 1.2), Math.PI / 4, 0x4a4f66)
    for (let i = 0; i < 4; i++) k.bench(...at(-28 - i * 2, -14 - i * 1.2), -Math.PI / 4, 0x4a4f66)
  }

  // String lights from post to post, planters along the rail.
  const posts: [number, number][] = [[-H + 2, -H + 2], [H - 2, -H + 2], [H - 2, H - 2], [-H + 2, H - 2]]
  for (const [x, z] of posts) k.cyl(x, 0, z, 0.1, 3.6, 0x8a8fa0, { seg: 5, cap: false })
  for (let i = 0; i < 4; i++) {
    const [x1, z1] = posts[i]
    const [x2, z2] = posts[(i + 1) % 4]
    along(x1, z1, x2, z2, 30, (x, z, t) => {
      const sag = Math.sin(t * Math.PI) * 0.8
      k.sphere(x, 3.5 - sag, z, 0.13, on ? rng.pick([0xffe1a1, 0xff8fb8, 0x9fe8ff]) : 0x9aa3b5, { glow: on, seg: 5, outline: false })
    })
  }
  for (let i = 0; i < 4; i++) {
    const [x1, z1] = posts[i]
    const [x2, z2] = posts[(i + 1) % 4]
    along(x1, z1, x2, z2, 7, (x, z, t) => {
      if (t === 0 || t === 1) return
      k.box(x, 0, z, 1.2, 0.7, 1.2, 0x3a3e52)
      k.bush(x, z, 0.55, 0x2fbf7a)
    })
  }

  // The sign, the brand, over the rail at the top corner facing the camera.
  {
    const [sx, sz] = at(4, 16.5)
    const rot = Math.PI / 4
    k.box(sx - 7 * Math.cos(rot), 0, sz + 7 * Math.sin(rot), 0.24, 5.2, 0.24, 0x2a2a35, { cap: false })
    k.box(sx + 7 * Math.cos(rot), 0, sz - 7 * Math.sin(rot), 0.24, 5.2, 0.24, 0x2a2a35, { cap: false })
    k.box(sx, 2.4, sz, 14.6, 3.2, 0.3, 0x101322, { rot })
    neonText(k, 'LOCO!', sx + 0.2 * Math.sin(rot), 2.75, sz + 0.2 * Math.cos(rot), 0.48, 0xff3d68, rot)
  }

  crowd(k, 24, 26, 33)
}
