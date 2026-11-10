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
import { brazier, cask, groundInlay, hills, vistaTable } from './vista'
import type { Finish } from '../kit'
import { bat, gull, smoke } from './vistaLife'

const COBBLE = 0x9c8a74
const COBBLE2 = 0x8a7864
/** The bed the cobbles are set in: their own stone a shade down, never the meadow under them. */
const MORTAR = 0x6f6152
const PLASTER = 0xead9b8
const PLASTER2 = 0xe2cda6
const TIMBER = 0x5c3b25
const STONE = 0x8d8578
const ROOF = [0x8a3a2a, 0x6e3a2e, 0x7a4a32] as const
const SHUTTER = [0x3f6f66, 0x7a3b2e, 0x46557a] as const
const MEADOW = 0x6f8f4a
const PINE = 0x2f4f3a
const RUNE = 0x9d6bff
const WARM = 0xffc27a
const DARK_PANE = 0x2a2a38

/** A timber on a façade: thin, proud of the plaster by a hair, never outlined. */
const BEAM = 0.14

/**
 * A gabled house, half-timbered, its gable end facing `+z` (the camera) or
 * its long side (`side`): a stone course at its foot, posts and a rail with a
 * brace in each end bay, and two windows in their frames with shutters, lit
 * tonight at the hour's share. A plain block with four black bars on it was
 * what this was, and a street of them read as cartons.
 */
function house(k: Kit, x: number, z: number, w: number, d: number, h: number, roof: Hex, o: { side?: boolean; y?: number } = {}) {
  const rng = k.rng
  const y = o.y ?? 0
  const rot = o.side ? Math.PI / 2 : 0
  const plaster = rng.chance(0.5) ? PLASTER : PLASTER2
  k.box(x, y, z, w, h, d, plaster, { rot })
  const fw = o.side ? d : w
  const fz = z + (o.side ? w : d) / 2 + 0.04
  // The stone course the frame stands on.
  k.box(x, y, fz - 0.02, fw + 0.12, 0.7, 0.14, STONE, { outline: false, cap: false })
  // Posts, the rail at mid height, the plate under the eaves.
  for (let i = 0; i <= 3; i++) k.box(x - fw / 2 + (i / 3) * fw, y + 0.7, fz, BEAM, h - 0.7, 0.08, TIMBER, { outline: false, cap: false })
  for (const ry of [h * 0.5, h - BEAM]) k.box(x, y + ry, fz, fw, BEAM, 0.08, TIMBER, { outline: false, cap: false })
  // A brace in each end bay, leaning in towards the middle.
  const bay = fw / 3
  const rise = h * 0.5 - 0.7
  const len = Math.hypot(bay, rise)
  for (const sgn of [-1, 1]) {
    k.box(x + sgn * (fw / 2 - bay / 2), y + 0.7 + rise / 2, fz, len, BEAM, 0.08, TIMBER, { tilt: sgn * Math.atan2(rise, bay), outline: false, cap: false })
  }
  const shutter = rng.pick(SHUTTER)
  for (let i = 0; i < 2; i++) {
    const wx = x - fw / 6 + i * (fw / 3)
    const wy = y + h * 0.5 + (h * 0.5 - 1.0) / 2 - 0.1
    const litHere = k.rig.lampsOn && rng.chance(Math.max(0.25, k.rig.windowsLit))
    k.box(wx, wy - 0.07, fz + 0.01, 0.94, 1.14, 0.06, TIMBER, { outline: false, cap: false })
    k.box(wx, wy, fz + 0.03, 0.8, 1.0, 0.06, litHere ? WARM : DARK_PANE, { glow: litHere, outline: false, cap: false })
    for (const sgn of [-1, 1]) k.box(wx + sgn * 0.66, wy - 0.03, fz + 0.02, 0.36, 1.06, 0.06, shutter, { outline: false, cap: false })
  }
  k.prism(x, y + h, z, (o.side ? d : w) + 0.7, h * 0.7, (o.side ? w : d) + 0.6, k.top(roof), { rot: o.side ? 0 : Math.PI / 2 })
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
  // Cobbles in the square, laid in rows across, set in a bed that comes up
  // nearly flush with them: a joint is a shallow line of darker stone. Over
  // the bare meadow each joint was a trench with grass at the bottom of it,
  // and from the table the square read as tiles floating on a lawn.
  const near = view.eye[2] + 2
  k.box(0, -0.1, (near - 16.4) / 2, 29.2, 0.125, near + 16.4, k.ground(MORTAR), { outline: false, cap: false, gloss: k.wetGloss() })
  for (let z = -16; z < near; z += 0.55) {
    const off = (Math.round(z / 0.55) % 2) * 0.35
    for (let x = -14 + off; x < 14; x += 0.7) {
      k.box(x, -0.05, z, 0.66, 0.1, 0.51, k.ground(mix(COBBLE, COBBLE2, rng.range(0, 1))), { outline: false, cap: true, gloss: k.wetGloss() })
    }
  }

  // The table's ground: a ring of dressed flagstone let into the cobbles, a
  // line of the rune's light cut round it. Lit after dark, the same violet
  // as the standing stone's.
  groundInlay(k, [
    { out: 1.62, color: 0x5d574f },
    { out: 1.5, color: RUNE, glow: true },
    { out: 1.44, color: 0x7d766c },
    { out: 0.5, color: 0x5d574f },
    { out: 0.42, color: 0x6f685f },
  ], 0.05)
  k.pool(0, 0, 5.5, WARM, 0.22)
  // A brazier either side of the square's near end: the fire the square is
  // lit by after dark, warm on the cobbles under a violet sky.
  const wrought: Finish = { kind: 'metal', color: 0x35333a }
  brazier(k, -5.4, -5.2, wrought)
  brazier(k, 4.6, -4.4, wrought)

  // ─── Near: the tavern on the left ───────────────────────────────────────
  // Its long wall faces the square, running away from the camera: a stone
  // course, the frame on it with a brace in each end bay, two windows in
  // their shutters over a box of flowers, and the door between them.
  const tx = -9.6
  const wall = tx + 2.04
  k.box(tx, 0, -9, 4, 6.2, 12, PLASTER)
  k.box(wall - 0.02, 0, -9, 0.14, 0.8, 12.1, STONE, { outline: false, cap: false })
  for (const z of [-14.9, -12.7, -10.5, -8.3, -6.1, -3.9, -3.1]) k.box(wall, 0.8, z, 0.08, 5.4, BEAM, TIMBER, { outline: false, cap: false })
  for (const y of [3.1, 6.2 - BEAM]) k.box(wall, y, -9, 0.08, BEAM, 12, TIMBER, { outline: false, cap: false })
  for (const [z0, z1, lean] of [[-14.9, -12.7, 1], [-6.1, -3.9, -1]] as const) {
    const run = z1 - z0
    const rise = 3.1 - 0.8
    k.box(wall, 0.8 + rise / 2, (z0 + z1) / 2, Math.hypot(run, rise), BEAM, 0.08, TIMBER, { tilt: lean * Math.atan2(rise, run), rot: Math.PI / 2, outline: false, cap: false })
  }
  for (const z of [-5.0, -11.6]) {
    k.box(wall + 0.01, 3.55, z, 0.06, 1.34, 1.44, TIMBER, { outline: false, cap: false })
    k.box(wall + 0.03, 3.62, z, 0.06, 1.2, 1.3, on ? WARM : DARK_PANE, { glow: on, outline: false, cap: false })
    for (const sgn of [-1, 1]) k.box(wall + 0.02, 3.6, z + sgn * 0.98, 0.06, 1.24, 0.5, SHUTTER[0], { outline: false, cap: false })
    // A window box under it: the one bit of green on the wall.
    k.box(wall + 0.14, 3.3, z, 0.26, 0.2, 1.5, 0x6b4a30, { cap: false })
    for (let i = 0; i < 5; i++) k.sphere(wall + 0.14, 3.56, z - 0.6 + i * 0.3, 0.13, i % 2 ? 0xd9534f : 0x5f9a4a, { seg: 5, outline: false })
  }
  k.door(wall + 0.01, 0, -8.3, 1.3, 2.3, 0x4a2c1a, { facing: 'x', frame: TIMBER })
  if (on) k.halo(tx + 2.8, 0, -8.3, 2.2, WARM, 0.3)
  k.prism(tx, 6.2, -9, 12.8, 3, 5.0, k.top(ROOF[0]), { rot: Math.PI / 2 })
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
  const oak: Finish = { kind: 'wood', color: 0x8a5a2f, grain: 'straight', grainColor: 0x4f2f14 }
  const hoop: Finish = { kind: 'metal', color: 0x3a3a40 }
  for (const [dx, dz] of [[-1.9, 1.0], [-2.5, 0.2]]) cask(k, cx + dx, cz + dz, oak, hoop)
  k.lantern(cx - 1.2, 2.1, cz + 0.9, on ? 0xffc27a : 0x6a5a40, 0.22)
  if (on) k.halo(cx - 1.2, 0, cz + 0.9, 2.4, WARM, 0.35)
  // The standing stone, its rune lit after dark. Out on the square between the
  // well and the stall, clear of both: set straight behind the stall it lined
  // up with it from the table, and all that showed between the posts was a
  // violet panel with a white slab floating on it.
  const sx = 5.2
  const sz = -17
  // A menhir, not a slab: five-sided, narrowing to a blunt top, its rune cut
  // as three strokes. A squared block with a lit panel on it read, from the
  // table, as a violet pillar with a window in it.
  k.cyl(sx, 0, sz, 0.8, 3.5, 0x7e7f86, { seg: 5, rTop: 0.5, rot: 0.4 })
  const stroke = (dx: number, y: number, w: number, h: number, tilt = 0) =>
    k.box(sx + dx, y, sz + 0.62, w, h, 0.05, on ? RUNE : 0x5a5a66, { tilt, glow: on, outline: false, cap: false })
  stroke(-0.12, 1.3, 0.09, 1.3)
  stroke(0.06, 2.3, 0.42, 0.09, -0.6)
  stroke(0.06, 2.0, 0.42, 0.09, 0.6)
  if (on) k.halo(sx, 0, sz + 1, 1.8, RUNE, 0.22)

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
  // Peaks behind them, snow on their heads: the edge of the country the
  // village is in. Sharp, where the folds in front are round.
  for (const [x, r, h] of [[-2300, 520, 300], [-1250, 430, 250], [-420, 380, 205], [820, 470, 280], [1700, 400, 230], [2600, 540, 310]] as const) {
    k.cone(x, -1, -3500, r, h, 0x34446e, { seg: 7, outline: false, rot: x * 0.01 })
    k.cone(x, h * 0.58 - 1, -3500 + 30, r * 0.43, h * 0.43, 0xffffff, { seg: 7, outline: false, rot: x * 0.01 })
  }
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
