/**
 * Neon: a square in a city of neon.
 *
 * The table stands on a podium in the middle of a night district: a few
 * towers with some of their windows lit, a neon edge on one in five, one
 * billboard, a bar with its stools, a food truck, cars with their headlights
 * on. At night it is the map this game was named for; at noon it is a city
 * under a hard sun with the tubes off, in lighter stone.
 *
 * **It used to be all of that at once, everywhere**: a tube on every other
 * tower, a sign on every third, a beacon on every fourth, four windows in
 * five lit, string lights round the square, a dance floor, a crowd of
 * twenty-two — and the room was a wall of light a spectator could not rest
 * their eyes on. The pocket parks between the towers and the dark windows
 * are what make the lit ones read.
 */
import type { Builder } from './common'
import { MAPS } from '../../cards/maps'
import { cityGrid, lots, podium, crowd, neonText, at, along, screenOf, FLOOR } from './common'
import { mix, cssHex } from '../sky'
import type { Actor } from '../life'
import { cloud, plane, puff, streetWalkers, traffic } from './actors'

/** The cars, parked along the streets and driving them. */
const CARS = [0xff3d68, 0x3d9bff, 0xffd23c, 0xf5f0e6, 0x2b2b2b, 0xc56bff] as const

export const neon: Builder = (k) => {
  const rng = k.rng
  const on = k.rig.lampsOn
  // A city by day is not a night city with the lights off: the same towers
  // stand in lighter stone under the sun.
  // By day the stone is warm and the palette spreads: the light is flat now,
  // so the room's contrast has to be in the paint, and seven blue-greys under
  // a flat sun came out as one pale wash.
  const palette = on
    ? [0x1c2140, 0x2a1f4d, 0x141a33, 0x22284a, 0x1a2a3f, 0x2b2540, 0x2f2a55]
    : [0x8a7fa8, 0xa88fb4, 0x6f7fa6, 0xc4b4c8, 0x7fa0aa, 0xb59aa8, 0x9aa4c4]
  const neonColors = [0xff3dd0, 0x4fd6ff, 0xffd23c, 0x7cff6b, 0xc56bff, 0xff3d68]
  // The square's own furniture takes the same day/night split the towers do.
  // Painted 0x2f2540 whatever the hour, the bar, its back wall and the kiosks
  // came out at noon as black shapes on pale stone: the counter disappeared
  // into its own shadow and what was left was the lit top of it, a magenta
  // plate hanging in the air with three stools under it.
  const NIGHT = on ? 0x2f2540 : 0x6f6690
  const NIGHT_DEEP = on ? 0x1e1830 : 0x5a5480
  const shopGlow = [0xff3dd0, 0x4fd6ff, 0xffd23c, 0xff8a3c]

  k.floor(on ? 0x14162a : 0xb9b0a4, FLOOR)

  const { cx, cz } = podium(k, {
    stone: on ? 0x15121f : 0x3a3550,
    step: on ? 0x22203a : 0x8a8298,
    floor: on ? 0x33374a : 0xd2c9bd,
    floor2: on ? 0x2b2f40 : 0xbfb5aa,
    accent: 0xc56bff, top: cssHex(MAPS.neon.table.felt),
  })

  const tower = (x: number, z: number, w: number, d: number, h: number) => {
    const color = rng.pick(palette)
    k.tower(x, z, w, h, d, color, { floorH: 1.6, windowColor: rng.chance(0.3) ? 0x9fe8ff : 0xffd98a, roof: 'flat', roofColor: mix(color, 0x000000, 0.3) })
    // Shopfront on the ground floor, facing the camera.
    const c = rng.pick(shopGlow)
    k.box(x, 0.3, z + d / 2 + 0.05, w * 0.8, 1.6, 0.08, on ? c : 0x2a3346, { glow: on, outline: false, cap: false })
    k.awning(x, z + d / 2, 0, w * 0.8, mix(c, 0x111111, on ? 0.2 : 0.6), { y: 2.1, depth: 0.95 })
    // One tower in five wears a neon edge, one in eight a sign, one in eight
    // a beacon, and no halo lies on a roof: a pool of light hanging in the air
    // over a tower was the first thing that made the towers look see-through.
    if (rng.chance(0.2)) {
      const nc = rng.pick(neonColors)
      k.box(x + w / 2 + 0.06, h - 0.3, z, 0.1, 0.25, d, on ? nc : 0x3a3f52, { glow: on, outline: false, cap: false })
      k.box(x, h - 0.3, z + d / 2 + 0.06, w, 0.25, 0.1, on ? nc : 0x3a3f52, { glow: on, outline: false, cap: false })
    }
    if (rng.chance(0.12)) {
      const nc = rng.pick(neonColors)
      k.box(x, h, z, w * 0.7, 0.12, 0.12, 0x2a2a35, { cap: false })
      k.box(x, h, z + 0.1, w * 0.7, Math.min(3, w * 0.4), 0.2, on ? nc : mix(nc, 0x222222, 0.7), { glow: on, cap: false })
    }
    if (rng.chance(0.12)) {
      const mh = rng.range(2, 5)
      k.cyl(x, h, z, 0.12, mh, 0x8a8fa0, { seg: 5, cap: false })
      k.sphere(x, h + mh + 0.15, z, 0.2, 0xff3b3b, { glow: true, seg: 6, outline: false })
    }
    if (rng.chance(0.3)) {
      k.box(x - w / 2 + 1, h, z - d / 2 + 1, 1.4, 0.9, 1.2, 0x8d94a3)
      k.cyl(x + w / 2 - 1.2, h, z + d / 2 - 1.2, 0.7, 1.4, 0x6b5039, { seg: 8 })
    }
  }
  // A vertical neon sign hung off a corner.
  const signpost = (x: number, z: number, h: number) => {
    const nc = rng.pick(neonColors)
    k.box(x, 1.5, z, 0.5, h, 0.3, NIGHT_DEEP)
    k.box(x, 1.8, z + 0.2, 0.3, h - 0.6, 0.1, on ? nc : mix(nc, 0x222222, 0.6), { glow: on, outline: false, cap: false })
  }

  /** A pocket park on an unbuilt block: a lawn, a few trees, a bench. */
  const park = (x: number, z: number, w: number) => {
    k.slab(x, z, w - 1, w - 1, k.ground(on ? 0x1f3a33 : 0x7fb86f), { h: 0.05 })
    const n = rng.int(2, 4)
    for (let i = 0; i < n; i++) k.tree(x + rng.range(-w / 3, w / 3), z + rng.range(-w / 3, w / 3), { kind: 'round', h: rng.range(1.2, 1.8), r: rng.range(0.7, 1.0), leaf: 0x2fbf7a })
    if (rng.chance(0.6)) k.bench(x + rng.range(-1, 1), z + w / 3, 0, 0x4a4f66)
    if (rng.chance(0.5)) k.lamp(x - w / 3, z - w / 3, { h: 3, style: 'box', color: 0xffe1a1, post: 0x2a2f3a })
  }

  const plan = cityGrid(k, {
    block: 11,
    road: 3.6,
    roadColor: on ? 0x1a1d2e : 0x4a4e5c,
    sidewalk: on ? 0x2a2d3f : 0xcfc6ba,
    dashes: true,
    crossings: true,
    cars: CARS,
    carDensity: 0.2,
    lamp: { h: 3, style: 'box', color: 0xffe1a1, post: 0x2a2f3a },
    people: 0.3,
    maxHeight: 24,
    // Half the blocks beside the square are parks; the skyline is at the edge.
    density: (c) => (c.front ? 1 : c.dist < 42 ? 0.65 : 0.85),
    open: (c) => park(c.x, c.z, c.w),
    fill: (c) => {
      if (c.front) {
        // A pocket park: nothing here may rise into the table.
        for (const l of lots(c, 2, 2, 1)) {
          const r = rng.next()
          if (r < 0.5) k.tree(l.x, l.z, { kind: 'round', h: 1.2, r: 0.8, leaf: 0x2fbf7a })
          else if (r < 0.65) k.bench(l.x, l.z, rng.pick([0, Math.PI / 2]), 0x4a4f66)
        }
        return
      }
      // One building a block: low beside the square, a tower at the edge.
      const near = c.dist < 42
      const [l] = lots(c, 1, 1, 0)
      const h = near ? rng.range(4, 8) : rng.range(8, 20)
      tower(l.x, l.z, l.w - rng.range(1, 3), l.d - rng.range(1, 3), h)
      if (rng.chance(0.15)) signpost(c.x + c.w / 2 - 0.2, c.z + c.d / 2 - 0.2, rng.range(3, 6))
      if (rng.chance(0.5)) k.tree(c.x - c.w / 2 - 0.9, c.z + c.d / 2 + 0.9, { kind: 'round', h: 1.2, r: 0.7, leaf: 0x2fbf7a })
    },
  })

  // ─── The square around the podium ──────────────────────────────────────
  const { a, b, sx, sy } = k.anchor
  // The sign, the brand, on a billboard at the top of the square.
  {
    const [px, pz] = at(sx + 3, sy + b + 8.5)
    const rot = Math.PI / 4
    k.box(px - 7 * Math.cos(rot), 0, pz + 7 * Math.sin(rot), 0.3, 6.2, 0.3, 0x2a2a35, { cap: false })
    k.box(px + 7 * Math.cos(rot), 0, pz - 7 * Math.sin(rot), 0.3, 6.2, 0.3, 0x2a2a35, { cap: false })
    k.box(px, 3.2, pz, 15, 3.4, 0.35, 0x101322, { rot })
    neonText(k, 'LOCO!', px + 0.25 * Math.sin(rot), 3.55, pz + 0.25 * Math.cos(rot), 0.5, 0xff3d68, rot)
  }
  // The bar on the left, its stools and its dance floor.
  {
    const rot = Math.PI / 4
    const [bx, bz] = at(sx - a - 6, sy + 1)
    k.box(bx, 0, bz, 7, 1.1, 1.3, NIGHT, { rot })
    // The counter's top: a dark note of the accent, lit like everything else.
    // Glowing, and then merely painted in the accent, it was a seven-tile bar
    // of light lying at the edge of the frame.
    k.box(bx, 1.1, bz, 7.2, 0.12, 1.5, mix(0xc56bff, NIGHT_DEEP, 0.6), { rot, cap: false })
    const [wx, wz] = at(sx - a - 9, sy + 1)
    k.box(wx, 0, wz, 7, 2.8, 0.5, NIGHT_DEEP, { rot })
    along(wx - 2.0, wz - 2.0, wx + 2.0, wz + 2.0, 3, (x, z) => k.box(x, 1.6, z, 0.24, 0.6, 0.24, rng.pick(neonColors), { glow: on, outline: false, cap: false }))
    const [tx, tz] = at(sx - a - 3.5, sy + 1)
    along(tx - 2, tz - 2, tx + 2, tz + 2, 5, (x, z) => {
      k.cyl(x, 0, z, 0.13, 0.7, 0x8a8fa0, { seg: 6, cap: false })
      k.cyl(x, 0.7, z, 0.32, 0.14, 0xff3d68, { seg: 8, cap: false })
    })
    k.person(...at(sx - a - 7.5, sy + 1.2), rot + Math.PI, { shirt: 0xffffff, pants: 0x1c1c1c })
    if (on) k.halo(bx, 0, bz, 4, 0xc56bff, 0.16)
  }
  // A food truck and a queue on the right.
  const truckSpot: [number, number] = [sx + a + 6, sy - 1]
  {
    const rot = -Math.PI / 4
    const [fx, fz] = at(...truckSpot)
    k.box(fx, 0.35, fz, 5, 2.4, 2.2, 0xffd23c, { rot })
    k.box(fx, 2.75, fz, 5.2, 0.2, 2.4, 0x2a2a35, { rot })
    k.box(fx - 1.5 * Math.sin(rot) * 0 - 1.2 * Math.sin(rot), 1.4, fz - 1.2 * Math.cos(rot), 3, 0.9, 0.08, on ? 0xfff0c0 : 0x2a3346, { rot, glow: on, outline: false, cap: false })
    for (const s of [-1.6, 1.6]) k.cyl(fx + s * Math.cos(rot), 0.35, fz - s * Math.sin(rot), 0.35, 0.3, 0x1c1c1c, { axis: 'z', rot, seg: 8 })
    for (let i = 0; i < 2; i++) k.person(...at(sx + a + 3.5 - i * 1.1, sy - 1 - i * 0.9), rot + Math.PI)
    if (on) k.halo(fx, 0, fz, 3.4, 0xfff0c0, 0.18)
  }
  // Six planters round the paving, and nothing strung over it.
  for (let i = 0; i < 6; i++) {
    const t = (i / 6) * Math.PI * 2 + 0.4
    const [x, z] = at(sx + Math.cos(t) * (a + 9), sy + Math.sin(t) * (b + 6))
    if (screenOf(x, z)[1] > sy + b + 7) continue
    k.box(x, 0, z, 1.2, 0.7, 1.2, 0x3a3e52)
    k.bush(x, z, 0.55, 0x2fbf7a)
  }
  crowd(k, 6)
  void cx
  void cz

  // ─── What moves: a car now and then, steam off the truck, the sky ────────
  const life: Actor[] = []
  life.push(...traffic(k, plan, CARS, 1))
  life.push(puff(k, 'steam', { at: [truckSpot[0] - 1.5, truckSpot[1] + 2.4], rise: 2, duration: 3200, size: 0.7 }))
  life.push(puff(k, 'steam-2', { at: [truckSpot[0] - 0.8, truckSpot[1] + 2.4], rise: 1.8, duration: 4100, delay: 1500, size: 0.55 }))
  if (k.rig.weather === 'clear' || k.rig.weather === 'cloudy') {
    life.push(cloud(k, 'cloud-0', { sy: 18, size: 1.1, duration: 190_000 }))
    life.push(cloud(k, 'cloud-1', { sy: 20.5, size: 0.7, duration: 240_000, delay: 90_000, from: 50, to: -50 }))
    life.push(plane(k, 'plane', { sy: 17, every: 110_000, color: 0xf5f0e6 }))
  }
  life.push(...streetWalkers(k, plan, 2))
  return life
}
