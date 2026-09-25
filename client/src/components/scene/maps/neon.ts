/**
 * Neon, seen from the table: a rooftop terrace above a city of neon.
 *
 * - **Near**: the table on the roof's tiles, a glass balustrade along the
 *   edge, a water tower on its legs on the left and the back of a sign on the
 *   right, lit from behind by its own tubes. A couple of vents.
 * - **Middle**: the roofs just across the street, a few storeys down, with
 *   their neon on the faces towards us: the one sign that says the game's
 *   name, a column of tubes, a billboard.
 * - **Far**: the skyline in three bands, the nearest tall and lit, the last a
 *   violet silhouette, and on the right the needle of the broadcast tower
 *   with its lights. Over it, the sky of a city at night — never quite dark,
 *   violet with its own light at the horizon.
 *
 * At noon it is the same city under a hard sun with the tubes off; the neon
 * keeps its colour a shade down (`neonText`), never grey.
 */
import type { Builder } from './vista'
import { neonText } from './vista'
import { MAPS } from '../../cards/maps'
import { mix, scale } from '../sky'
import { deck, hills, skyline, vistaTable } from './vista'
import { aircraft, airship } from './vistaLife'

const TILE = 0x2c2936
const STEEL = 0x2b2a36
const NEON = [0xff4fd8, 0x4fe3ff, 0xc56bff, 0xffc14f] as const
/** How far below the roof the street is, tiles. */
const STREET = -48
/** Where the roof ends. */
const EDGE = -7

export const neon: Builder = (k) => {
  const rng = k.rng
  const on = k.rig.lampsOn
  const view = k.view
  if (!view) return
  vistaTable(k, MAPS.neon.table)

  // ─── Near: the roof ─────────────────────────────────────────────────────
  // A deck of dark wood: the one warm thing up here, under the violet.
  deck(k, EDGE, view.eye[2] + 2, 52, 0x4a3328, 0x3d2a22, { plank: 0.36 })
  // The parapet and a railing along the edge: two rails on posts, so the
  // city shows through it.
  k.box(0, -0.1, EDGE - 0.3, 52, 0.5, 0.5, scale(TILE, 0.9), { cap: true })
  for (const y of [0.75, 1.1]) k.box(0, y, EDGE - 0.3, 52, 0.06, 0.06, STEEL, { cap: false })
  for (let x = -24; x <= 24; x += 2) k.box(x, 0.4, EDGE - 0.3, 0.07, 0.76, 0.07, STEEL, { outline: false, cap: false })
  // The roof's own neon: a tube along the parapet's foot.
  if (on) k.box(0, 0.02, EDGE + 0.05, 52, 0.06, 0.06, NEON[2], { glow: true, outline: false, cap: false })

  // Left: planters of tall grass along the railing, and a bench.
  for (const [x, z] of [[-5.6, -5.8], [-7.4, -4.2], [-8.2, -1.8]] as const) {
    k.box(x, 0, z, 1.1, 0.8, 1.1, 0x3b3747, { cap: false })
    k.bush(x, z, 0.62, k.leaf(mix(0x3f8f6a, 0x2b6b58, rng.range(0, 1))), { y: 0.8, collide: false })
  }
  k.box(-5.4, 0.42, -2.6, 0.5, 0.08, 2.2, 0x6b4a3a, { cap: false })
  for (const dz of [-0.9, 0.9]) k.box(-5.4, 0, -2.6 + dz, 0.4, 0.42, 0.1, STEEL, { outline: false, cap: false })
  // Right: the rooftop bar, its counter lit from beneath, two stools.
  const bx = 6.2
  const bz = -4.6
  k.box(bx, 0, bz, 1.0, 1.1, 4.4, 0x2a2536)
  k.box(bx, 1.1, bz, 1.3, 0.08, 4.6, 0x6b4a3a, { cap: true })
  if (on) k.box(bx - 0.52, 0.06, bz, 0.06, 0.06, 4.3, NEON[1], { glow: true, outline: false, cap: false })
  for (const dz of [-1.2, 0.6]) {
    k.cyl(bx - 1.0, 0, bz + dz, 0.05, 0.75, STEEL, { seg: 6, cap: false })
    k.cyl(bx - 1.0, 0.75, bz + dz, 0.24, 0.08, NEON[0], { seg: 12, cap: false })
  }
  // Bottles on a shelf behind it, catching the tubes.
  for (let i = 0; i < 6; i++) k.cyl(bx + 0.2, 1.18, bz - 1.6 + i * 0.6, 0.06, 0.3, rng.pick([0x2f8f6a, 0x8a3a4a, 0xc9a86b]), { seg: 6, outline: false, cap: false, gloss: 0.8 })

  // ─── Middle: the roofs across the street ────────────────────────────────
  const across = (x: number, z: number, w: number, h: number, d: number, c: number) => {
    k.box(x, STREET, z, w, h - STREET, d, c, { cap: true })
    // Rows of windows on the face towards us.
    const floors = Math.floor((h - STREET) / 3.2)
    for (let f = 0; f < floors; f++) {
      for (let cx = x - w / 2 + 1.2; cx < x + w / 2 - 0.8; cx += 2.2) {
        const litHere = on && rng.chance(k.rig.windowsLit)
        k.box(cx, STREET + f * 3.2 + 1.0, z + d / 2 + 0.04, 1.3, 1.5, 0.08, litHere ? mix(0xffd89a, 0x9fe0ff, rng.range(0, 1)) : scale(c, 0.6), { glow: litHere, outline: false, cap: false })
      }
    }
  }
  // Lower than this roof, every one: the city is below the table, and only
  // the far towers stand up into the sky.
  across(-42, -60, 22, -18, 14, 0x3d3a52)
  across(-14, -74, 18, -12, 14, 0x453f5c)
  across(14, -66, 20, -22, 14, 0x3a3f58)
  across(44, -58, 24, -9, 14, 0x413a55)
  // The name, in tubes, on the roof across the street.
  // Off to the left, where no seat covers it.
  neonText(k, 'LOCO!', -40, -18 + 0.2, -60 + 7.3, 1.3, on ? NEON[0] : mix(NEON[0], 0x4a3a55, 0.3))
  // A column of tubes down the corner of the building on the right.
  for (let i = 0; i < 8; i++) {
    const c = NEON[i % 2 === 0 ? 1 : 3]
    k.box(31.5, -12 - i * 3.6, -58 + 7.1, 1.6, 2.6, 0.3, on ? c : mix(c, 0x3a3548, 0.4), { glow: on, outline: !on, cap: false })
  }
  // A billboard on the roof across the middle.
  k.box(14, -22, -66, 0.3, 4, 0.3, STEEL)
  k.box(14, -18, -66, 12, 5, 0.4, on ? mix(NEON[1], 0x10202a, 0.35) : 0x3a8fa8, { glow: on, cap: false })

  // ─── Far: the skyline ───────────────────────────────────────────────────
  // Night towers are the violets the neon is laid on; by day they are stone
  // and glass, and the city is a city.
  const towers = on ? [0x2e2b45, 0x35314f, 0x2a2840, 0x3b3452] : [0x8d97a8, 0xb9a48c, 0x6f8fa6, 0xa99ab8, 0xc7b8a0]
  // Most of the city stands below this roof; a few spires stand up into the
  // sky, and the sky is what they are read against.
  skyline(k, { x0: -420, x1: 420, z0: -170, z1: -340, h: [14, 44], w: [14, 26], count: 55, colors: towers, base: STREET, neon: { share: 0.25, colors: NEON }, window: 0xffd89a, windows: 0.5, spires: { count: 3, h: [70, 95] } })
  skyline(k, { x0: -900, x1: 900, z0: -440, z1: -720, h: [25, 60], w: [20, 40], count: 60, colors: towers.map((c) => mix(c, 0x5a4a8a, 0.25)), base: STREET, neon: { share: 0.12, colors: NEON }, windows: 0.3, spires: { count: 4, h: [110, 170] } })
  skyline(k, { x0: -1800, x1: 1800, z0: -900, z1: -1400, h: [40, 90], w: [30, 60], count: 60, colors: towers.map((c) => mix(c, 0x6a5a9a, 0.4)), base: STREET, windows: 0.06, ribbons: false, spires: { count: 5, h: [140, 220] } })
  hills(k, -3500, 3500, -3000, 160, 0x3b3060, 12, STREET)

  // The broadcast tower on the right: a needle with its deck and its lights.
  // Its deck stands a little over the eye, so it reads in the band of sky
  // on the right, clear of the seats.
  const tx = 360
  const tz = -650
  const tc = on ? 0x4a4466 : 0xc9ccd6
  k.cyl(tx, STREET, tz, 8, 40, tc, { seg: 8, rTop: 4 })
  k.cyl(tx, STREET + 40, tz, 4, 44, scale(tc, 1.05), { seg: 8, rTop: 2 })
  k.cyl(tx, STREET + 84, tz, 13, 8, scale(tc, 1.1), { seg: 16, rTop: 10 })
  if (on) k.cyl(tx, STREET + 87, tz, 13.2, 1.4, NEON[1], { seg: 16, glow: true, outline: false, cap: false })
  k.cyl(tx, STREET + 92, tz, 1.6, 40, scale(tc, 1.15), { seg: 6, rTop: 0.3 })
  if (on) for (const y of [60, 92, 131]) k.sphere(tx, STREET + y, tz, 2.4, 0xff3b4f, { glow: true, seg: 8, outline: false })
  // ─── What moves ─────────────────────────────────────────────────────────
  return [
    aircraft('plane', [[-1600, 190, -1900], [1600, 230, -1900]], { duration: 46_000, every: 110_000, size: 7 }),
    airship('blimp', [[-420, 70, -760], [-180, 76, -760]], { duration: 320_000, hull: on ? 0x3a3450 : 0xd9d2c6, band: on ? NEON[0] : 0xc56bff, size: 9 }),
  ]
}
