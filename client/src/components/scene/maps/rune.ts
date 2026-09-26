/**
 * Rune, seen from the table: the square of a village that has a wizard in
 * it, the wizard's tower on its hill beyond the roofs.
 *
 * - **Near**: cobbles; on the left the corner of the tavern, half-timbered,
 *   its window warm and its sign hanging from an iron bracket with a lantern
 *   under it; on the right a market stall with its barrels, and out on the
 *   square one of the standing stones whose rune glows after dark.
 * - **Middle**: the street running away on the right, gabled houses in a
 *   row, a well, then the meadow climbing to the woods.
 * - **Far**: the hill, the tower on it with windows the wrong colour and a
 *   light at its top, pine woods, and the blue mountains behind.
 */
import type { Builder } from './vista'
import { MAPS } from '../../cards/maps'
import { mix, type Hex } from '../sky'
import type { Kit } from '../kit'
import { hills, vistaTable } from './vista'
import { bat, gull, smoke } from './vistaLife'

const COBBLE = 0x9c8a74
const COBBLE2 = 0x8a7864
const PLASTER = 0xefe2c6
const TIMBER = 0x4a2e1c
const ROOF = [0x8a3a2a, 0x6e3a2e, 0x7a4a32] as const
const MEADOW = 0x6f8f4a
const PINE = 0x2f4f3a
const RUNE = 0x9d6bff
const WARM = 0xffc27a

/**
 * A gabled house, half-timbered, its gable end facing `+z` (the camera) or
 * its long side (`side`). Windows lit tonight at the hour's share.
 */
function house(k: Kit, x: number, z: number, w: number, d: number, h: number, roof: Hex, o: { side?: boolean; y?: number } = {}) {
  const rng = k.rng
  const y = o.y ?? 0
  const rot = o.side ? Math.PI / 2 : 0
  k.box(x, y, z, w, h, d, PLASTER, { rot })
  // Timbers on the face towards the camera.
  const fw = o.side ? d : w
  const fz = z + (o.side ? w : d) / 2 + 0.04
  for (let i = 0; i <= 3; i++) k.box(x - fw / 2 + (i / 3) * fw, y, fz, 0.18, h, 0.08, TIMBER, { outline: false, cap: false })
  k.box(x, y + h * 0.5, fz, fw, 0.18, 0.08, TIMBER, { outline: false, cap: false })
  for (let i = 0; i < 2; i++) {
    const wx = x - fw / 4 + i * (fw / 2)
    const litHere = k.rig.lampsOn && rng.chance(Math.max(0.25, k.rig.windowsLit))
    k.box(wx, y + h * 0.62, fz + 0.02, 0.8, 0.9, 0.06, litHere ? WARM : 0x2a2a38, { glow: litHere, outline: false, cap: false })
  }
  k.prism(x, y + h, z, (o.side ? d : w) + 0.5, h * 0.7, (o.side ? w : d) + 0.4, k.top(roof), { rot: o.side ? 0 : Math.PI / 2 })
  if (rng.chance(0.6)) k.box(x + fw * 0.25, y + h + h * 0.3, z, 0.5, 1.4, 0.5, 0x6a5a50)
}

export const rune: Builder = (k) => {
  const rng = k.rng
  const on = k.rig.lampsOn
  const view = k.view
  if (!view) return
  vistaTable(k, MAPS.rune.table)

  // ─── The ground ─────────────────────────────────────────────────────────
  k.box(0, -0.3, -2600, 9000, 0.3, 5300, k.ground(MEADOW), { outline: false, cap: false })
  // Cobbles in the square, laid in rows across.
  for (let z = -16; z < view.eye[2] + 2; z += 0.55) {
    const off = (Math.round(z / 0.55) % 2) * 0.35
    for (let x = -14 + off; x < 14; x += 0.7) {
      k.box(x, -0.05, z, 0.64, 0.1, 0.5, k.ground(mix(COBBLE, COBBLE2, rng.range(0, 1))), { outline: false, cap: true, gloss: k.wetGloss() })
    }
  }

  // ─── Near: the tavern on the left ───────────────────────────────────────
  // Its long wall faces the square, running away from the camera.
  const tx = -9.6
  k.box(tx, 0, -9, 4, 6.2, 12, PLASTER)
  for (let z = -14.5; z <= -3.5; z += 2.2) k.box(tx + 2.04, 0, z, 0.08, 6.2, 0.2, TIMBER, { outline: false, cap: false })
  for (const y of [0.9, 3.2, 6.0]) k.box(tx + 2.04, y, -9, 0.08, 0.2, 12, TIMBER, { outline: false, cap: false })
  // Two windows and the door, on the wall towards the table.
  for (const z of [-5.2, -12.4]) k.box(tx + 2.08, 3.6, z, 0.06, 1.1, 1.2, on ? WARM : 0x2a2a38, { glow: on, outline: false, cap: false })
  k.box(tx + 2.08, 0, -8.6, 0.06, 2.2, 1.3, 0x3a2418, { outline: false, cap: false })
  if (on) k.halo(tx + 2.8, 0, -8.6, 2.2, WARM, 0.35)
  k.prism(tx, 6.2, -9, 12.6, 3, 4.8, k.top(ROOF[0]), { rot: Math.PI / 2 })
  // The sign on its bracket, and the lantern under it.
  k.box(tx + 3, 4.6, -4.2, 2, 0.1, 0.1, 0x2b2b30, { cap: false })
  k.box(tx + 3.6, 3.6, -4.2, 0.08, 0.9, 1.1, 0x7a4a2a, { cap: false })
  k.box(tx + 3.64, 3.8, -4.2, 0.04, 0.4, 0.5, 0xd9a441, { outline: false, cap: false })
  k.lantern(tx + 2.8, 3.1, -4.2, on ? 0xffc27a : 0x6a5a40, 0.26)
  if (on) k.halo(tx + 2.8, 3.1, -4.2, 0.7, WARM, 0.35, false)

  // ─── Near: a market stall on the right ──────────────────────────────────
  // A striped awning over a counter of baskets, barrels by it, lit by its
  // own lantern after dark: colour where the cart was a black shape.
  const cx = 7.2
  const cz = -7.5
  k.stall(cx, cz, -0.35, 0xc8513f, 0xf3e6c8)
  for (const [dx, dz] of [[-1.9, 1.0], [-2.5, 0.2]]) {
    k.cyl(cx + dx, 0, cz + dz, 0.34, 0.8, 0x8a5a2f, { seg: 10 })
    k.cyl(cx + dx, 0.62, cz + dz, 0.36, 0.06, 0x2a2a2a, { seg: 10, outline: false, cap: false })
  }
  k.lantern(cx - 1.2, 2.1, cz + 0.9, on ? 0xffc27a : 0x6a5a40, 0.22)
  if (on) k.halo(cx - 1.2, 0, cz + 0.9, 2.4, WARM, 0.35)
  // The standing stone, its rune lit after dark. Out on the square between the
  // well and the stall, clear of both: set straight behind the stall it lined
  // up with it from the table, and all that showed between the posts was a
  // violet panel with a white slab floating on it.
  const sx = 5.2
  const sz = -17
  k.box(sx, 0, sz, 1.3, 3.6, 0.8, 0x7e7f86, { rot: -0.2 })
  k.box(sx - 0.06, 1.8, sz + 0.42, 0.5, 1.1, 0.04, on ? RUNE : 0x5a5a66, { rot: -0.2, glow: on, outline: false, cap: false })
  if (on) k.halo(sx, 0, sz + 1, 2.5, RUNE, 0.3)

  // ─── Middle: the street, the well, the meadow ───────────────────────────
  for (let i = 0; i < 6; i++) {
    const z = -20 - i * 11
    house(k, 14 + rng.range(-1, 1), z, 8, 6, rng.range(4.5, 6.5), rng.pick(ROOF), { side: true })
    house(k, -18 - rng.range(0, 2), z - 4, 8, 6, rng.range(4.5, 6), rng.pick(ROOF), { side: true })
  }
  k.cyl(-2, 0, -26, 1.1, 0.9, 0x8a8a90, { seg: 14 })
  for (const dx of [-0.9, 0.9]) k.box(-2 + dx, 0.9, -26, 0.14, 1.8, 0.14, TIMBER, { outline: false, cap: false })
  k.prism(-2, 2.7, -26, 2.4, 0.9, 1.6, ROOF[1])
  // Fence and trees at the edge of the meadow.
  for (let i = 0; i < 30; i++) {
    const x = rng.range(-200, 200)
    const z = rng.range(-90, -220)
    if (Math.abs(x) < 20) continue
    const s = rng.range(0.8, 1.4)
    // The crown starts at twice a person's height, so the trunk under it
    // still reads at this distance and through the rain.
    k.cyl(x, 0, z, 0.4 * s, 3 * s, 0x5a3a26, { seg: 6 })
    k.sphere(x, 4.4 * s, z, 2.2 * s, k.leaf(mix(0x4f7a3a, 0x6a8a42, rng.range(0, 1))), { seg: 8, outline: false })
  }

  // ─── Far: the hill, the tower, the woods, the mountains ─────────────────
  // Low folds of meadow, never high enough to hide what stands behind them.
  hills(k, -700, 200, -620, 18, mix(MEADOW, 0x4a6a3a, 0.4), 8, -1)
  hills(k, 100, 1300, -760, 16, mix(MEADOW, 0x4a6a3a, 0.5), 8, -1)
  // Woods in front of the folds: dark pines standing on the meadow, each on
  // its trunk. The band is flat ground, so a pine lifted off it is a cone
  // hanging in the air.
  for (let i = 0; i < 160; i++) {
    const x = rng.range(-900, 1200)
    const z = rng.range(-300, -520)
    const hh = rng.range(9, 16)
    const bole = hh * 0.22
    k.cyl(x, 0, z, hh * 0.05, bole + 0.5, 0x3e2a1c, { seg: 5, outline: false, cap: false })
    k.cone(x, bole, z, hh * 0.28, hh, mix(PINE, 0x3f5f45, rng.range(0, 1)), { seg: 6, outline: false })
  }
  hills(k, -3000, 3000, -2600, 240, 0x5a6a8a, 12, -1)
  // The tower: a round keep narrowing up, a pointed cap, windows lit the
  // wrong colour, a light at the top that is on at every hour.
  // Far enough that its light, forty metres up, sits just under the frame's
  // top edge, in the gap the street opens between the roofs.
  const wx = -110
  const wz = -600
  const wy = 12
  // The hill has a flat crown wider than the keep: a cone's apex is a point,
  // and a keep stood on a point stands on nothing. The keep's footing goes
  // down into the hill so no slope or mist can show daylight under it.
  k.cyl(wx, -1, wz, 70, wy + 1, mix(MEADOW, 0x4a6a3a, 0.35), { seg: 14, rTop: 9, outline: false })
  k.cyl(wx, wy - 3, wz, 5.2, 3.4, 0x7a7584, { seg: 12, rTop: 4.8, outline: false })
  k.cyl(wx, wy, wz, 4.4, 22, 0x8f8a9a, { seg: 12, rTop: 3.6 })
  for (const y of [7, 13, 18]) k.box(wx, wy + y, wz + 4, 0.9, 1.6, 0.4, on ? RUNE : 0x3a3548, { glow: on, outline: false, cap: false })
  k.cyl(wx, wy + 22, wz, 5.2, 1.1, 0x6a6474, { seg: 12 })
  k.cone(wx, wy + 23.1, wz, 5, 12, 0x3e3456, { seg: 12 })
  k.sphere(wx, wy + 36, wz, 1.2, RUNE, { glow: true, seg: 10, outline: false })
  k.halo(wx, wy + 36, wz, 0.8, RUNE, 0.5, false)
  // ─── What moves: smoke from the tavern, bats after dark, swifts by day ──
  k.box(tx - 1, 7.4, -12.6, 0.8, 2.6, 0.8, 0x6a5a50)
  const air = on
    ? [bat('bat-a', [[-20, 9, -22], [-4, 12, -30], [10, 8, -24], [-6, 10, -18]]), bat('bat-b', [[16, 11, -34], [2, 14, -40], [-14, 10, -32]], { delay: 3000 })]
    : [gull('swift-a', [[-50, 14, -70], [-10, 18, -90], [30, 15, -80]], { duration: 20_000, color: 0x2e2a30, size: 0.6 })]
  return [smoke('tavern-smoke', [tx - 1, 10, -12.6], { rise: 6 }), smoke('tavern-smoke-2', [tx - 1, 10, -12.6], { rise: 6, delay: 2600 }), ...air]
}
