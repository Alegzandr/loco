/**
 * Marina, seen from the table: a card table on the end of a wooden quay, the
 * bay opening in front of it out to the horizon.
 *
 * Three grounds, the way a painter lays out a view (`docs/notes/visual.md`,
 * "The view"):
 *
 * - **Near** (the first ten metres): the table on its pedestal, the planks of
 *   the quay, and what frames the picture at its two edges — a lamp post and
 *   a bollard with its rope on the left, crates and a barrel on the right.
 *   These are the only things drawn at full weight, and they are few.
 * - **Middle** (ten metres to a few hundred): the bay itself, which is most of
 *   the picture on purpose — a harbour is water first — with a jetty running
 *   out on the right, a couple of boats at anchor and a breakwater with its
 *   beacon.
 * - **Far** (a kilometre and more): two headlands closing the bay, layered one
 *   behind the other so the air greys each a step more (`LOOK.vista.haze`), a
 *   white town at the foot of the left one, the lighthouse on the right one.
 *   Above them, the sky of the hour and its sun, whose road lies across the
 *   water between them.
 *
 * World axes as the kit's, the table's centre at the origin, a tile a metre.
 * The camera stands at `+z` looking towards `-z` (`view.ts`).
 */
import type { Builder } from './vista'
import { MAPS } from '../../cards/maps'
import { mix, scale } from '../sky'
import { deck, hills, sailboat, vistaTable } from './vista'
import { driftingBoat, gull } from './vistaLife'

const SEA = 0x1f6f9c
const PLANK = 0xa77a4c
const PLANK2 = 0x946a40
const IRON = 0x2d3b45
const ROCK = 0x5d6470
const HILL = 0x4f6a57
const HILL_FAR = 0x5a6f7e
const WHITE = 0xf1e9dc

/** Where the quay ends and the water starts, tiles in front of the table (towards -z). */
const QUAY_EDGE = -7
/** The water's surface, under the planks. */
const SEA_LEVEL = -1.3

export const marina: Builder = (k) => {
  const rng = k.rng
  const on = k.rig.lampsOn
  const view = k.view
  if (!view) return
  vistaTable(k, MAPS.marina.table)

  // ─── The quay ───────────────────────────────────────────────────────────
  // Planks laid across, parallel to the water's edge.
  const deckBack = QUAY_EDGE
  deck(k, deckBack, view.eye[2] + 2, 48, PLANK, PLANK2)
  // The quay's face towards the water, and its piles going down into it.
  k.box(0, SEA_LEVEL - 0.6, deckBack - 0.2, 48, 0.6 + 0.6 - SEA_LEVEL - 0.12, 0.4, scale(PLANK2, 0.7), { cap: false })
  for (let x = -22; x <= 22; x += 2.4) k.cyl(x, SEA_LEVEL - 0.8, deckBack - 0.3, 0.2, 0.8 - SEA_LEVEL - 0.1, scale(PLANK2, 0.6), { seg: 8, cap: false })

  // ─── Near: what frames the picture ──────────────────────────────────────
  // Left: a harbour lamp, a bollard and the rope going down to the water.
  k.lamp(-7.2, -5.6, { h: 4.4, style: 'lantern', post: IRON, color: 0xffd28a })
  k.cyl(-3.1, 0, deckBack + 0.7, 0.24, 0.55, IRON, { seg: 10, rTop: 0.2 })
  k.sphere(-3.1, 0.6, deckBack + 0.7, 0.22, IRON, { seg: 10 })
  k.cyl(-6.4, 0, deckBack + 0.7, 0.24, 0.55, IRON, { seg: 10, rTop: 0.2 })
  k.sphere(-6.4, 0.6, deckBack + 0.7, 0.22, IRON, { seg: 10 })
  // A chain between the two bollards, sagging.
  for (let i = 0; i < 10; i++) {
    const t = (i + 0.5) / 10
    const x = -6.4 + 3.3 * t
    const sag = 0.5 - 1.6 * t * (1 - t)
    k.box(x, sag, deckBack + 0.7, 0.34, 0.05, 0.05, IRON, { outline: false, cap: false })
  }
  // Right: crates stacked by the water, a barrel, a coil of rope.
  const crate = (x: number, z: number, s: number, y: number, rot: number, c: number) => {
    k.box(x, y, z, s, s, s, c, { rot })
    k.box(x, y + s * 0.42, z, s + 0.04, s * 0.14, s + 0.04, scale(c, 0.78), { rot, outline: false, cap: false })
  }
  crate(4.4, deckBack + 1.4, 0.8, 0, 0.2, 0x9a7446)
  crate(5.3, deckBack + 1.1, 0.8, 0, -0.15, 0x8c6a40)
  crate(4.8, deckBack + 1.3, 0.7, 0.8, 0.5, 0xa47c4c)
  k.cyl(6.1, 0, deckBack + 2.3, 0.34, 0.85, 0x7a5030, { seg: 12 })
  for (const y of [0.16, 0.62]) k.cyl(6.1, y, deckBack + 2.3, 0.36, 0.07, IRON, { seg: 12, outline: false, cap: false })
  k.cyl(3.4, 0, deckBack + 2.6, 0.45, 0.12, 0xc9a86b, { seg: 16, rTop: 0.35 })
  // The near corners: a planter and a folded chair's worth of shape.
  k.cyl(-5.2, 0, 1.8, 0.45, 0.7, 0x6f7b88, { seg: 12, rTop: 0.55 })
  k.bush(-5.2, 1.8, 0.62, k.leaf(0x4f8a5a), { y: 0.62 })
  k.cyl(5.8, 0, 1.2, 0.45, 0.7, 0x6f7b88, { seg: 12, rTop: 0.55 })
  k.bush(5.8, 1.2, 0.55, k.leaf(0x4f8a5a), { y: 0.62 })

  // ─── Middle: the bay ────────────────────────────────────────────────────
  const sea = k.rig.wet ? mix(SEA, 0x1a3550, 0.4) : SEA
  k.box(0, SEA_LEVEL - 1, -2600, 8000, 1, 5200, sea, { outline: false, cap: false, water: true })

  // A jetty out on the right, on piles, with a boat against it.
  const jx = 16
  for (let z = deckBack; z > -70; z -= 3) {
    k.box(jx, -0.35, z - 1.5, 2.4, 0.14, 3, k.ground(mix(PLANK, PLANK2, rng.range(0, 1))), { cap: true })
    k.cyl(jx - 1.1, SEA_LEVEL - 0.5, z - 1.5, 0.14, 1.4, scale(PLANK2, 0.6), { seg: 6, cap: false })
    k.cyl(jx + 1.1, SEA_LEVEL - 0.5, z - 1.5, 0.14, 1.4, scale(PLANK2, 0.6), { seg: 6, cap: false })
  }
  for (let z = deckBack - 6; z > -70; z -= 12) k.lamp(jx + 1.3, z, { h: 3.2, style: 'lantern', post: IRON, color: 0xffd28a })
  k.model('pirate/boat-row-large', jx - 3, -30, { rot: Math.PI / 2, y: SEA_LEVEL - 0.1, scale: 1.1, collide: false })

  // Boats at anchor, sails furled at this hour.
  sailboat(k, -26, -95, 0.5, 1, 0xf2ece0, 0x2f5d7a, SEA_LEVEL)
  sailboat(k, 34, -170, -0.3, 1.2, 0x2f5d7a, 0xf2ece0, SEA_LEVEL)
  sailboat(k, -70, -260, 0.9, 1.3, 0xc8513f, 0xf2ece0, SEA_LEVEL)

  // A breakwater across the left of the bay: a low wall of stone with its
  // boulders heaped along the seaward foot, and the beacon at its end.
  k.box(-95, SEA_LEVEL - 1, -330, 130, 3.2, 5, 0x8d8a84, { cap: true })
  for (let i = 0; i < 40; i++) {
    const x = -158 + (i / 39) * 126 + rng.range(-1.5, 1.5)
    k.cone(x, SEA_LEVEL - 1.2, -334 + rng.range(-1, 1), rng.range(2.2, 3.4), rng.range(2, 3.4), mix(ROCK, 0x777d88, rng.range(0, 1)), { seg: 5, outline: false })
  }
  k.cyl(-28, SEA_LEVEL + 2, -330, 1.3, 6, 0xd8413a, { seg: 10 })
  k.cyl(-28, SEA_LEVEL + 8, -330, 0.9, 1.4, on ? 0xffd28a : 0xf2efe8, { seg: 10, glow: on })

  // ─── Far: the headlands and the town ────────────────────────────────────
  // Layered hills, each farther one a flatter, bluer silhouette; the air does
  // the rest.
  const hillsAt = (x0: number, x1: number, z: number, h: number, color: number, n: number) => hills(k, x0, x1, z, h, color, n, SEA_LEVEL - 2)
  // The left headland, near and far.
  hillsAt(-1700, -560, -1300, 80, HILL, 9)
  hillsAt(-3000, -1100, -2700, 150, HILL_FAR, 8)
  // The right headland, nearer, with the lighthouse.
  hillsAt(430, 1500, -960, 55, mix(HILL, ROCK, 0.4), 8)
  hillsAt(1100, 3200, -2400, 130, HILL_FAR, 8)
  // The open sea between them, and a last faint line of coast across it.
  hillsAt(-1200, 1200, -4600, 40, mix(HILL_FAR, 0x9fb3c8, 0.5), 10)

  // The lighthouse on the right headland's point.
  const lx = 470
  const lz = -900
  k.cone(lx, SEA_LEVEL - 2, lz, 60, 28, ROCK, { seg: 8, outline: false })
  k.cyl(lx, 24, lz, 4.2, 24, WHITE, { seg: 12, rTop: 3.4 })
  for (const y of [30, 40]) k.cyl(lx, y, lz, 4.0, 3, 0xc8322f, { seg: 12, rTop: 3.8, outline: false })
  k.cyl(lx, 48, lz, 3.6, 1, IRON, { seg: 12 })
  k.cyl(lx, 49, lz, 2.6, 4, on ? 0xfff0c0 : 0xdfe8ec, { seg: 12, glow: on })
  k.cone(lx, 53, lz, 3.4, 3, 0xc8322f, { seg: 12 })
  if (on) k.halo(lx, 51, lz, 14, 0xffe2a0, 0.35, false)

  // The white town on the left headland's shore, stepping up the slope
  // behind its harbour wall.
  for (let i = 0; i < 90; i++) {
    const x = rng.range(-1250, -700)
    const z = rng.range(-1260, -1150)
    const hh = rng.range(8, 14)
    const up = Math.max(0, (-700 - x) / 550) * 28 + rng.range(0, 6)
    const w = rng.range(9, 16)
    const color = rng.chance(0.2) ? 0xe9c9a3 : rng.chance(0.2) ? 0xd9e4ea : WHITE
    k.box(x, SEA_LEVEL - 2 + up, z, w, hh, rng.range(8, 14), color, { cap: true, outline: false })
    k.prism(x, SEA_LEVEL - 2 + up + hh, z, w + 1, 4, rng.range(8, 14), 0xc2573f, { outline: false })
    if (on && rng.chance(k.rig.windowsLit * 1.4)) k.box(x, SEA_LEVEL - 2 + up + hh * 0.5, z + 7.2, 2.4, 2.2, 0.4, 0xffd08a, { glow: true, outline: false, cap: false })
  }
  // ─── What moves ─────────────────────────────────────────────────────────
  const W = SEA_LEVEL
  return [
    gull('gull-a', [[-46, 11, -40], [-14, 14, -58], [22, 12, -48], [44, 9, -30]], { duration: 26_000 }),
    gull('gull-b', [[50, 16, -90], [10, 19, -110], [-36, 17, -95], [-60, 13, -70]], { duration: 34_000, delay: 9000, size: 1.1 }),
    gull('gull-c', [[-30, 22, -160], [20, 26, -170], [70, 22, -150]], { duration: 40_000, delay: 20_000 }),
    // Out in the bay, left to right, bow first, coming out of the haze and
    // going back into it.
    driftingBoat('boat-far', [[-120, W, -230], [-40, W, -236]], { duration: 130_000, hull: 0xf2ece0, trim: 0xc8513f, size: 1.2 }),
    // At anchor beyond the jetty's two nearest lamps, rocking and going
    // nowhere: this close, a boat fading in or out is a ghost. Never behind a
    // post either: a sprite is drawn over the whole frame.
    driftingBoat('boat-near', [[97, W, -130]], { delay: 40_000, hull: 0x2f5d7a, trim: 0xf2ece0 }),
  ]
}
