/**
 * Rune: the square of a village that has a wizard in it.
 *
 * Cobbles, blocks of half-timbered houses with their gardens, a tavern with a
 * lantern over its door, a tower whose windows are the wrong colour, four
 * standing stones around the square with something carved into them that
 * glows after dark. Market day: stalls, barrels, a cart, chickens' worth of
 * people. A stream runs through the village under stone bridges.
 */
import type { Builder } from './common'
import { MAPS } from '../../cards/maps'
import { cityGrid, lots, podium, crowd, at, ring, FLOOR } from './common'
import { mix, scale, cssHex } from '../sky'

export const rune: Builder = (k) => {
  const rng = k.rng
  const on = k.rig.lampsOn

  k.floor(0x5fa653, FLOOR)
  podium(k, { stone: 0x4a2e17, step: 0x8d857a, floor: 0x8d857a, floor2: 0x7c746a, accent: 0xffab52, top: cssHex(MAPS.rune.table.felt) })

  const plasters = [0xf1e3c8, 0xe9d6b8, 0xf5e9d2, 0xdcc7a4, 0xead9c7]
  const roofs = [0x8b3a2a, 0x6b4a2b, 0x3f4a5c, 0x7a5a3a, 0x9a4a3a]
  const house = (x: number, z: number, w: number, h: number, d: number, rot: number) => {
    const plaster = rng.pick(plasters)
    const roof = rng.pick(roofs)
    k.box(x, 0, z, w, h, d, plaster, { rot })
    k.box(x, 0, z, w + 0.2, 0.7, d + 0.2, 0x6f6a62, { rot })
    const beam = 0x4a2e17
    for (const fx of [-1, 1]) {
      const px = x + ((fx * w) / 2) * Math.cos(rot)
      const pz = z - ((fx * w) / 2) * Math.sin(rot)
      k.box(px, 0.7, pz, 0.16, h - 0.7, 0.16, beam, { rot, outline: false, cap: false })
    }
    k.box(x, h - 0.2, z, w + 0.08, 0.16, d + 0.08, beam, { rot, outline: false, cap: false })
    k.box(x, h / 2 + 0.2, z, w + 0.08, 0.14, d + 0.08, beam, { rot, outline: false, cap: false })
    const cols = Math.max(1, Math.floor(w / 1.6))
    for (let c = 0; c < cols; c++) {
      const lx = -w / 2 + (c + 0.5) * (w / cols)
      const wx = x + lx * Math.cos(rot) + (d / 2 + 0.03) * Math.sin(rot)
      const wz = z - lx * Math.sin(rot) + (d / 2 + 0.03) * Math.cos(rot)
      const lit = rng.chance(k.rig.windowsLit)
      k.box(wx, 1.4, wz, 0.55, 0.6, 0.08, lit ? 0xffd98a : 0x2a3346, { rot, glow: lit, outline: false, cap: false })
      if (h > 3.4) {
        const lit2 = rng.chance(k.rig.windowsLit)
        k.box(wx, h - 1.4, wz, 0.55, 0.6, 0.08, lit2 ? 0xffd98a : 0x2a3346, { rot, glow: lit2, outline: false, cap: false })
      }
    }
    k.prism(x, h, z, w + 0.5, Math.min(w, d) * 0.55, d + 0.5, roof, { rot })
    k.box(x + w * 0.25 * Math.cos(rot), h, z - w * 0.25 * Math.sin(rot), 0.5, Math.min(w, d) * 0.55 + 0.5, 0.5, 0x6f6a62, { rot })
  }

  const { sx, sy, a, b } = k.anchor
  const tavernCell = { sx: sx + a + 9, sy: sy + 2 }
  const towerCell = { sx: sx - 22, sy: sy + b + 8 }
  const nearest = (c: { sx: number; sy: number }, p: { sx: number; sy: number }) => Math.hypot(c.sx - p.sx, (c.sy - p.sy) / 0.53) < 7.5

  cityGrid(k, {
    block: 12,
    road: 3,
    roadColor: 0x9c7f58,
    dashes: false,
    cars: undefined,
    lamp: { h: 2.4, style: 'lantern', color: 0xffab52, post: 0x4a2e17 },
    people: 1.5,
    maxHeight: 5,
    water: { line: -2, axis: 'z', color: k.rig.snow ? 0x9fd0e8 : 0x3f8fd6, bank: 0x6f6a62, bridge: 0x8a847a },
    fill: (c) => {
      if (nearest(c, tavernCell) || nearest(c, towerCell)) return
      // One or two houses, the rest garden; in front of the table, garden only.
      const n = c.front ? 2 : rng.chance(0.4) ? 1 : 2
      const ls = lots(c, n, n, 1.5)
      let built = 0
      for (const l of ls) {
        if (!c.front && built < (n === 1 ? 1 : rng.int(2, 3)) && rng.chance(0.8)) {
          const w = Math.min(l.w, rng.range(4, 6)), d = Math.min(l.d, rng.range(3.5, 5))
          house(l.x, l.z, w, rng.range(3, 4.4), d, rng.pick([0, Math.PI / 2]))
          built++
        } else {
          if (rng.chance(0.6)) k.tree(l.x, l.z, { kind: rng.chance(0.3) ? 'pine' : 'round', h: rng.range(1.2, 2), r: rng.range(0.8, 1.2) })
          if (rng.chance(0.5)) k.bush(l.x + rng.range(-1.5, 1.5), l.z + rng.range(-1.5, 1.5), 0.5)
          if (rng.chance(0.3)) k.fence(l.x - l.w / 2, l.z + l.d / 2, l.x + l.w / 2, l.z + l.d / 2, 0x8a6a45, 0.8)
          if (rng.chance(0.2)) k.crate(l.x, l.z, 0.6)
          if (rng.chance(0.15)) {
            k.cyl(l.x, 0, l.z, 1.0, 0.9, 0x6f6a62, { seg: 10 })
            k.disc(l.x, 0.9, l.z, 0.8, 0x1c2536, { seg: 10 })
            k.prism(l.x, 2.2, l.z, 2.6, 0.8, 1.6, 0x6b4a2b)
            k.box(l.x - 1, 0, l.z, 0.14, 2.2, 0.14, 0x4a2e17, { cap: false })
            k.box(l.x + 1, 0, l.z, 0.14, 2.2, 0.14, 0x4a2e17, { cap: false })
          }
        }
      }
    },
  })

  // ─── The tavern, on the right, facing the square ───────────────────────
  {
    const [tx, tz] = at(tavernCell.sx, tavernCell.sy)
    const rot = Math.PI / 4
    house(tx, tz, 10, 4.8, 6.5, rot)
    house(tx + 4.5, tz - 5.5, 5, 3.4, 4, rot + 0.15)
    const [dx, dz] = at(tavernCell.sx - 4.6, tavernCell.sy)
    k.box(dx, 0, dz, 1.2, 2.2, 0.16, 0x3a2414, { rot, cap: false })
    k.box(dx + 1.2, 2.6, dz - 1.2, 1.2, 0.1, 0.1, 0x4a2e17, { rot, outline: false, cap: false })
    k.box(dx + 1.6, 1.8, dz - 1.6, 0.9, 0.7, 0.08, 0x8b3a2a, { rot })
    k.cyl(dx + 1.55, 2.05, dz - 1.65, 0.22, 0.1, 0xffab52, { seg: 8, axis: 'z', rot, glow: on, outline: false })
    k.lamp(dx - 1.8, dz + 0.6, { h: 2.2, style: 'lantern', color: 0xffab52, post: 0x4a2e17 })
    const [bx, bz] = at(tavernCell.sx - 5.5, tavernCell.sy - 4)
    k.barrel(bx, bz)
    k.barrel(bx + 0.7, bz + 0.5)
    k.barrel(bx + 0.35, bz + 0.25, 0x8a5a2f, 0.8)
    const [ex, ez] = at(tavernCell.sx - 5, tavernCell.sy + 3.5)
    k.bench(ex, ez, rot)
    k.person(ex - 0.6, ez - 0.6, rot + Math.PI, { hat: 0x2b1b12 })
    k.person(ex + 0.6, ez + 0.6, rot + Math.PI)
  }

  // ─── The wizard's tower, top left ──────────────────────────────────────
  {
    const [wx, wz] = at(towerCell.sx, towerCell.sy)
    k.cyl(wx, 0, wz, 3.2, 1.2, 0x6f6a62, { seg: 12 })
    k.cyl(wx, 1.2, wz, 2.6, 12, 0x8a8fa3, { seg: 12 })
    k.cyl(wx, 13.2, wz, 3.1, 0.8, 0x6f6a62, { seg: 12 })
    k.cone(wx, 14, wz, 3.2, 6, 0x3d2a6b, { seg: 12 })
    k.sphere(wx, 20.4, wz, 0.4, on ? 0xc56bff : 0x7a6aa0, { glow: on, seg: 6 })
    for (let i = 0; i < 5; i++) {
      const y = 3 + i * 2.3
      k.box(wx + 2.62, y, wz + 0.5 * (i % 2 ? 1 : -1), 0.1, 0.7, 0.45, on ? 0xc56bff : 0x2a3346, { glow: on, outline: false, cap: false })
      k.box(wx - 0.5 * (i % 2 ? 1 : -1), y, wz + 2.62, 0.45, 0.7, 0.1, on ? 0xc56bff : 0x2a3346, { glow: on, outline: false, cap: false })
    }
    if (on) k.halo(wx, 20.4, wz, 1.3, 0xc56bff, 0.4, false)
    k.tree(wx + 5, wz + 3, { kind: 'pine', h: 2.4, r: 1.2 })
    k.tree(wx - 4.8, wz - 1, { kind: 'pine', h: 2.0, r: 1.0 })
    k.cyl(wx + 2.4, 0, wz + 4, 0.5, 0.7, 0x1c1c1c, { seg: 8, rTop: 0.6 })
    if (on) k.halo(wx + 2.4, 0.75, wz + 4, 0.7, 0x7cffd0, 0.5, false)
    k.person(wx + 4, wz + 5, Math.PI / 4, { shirt: 0x3d2a6b, pants: 0x3d2a6b, hat: 0x3d2a6b })
  }

  // ─── The market around the square ──────────────────────────────────────
  const stallAt = (dsx: number, dsy: number, c1: number, c2: number) => {
    const [x, z] = at(sx + dsx, sy + dsy)
    const [cx, cz] = at(sx, sy)
    k.stall(x, z, Math.atan2(cx - x, cz - z) + Math.PI, c1, c2)
  }
  stallAt(-a - 5, -3, 0xff3d68, 0xfff5e6)
  stallAt(-a - 7, 4, 0x3d9bff, 0xfff5e6)
  stallAt(-a + 4, -b - 6, 0x2fd18a, 0xfff5e6)
  stallAt(a - 6, -b - 6.5, 0xffd23c, 0xfff5e6)
  {
    const [cx, cz] = at(sx + a + 4, sy - b - 4)
    k.box(cx, 0.5, cz, 2.6, 0.7, 1.4, 0x8a5a2f, { rot: 0.6 })
    k.cyl(cx + 0.8, 0.45, cz + 0.6, 0.45, 0.2, 0x4a2e17, { axis: 'z', rot: 0.6, seg: 8 })
    k.cyl(cx - 0.8, 0.45, cz - 0.6, 0.45, 0.2, 0x4a2e17, { axis: 'z', rot: 0.6, seg: 8 })
    k.box(cx, 1.2, cz, 2.2, 0.8, 1.2, 0xe0b04a, { rot: 0.6 })
    k.crate(cx + 2.4, cz - 1.5, 0.7)
    k.crate(cx + 3.1, cz - 1.0, 0.55)
    for (let i = 0; i < 3; i++) k.cyl(cx - 3 + i * 1.1, 0, cz + 2 + (i % 2) * 0.8, 0.5, 1.0, 0xe0b04a, { axis: 'x', seg: 8 })
  }
  // The standing stones, on the plaza's rim at the four diagonals.
  for (const [dx, dy] of [[-1, 1], [1, 1], [-1, -1], [1, -1]] as const) {
    const [x, z] = at(sx + dx * (a + 3.5), sy + dy * (b + 2.5))
    const [cx, cz] = at(sx, sy)
    const ang = Math.atan2(cx - x, cz - z)
    k.box(x, 0, z, 1.1, 2.8, 0.8, 0x6f7a8a, { rot: ang })
    k.box(x, 0.8, z, 0.14, 1.3, 0.82, on ? 0x7cffd0 : 0x4a5a5a, { rot: ang, glow: on, outline: false, cap: false })
    if (on) k.halo(x, 0, z, 2.6, 0x7cffd0, 0.3)
  }
  {
    const [cx, cz] = at(sx, sy)
    ring(k, 8, 1, (x, z) => {
      const t = Math.atan2(z - cz, x - cx)
      const [px, pz] = at(sx + Math.cos(t) * (a + 7), sy + Math.sin(t) * (b + 4.5))
      k.lamp(px, pz, { h: 2.4, style: 'lantern', color: 0xffab52, post: 0x4a2e17 })
      void x
    }, 0, cx, cz)
  }
  crowd(k, 26)
  for (let i = 0; i < 5; i++) k.rock(rng.range(-90, 90), rng.range(-90, 90), rng.range(0.5, 1.0), mix(0x8a8f99, 0x5fa653, 0.2))
  k.rock(-40, 30, 1.0, scale(0x8a8f99, 0.9))
}
