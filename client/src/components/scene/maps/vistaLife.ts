/**
 * What moves in a room seen from the table (`life.ts: Actor.world`).
 *
 * Each actor is built standing at the world origin and carries its route in
 * the world, in tiles; the render builds it at the route's first point,
 * photographs it with the room's own camera, projects the route into the
 * frame and scales it along the way with the distance (`render.ts:
 * vistaSprites`). So a gull coming round towards the table grows as it
 * comes, and a boat crossing the far bay stays the size of a boat out there.
 *
 * The quiet rule holds here as it did from above (`docs/notes/visual.md`,
 * "The room is quiet"): a few things, slow, at the edges of the picture and
 * in its sky — never across the table, never a crowd.
 */
import type { Kit } from '../kit'
import type { Actor } from '../life'
import type { View } from '../view'
import { mix, scale, type Hex } from '../sky'
import { sailboat } from './vista'

type P3 = [number, number, number]

/** The share of a boat's crossing spent coming out of the haze, and going back into it. */
export const BOAT_FADE = 0.15

/**
 * The altitude at which something over `(x, z)` stands `frac` of the way down
 * the band of sky, from the frame's top edge to the horizon. What flies in the
 * sky band is placed by the frame, never at a height in tiles: that band is a
 * sliver on a wide screen and a slab on a tall one, and a blimp at a fixed
 * height was cut in half by the top edge of one. Without a view, `fallback`.
 */
export function skyAltitude(view: View | undefined, x: number, z: number, frac: number, fallback: number): number {
  if (!view) return fallback
  const at = view.project([x, view.eye[1], z])
  if (!at) return fallback
  const r = view.ray(at[0], Math.max(0, view.horizonY) * frac)
  if (Math.abs(r[2]) < 1e-6) return fallback
  const t = (z - view.eye[2]) / r[2]
  return t > 0 ? view.eye[1] + t * r[1] : fallback
}

/**
 * How tall, in tiles, something at depth `z` may be to take `share` of the
 * band of sky: on an ultrawide frame the band is a few dozen pixels, and a
 * blimp sized for a monitor fills it top to bottom. Infinity without a view.
 */
export function skyRoom(view: View | undefined, x: number, z: number, share: number): number {
  const at = view?.project([x, view.eye[1], z])
  if (!view || !at) return Infinity
  return share * Math.max(0, view.horizonY) * view.tileAt(at[2])
}

/** An airship's height, top of the fin to the gondola's keel, per unit of `size`. */
const AIRSHIP_TALL = 2.8

/** A gull or any pale sea bird: two wings at a beat, on a wide arc. */
export function gull(id: string, route: P3[], o: { duration?: number; delay?: number; color?: Hex; size?: number } = {}): Actor {
  const s = o.size ?? 1
  return {
    id,
    flying: true,
    path: [[0, 0]],
    world: route,
    duration: o.duration ?? 24_000,
    motion: 'loop',
    fade: true,
    delay: o.delay,
    turn: true,
    bob: { amp: 0.12, period: 640 },
    build: (k) => {
      const c = o.color ?? 0xf5f0e6
      k.box(0.34 * s, 0, 0, 0.7 * s, 0.05 * s, 0.18 * s, c, { tilt: 0.45, cap: false })
      k.box(-0.34 * s, 0, 0, 0.7 * s, 0.05 * s, 0.18 * s, c, { tilt: -0.45, cap: false })
      k.box(0, -0.06 * s, 0, 0.26 * s, 0.14 * s, 0.5 * s, scale(c, 0.9), { cap: false })
    },
  }
}

/** A bat: dark, fast, jinking. */
export function bat(id: string, route: P3[], o: { duration?: number; delay?: number } = {}): Actor {
  return {
    ...gull(id, route, { duration: o.duration ?? 9000, delay: o.delay, color: 0x241a2e, size: 0.6 }),
    bob: { amp: 0.25, period: 260 },
  }
}

/**
 * A sailing boat crossing the bay, bow first, rocking on the swell. It is built
 * bow towards +x, so the route runs left to right, and it is a one-way trip
 * that comes out of the haze and goes back into it: a `bounce` sailed it home
 * stern first, and a sprite turned round by `scaleX(-1)` is a hull flipping on
 * the spot. The fades take the first and last `BOAT_FADE` of the crossing.
 * One point is a boat at anchor, which only rocks.
 */
export function driftingBoat(id: string, route: P3[], o: { duration?: number; delay?: number; hull?: Hex; trim?: Hex; size?: number } = {}): Actor {
  const crossing = route.length > 1
  const a = route[0]
  const b = route[route.length - 1]
  const at = (t: number): P3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
  return {
    id,
    flying: true,
    path: [[0, 0]],
    world: crossing ? [a, at(BOAT_FADE), at(1 - BOAT_FADE), b] : [a],
    duration: o.duration ?? 120_000,
    motion: crossing ? 'loop' : undefined,
    fade: crossing,
    delay: o.delay,
    bob: { amp: 0.04, period: 3800 },
    build: (k) => sailboat(k, 0, 0, 0, o.size ?? 1, o.hull ?? 0xf2ece0, o.trim ?? 0x2f5d7a, 0.15),
  }
}

/** Something crossing high now and then: a small plane, its lights on after dark. */
export function aircraft(id: string, route: P3[], o: { duration?: number; every?: number; color?: Hex; size?: number } = {}): Actor {
  const s = o.size ?? 6
  return {
    id,
    flying: true,
    path: [[0, 0]],
    world: route,
    duration: o.duration ?? 40_000,
    motion: 'pass',
    every: o.every ?? 120_000,
    build: (k) => {
      const c = o.color ?? 0xf5f0e6
      k.cyl(0, 0, 0, 0.32 * s, 3.2 * s, c, { axis: 'x', seg: 8 })
      k.box(0, -0.05 * s, 0, 0.9 * s, 0.1 * s, 3.6 * s, scale(c, 0.85), { cap: false })
      k.box(-1.4 * s, 0.1 * s, 0, 0.6 * s, 0.7 * s, 0.1 * s, scale(c, 0.85), { cap: false })
      if (k.rig.lampsOn) {
        k.sphere(0, 0, 1.85 * s, 0.14 * s, 0xff3b3b, { glow: true, seg: 4, outline: false })
        k.sphere(0, 0, -1.85 * s, 0.14 * s, 0x3bff7a, { glow: true, seg: 4, outline: false })
      }
    },
  }
}

/** An airship, slow, its gondola lit: the deco sky's and the neon sky's. */
export function airship(id: string, route: P3[], o: { duration?: number; delay?: number; hull?: Hex; band?: Hex; size?: number; maxTall?: number } = {}): Actor {
  const s = Math.min(o.size ?? 10, (o.maxTall ?? Infinity) / AIRSHIP_TALL)
  return {
    id,
    flying: true,
    path: [[0, 0]],
    world: route,
    duration: o.duration ?? 300_000,
    motion: 'bounce',
    delay: o.delay,
    bob: { amp: 0.06, period: 7000 },
    build: (k) => {
      const hull = o.hull ?? 0xd9d2c6
      k.cyl(0, 0, 0, 1.3 * s, 5 * s, hull, { axis: 'x', seg: 16 })
      k.sphere(2.5 * s, 0, 0, 1.3 * s, hull, { seg: 16 })
      k.sphere(-2.5 * s, 0, 0, 1.3 * s, scale(hull, 0.95), { seg: 16 })
      k.cyl(0.8 * s, 0, 0, 1.33 * s, 0.4 * s, o.band ?? 0xc23a2f, { axis: 'x', seg: 16, outline: false })
      for (const d of [-1, 1]) k.box(-3.4 * s, 0, d * 0.9 * s, 0.9 * s, 0.1 * s, 1.0 * s, scale(hull, 0.8), { cap: false })
      k.box(-3.4 * s, 0.7 * s, 0, 0.9 * s, 1.2 * s, 0.1 * s, scale(hull, 0.8), { cap: false })
      k.box(0.2 * s, -1.5 * s, 0, 1.6 * s, 0.4 * s, 0.6 * s, 0x3a2e28)
      if (k.rig.lampsOn) k.box(0.2 * s, -1.45 * s, 0.31 * s, 1.3 * s, 0.18 * s, 0.02 * s, 0xffd08a, { glow: true, outline: false, cap: false })
    },
  }
}

/** A petal falling past the camera, turning as it goes. */
export function petal(id: string, from: P3, drift: [number, number], o: { duration?: number; delay?: number; color?: Hex } = {}): Actor {
  const [dx, dz] = drift
  return {
    id,
    flying: true,
    path: [[0, 0]],
    world: [from, [from[0] + dx * 0.5, from[1] - 2.2, from[2] + dz * 0.5], [from[0] + dx, Math.max(0.05, from[1] - 4.6), from[2] + dz]],
    duration: o.duration ?? 9000,
    motion: 'loop',
    fade: true,
    spin: true,
    delay: o.delay,
    bob: { amp: 0.08, period: 1300 },
    build: (k) => k.box(0, 0, 0, 0.09, 0.012, 0.06, o.color ?? 0xffc4d8, { outline: false, cap: false, rot: 0.4 }),
  }
}

/** Smoke going up from a chimney: puffs that grow and thin. */
export function smoke(id: string, at: P3, o: { rise?: number; duration?: number; delay?: number; size?: number } = {}): Actor {
  const s = o.size ?? 1
  return {
    id,
    flying: true,
    path: [[0, 0]],
    world: [at, [at[0] + 1.2 * s, at[1] + (o.rise ?? 5) * s, at[2]]],
    duration: o.duration ?? 5200,
    motion: 'loop',
    puff: true,
    delay: o.delay,
    build: (k) => {
      const c = mix(0xd8d4dc, k.rig.sky.horizon, 0.3)
      k.sphere(0, 0.5 * s, 0, 0.5 * s, c, { seg: 8, outline: false })
      k.sphere(0.4 * s, 0.9 * s, 0.1, 0.4 * s, c, { seg: 7, outline: false })
    },
  }
}

/** A craft crossing a sky with no air: a hull, two engines lit. */
export function shuttle(id: string, route: P3[], o: { duration?: number; every?: number; size?: number } = {}): Actor {
  const s = o.size ?? 5
  return {
    id,
    flying: true,
    path: [[0, 0]],
    world: route,
    duration: o.duration ?? 50_000,
    motion: 'pass',
    every: o.every ?? 110_000,
    build: (k: Kit) => {
      k.box(0, 0, 0, 3 * s, 0.6 * s, 1.2 * s, 0xe9edf2)
      k.prism(1.8 * s, -0.3 * s, 0, 0.6 * s, 0.6 * s, 1.2 * s, 0xe9edf2)
      k.box(-0.2 * s, -0.1 * s, 0, 1.2 * s, 0.12 * s, 3.4 * s, 0xc9d0da, { cap: false })
      k.box(-1.6 * s, 0.1 * s, 0, 0.2 * s, 0.35 * s, 0.9 * s, 0x4fd6ff, { glow: true, outline: false, cap: false })
    },
  }
}
