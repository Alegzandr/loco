/**
 * Orbit: a base on an airless moon.
 *
 * Regolith and craters, a landing pad the table stands on, habitat domes and
 * the tubes between them, a rocket on its gantry, solar fields, a rover that
 * has been out too long. The only colours are the ones the base brought with
 * it: orange stripes, cyan light, and the white of everything else. Dust and
 * a solar storm are its weathers; it does not rain here.
 *
 * The habitat is on the right, the rocket at the top, the solar field at the
 * bottom left, the antenna on the left.
 */
import type { Builder } from './common'
import { crowd, ring, along, at, PLAZA_R, MID, OUTER, FAR, FLOOR } from './common'
import { mix, scale } from '../sky'

const HULL = 0xe6e9ee
const STRIPE = 0xff8a3c
const CYAN = 0x4fd6ff
const REGOLITH = 0x8d8f97

export const orbit: Builder = (k) => {
  const rng = k.rng
  const on = k.rig.lampsOn
  const suit = { shirt: 0xf2f4f8, pants: 0xf2f4f8, skin: 0x9fd8ff, hair: 0xf2f4f8 }
  const screenX = (x: number, z: number) => (x - z) / Math.SQRT2
  const screenY = (x: number, z: number) => (-(x + z) / Math.SQRT2) * 0.53
  const free = (x: number, z: number) => {
    const sx = screenX(x, z), sy = screenY(x, z)
    if (sx > 23 && sy > -12 && sy < 12) return false
    if (Math.abs(sx - 14) < 12 && sy > 10) return false
    if (sx < -24 && sy < -8) return false
    if (Math.abs(sx + 33) < 6 && Math.abs(sy - 3) < 8) return false
    return true
  }

  k.floor(REGOLITH, FLOOR)
  for (let i = 0; i < 26; i++) {
    const a = rng.next() * Math.PI * 2
    const r = rng.range(MID, FAR + 40)
    const x = Math.cos(a) * r, z = Math.sin(a) * r
    if (!free(x, z)) continue
    const cr = rng.range(1.8, 5.5)
    k.disc(x, 0, z, cr, k.ground(scale(REGOLITH, 0.78)), { seg: 18 })
    ring(k, Math.round(cr * 3), cr, (rx, rz) => k.rock(x + rx, z + rz, rng.range(0.2, 0.55), k.ground(mix(REGOLITH, 0xffffff, 0.12))), 0.15)
  }
  for (let i = 0; i < 50; i++) {
    const a = rng.next() * Math.PI * 2
    const r = rng.range(PLAZA_R + 2, FAR + 40)
    k.rock(Math.cos(a) * r, Math.sin(a) * r, rng.range(0.3, 1.2), k.ground(scale(REGOLITH, rng.range(0.8, 1.1))))
  }

  // ─── The landing pad ───────────────────────────────────────────────────
  k.disc(0, 0.02, 0, PLAZA_R, k.ground(0x5f636d), { seg: 48 })
  k.disc(0, 0.06, 0, PLAZA_R - 1.2, k.ground(0xf2d35e), { seg: 48 })
  k.disc(0, 0.1, 0, PLAZA_R - 2.2, k.ground(0x5f636d), { seg: 48 })
  ring(k, 28, PLAZA_R - 0.6, (x, z) => {
    k.box(x, 0.1, z, 0.4, 0.24, 0.4, on ? CYAN : 0x3a4a55, { glow: on, outline: false, cap: false })
    if (on) k.halo(x, 0.2, z, 1.0, CYAN, 0.3, false)
  }, 0)
  for (const a of [0.9, 2.5, 4.1, 5.7]) {
    along(Math.cos(a) * PLAZA_R, Math.sin(a) * PLAZA_R, Math.cos(a) * 100, Math.sin(a) * 100, 26, (x, z) =>
      k.slab(x, z, 3, 2.6, k.ground(0x6f737d), { rot: -a, h: 0.05 }),
    )
    along(Math.cos(a) * (PLAZA_R + 2), Math.sin(a) * (PLAZA_R + 2), Math.cos(a) * 96, Math.sin(a) * 96, 12, (x, z) =>
      k.lamp(x + Math.cos(a + Math.PI / 2) * 2, z + Math.sin(a + Math.PI / 2) * 2, { h: 2.2, style: 'box', color: CYAN, post: 0x9aa3b5 }),
    )
  }

  // ─── Habitat, on the right ─────────────────────────────────────────────
  const dome = (x: number, z: number, r: number) => {
    k.cyl(x, 0, z, r + 0.4, 0.6, 0x9aa3b5, { seg: 16 })
    k.sphere(x, 0.6, z, r, on ? mix(0xbfe3f0, 0xffe2a8, 0.35) : 0xbfe3f0, { seg: 12, glow: on })
    k.cyl(x, 0.55, z, r + 0.2, 0.12, on ? CYAN : 0x6f737d, { seg: 16, glow: on, outline: false, cap: false })
    if (on) k.halo(x, 0, z, r * 1.6, 0xffe2a8, 0.16)
  }
  const tube = (a: [number, number], b: [number, number]) => {
    const [x1, z1] = a, [x2, z2] = b
    const len = Math.hypot(x2 - x1, z2 - z1)
    const rot = -Math.atan2(z2 - z1, x2 - x1)
    k.cyl((x1 + x2) / 2, 1.1, (z1 + z2) / 2, 1.0, len, HULL, { axis: 'x', rot, seg: 10 })
    along(x1, z1, x2, z2, Math.max(2, Math.round(len / 3)), (x, z) => k.cyl(x, 1.1, z, 1.12, 0.4, STRIPE, { axis: 'x', rot, seg: 10, outline: false }))
  }
  const module = (x: number, z: number, rot: number, len = 6) => {
    k.box(x, 0, z, len, 2.6, 3, HULL, { rot })
    k.box(x, 2.6, z, len + 0.2, 0.3, 3.2, 0x9aa3b5, { rot })
    k.box(x, 0.5, z, len + 0.04, 0.5, 3.04, STRIPE, { rot, outline: false, cap: false })
    for (let i = 0; i < 3; i++) {
      const t = -len / 2 + (i + 0.5) * (len / 3)
      k.box(x + t * Math.cos(rot), 1.3, z - t * Math.sin(rot) + 1.53, 0.9, 0.6, 0.06, on ? 0xffe2a8 : 0x1a2233, { rot, glow: on, outline: false, cap: false })
    }
    k.cyl(x, 2.9, z, 0.15, 1.2, 0x9aa3b5, { seg: 5, cap: false })
    k.sphere(x, 4.2, z, 0.18, 0xff3b3b, { glow: true, seg: 5, outline: false })
  }
  const d1 = at(31, 0), d2 = at(34, 7), d3 = at(33, -7), d4 = at(27.5, 5.5), d5 = at(27.5, -5.5)
  dome(...d1, 5)
  dome(...d2, 3.6)
  dome(...d3, 3.4)
  dome(...d4, 2.6)
  dome(...d5, 2.6)
  tube(d1, d2)
  tube(d1, d3)
  tube(d1, d4)
  tube(d1, d5)
  module(...at(35, 13), Math.PI / 4, 7)
  module(...at(35, -13), Math.PI / 4, 7)
  tube(d2, at(35, 13))
  tube(d3, at(35, -13))
  // The airlock facing the pad, with its light, and the crates that came in.
  {
    const [ax, az] = at(25.5, 0)
    k.box(ax, 0, az, 2.4, 2.6, 1.3, 0x9aa3b5, { rot: Math.PI / 4 })
    k.box(...at(24.8, 0), 0.3, 1.4, 2, 0.1, on ? CYAN : 0x2a3a45, { rot: Math.PI / 4, glow: on, outline: false, cap: false })
    tube(at(26.2, 0), d1)
  }
  for (let i = 0; i < 6; i++) k.crate(...at(27 + rng.range(-1.5, 1.5), -3.5 + rng.range(-1.5, 1.5)), rng.range(0.5, 0.9), HULL)
  for (let i = 0; i < 3; i++) k.cyl(...at(29 + i * 1.6, 3.6 + i * 0.4), 0, 1.1, 3.4, HULL, { seg: 10 })
  for (let i = 0; i < 3; i++) k.cyl(...at(29 + i * 1.6, 3.6 + i * 0.4), 1.0, 1.12, 0.4, STRIPE, { seg: 10, outline: false })

  // ─── The rocket and its gantry, at the top ─────────────────────────────
  {
    const [rx, rz] = at(14, 15.5)
    k.disc(rx, 0, rz, 5, k.ground(0x4a4e58), { seg: 20 })
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4
      k.box(rx + Math.cos(a) * 2.1, 0, rz + Math.sin(a) * 2.1, 0.55, 1.5, 0.55, 0x6f737d)
    }
    k.cyl(rx, 1.3, rz, 1.7, 13, HULL, { seg: 14 })
    k.cyl(rx, 1.3, rz, 1.72, 1.1, STRIPE, { seg: 14, outline: false })
    k.cyl(rx, 10.5, rz, 1.72, 0.9, STRIPE, { seg: 14, outline: false })
    k.cone(rx, 14.3, rz, 1.7, 3.8, 0xd94c4c, { seg: 14 })
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.3
      k.box(rx + Math.cos(a) * 2.1, 1.3, rz + Math.sin(a) * 2.1, 1.6, 3, 0.25, 0xd94c4c, { rot: -a })
    }
    k.cyl(rx, 0.4, rz, 1.0, 1.0, 0x3a3f4a, { seg: 10, rTop: 0.8 })
    if (on) k.halo(rx, 0.45, rz, 1.6, 0xff8a3c, 0.35, false)
    const [gx, gz] = at(18, 15.5)
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.box(gx + dx, 0, gz + dz, 0.24, 16, 0.24, 0x9aa3b5, { cap: false })
    for (let y = 2; y < 16; y += 2.6) k.box(gx, y, gz, 2.2, 0.2, 2.2, 0x9aa3b5, { outline: false, cap: false })
    k.box(gx - 2.2, 12, gz + 0.5, 2.8, 0.3, 0.9, 0x9aa3b5, { rot: Math.PI / 4 })
    k.sphere(gx, 16.3, gz, 0.22, 0xff3b3b, { glow: true, seg: 5, outline: false })
    const [fx, fz] = at(6, 15)
    k.box(fx, 0.6, fz, 4, 1.2, 1.8, HULL, { rot: 0.3 })
    k.cyl(fx, 1.8, fz, 0.8, 3, STRIPE, { axis: 'x', rot: 0.3, seg: 10 })
    for (const dx of [-1.3, 1.3]) for (const dz of [-1, 1]) k.cyl(fx + dx * Math.cos(0.3) + dz * Math.sin(0.3), 0.45, fz - dx * Math.sin(0.3) + dz * Math.cos(0.3), 0.45, 0.4, 0x3a3f4a, { axis: 'z', rot: 0.3, seg: 8 })
    k.person(...at(9, 13), Math.PI / 4, suit)
    k.person(...at(11, 12.5), Math.PI / 4 + 0.5, suit)
  }

  // ─── Solar fields, bottom left ─────────────────────────────────────────
  for (let row = 0; row < 4; row++) {
    for (let i = 0; i < 7; i++) {
      const [x, z] = at(-38 + i * 2.2, -10 - row * 2.6)
      k.box(x, 0, z, 0.16, 1.1, 0.16, 0x9aa3b5, { cap: false })
      k.box(x, 1.1, z, 3, 0.12, 2.4, 0x1d3a7a, { cap: false, rot: Math.PI / 4 })
      k.box(x, 1.22, z, 3.1, 0.04, 2.5, 0x9aa3b5, { outline: false, cap: false, rot: Math.PI / 4 })
    }
  }
  {
    const [bx, bz] = at(-24, -14)
    k.box(bx, 0, bz, 3, 1.6, 2.2, HULL, { rot: Math.PI / 4 })
    k.box(bx, 1.6, bz, 0.2, 1.8, 0.2, 0x9aa3b5, { cap: false })
  }

  // ─── Antenna, tanks, the rover, on the left ────────────────────────────
  {
    const [ax, az] = at(-33, 4)
    k.cyl(ax, 0, az, 1.0, 0.5, 0x9aa3b5, { seg: 10 })
    k.cyl(ax, 0.5, az, 0.28, 4, HULL, { seg: 6, cap: false })
    k.cyl(ax, 4.5, az, 0.4, 0.6, HULL, { seg: 12, rTop: 3, cap: false })
    k.cyl(ax, 5.1, az, 0.08, 1.6, 0x9aa3b5, { seg: 5, cap: false, outline: false })
    k.sphere(ax, 6.7, az, 0.16, 0xff3b3b, { glow: true, seg: 5, outline: false })
    const [tx, tz] = at(-36, 9)
    k.cyl(tx, 0, tz, 0.6, 2.4, HULL, { seg: 6, cap: false })
    k.cyl(tx, 2.4, tz, 0.3, 0.4, HULL, { seg: 10, rTop: 2, cap: false })
    k.person(...at(-31, 2), Math.PI / 2, suit)
  }
  {
    const [vx, vz] = at(-30, -3)
    const rot = 0.7
    k.box(vx, 0.6, vz, 2.8, 0.7, 1.7, HULL, { rot })
    k.box(vx, 1.3, vz, 1.5, 0.7, 1.5, 0xbfe3f0, { rot })
    for (const dx of [-1, 0, 1]) {
      for (const dz of [-1, 1]) {
        k.cyl(vx + dx * Math.cos(rot) + dz * Math.sin(rot), 0.4, vz - dx * Math.sin(rot) + dz * Math.cos(rot), 0.42, 0.3, 0x3a3f4a, { axis: 'z', rot, seg: 8 })
      }
    }
    k.cyl(vx - 1, 1.3, vz, 0.05, 1.8, 0x9aa3b5, { seg: 4, cap: false, outline: false })
    k.box(vx - 1.45, 0.6, vz, 0.1, 0.3, 1.0, on ? 0xfff3c4 : 0xe8e8e8, { rot, glow: on, outline: false, cap: false })
    k.person(vx + 2.2, vz + 1.6, -rot, suit)
    along(vx - 2, vz + 2, vx - 14, vz + 10, 14, (x, z) => k.slab(x + 0.5, z, 0.9, 0.2, k.ground(scale(REGOLITH, 0.7)), { h: 0.02, rot: -0.6 }))
  }

  crowd(k, 12, PLAZA_R - 6, PLAZA_R + 2, suit)
  k.flag(...at(-28, 10), 0x4fd6ff, 4)
  k.flag(...at(24, -10), 0xff3d68, 4)
  for (let i = 0; i < 6; i++) k.crate(...at(-10 + rng.range(-3, 3), -15 + rng.range(-1, 1)), rng.range(0.5, 0.9), STRIPE)
  ring(k, 10, OUTER + 4, (x, z) => { if (free(x, z)) k.lamp(x, z, { h: 2.4, style: 'box', color: CYAN, post: 0x9aa3b5 }) }, 0.2)
}
