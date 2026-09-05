/**
 * Orbit: a base on an airless moon.
 *
 * Regolith and craters, a landing pad the table stands on, blocks of habitat
 * modules, domes and tanks joined by tubes, paths lit in cyan between them, a
 * rocket on its gantry at the top, solar fields, a rover that has been out too
 * long. The only colours are the ones the base brought with it: orange
 * stripes, cyan light, and the white of everything else. Dust and a solar
 * storm are its weathers; it does not rain here.
 */
import type { Builder } from './common'
import { MAPS } from '../../cards/maps'
import { cityGrid, lots, podium, crowd, at, ring, along, FLOOR } from './common'
import { mix, scale, cssHex } from '../sky'
import type { Actor } from '../life'
import { over, streetWalkers, strollers } from './actors'

const HULL = 0xe6e9ee
const STRIPE = 0xff8a3c
const CYAN = 0x4fd6ff
const REGOLITH = 0x8d8f97

export const orbit: Builder = (k) => {
  const rng = k.rng
  const on = k.rig.lampsOn
  const suit = { shirt: 0xf2f4f8, pants: 0xf2f4f8, skin: 0x9fd8ff, hair: 0xf2f4f8 }
  const { sx, sy, a, b } = k.anchor

  k.floor(REGOLITH, FLOOR)
  podium(k, { stone: 0x3a3f4a, step: 0x6f737d, floor: 0x5f636d, floor2: 0x555960, accent: CYAN, top: cssHex(MAPS.orbit.table.felt) })
  // The pad's yellow ring and its landing lights, on the plaza's rim.
  for (let i = 0; i < 28; i++) {
    const t = (i / 28) * Math.PI * 2
    const [x, z] = at(sx + Math.cos(t) * (a + 8.5), sy + Math.sin(t) * (b + 5))
    k.box(x, 0.1, z, 0.4, 0.24, 0.4, on ? CYAN : 0x3a4a55, { glow: on, outline: false, cap: false })
    if (on) k.halo(x, 0.2, z, 1.0, CYAN, 0.3, false)
  }

  const dome = (x: number, z: number, r: number) => {
    k.cyl(x, 0, z, r + 0.4, 0.6, 0x9aa3b5, { seg: 16 })
    k.sphere(x, 0.6, z, r, on ? mix(0xbfe3f0, 0xffe2a8, 0.35) : 0xbfe3f0, { seg: 12, glow: on })
    k.cyl(x, 0.55, z, r + 0.2, 0.12, on ? CYAN : 0x6f737d, { seg: 16, glow: on, outline: false, cap: false })
    if (on) k.halo(x, 0, z, r * 1.6, 0xffe2a8, 0.16)
  }
  const tube = (x1: number, z1: number, x2: number, z2: number) => {
    const len = Math.hypot(x2 - x1, z2 - z1)
    const rot = -Math.atan2(z2 - z1, x2 - x1)
    k.cyl((x1 + x2) / 2, 1.1, (z1 + z2) / 2, 0.9, len, HULL, { axis: 'x', rot, seg: 10 })
    along(x1, z1, x2, z2, Math.max(2, Math.round(len / 3)), (x, z) => k.cyl(x, 1.1, z, 1.0, 0.4, STRIPE, { axis: 'x', rot, seg: 10, outline: false }))
  }
  const module = (x: number, z: number, rot: number, len = 6, d = 3) => {
    k.box(x, 0, z, len, 2.6, d, HULL, { rot })
    k.box(x, 2.6, z, len + 0.2, 0.3, d + 0.2, 0x9aa3b5, { rot })
    k.box(x, 0.5, z, len + 0.04, 0.5, d + 0.04, STRIPE, { rot, outline: false, cap: false })
    for (let i = 0; i < 3; i++) {
      const t = -len / 2 + (i + 0.5) * (len / 3)
      const lit = on && rng.chance(0.8)
      k.box(x + t * Math.cos(rot), 1.3, z - t * Math.sin(rot) + (d / 2 + 0.03), 0.9, 0.6, 0.06, lit ? 0xffe2a8 : 0x1a2233, { rot, glow: lit, outline: false, cap: false })
    }
    if (rng.chance(0.5)) {
      k.cyl(x, 2.9, z, 0.15, 1.2, 0x9aa3b5, { seg: 5, cap: false })
      k.sphere(x, 4.2, z, 0.18, 0xff3b3b, { glow: true, seg: 5, outline: false })
    }
  }
  const tank = (x: number, z: number) => {
    k.cyl(x, 0, z, 1.1, 3.2, HULL, { seg: 10 })
    k.cyl(x, 1.0, z, 1.12, 0.4, STRIPE, { seg: 10, outline: false })
  }
  const solar = (x: number, z: number) => {
    k.box(x, 0, z, 0.16, 1.1, 0.16, 0x9aa3b5, { cap: false })
    k.box(x, 1.1, z, 2.8, 0.12, 2.2, 0x1d3a7a, { cap: false })
    k.box(x, 1.22, z, 2.9, 0.04, 2.3, 0x9aa3b5, { outline: false, cap: false })
  }

  // In the right band rather than the top one: eighteen tiles of rocket over a
  // pad set high on the frame is a rocket nobody sees the top of. See the same
  // move in `rune.ts`.
  const rocketSpot = { sx: sx + a + 8, sy: sy + 2 }
  const near = (c: { sx: number; sy: number }, p: { sx: number; sy: number }, r: number) => Math.hypot(c.sx - p.sx, (c.sy - p.sy) / 0.53) < r

  const plan = cityGrid(k, {
    block: 12,
    road: 3,
    roadColor: 0x6f737d,
    dashes: false,
    lamp: { h: 2.2, style: 'box', color: CYAN, post: 0x9aa3b5 },
    people: 0.6,
    maxHeight: 5,
    fill: (c) => {
      if (near(c, rocketSpot, 9)) return
      const kind = c.front ? 0.7 : rng.next()
      if (kind < 0.4) {
        // A habitat: a dome and two modules, tubed together.
        const [d, m1, m2] = lots(c, 2, 2, 1.5)
        dome(d.x, d.z, Math.min(d.w, d.d) * 0.42)
        module(m1.x, m1.z, 0, m1.w - 0.5, 2.8)
        module(m2.x, m2.z, Math.PI / 2, m2.d - 0.5, 2.8)
        tube(d.x, d.z, m1.x, m1.z)
        tube(d.x, d.z, m2.x, m2.z)
        k.crate(c.x + c.w / 2 - 1, c.z + c.d / 2 - 1, 0.7, HULL)
      } else if (kind < 0.65) {
        // Tanks and a small dome.
        const ls = lots(c, 2, 2, 1)
        tank(ls[0].x, ls[0].z)
        tank(ls[1].x, ls[1].z)
        dome(ls[3].x, ls[3].z, 2.2)
        k.crate(ls[2].x, ls[2].z, 0.8, STRIPE)
        k.crate(ls[2].x + 1.2, ls[2].z + 0.6, 0.6, HULL)
      } else if (kind < 0.85) {
        // A solar field.
        for (const l of lots(c, 3, 3, 0.8)) solar(l.x, l.z)
      } else {
        // A crater and the rocks around it.
        const cr = rng.range(2, 4)
        k.disc(c.x, 0, c.z, cr, k.ground(scale(REGOLITH, 0.78)), { seg: 18 })
        ring(k, Math.round(cr * 3), cr, (rx, rz) => k.rock(c.x + rx, c.z + rz, rng.range(0.2, 0.55), k.ground(mix(REGOLITH, 0xffffff, 0.12))), 0.15)
        for (let i = 0; i < 4; i++) k.rock(c.x + rng.range(-5, 5), c.z + rng.range(-5, 5), rng.range(0.3, 1), k.ground(scale(REGOLITH, rng.range(0.8, 1.1))))
      }
    },
  })

  // ─── The rocket and its gantry, at the top ─────────────────────────────
  {
    const [rx, rz] = at(rocketSpot.sx, rocketSpot.sy)
    k.disc(rx, 0, rz, 5, k.ground(0x4a4e58), { seg: 20 })
    for (let i = 0; i < 4; i++) {
      const t = (i / 4) * Math.PI * 2 + Math.PI / 4
      k.box(rx + Math.cos(t) * 2.1, 0, rz + Math.sin(t) * 2.1, 0.55, 1.5, 0.55, 0x6f737d)
    }
    k.cyl(rx, 1.3, rz, 1.7, 13, HULL, { seg: 14 })
    k.cyl(rx, 1.3, rz, 1.72, 1.1, STRIPE, { seg: 14, outline: false })
    k.cyl(rx, 10.5, rz, 1.72, 0.9, STRIPE, { seg: 14, outline: false })
    k.cone(rx, 14.3, rz, 1.7, 3.8, 0xd94c4c, { seg: 14 })
    for (let i = 0; i < 3; i++) {
      const t = (i / 3) * Math.PI * 2 + 0.3
      k.box(rx + Math.cos(t) * 2.1, 1.3, rz + Math.sin(t) * 2.1, 1.6, 3, 0.25, 0xd94c4c, { rot: -t })
    }
    k.cyl(rx, 0.4, rz, 1.0, 1.0, 0x3a3f4a, { seg: 10, rTop: 0.8 })
    if (on) k.halo(rx, 0.45, rz, 1.6, 0xff8a3c, 0.35, false)
    const [gx, gz] = at(rocketSpot.sx + 4, rocketSpot.sy)
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.box(gx + dx, 0, gz + dz, 0.24, 16, 0.24, 0x9aa3b5, { cap: false })
    for (let y = 2; y < 16; y += 2.6) k.box(gx, y, gz, 2.2, 0.2, 2.2, 0x9aa3b5, { outline: false, cap: false })
    k.box(gx - 2.2, 12, gz + 0.5, 2.8, 0.3, 0.9, 0x9aa3b5, { rot: Math.PI / 4 })
    k.sphere(gx, 16.3, gz, 0.22, 0xff3b3b, { glow: true, seg: 5, outline: false })
    const [fx, fz] = at(rocketSpot.sx - 3, rocketSpot.sy - 6)
    k.box(fx, 0.6, fz, 4, 1.2, 1.8, HULL, { rot: 0.3 })
    k.cyl(fx, 1.8, fz, 0.8, 3, STRIPE, { axis: 'x', rot: 0.3, seg: 10 })
    for (const dx of [-1.3, 1.3]) for (const dz of [-1, 1]) k.cyl(fx + dx * Math.cos(0.3) + dz * Math.sin(0.3), 0.45, fz - dx * Math.sin(0.3) + dz * Math.cos(0.3), 0.45, 0.4, 0x3a3f4a, { axis: 'z', rot: 0.3, seg: 8 })
    k.person(...at(rocketSpot.sx - 2.5, rocketSpot.sy - 4), Math.PI / 4, suit)
  }

  // ─── The antenna and the crew around the pad; the rover is an actor ────
  /** The rover, built at the origin heading screen-right. */
  const rover = (kk: typeof k, vx: number, vz: number) => {
    const rot = Math.PI / 4
    kk.box(vx, 0.6, vz, 2.8, 0.7, 1.7, HULL, { rot })
    kk.box(vx, 1.3, vz, 1.5, 0.7, 1.5, 0xbfe3f0, { rot })
    for (const dx of [-1, 0, 1]) {
      for (const dz of [-1, 1]) {
        kk.cyl(vx + dx * Math.cos(rot) + dz * Math.sin(rot), 0.4, vz - dx * Math.sin(rot) + dz * Math.cos(rot), 0.42, 0.3, 0x3a3f4a, { axis: 'z', rot, seg: 8 })
      }
    }
    kk.cyl(vx - Math.cos(rot), 1.3, vz + Math.sin(rot), 0.05, 1.8, 0x9aa3b5, { seg: 4, cap: false, outline: false })
    kk.box(vx + 1.45 * Math.cos(rot), 0.6, vz - 1.45 * Math.sin(rot), 0.1, 0.3, 1.0, on ? 0xfff3c4 : 0xe8e8e8, { rot, glow: on, outline: false, cap: false })
  }
  const [ax, az] = at(sx + a + 7, sy + 3)
  const antenna = over(ax, az, 6.7)
  {
    k.cyl(ax, 0, az, 1.0, 0.5, 0x9aa3b5, { seg: 10 })
    k.cyl(ax, 0.5, az, 0.28, 4, HULL, { seg: 6, cap: false })
    k.cyl(ax, 4.5, az, 0.4, 0.6, HULL, { seg: 12, rTop: 3, cap: false })
    k.cyl(ax, 5.1, az, 0.08, 1.6, 0x9aa3b5, { seg: 5, cap: false, outline: false })
    k.sphere(ax, 6.7, az, 0.16, 0xff3b3b, { glow: true, seg: 5, outline: false })
    for (let i = 0; i < 6; i++) k.crate(...at(sx + a + 5 + rng.range(-1.5, 1.5), sy - 4 + rng.range(-1.5, 1.5)), rng.range(0.5, 0.9), HULL)
    k.flag(...at(sx - a - 4, sy + b + 3), 0x4fd6ff, 4)
    k.flag(...at(sx + a + 4, sy - b - 3), 0xff3d68, 4)
  }
  crowd(k, 12, suit)

  // ─── What moves: the rover, a satellite, the beacon, the crew ──────────
  // No clouds and no birds: nothing lives in this sky but what the base put
  // there.
  const life: Actor[] = []
  life.push({
    id: 'rover',
    path: [[sx - a - 11, sy - 2], [sx - a - 4, sy - 6]],
    duration: 34_000,
    motion: 'bounce',
    turn: true,
    build: (kk) => rover(kk, 0, 0),
  })
  life.push({
    id: 'satellite',
    flying: true,
    path: [[-52, 12], [52, 21]],
    duration: 40_000,
    motion: 'pass',
    every: 130_000,
    build: (kk) => {
      kk.box(0, 16, 0, 0.9, 0.7, 0.7, HULL)
      kk.box(1.6, 16.3, 0, 2.2, 0.06, 0.9, 0x1d3a7a, { cap: false })
      kk.box(-1.6, 16.3, 0, 2.2, 0.06, 0.9, 0x1d3a7a, { cap: false })
      kk.cyl(0, 16.7, 0, 0.35, 0.3, 0x9aa3b5, { seg: 8, rTop: 0.1, cap: false })
      kk.sphere(0, 15.8, 0, 0.08, 0xff3b3b, { glow: true, seg: 4, outline: false })
    },
  })
  life.push({
    id: 'beacon',
    flying: true,
    puff: true,
    path: [antenna],
    duration: 2200,
    build: (kk) => {
      kk.sphere(0, 0, 0, 0.22, 0xff3b3b, { glow: true, seg: 6, outline: false })
      kk.halo(0, 0, 0, 0.7, 0xff3b3b, 0.5, false)
    },
  })
  life.push(...strollers(k, 3, { look: suit, slow: 1.6 }))
  life.push(...streetWalkers(k, plan, 2, { look: suit }))
  return life
}
