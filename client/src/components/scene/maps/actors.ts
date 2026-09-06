/**
 * The things that move, built with the kit and carried by `LifeLayer`.
 *
 * Each factory returns an `Actor` (`scene/life.ts`): a builder that draws the
 * thing at the origin with the same kit the room is built with, and a route in
 * screen tiles. What a room does with them is its builder's business — the
 * harbour has a ferry, the moon a satellite — but the cloud, the bird, the
 * passer-by and the puff of smoke are the same in every room that has a sky
 * to put them in, so they are written once here.
 *
 * **A route on the ground is a candidate.** A sprite is drawn over the whole
 * frame, so it passes in front of everything the render has, and a walker
 * crossing a house at the wrong depth is the illusion breaking. So a thing on
 * the ground goes where things go — the pavement along the buildings, a lane
 * of the road, the promenade round the plaza — and says what it takes up
 * (`body`); the render then keeps the stretch of it nothing stands in front
 * of and nothing is built on (`life.ts: trimRoute`). The street walkers and
 * the traffic hand in every pavement and every lane the grid laid and ask
 * for a few (`pick`): which ones survive depends on the frame, and the
 * builder has not seen it.
 *
 * **Things move at a speed, not for a duration.** A person walks at
 * `WALK_SPEED` ground tiles a second and a car drives at `DRIVE_SPEED`; the
 * route decides how long that takes. Sprites written with a duration crossed
 * the plaza at a run.
 */
import type { Kit } from '../kit'
import type { Actor, ScreenPt } from '../life'
import { CAR_BODY, PERSON_BODY } from '../life'
import type { Hex } from '../sky'
import { mix, scale } from '../sky'
import { at, screenOf, WALK_LINE, type StreetPlan } from './common'

/** Ground tiles per second. A person here is a tile and a half tall. */
export const WALK_SPEED = 0.75
export const DRIVE_SPEED = 3.2

const PITCH_COS = Math.cos((32 * Math.PI) / 180)

/** Where a point `y` tiles above the ground point `(sx, sy)` lands on screen. */
export function lift(pt: ScreenPt, y: number): ScreenPt {
  return [pt[0], pt[1] + y * PITCH_COS]
}

// ─── The sky ─────────────────────────────────────────────────────────────────

/**
 * A cloud: a row of balls with a flat underside, high up, drifting across the
 * top of the frame and fading at both ends of its run. Its colour is the
 * hour's — white at noon, the sky's own tone at night — so it belongs to the
 * light it drifts through rather than sitting on it.
 */
export function cloud(k: Kit, id: string, o: { sy: number; from?: number; to?: number; size?: number; duration?: number; delay?: number }): Actor {
  const size = o.size ?? 1
  const white = mix(0xffffff, k.rig.sky.horizon, 0.12 + k.rig.dark * 0.45)
  return {
    id,
    flying: true,
    path: [
      [o.from ?? -50, o.sy],
      [o.to ?? 50, o.sy],
    ],
    duration: o.duration ?? 150_000,
    motion: 'loop',
    fade: true,
    delay: o.delay,
    build: (kk) => {
      const y = 9
      const r = 1.1 * size
      const balls: [number, number, number][] = [
        [0, 0.5, 0],
        [1.5, 0.2, 0.2],
        [-1.4, 0.15, -0.1],
        [0.6, 0.85, -0.6],
        [-0.5, 0.75, 0.5],
        [2.6, -0.1, 0],
        [-2.5, -0.1, 0.1],
      ]
      for (const [dx, dy, dz] of balls) kk.sphere(dx * size, y + r + dy * r, dz * size, r * (0.8 + Math.abs(dy) * 0.3), white, { seg: 9 })
      kk.box(0, y + r * 0.3, 0, 6 * size, 0.7 * r, 2 * size, white, { outline: false, cap: false })
    },
  }
}

/** A bird: two wings at a beat, flying a wide arc across the top band. */
export function bird(_k: Kit, id: string, o: { path: ScreenPt[]; duration?: number; delay?: number; color?: Hex }): Actor {
  return {
    id,
    flying: true,
    path: o.path,
    duration: o.duration ?? 26_000,
    motion: 'loop',
    fade: true,
    delay: o.delay,
    turn: true,
    bob: { amp: 0.18, period: 700 },
    build: (kk) => {
      const c = o.color ?? 0xf5f0e6
      kk.box(0.22, 8, 0, 0.5, 0.07, 0.12, c, { rot: 0, tilt: 0.55, cap: false })
      kk.box(-0.22, 8, 0, 0.5, 0.07, 0.12, c, { rot: 0, tilt: -0.55, cap: false })
      kk.box(0, 7.95, 0, 0.22, 0.12, 0.14, scale(c, 0.85), { cap: false })
    },
  }
}

/** A hot-air balloon: a striped ball, cords, a basket, riding the air. */
export function balloon(_k: Kit, id: string, o: { at: ScreenPt; colors?: [Hex, Hex]; y?: number; drift?: number }): Actor {
  const [a, b] = o.colors ?? [0xff3d68, 0xffd23c]
  const y = o.y ?? 7
  const drift = o.drift ?? 1.2
  return {
    id,
    flying: true,
    path: [
      [o.at[0] - drift, o.at[1]],
      [o.at[0] + drift, o.at[1] + 0.4],
    ],
    duration: 26_000,
    motion: 'bounce',
    bob: { amp: 0.35, period: 5200 },
    build: (kk) => {
      const r = 1.7
      kk.sphere(0, y + r + 1.4, 0, r, a, { seg: 12 })
      for (let i = 0; i < 4; i++) {
        const t = (i / 4) * Math.PI * 2
        kk.box(Math.cos(t) * r * 0.62, y + r + 0.5, Math.sin(t) * r * 0.62, 0.55, r * 1.5, 0.55, b, { rot: -t, outline: false, cap: false })
      }
      kk.cyl(0, y + 0.55, 0, 0.55, 0.9, scale(a, 0.85), { seg: 8, rTop: 0.9, cap: false })
      for (const [dx, dz] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) kk.box(dx, y - 0.2, dz, 0.05, 0.9, 0.05, 0x2a2a2a, { outline: false, cap: false })
      kk.box(0, y - 0.75, 0, 0.9, 0.6, 0.9, 0xb98a4d)
      kk.sphere(0.15, y - 0.35, 0, 0.16, 0xf3c9a5, { seg: 6 })
    },
  }
}

/** A little plane crossing high, now and then. */
export function plane(_k: Kit, id: string, o: { sy: number; every?: number; color?: Hex }): Actor {
  return {
    id,
    flying: true,
    path: [
      [-52, o.sy],
      [52, o.sy + 2],
    ],
    duration: 22_000,
    motion: 'pass',
    every: o.every ?? 95_000,
    bob: { amp: 0.12, period: 2600 },
    build: (kk) => {
      const c = o.color ?? 0xf5f0e6
      const y = 14
      kk.cyl(0, y, 0, 0.32, 3.2, c, { axis: 'x', seg: 8 })
      kk.cone(1.9, y, 0, 0.3, 0.6, scale(c, 0.9), { seg: 8, rot: 0 })
      kk.box(-0.1, y - 0.05, 0, 0.9, 0.1, 3.6, 0xd94c4c, { cap: false })
      kk.box(-1.3, y + 0.1, 0, 0.6, 0.7, 0.1, 0xd94c4c, { cap: false })
      kk.box(-1.3, y + 0.05, 0, 0.5, 0.08, 1.4, 0xd94c4c, { cap: false })
      kk.box(0.3, y + 0.3, 0, 1.0, 0.18, 0.34, 0x9fe8ff, { outline: false, cap: false })
      if (kk.rig.lampsOn) kk.sphere(-0.1, y - 0.1, 1.85, 0.08, 0xff3b3b, { glow: true, seg: 4, outline: false })
    },
  }
}

// ─── Smoke, steam, spray ────────────────────────────────────────────────────

/**
 * A puff rising from a point: three soft balls that grow and thin out. Sent up
 * from a chimney, a funnel, a hot pool, a fountain's crown.
 */
export function puff(_k: Kit, id: string, o: { at: ScreenPt; rise?: number; duration?: number; delay?: number; color?: Hex; size?: number }): Actor {
  const size = o.size ?? 1
  return {
    id,
    flying: true,
    path: [o.at, [o.at[0] + 0.4 * size, o.at[1] + (o.rise ?? 2.4)]],
    duration: o.duration ?? 3800,
    motion: 'loop',
    puff: true,
    delay: o.delay,
    build: (kk) => {
      const c = o.color ?? mix(0xe8ecf0, kk.rig.sky.horizon, 0.2)
      kk.sphere(0, 0.5 * size, 0, 0.42 * size, c, { seg: 8, outline: false })
      kk.sphere(0.35 * size, 0.85 * size, 0.1, 0.34 * size, c, { seg: 7, outline: false })
      kk.sphere(-0.3 * size, 0.95 * size, -0.1, 0.3 * size, scale(c, 1.03), { seg: 7, outline: false })
    },
  }
}

// ─── People ──────────────────────────────────────────────────────────────────

/** A direction on the ground, in world tiles. */
export type Heading = [number, number]

/**
 * The rotation that faces a person along `heading`: a person faces +z at
 * rot 0 and `rotateY` sends +z to (sin, 0, cos). Screen-right is the world
 * (1, -1) diagonal, three quarters of a turn.
 */
export function personRot([hx, hz]: Heading): number {
  return Math.atan2(hx, hz)
}

/** The rotation that faces a car along `heading`: +x at rot 0, sent to (cos, 0, -sin). */
export function carRot([hx, hz]: Heading): number {
  return Math.atan2(-hz, hx)
}

/** Screen-right, the direction a route with no heading of its own is drawn facing. */
const SCREEN_RIGHT: Heading = [Math.SQRT1_2, -Math.SQRT1_2]

/**
 * Somebody walking: the kit's person mid-stride, going along a route at a
 * walking pace. Built facing `heading`; without one it faces screen-right and
 * is mirrored on a leg that heads left, which is right for a route that runs
 * across the screen and a quarter turn off for one that runs up it — so a
 * route along a street says its heading and goes one way.
 */
export function walker(_k: Kit, id: string, o: { path: ScreenPt[]; speed?: number; delay?: number; motion?: Actor['motion']; look?: Parameters<Kit['person']>[3]; bob?: Actor['bob']; heading?: Heading; pick?: Actor['pick']; part?: Actor['part']; minLen?: number }): Actor {
  return {
    id,
    path: o.path,
    duration: 30_000,
    speed: o.speed ?? WALK_SPEED,
    body: PERSON_BODY,
    motion: o.motion ?? 'bounce',
    delay: o.delay,
    turn: !o.heading,
    pick: o.pick,
    part: o.part,
    minLen: o.minLen,
    bob: o.bob ?? { amp: 0.05, period: 520 },
    build: (kk) => {
      kk.person(0, 0, personRot(o.heading ?? SCREEN_RIGHT), { ...o.look, stride: 1 })
    },
  }
}

/** True when any of the run, in screen tiles, lies within `pad` tiles of the frame. */
function nearFrame(k: Kit, p: ScreenPt, q: ScreenPt, pad = 4): boolean {
  const hw = k.frame.w / 2 + pad
  const hh = k.frame.h / 2 + pad
  const inside = (pt: ScreenPt) => Math.abs(pt[0]) <= hw && Math.abs(pt[1]) <= hh
  if (inside(p) || inside(q)) return true
  // A run whose ends are both off the frame may still cross it.
  const cx = (p[0] + q[0]) / 2
  const cy = (p[1] + q[1]) / 2
  return Math.abs(cx) <= hw && Math.abs(cy) <= hh
}

/** The two ends of a run, offset `off` tiles to its side, in screen tiles, going `dir`. */
function alongRun(run: StreetPlan['runs'][number], off: number, dir: 1 | -1): { path: ScreenPt[]; heading: Heading } {
  const a = run.axis === 'x' ? screenOf(run.from, run.line + off) : screenOf(run.line + off, run.from)
  const b = run.axis === 'x' ? screenOf(run.to, run.line + off) : screenOf(run.line + off, run.to)
  const heading: Heading = run.axis === 'x' ? [dir, 0] : [0, dir]
  return { path: dir > 0 ? [a, b] : [b, a], heading }
}

/**
 * People walking the pavements of the street grid: along the building line,
 * one way, from wherever the render lets them start to wherever it stops
 * them, and back again a while later. Every pavement of every run in the
 * frame is a candidate, both ways; `n` survive.
 */
export function streetWalkers(k: Kit, plan: StreetPlan, n: number, o: { look?: Parameters<Kit['person']>[3] } = {}): Actor[] {
  const out: Actor[] = []
  const off = plan.road / 2 + plan.sidewalk - WALK_LINE
  let i = 0
  for (const run of plan.runs) {
    for (const side of [-1, 1] as const) {
      for (const dir of [-1, 1] as const) {
        const { path, heading } = alongRun(run, side * off, dir)
        if (!nearFrame(k, path[0], path[1])) continue
        out.push(walker(k, `walk-${i++}`, { path, heading, motion: 'pass', speed: WALK_SPEED * k.rng.range(0.85, 1.15), delay: k.rng.range(0, 60_000), look: o.look, pick: { group: 'walkers', keep: n } }))
      }
    }
  }
  return out
}

// ─── Vehicles ────────────────────────────────────────────────────────────────

/**
 * Cars driving the streets: the right-hand lane of every run in the frame,
 * both ways, each a candidate; `n` survive, and each crosses now and then.
 * A car is built facing the way its lane goes, so it is never mirrored.
 */
export function traffic(k: Kit, plan: StreetPlan, colors: readonly Hex[], n: number): Actor[] {
  const out: Actor[] = []
  let i = 0
  for (const run of plan.runs) {
    for (const dir of [-1, 1] as const) {
      // The right-hand lane: +z heading +x, +x heading -z (`cityGrid` parks the same way).
      const lane = (run.axis === 'x' ? dir : -dir) * (plan.road / 4)
      const { path, heading } = alongRun(run, lane, dir)
      if (!nearFrame(k, path[0], path[1])) continue
      const color = k.rng.pick(colors)
      out.push({
        id: `car-${i++}`,
        path,
        duration: 20_000,
        speed: DRIVE_SPEED * k.rng.range(0.9, 1.1),
        body: CAR_BODY,
        minLen: 12,
        motion: 'pass',
        delay: k.rng.range(0, 40_000),
        pick: { group: 'traffic', keep: n },
        build: (kk) => kk.car(0, 0, carRot(heading), color),
      })
    }
  }
  return out
}

/** A boat under way: hull, cabin, a wake, crossing a stretch of water. */
export function boat(_k: Kit, id: string, o: { path: ScreenPt[]; hull: Hex; duration?: number; every?: number; motion?: Actor['motion']; len?: number; sail?: boolean; delay?: number; fade?: boolean }): Actor {
  return {
    id,
    path: o.path,
    duration: o.duration ?? 60_000,
    motion: o.motion ?? 'pass',
    every: o.every,
    delay: o.delay,
    fade: o.fade,
    turn: true,
    bob: { amp: 0.06, period: 2400 },
    build: (kk) => {
      // Bow at local +x, heading screen-right: see `carLap`.
      const rot = Math.PI / 4
      const len = o.len ?? 4.2
      const on = kk.rig.lampsOn
      const c = Math.cos(rot)
      const s = Math.sin(rot)
      kk.box(0, -0.55, 0, len, 0.9, 1.8, o.hull, { rot })
      kk.box((len / 2) * c, -0.4, -(len / 2) * s, 1.0, 0.75, 1.2, o.hull, { rot: rot + Math.PI / 4 })
      kk.box(0, 0.35, 0, len - 0.2, 0.12, 1.6, mix(o.hull, 0xffffff, 0.5), { rot, outline: false, cap: false })
      if (o.sail) {
        kk.cyl(0, 0.4, 0, 0.07, 3.6, 0x6b4a2b, { seg: 5, cap: false })
        kk.box(0.85 * s, 1.3, 0.85 * c, 0.06, 2.4, 1.5, 0xfaf6ee, { rot, cap: false })
      } else {
        kk.box(-0.4 * c, 0.45, 0.4 * s, 1.6, 1.0, 1.3, 0xf5f0e6, { rot })
        kk.box(-0.4 * c, 0.7, 0.4 * s, 1.64, 0.4, 1.34, on ? 0xffe2a8 : 0x1a2233, { rot, glow: on, outline: false, cap: false })
        kk.cyl(-0.6 * c, 1.45, 0.6 * s, 0.1, 0.6, 0x2a2f3a, { seg: 5, cap: false })
      }
      // The wake: two pale streaks off the stern.
      for (const side of [-0.7, 0.7]) {
        kk.box(-(len / 2 + 1.2) * c + side * s, -0.66, (len / 2 + 1.2) * s + side * c, 2.4, 0.04, 0.22, mix(0x2c86c9, 0xffffff, 0.6), { rot, outline: false, cap: false })
      }
      if (on) kk.sphere((len / 2 + 0.3) * c, 0.55, -(len / 2 + 0.3) * s, 0.12, 0x7cff6b, { glow: true, seg: 5, outline: false })
    },
  }
}

// ─── Small lights ────────────────────────────────────────────────────────────

/** A firefly, or a spark: a glowing mote wandering a small loop. Only after dark. */
export function mote(k: Kit, id: string, o: { at: ScreenPt; color: Hex; r?: number; duration?: number; delay?: number }): Actor | null {
  if (!k.rig.lampsOn) return null
  const r = o.r ?? 1.2
  const path: ScreenPt[] = []
  for (let i = 0; i <= 8; i++) {
    const t = (i / 8) * Math.PI * 2
    path.push([o.at[0] + Math.cos(t) * r, o.at[1] + Math.sin(t * 2) * r * 0.35])
  }
  return {
    id,
    flying: true,
    path,
    duration: o.duration ?? 9000,
    motion: 'loop',
    delay: o.delay,
    bob: { amp: 0.3, period: 1700 },
    build: (kk) => {
      kk.sphere(0, 1.2, 0, 0.09, o.color, { glow: true, seg: 5, outline: false })
      kk.halo(0, 1.2, 0, 0.35, o.color, 0.5, false)
    },
  }
}

/** Somewhere `y` tiles up over the world point, in screen tiles. */
export function over(x: number, z: number, y: number): ScreenPt {
  const sx = (x - z) / Math.SQRT2
  const sy = (-(x + z) / Math.SQRT2) * Math.sin((32 * Math.PI) / 180)
  return [sx, sy + y * PITCH_COS]
}

export { at }
