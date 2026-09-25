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
import { neonText } from './vista'
import { MAPS } from '../../cards/maps'
import { mix } from '../sky'
import { hills, skyline, vistaTable } from './vista'
import { airship, gull } from './vistaLife'

const MARBLE = 0xefe6d6
const MARBLE_DARK = 0xc29a78
const BRASS = 0xd9a441
const STONE = 0xe9dcc2
const STONE2 = 0xd8c6a4
const GOLD = 0xf0c46a
/** The boulevard, level with the terrace: the balustrade is what parts them. */
const STREET = -0.2
const EDGE = -7

export const velvet: Builder = (k) => {
  const rng = k.rng
  const on = k.rig.lampsOn
  const view = k.view
  if (!view) return
  vistaTable(k, MAPS.velvet.table)

  // ─── Near: the terrace ──────────────────────────────────────────────────
  for (let z = EDGE; z < view.eye[2] + 2; z += 1) {
    for (let x = -18; x < 18; x += 1) {
      const dark = (Math.round(x) + Math.round(z)) % 2 === 0
      k.box(x + 0.5, -0.1, z + 0.5, 0.98, 0.1, 0.98, k.ground(dark ? MARBLE_DARK : MARBLE), { outline: false, cap: true, gloss: 0.35 + k.wetGloss() })
    }
  }
  // The balustrade: a plinth, balusters, a rail.
  k.box(0, 0, EDGE - 0.2, 36, 0.25, 0.6, STONE2)
  for (let x = -17.5; x <= 17.5; x += 0.55) {
    k.cyl(x, 0.25, EDGE - 0.2, 0.12, 0.7, STONE, { seg: 8, rTop: 0.08, outline: false })
  }
  k.box(0, 0.95, EDGE - 0.2, 36, 0.18, 0.7, STONE, { cap: true })
  for (let x = -16; x <= 16; x += 8) k.box(x, 0, EDGE - 0.2, 0.7, 1.2, 0.8, STONE2)

  // Left: the palm in its urn and the brass lamp.
  k.cyl(-6.2, 0, -3.8, 0.55, 0.9, BRASS, { seg: 14, rTop: 0.75, gloss: 0.6 })
  k.tree(-6.2, -3.8, { kind: 'palm', h: 4.4 })
  k.cyl(-5.2, 0, -0.6, 0.3, 0.06, BRASS, { seg: 12, gloss: 0.6 })
  k.cyl(-5.2, 0.06, -0.6, 0.04, 2.2, BRASS, { seg: 6, gloss: 0.6, cap: false })
  k.cone(-5.2, 2.0, -0.6, 0.55, 0.45, on ? 0xffe0a8 : 0xf3ead8, { seg: 12, glow: on })
  if (on) k.halo(-5.2, 0, -0.6, 1.8, 0xffd08a, 0.3)
  // Right: a fluted column holding up nothing but the frame.
  k.box(6.6, 0, -5, 1.3, 0.3, 1.3, STONE2)
  k.cyl(6.6, 0.3, -5, 0.5, 5, STONE, { seg: 16 })
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    k.box(6.6 + Math.cos(a) * 0.5, 0.3, -5 + Math.sin(a) * 0.5, 0.06, 5, 0.06, STONE2, { outline: false, cap: false })
  }
  k.box(6.6, 5.3, -5, 1.4, 0.4, 1.4, STONE2)
  k.box(6.6, 5.1, -5, 1.2, 0.1, 1.2, GOLD, { outline: false, cap: false })

  // ─── Middle: the boulevard and the grand hotel ──────────────────────────
  k.box(0, STREET - 0.3, -2600, 9000, 0.3, 5300, k.ground(0x5a5048), { outline: false, cap: false, gloss: k.wetGloss() })
  // The promenade: palms in a row either side, lamps between them.
  for (let z = -18; z > -160; z -= 12) {
    for (const x of [-22, 22]) {
      k.tree(x + rng.range(-0.5, 0.5), z, { kind: 'palm', h: 7 })
      k.lamp(x * 0.8, z - 6, { h: 4.2, style: 'globe', post: 0x2a2226, color: 0xffd08a })
    }
  }
  // The fountain in the roundabout.
  k.cyl(0, STREET, -70, 7, 0.9, STONE2, { seg: 24 })
  k.cyl(0, STREET + 0.9, -70, 6.4, 0.1, 0x3f7a8a, { seg: 24, water: true, outline: false, cap: false })
  k.cyl(0, STREET + 0.9, -70, 1.2, 3, STONE, { seg: 12, rTop: 0.6 })
  k.sphere(0, STREET + 4.2, -70, 0.8, GOLD, { seg: 10 })

  // The grand hotel on the right: tiers stepped back, gold at every step.
  const hx = 62
  const hz = -120
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
  neonText(k, 'LOCO!', hx - 8, STREET + 5.8, hz + 15.2, 0.7, on ? GOLD : mix(GOLD, 0x5a4a30, 0.3))
  if (on) for (let i = 0; i < 18; i++) k.sphere(hx - 16.5 + i, STREET + 4.4, hz + 15.8, 0.14, 0xfff0c0, { glow: true, seg: 6, outline: false })

  // ─── Far: the deco skyline ──────────────────────────────────────────────
  const towers = [STONE, STONE2, 0xe2cfa9, 0xd9c09a, 0xcdb89a]
  skyline(k, { x0: -420, x1: 200, z0: -200, z1: -380, h: [20, 60], w: [18, 30], count: 30, colors: towers, base: STREET, tiers: 1, window: 0xffd08a, windows: 0.8 })
  skyline(k, { x0: -1000, x1: 1000, z0: -480, z1: -800, h: [30, 90], w: [22, 40], count: 50, colors: towers.map((c) => mix(c, 0xb8a8c8, 0.2)), base: STREET, tiers: 2, windows: 0.3, spires: { count: 3, h: [110, 150] } })
  hills(k, -3200, 3200, -2400, 180, 0x7a86a8, 12, STREET)
  // ─── What moves: an airship over the skyline, gulls off the sea ─────────
  return [
    airship('airship', [[-520, 110, -950], [-260, 118, -950]], { duration: 340_000, hull: 0xe9dcc2, band: GOLD, size: 12 }),
    gull('gull-a', [[-40, 16, -60], [-6, 20, -80], [26, 17, -66]], { duration: 28_000 }),
  ]
}
