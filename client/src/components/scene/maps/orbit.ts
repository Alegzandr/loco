/**
 * Orbit, seen from the table: a landing pad on an airless moon, the Earth in
 * a black sky.
 *
 * - **Near**: the pad's metal plates with their hazard edge, a mast with its
 *   floodlight and antenna on the left, cargo on the right and the rover
 *   that has been out too long.
 * - **Middle**: the base — white domes half sunk in the regolith with a ring
 *   of lit windows, the tubes between them, a dish on the left, the rocket
 *   on its gantry on the right.
 * - **Far**: crater rims and the grey mountains of the highlands, with no
 *   air to soften them (`LOOK.rooms.orbit.haze`): here the far is as sharp
 *   as the near, which is what a place with no air looks like.
 *
 * The only colours are the ones the base brought: orange stripes, cyan light
 * and the white of everything else, under the blue of the Earth.
 */
import type { Builder } from './vista'
import { MAPS } from '../../cards/maps'
import { mix, scale } from '../sky'
import { hills, vistaTable } from './vista'
import { shuttle } from './vistaLife'

const REGOLITH = 0x8a8c93
const REGOLITH2 = 0x7a7c84
const PLATE = 0x6f7884
const PLATE2 = 0x646c78
const WHITE = 0xe9edf2
const ORANGE = 0xf28c28
const CYAN = 0x4fd6ff
const STEEL = 0x55606c

export const orbit: Builder = (k) => {
  const rng = k.rng
  const on = k.rig.lampsOn
  const view = k.view
  if (!view) return
  vistaTable(k, MAPS.orbit.table)

  // ─── The ground, to the horizon ─────────────────────────────────────────
  k.box(0, -0.4, -2600, 9000, 0.4, 5300, REGOLITH, { outline: false, cap: false })
  // Craters: a darker floor inside a raised rim, flattened by the distance.
  for (let i = 0; i < 40; i++) {
    const x = rng.range(-500, 500)
    const z = rng.range(-30, -700)
    if (Math.abs(x) < 20 && z > -60) continue
    const r = rng.range(3, 16) * (1 + -z / 400)
    k.cyl(x, -0.1, z, r * 1.15, 0.35, REGOLITH2, { seg: 20, rTop: r, outline: false, cap: false })
    k.cyl(x, -0.02, z, r * 0.9, 0.1, scale(REGOLITH2, 0.85), { seg: 20, outline: false, cap: false })
  }
  for (let i = 0; i < 80; i++) {
    const x = rng.range(-60, 60)
    const z = rng.range(-9, -80)
    k.sphere(x, 0, z, rng.range(0.15, 0.6), mix(REGOLITH, 0x6a6c74, rng.range(0, 1)), { seg: 5, outline: false })
  }

  // ─── Near: the pad ──────────────────────────────────────────────────────
  const EDGE = -8
  for (let z = EDGE; z < view.eye[2] + 2; z += 1.6) {
    for (let x = -14; x < 14; x += 1.6) {
      k.box(x + 0.8, 0, z + 0.8, 1.56, 0.12, 1.56, (Math.round(x / 1.6) + Math.round(z / 1.6)) % 2 ? PLATE : PLATE2, { outline: false, cap: false, gloss: 0.25 })
    }
  }
  // The hazard edge along the pad's far side, and its lights.
  for (let x = -14; x < 14; x += 1.2) k.box(x + 0.6, 0.12, EDGE + 0.2, 0.58, 0.04, 0.4, 0x22262c, { outline: false, cap: false })
  for (let x = -13.4; x < 14; x += 1.2) k.box(x + 0.6, 0.12, EDGE + 0.2, 0.58, 0.045, 0.4, ORANGE, { rot: 0.5, outline: false, cap: false })
  for (let x = -12; x <= 12; x += 4) k.cyl(x, 0.12, EDGE, 0.12, 0.14, on ? CYAN : 0x3a6a7a, { seg: 8, glow: on, outline: false })

  // Left: the mast, a floodlight and an antenna.
  k.box(-7.2, 0, -6.4, 0.9, 0.3, 0.9, STEEL)
  k.cyl(-7.2, 0.3, -6.4, 0.14, 6.2, 0xc9ced6, { seg: 8 })
  k.box(-6.8, 5.8, -6.4, 0.8, 0.5, 0.5, STEEL, { rot: 0.3 })
  k.box(-6.4, 5.85, -6.2, 0.1, 0.4, 0.44, on ? 0xfff6dc : 0xdfe3e8, { rot: 0.3, glow: on, outline: false, cap: false })
  k.cyl(-7.2, 6.5, -6.4, 0.03, 1.8, 0xc9ced6, { seg: 4, cap: false })
  if (on) k.sphere(-7.2, 8.3, -6.4, 0.1, 0xff3b4f, { glow: true, seg: 6, outline: false })
  // Right: cargo, white with its orange band, and the rover.
  const crate = (x: number, z: number, s: number, y = 0, rot = 0) => {
    k.box(x, y, z, s, s * 0.8, s, WHITE, { rot })
    k.box(x, y + s * 0.3, z, s + 0.02, s * 0.14, s + 0.02, ORANGE, { rot, outline: false, cap: false })
  }
  crate(6.2, -6.8, 1.2, 0, 0.2)
  crate(7.5, -6.2, 1.0, 0, -0.3)
  crate(6.6, -6.6, 0.9, 0.96, 0.5)
  const rx = 7.6
  const rz = -2.6
  k.box(rx, 0.5, rz, 2.6, 0.7, 1.6, WHITE, { rot: -0.4 })
  k.box(rx - 0.3, 1.2, rz, 1.1, 0.6, 1.2, 0xc9d0da, { rot: -0.4 })
  k.box(rx - 0.84, 1.3, rz - 0.38, 0.06, 0.36, 0.9, 0x243847, { rot: -0.4, gloss: 0.8, outline: false, cap: false })
  for (const [dx, dz] of [[-1, -0.9], [1, -0.9], [-1, 0.9], [1, 0.9]]) {
    const c = Math.cos(-0.4)
    const s = Math.sin(-0.4)
    k.cyl(rx + dx * c + dz * s, 0.42, rz - dx * s + dz * c, 0.42, 0.34, 0x33383f, { axis: 'z', rot: -0.4, seg: 10 })
  }
  k.cyl(rx + 0.8, 1.2, rz - 0.3, 0.03, 1.6, 0xc9ced6, { seg: 4, cap: false })

  // ─── Middle: the base ───────────────────────────────────────────────────
  const dome = (x: number, z: number, r: number) => {
    k.sphere(x, -r * 0.35, z, r, WHITE, { seg: 24 })
    k.cyl(x, 0, z, r * 0.96, 0.6, 0xb9c0c9, { seg: 24, cap: false })
    // A ring of windows, lit after dark, set into the shell: the sphere's
    // own radius at the windows' height, each one turned to face out of it.
    const wy = r * 0.25
    const wh = r * 0.05
    const lift = wy + wh / 2 + r * 0.35
    const shell = Math.sqrt(r * r - lift * lift)
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i - 4.5) * 0.22
      const wx = x + Math.cos(a) * shell
      const wz = z - Math.sin(a) * shell
      const litHere = on && rng.chance(0.6)
      k.box(wx, wy, wz, r * 0.07, wh, r * 0.03, litHere ? mix(CYAN, 0xffffff, 0.3) : 0x2a3a48, { rot: a + Math.PI / 2, glow: litHere, outline: false, cap: false })
    }
  }
  dome(-34, -70, 9)
  dome(-12, -96, 12)
  dome(26, -84, 8)
  // The tubes between them, each with a row of windows along the flank that
  // faces the table, laid on the tube's own axis.
  const tube = (cx: number, cz: number, rot: number) => {
    const tr = 1.5
    k.cyl(cx, 1.6, cz, tr, 22, 0xd9dee5, { axis: 'x', rot, seg: 12 })
    const ux = Math.cos(rot)
    const uz = -Math.sin(rot)
    for (const t of [-4.5, -1.5, 1.5, 4.5]) {
      const wx = cx + ux * t - uz * tr
      const wz = cz + uz * t + ux * tr
      k.box(wx, 1.4, wz, 0.9, 0.4, 0.2, on ? CYAN : 0x2a3a48, { rot, glow: on, outline: false, cap: false })
    }
  }
  tube(-23, -82, 0.9)
  tube(7, -90, -0.25)
  // The dish on the left.
  k.cyl(-70, 0, -120, 1.6, 9, 0xc9ced6, { seg: 10 })
  k.cone(-70, 16, -118, 9, 4, WHITE, { seg: 24 })
  k.cyl(-70, 14, -118, 0.3, 6, STEEL, { seg: 6, cap: false })
  // The rocket on its gantry, on the right.
  const gx = 88
  const gz = -190
  k.cyl(gx, 0, gz, 5.5, 3, 0x6b7380, { seg: 16, cap: false })
  k.cyl(gx, 3, gz, 3.2, 30, WHITE, { seg: 16 })
  for (const y of [8, 20]) k.cyl(gx, 3 + y, gz, 3.25, 2.2, ORANGE, { seg: 16, outline: false, cap: false })
  k.cone(gx, 33, gz, 3.2, 9, ORANGE, { seg: 16 })
  for (const a of [0, 2.1, 4.2]) k.box(gx + Math.cos(a) * 3.6, 3, gz + Math.sin(a) * 3.6, 0.4, 7, 2.4, WHITE, { rot: -a })
  // The gantry: a lattice tower beside it, lit at every level at night.
  for (let y = 0; y < 38; y += 4) {
    k.box(gx + 8, y, gz, 4, 0.3, 4, STEEL, { cap: false })
    for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) k.box(gx + 8 + dx, y, gz + dz, 0.25, 4, 0.25, STEEL, { outline: false, cap: false })
    if (on && y % 8 === 0) k.box(gx + 6, y + 0.4, gz + 2, 0.3, 0.3, 0.3, 0xff3b4f, { glow: true, outline: false, cap: false })
  }

  // ─── Far: the rims and the highlands ────────────────────────────────────
  hills(k, -1600, -300, -1100, 90, 0x80828a, 9, -1)
  hills(k, 300, 1800, -1300, 120, 0x7a7c85, 9, -1)
  hills(k, -3500, 3500, -3200, 120, 0x6f717a, 14, -1)
  // A few peaks, sharp: nothing weathers them here.
  for (let i = 0; i < 8; i++) {
    const x = rng.range(-2500, 2500)
    // Low enough to leave the Earth its sky.
    k.cone(x, -1, rng.range(-2200, -2800), rng.range(120, 220), rng.range(60, 120), mix(0x75777f, 0x8a8c94, rng.range(0, 1)), { seg: 6, outline: false })
  }
  // ─── What moves ─────────────────────────────────────────────────────────
  return [shuttle('shuttle', [[-1400, 260, -1600], [1400, 360, -1600]], { duration: 60_000, every: 120_000, size: 8 })]
}
