/**
 * Velvet, seen from the table: the terrace of an art-deco hotel on its
 * boulevard, the grand hotel across the way with its marquee, a skyline of
 * cream towers stepped back tier on tier.
 *
 * - **Near**: a marble chequer, black and cream, a brass floor lamp and a
 *   palm in its urn on the left, a fluted column on the right, the
 *   balustrade along the terrace's edge.
 * - **Middle**: the boulevard past the balustrade, lined with palms, a fountain in the
 *   roundabout, and the grand hotel on the right — cream stone, gold trim, the
 *   name on its marquee in lights.
 * - **Far**: the deco skyline, stepped tops, amber windows at dusk, the hills
 *   behind it gone blue.
 */
import type { Builder } from './vista'
import type { Finish, Kit } from '../kit'
import { groundInlay, neonText } from './vista'
import { MAPS } from '../../cards/maps'
import { mix } from '../sky'
import { hills, skyline, vistaTable } from './vista'
import { airship, gull, skyAltitude, skyRoom } from './vistaLife'

const MARBLE = 0xe6dac6
/** The floor: a marble near black, warm. */
const NOIR = 0x3a2f3c
const BRASS = 0xd9a441
const STONE = 0xe9dcc2
const STONE2 = 0xd8c6a4
const GOLD = 0xf0c46a
/**
 * The boulevard, level with the terrace: the balustrade is what parts them.
 * Level to the tile: every palm and lamp on it stands at 0, and a street a
 * fifth of a tile down left the whole promenade floating over it.
 */
const STREET = 0
const EDGE = -7

/**
 * A standard lamp: a turned brass stem on a stepped foot, a globe of opal
 * glass on it. Lit, the globe is the light and its pool lies on the floor.
 */
function standardLamp(k: Kit, x: number, z: number, brass: Finish, on: boolean) {
  k.lathe(x, 0, z, [[0, 0], [0.3, 0], [0.3, 0.03], [0.22, 0.05], [0.2, 0.09], [0.08, 0.14], [0.04, 0.3], [0.035, 0.9], [0.06, 0.94], [0.035, 0.98], [0.03, 1.66], [0.09, 1.7], [0.13, 1.76], [0, 1.76]], brass, { seg: 24 })
  k.sphere(x, 1.98, z, 0.25, on ? 0xffe6b8 : 0xe9e2d2, { glow: on, seg: 14, outline: false, gloss: 0.6 })
  if (on) {
    k.halo(x, 1.98, z, 0.6, 0xffd08a, 0.34, false)
    k.pool(x, z, 3.4, 0xffd08a, 0.34)
  }
}

export const velvet: Builder = (k) => {
  const rng = k.rng
  const on = k.rig.lampsOn
  const view = k.view
  if (!view) return
  vistaTable(k, MAPS.velvet.table)

  // ─── Near: the terrace ──────────────────────────────────────────────────
  // A polished floor of dark marble, laid on the diagonal in two close tones
  // with a brass stud where four slabs meet: it mirrors the lamps, the
  // balustrade and the table standing on it, which is what says marble. A
  // chequer of cream and brown at a metre a tile was the loudest thing in
  // the room and said lino.
  k.polished(0.55)
  const near = view.eye[2] + 2
  k.box(0, -0.1, (EDGE + near) / 2, 40, 0.1, near - EDGE, k.ground(NOIR), { outline: false, cap: true, gloss: 0.7 + k.wetGloss() })
  // Lines of brass let into it on the two diagonals: a lattice three metres
  // across, which is the scale a floor is read at from a chair.
  if (!k.rig.snow) {
    for (let c = -30; c <= 30; c += 3) {
      for (const rot of [Math.PI / 4, -Math.PI / 4]) k.box(c, 0, (EDGE + near) / 2, 0.035, 0.004, 44, BRASS, { rot, outline: false, cap: false, gloss: 0.8 })
    }
  }
  // A band of cream marble and a line of brass along the foot of the balustrade.
  k.box(0, 0, EDGE + 0.5, 40, 0.006, 1.0, k.ground(MARBLE), { outline: false, cap: false, gloss: 0.6 + k.wetGloss() })
  k.box(0, 0, EDGE + 1.06, 40, 0.008, 0.07, k.ground(BRASS), { outline: false, cap: false, gloss: 0.8 })
  // The table's foot: a ring of cream marble between two lines of brass, the
  // table's own burgundy inside it.
  groundInlay(k, [
    { out: 1.42, color: BRASS, gloss: 0.8 },
    { out: 1.36, color: MARBLE, gloss: 0.6 },
    { out: 0.86, color: BRASS, gloss: 0.8 },
    { out: 0.8, color: 0x4a1220, gloss: 0.7 },
    { out: 0.2, color: BRASS, gloss: 0.8 },
    { out: 0.14, color: NOIR, gloss: 0.7 },
  ])
  // The lamp over the table lies on the floor round it.
  k.pool(0, 0, 5, 0xffd9a0, 0.22)

  // The balustrade: a plinth, turned balusters, a rail, and on every pier a
  // globe of opal glass. Finished, like the table: it is the nearest thing in
  // the room after it.
  const stone: Finish = { kind: 'marble', color: STONE, grain: 'marble', grainColor: mix(STONE, 0x8a7458, 0.5) }
  const brass: Finish = { kind: 'metal', color: BRASS }
  const bz = EDGE - 0.2
  k.finishBox(0, 0, bz, 40, 0.25, 0.6, stone)
  for (let x = -19.7; x <= 19.7; x += 0.5) {
    if (Math.abs(((x + 20) % 8) - 4) < 0.5) continue
    k.lathe(x, 0.25, bz, [[0.1, 0], [0.1, 0.04], [0.055, 0.09], [0.1, 0.24], [0.125, 0.34], [0.1, 0.44], [0.055, 0.58], [0.085, 0.66], [0.085, 0.7]], stone, { seg: 10 })
  }
  k.finishBox(0, 0.95, bz, 40, 0.16, 0.66, stone)
  if (k.rig.snow) k.box(0, 1.11, bz, 40, 0.05, 0.66, k.top(STONE), { outline: false })
  for (let x = -16; x <= 16; x += 8) {
    k.finishBox(x, 0, bz, 0.74, 1.24, 0.82, stone)
    k.lathe(x, 1.24, bz, [[0, 0], [0.3, 0], [0.3, 0.04], [0.12, 0.09], [0.06, 0.2], [0.11, 0.26], [0, 0.26]], brass, { seg: 20 })
    k.sphere(x, 1.24 + 0.5, bz, 0.27, on ? 0xffe6b8 : 0xe9e2d2, { glow: on, seg: 14, outline: false, gloss: 0.6 })
    if (on) {
      k.halo(x, 1.74, bz, 0.62, 0xffd08a, 0.32, false)
      k.pool(x, bz + 1.2, 3.2, 0xffd08a, 0.3)
    }
  }

  // Left: a tall vase of black lacquer banded in brass, and a brass standard
  // lamp with its globe. Turned pieces, both.
  const noir: Finish = { kind: 'marble', color: 0x2c2230 }
  k.lathe(-6.4, 0, -4.4, [[0, 0], [0.42, 0], [0.42, 0.08], [0.3, 0.12], [0.24, 0.24], [0.3, 0.42], [0.5, 0.8], [0.6, 1.2], [0.56, 1.5], [0.36, 1.8], [0.22, 1.98], [0.2, 2.1], [0.3, 2.2], [0.32, 2.24], [0.26, 2.24], [0, 2.1]], noir, { seg: 36 })
  for (const [r, y] of [[0.43, 0.02], [0.605, 1.18], [0.215, 2.02], [0.325, 2.2]] as const) k.lathe(-6.4, 0, -4.4, [[r, y], [r + 0.012, y + 0.02], [r, y + 0.04]], brass, { seg: 36 })
  standardLamp(k, -4.3, -6.0, brass, on)
  // Right: a column of the same stone, its base and its capital in brass,
  // holding up nothing but the frame, and the lamp's twin beside it.
  k.finishBox(6.8, 0, -5, 1.5, 0.3, 1.5, stone)
  k.lathe(6.8, 0.3, -5, [[0.66, 0], [0.66, 0.1], [0.56, 0.2], [0.52, 0.32], [0.5, 0.4], [0.47, 2.6], [0.44, 4.8], [0.5, 4.9], [0.6, 5.0], [0.64, 5.06], [0, 5.06]], stone, { seg: 28 })
  for (const y of [0.42, 5.12]) k.lathe(6.8, 0.3, -5, [[0.53, y - 0.08], [0.56, y - 0.04], [0.53, y]], brass, { seg: 28 })
  k.finishBox(6.8, 5.36, -5, 1.5, 0.4, 1.5, stone)
  standardLamp(k, 4.5, -6.0, brass, on)

  // ─── Middle: the boulevard and the grand hotel ──────────────────────────
  const hx = 62
  const hz = -120
  // The name on the hotel's marquee, and the line from the table to it: a
  // palm or a lamp planted on that line stood its trunk across a letter.
  const signX = hx - 8
  const signZ = hz + 15.2
  const signHalf = 8.5 * 0.9 + 1
  const [ex, , ez] = view.eye
  const acrossSign = (x: number, z: number) => {
    const t = (ez - z) / (ez - signZ)
    const at = ex + (signX - ex) * t
    return t > 0 && t < 1 && Math.abs(x - at) < (signHalf + 0.6) * t + 0.6
  }
  // It stops under the balustrade's plinth, where the terrace begins: the two
  // tops are one level and would fight for the same pixels.
  const far = -5250
  k.box(0, STREET - 0.3, (far + EDGE - 0.2) / 2, 9000, 0.3, EDGE - 0.2 - far, k.ground(0x5a5048), { outline: false, cap: false, gloss: k.wetGloss() })
  // The promenade: palms in a row either side, lamps between them.
  for (let z = -18; z > -160; z -= 12) {
    for (const x of [-22, 22]) {
      const px = x + rng.range(-0.5, 0.5)
      if (!acrossSign(px, z)) k.tree(px, z, { kind: 'palm', h: 7 })
      if (!acrossSign(x * 0.8, z - 6)) k.lamp(x * 0.8, z - 6, { h: 4.2, style: 'globe', post: 0x2a2226, color: 0xffd08a })
    }
  }
  // The fountain in the roundabout.
  k.cyl(0, STREET, -70, 7, 0.9, STONE2, { seg: 24 })
  k.cyl(0, STREET + 0.9, -70, 6.4, 0.1, 0x3f7a8a, { seg: 24, water: true, outline: false, cap: false })
  k.cyl(0, STREET + 0.9, -70, 1.2, 3, STONE, { seg: 12, rTop: 0.6 })
  k.sphere(0, STREET + 4.2, -70, 0.8, GOLD, { seg: 10 })

  // The grand hotel on the right: tiers stepped back, gold at every step.
  let y = STREET
  let w = 44
  for (const h of [26, 18, 12, 8]) {
    k.box(hx, y, hz, w, h, w * 0.6, STONE)
    k.box(hx, y + h - 0.6, hz, w + 0.4, 0.6, w * 0.6 + 0.4, GOLD, { outline: false })
    const floors = Math.floor(h / 3.2)
    for (let f = 0; f < floors; f++) {
      for (let c = hx - w / 2 + 1.6; c < hx + w / 2 - 1; c += 2.4) {
        const litHere = on && rng.chance(k.rig.windowsLit + 0.15)
        k.box(c, y + f * 3.2 + 1.2, hz + w * 0.3 + 0.05, 1.1, 1.6, 0.08, litHere ? 0xffd08a : 0x3a4452, { glow: litHere, outline: false, cap: false })
      }
    }
    for (let c = hx - w / 2 + 3; c < hx + w / 2 - 2; c += 6) k.box(c, y, hz + w * 0.3 + 0.1, 0.5, h - 0.6, 0.2, STONE2, { outline: false, cap: false })
    y += h
    w *= 0.72
  }
  k.cyl(hx, y, hz, 0.8, 16, GOLD, { seg: 8, rTop: 0.1 })
  // The marquee over its door, and the name in lights on it.
  k.box(hx - 8, STREET + 4.5, hz + 14.2, 18, 1.2, 3, 0x2a2226)
  neonText(k, 'LOCO!', signX, STREET + 5.8, signZ, 0.9, on ? GOLD : mix(GOLD, 0x5a4a30, 0.3))
  if (on) for (let i = 0; i < 18; i++) k.sphere(hx - 16.5 + i, STREET + 4.4, hz + 15.8, 0.14, 0xfff0c0, { glow: true, seg: 6, outline: false })

  // ─── Far: the deco skyline ──────────────────────────────────────────────
  const towers = [STONE, STONE2, 0xe2cfa9, 0xd9c09a, 0xcdb89a]
  skyline(k, { x0: -420, x1: 200, z0: -200, z1: -380, h: [20, 60], w: [18, 30], count: 30, colors: towers, base: STREET, tiers: 1, window: 0xffd08a, windows: 0.8 })
  skyline(k, { x0: -1000, x1: 1000, z0: -480, z1: -800, h: [30, 90], w: [22, 40], count: 50, colors: towers.map((c) => mix(c, 0xb8a8c8, 0.2)), base: STREET, tiers: 2, windows: 0.3, spires: { count: 3, h: [110, 150] } })
  hills(k, -3200, 3200, -2400, 180, 0x7a86a8, 12, STREET)
  // ─── What moves: an airship over the skyline, gulls off the sea ─────────
  // Halfway down the band of sky, whatever the frame's shape.
  const shipY = skyAltitude(view, 11, -180, 0.5, 14)
  return [
    // In front of the skyline, between the fountain's column and the lamps and
    // palms on the right, which all stand up into the sky on a wide frame: a
    // sprite is drawn over everything, so an airship behind a tower, a palm or
    // a lamp read as a piece of it.
    airship('airship', [[8, shipY, -180], [14, shipY, -180]], { duration: 340_000, hull: 0xe9dcc2, band: GOLD, size: 1.3, maxTall: skyRoom(view, 11, -180, 0.6) }),
    gull('gull-a', [[-40, 16, -60], [-6, 20, -80], [26, 17, -66]], { duration: 28_000 }),
  ]
}
