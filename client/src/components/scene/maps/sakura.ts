/**
 * Sakura, seen from the table: the veranda of a hot-spring inn, under its
 * eaves, looking out over a garden to a pagoda on the hill.
 *
 * - **Near**: cedar boards, the two posts of the veranda at the frame's edges
 *   and the eave's beam across the top — the picture is seen from under a
 *   roof, which is what frames it — a paper lantern hanging at each side,
 *   and the cherry branches reaching in over the top corners.
 * - **Middle**: the garden beyond the veranda's rail: raked gravel, stone
 *   lanterns, a pond with its red bridge, the torii at the water's edge,
 *   cherry trees in bloom.
 * - **Far**: the pagoda on the wooded hill to the left, and a broad mountain
 *   with snow on its shoulders, far enough to be mostly sky.
 *
 * The trees are in blossom in every season the server deals: a village that
 * is only pink in April is one nobody is dealt into in October.
 */
import type { Builder } from './vista'
import { MAPS } from '../../cards/maps'
import { mix, scale } from '../sky'
import { deck, hills, vistaTable } from './vista'
import { gull, petal } from './vistaLife'

const CEDAR = 0x6b3f2a
const CEDAR2 = 0x5c3524
const POST = 0x3d2418
const LACQUER = 0xc23a2f
const ROOF = 0x3a3f4a
const PAPER = 0xd8433a
const PINK = [0xffd0e0, 0xffbdd4, 0xfaaecb, 0xffe2ec] as const
const GRAVEL = 0xd9d2c3
const MOSS = 0x7a8f5e
const STONE = 0x9a9892

export const sakura: Builder = (k) => {
  const rng = k.rng
  const on = k.rig.lampsOn
  const view = k.view
  if (!view) return
  vistaTable(k, MAPS.sakura.table)

  // ─── Near: the veranda ──────────────────────────────────────────────────
  const EDGE = -6
  deck(k, EDGE, view.eye[2] + 2, 30, CEDAR, CEDAR2, { plank: 0.3 })
  // Its rail: a low lacquered bar on short posts.
  k.box(0, 0.7, EDGE - 0.2, 30, 0.1, 0.12, LACQUER, { cap: false })
  for (let x = -14; x <= 14; x += 2.2) k.box(x, 0, EDGE - 0.2, 0.12, 0.72, 0.12, POST, { outline: false, cap: false })
  // The posts and the eave: a beam across the top of the frame and the
  // underside of the roof going back over the camera.
  for (const x of [-6.6, 6.6]) {
    k.box(x, 0, EDGE + 0.2, 0.36, 3.9, 0.36, POST)
    k.box(x, 0, EDGE + 0.2, 0.5, 0.25, 0.5, scale(STONE, 0.8))
  }
  k.box(0, 3.7, EDGE + 0.2, 16, 0.4, 0.42, POST)
  k.box(0, 4.1, EDGE + 1.6, 17, 0.14, 4.2, scale(ROOF, 0.8), { outline: false, cap: false })
  for (let x = -8; x <= 8; x += 0.9) k.box(x, 3.95, EDGE + 1.6, 0.1, 0.16, 4.2, POST, { outline: false, cap: false })
  // A paper lantern hanging at each side, lit from the hour the lamps are.
  for (const x of [-5.2, 5.2]) {
    k.cyl(x, 2.75, EDGE + 0.6, 0.02, 0.95, POST, { seg: 4, cap: false, outline: false })
    // A red paper lantern, lit from within after dark.
    k.cyl(x, 2.07, EDGE + 0.6, 0.3, 0.66, on ? 0xff7a4a : PAPER, { seg: 14, rTop: 0.3, glow: on })
    k.sphere(x, 2.4, EDGE + 0.6, 0.36, on ? 0xff7a4a : PAPER, { seg: 14, glow: on })
    for (const y of [2.2, 2.6]) k.cyl(x, y, EDGE + 0.6, 0.37, 0.03, POST, { seg: 14, outline: false, cap: false })
    k.cyl(x, 2.01, EDGE + 0.6, 0.18, 0.06, POST, { seg: 8, cap: false, outline: false })
    k.cyl(x, 2.73, EDGE + 0.6, 0.18, 0.06, POST, { seg: 8, cap: false, outline: false })
    if (on) k.halo(x, 2.4, EDGE + 0.6, 0.7, 0xffc27a, 0.3, false)
  }
  // A cushion and a low tray on the boards to the left.
  k.box(-5.0, 0, -1.2, 1.0, 0.18, 1.0, 0x7a4a8a)
  k.box(4.8, 0, -1.6, 1.2, 0.3, 0.8, CEDAR2)
  k.cyl(4.6, 0.3, -1.6, 0.14, 0.2, 0xe8e2d6, { seg: 10 })

  // ─── Cherry branches over the top corners ───────────────────────────────
  // Two trees just past the posts, their crowns reaching in under the eave.
  const blossom = (cx: number, cy: number, cz: number, spread: number, n: number) => {
    for (let i = 0; i < n; i++) {
      const x = cx + rng.range(-spread, spread)
      const y = cy + rng.range(-spread * 0.35, spread * 0.4)
      const z = cz + rng.range(-spread * 0.6, spread * 0.6)
      k.sphere(x, y, z, rng.range(0.45, 0.95), k.leaf(rng.pick(PINK)), { seg: 8, outline: false })
    }
  }
  const trunk = (x: number, z: number, h: number, lean: number) => {
    k.cyl(x, 0, z, 0.32, h, 0x4a2c22, { seg: 7, rTop: 0.2 })
    k.box(x + lean * 1.2, h - 0.4, z, 2.6, 0.22, 0.22, 0x4a2c22, { tilt: lean * 0.5, outline: false, cap: false })
  }
  trunk(-9.5, -10, 3.8, 1)
  blossom(-7.2, 4.4, -9, 3.6, 110)
  blossom(-9.6, 3.4, -11, 2.4, 50)
  trunk(10, -12, 4, -1)
  blossom(7.8, 4.5, -11, 3.8, 110)
  blossom(10.5, 3.3, -13, 2.4, 50)

  // ─── Middle: the garden ─────────────────────────────────────────────────
  k.box(0, -0.6, -2600, 9000, 0.1, 5200, k.ground(mix(MOSS, 0x5a7a4a, 0.4)), { outline: false, cap: false })
  // Raked gravel in front of the veranda, stepping stones across it, and
  // petals fallen on both.
  k.box(0, -0.58, -18, 70, 0.05, 26, k.ground(GRAVEL), { outline: false, cap: false })
  for (let i = 0; i < 9; i++) k.cyl(-1 + Math.sin(i) * 2, -0.55, EDGE - 2 - i * 2.4, rng.range(0.5, 0.7), 0.1, STONE, { seg: 8, outline: false })
  for (let i = 0; i < 220; i++) k.disc(rng.range(-30, 30), -0.52, rng.range(-6.5, -60), rng.range(0.05, 0.12), k.leaf(rng.pick(PINK)))
  // Stone lanterns.
  const toro = (x: number, z: number, s: number) => {
    k.box(x, -0.55, z, 0.9 * s, 0.25 * s, 0.9 * s, STONE)
    k.cyl(x, -0.3, z, 0.18 * s, 1.1 * s, STONE, { seg: 6 })
    k.box(x, -0.3 + 1.1 * s, z, 0.7 * s, 0.55 * s, 0.7 * s, on ? 0xffd28a : STONE, { glow: on, cap: false })
    k.cone(x, 0.25 + 1.1 * s, z, 0.75 * s, 0.45 * s, STONE, { seg: 6 })
  }
  toro(-9, -18, 1.3)
  toro(11, -24, 1.2)
  toro(-22, -40, 1.4)
  // The pond, its bridge, the torii at its edge.
  k.cyl(4, -0.62, -60, 18, 0.1, 0x3f7a8a, { seg: 32, water: true, outline: false, cap: false })
  for (let i = 0; i < 12; i++) {
    const t = i / 11
    const a = Math.sin(t * Math.PI) * 1.6
    k.box(-8 + t * 16, -0.4 + a, -58, 1.4, 0.2, 2.4, LACQUER, { outline: false, cap: false })
  }
  k.box(-8, -0.6, -58, 0.2, 2, 2.4, LACQUER, { outline: false, cap: false })
  const torii = (x: number, z: number, s: number) => {
    for (const dx of [-2.2, 2.2]) k.cyl(x + dx * s, -0.6, z, 0.28 * s, 6 * s, LACQUER, { seg: 10 })
    k.box(x, -0.6 + 4.6 * s, z, 5.6 * s, 0.4 * s, 0.5 * s, LACQUER)
    k.box(x, -0.6 + 5.8 * s, z, 7 * s, 0.45 * s, 0.6 * s, 0x2a1d1a)
    k.box(x, -0.6 + 5.4 * s, z, 0.4 * s, 0.9 * s, 0.4 * s, LACQUER, { outline: false })
  }
  torii(26, -74, 1.2)
  // Cherry trees through the garden and up the slope.
  for (let i = 0; i < 60; i++) {
    const x = rng.range(-120, 120)
    const z = rng.range(-22, -170)
    if (Math.abs(x) < 12 && z > -80) continue
    const s = rng.range(0.8, 1.3)
    k.cyl(x, -0.6, z, 0.35 * s, 3 * s, 0x4a2c22, { seg: 6, rTop: 0.22 * s })
    for (let j = 0; j < 7; j++) k.sphere(x + rng.range(-2, 2) * s, -0.6 + (3.2 + rng.range(0, 1.6)) * s, z + rng.range(-1.5, 1.5) * s, rng.range(1.2, 2) * s, k.leaf(rng.pick(PINK)), { seg: 8, outline: false })
  }

  // ─── Far: the pagoda on its hill, the mountain ──────────────────────────
  // The garden's edge: clipped hedges, and the ground rising in soft folds
  // to a line of dark pines, so the lawn ends where the eye expects it to.
  for (let i = 0; i < 26; i++) {
    const x = rng.range(-90, 90)
    const z = rng.range(-26, -70)
    if (Math.abs(x) < 10) continue
    const r = rng.range(0.9, 1.8)
    k.sphere(x, -0.6 + r * 0.35, z, r, k.leaf(mix(0x3f6e45, 0x557f4a, rng.range(0, 1))), { seg: 8 })
  }
  hills(k, -420, 420, -190, 9, 0x6a8a55, 14, -1)
  for (let i = 0; i < 140; i++) {
    const x = rng.range(-520, 520)
    const z = rng.range(-210, -300)
    const hh = rng.range(7, 13)
    k.cone(x, rng.range(1, 6), z, hh * 0.3, hh, mix(0x2f5a3f, 0x3a6647, rng.range(0, 1)), { seg: 6, outline: false })
  }
  hills(k, -900, -120, -520, 60, 0x4f7a55, 7, -1)
  hills(k, 200, 1200, -760, 45, 0x5a8060, 7, -1)
  hills(k, -2600, 2600, -1800, 120, 0x6a8a8a, 12, -1)
  // The pagoda, five roofs, standing on the near hill's shoulder.
  const px = -330
  const pz = -560
  const py = 26
  for (let t = 0; t < 5; t++) {
    const w = 11 - t * 1.6
    const y = py + t * 6
    k.box(px, y, pz, w * 0.7, 4.4, w * 0.7, 0xe8dcc8, { cap: false })
    k.box(px, y + 4.2, pz, w * 1.3, 0.6, w * 1.3, ROOF, { cap: true })
    k.box(px, y + 4.2, pz, w * 1.34, 0.2, w * 1.34, LACQUER, { outline: false, cap: false })
  }
  k.cyl(px, py + 30, pz, 0.3, 8, 0x8a7a55, { seg: 6, cap: false })
  // Pines on the hill round it.
  for (let i = 0; i < 40; i++) {
    const x = px + rng.range(-160, 160)
    const z = pz + rng.range(-60, 80)
    const hh = rng.range(10, 18)
    k.cone(x, rng.range(0, 20), z, hh * 0.3, hh, mix(0x2f5a3f, 0x3f6a48, rng.range(0, 1)), { seg: 6, outline: false })
  }
  // The mountain: a broad cone, snow on its upper third.
  k.cone(900, -1, -5200, 2800, 1500, 0x5f7596, { seg: 28, outline: false })
  k.cone(900, 900, -5200 + 200, 1130, 600, 0xf2f4f8, { seg: 28, outline: false })
  // ─── What moves: petals past the eaves, a pair of birds far off ─────────
  const petals = Array.from({ length: 12 }, (_, i) =>
    petal(`petal-${i}`, [rng.range(-10, 10), rng.range(3.6, 5), rng.range(-12, -6)], [rng.range(0.6, 2.4), rng.range(1.5, 4)], { duration: rng.range(7000, 11_000), delay: rng.range(0, 11_000), color: rng.pick(PINK) }),
  )
  return [
    ...petals,
    gull('bird-a', [[-60, 18, -120], [-10, 22, -150], [40, 19, -130]], { duration: 30_000, color: 0x3a3440, size: 0.8 }),
    gull('bird-b', [[80, 26, -200], [30, 29, -230], [-30, 26, -210]], { duration: 38_000, delay: 12_000, color: 0x3a3440, size: 0.8 }),
  ]
}
