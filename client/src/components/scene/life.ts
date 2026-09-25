/**
 * What moves in a room, and how it is described.
 *
 * The room is rendered once and released (`render.ts`), so nothing in it can
 * move. What can move is a **sprite over it**: a small thing built with the
 * same kit under the same light — a gull, a boat, a petal, a puff of smoke —
 * rendered to its own little bitmap in the same pass as the room, then carried
 * along a path by a transform animation (`LifeLayer.svelte`). The board's
 * compositing budget still belongs to the cards: an actor is one layer
 * carried by one route animation, with at most two more on elements inside it
 * when it bobs, spins or puffs.
 *
 * A builder returns its actors beside the room it built (`maps/*.ts`,
 * `maps/vistaLife.ts`), each with its route **in the world**. The render
 * builds the thing standing at the route's first point, photographs it with
 * the room's own camera, and projects the route into the frame, with the
 * scale the change of distance asks at every point (`render.ts:
 * vistaSprites`): a gull coming round towards the table grows as it comes.
 * This file is the description and the arithmetic; no three.js, no framework.
 */
import type { Kit } from './kit'

/** A point on screen, in tiles from the frame's centre, `sy` up. */
export type ScreenPt = [number, number]

export interface Actor {
  /** Stable within a room: the sprite's seed and the layer's key. */
  id: string
  /** Builds the thing at the origin, standing on `y = 0`, heading +x. */
  build: (k: Kit) => void
  /**
   * The route in the world, tiles, `y` up. The render builds the thing
   * standing at the first point, and projects the route into `path`.
   */
  world: [number, number, number][]
  /** The route on screen, in screen tiles: written by the render from `world`. One point is a thing that stays put. */
  path: ScreenPt[]
  /**
   * How large the sprite is drawn at each point of `path`, as a share of the
   * size it was rendered at: under a perspective camera a thing coming closer
   * grows. Written by the render from `world`; absent, 1 everywhere.
   */
  scales?: number[]
  /** One cycle along the route, in ms: there and back for a `bounce`. */
  duration: number
  /**
   * `loop` wraps to the start (a gull's circuit), `bounce` turns around (a
   * boat drifting and drifting back), `pass` crosses once and is gone until
   * the next time (a plane).
   */
  motion?: 'loop' | 'bounce' | 'pass'
  /**
   * For `pass`: how often, in ms. Defaults to three times the duration, and is
   * never shorter than it (`passEvery`): a speed can resolve a duration longer
   * than the period a builder wrote by hand.
   */
  every?: number
  /** Start offset into the cycle, in ms, so a row of actors is not a chorus line. */
  delay?: number
  /** Flip the sprite when it heads left on screen. */
  turn?: boolean
  /** Rise and fall, in tiles, over `period` ms. */
  bob?: { amp: number; period: number }
  /** Turn on the spot, once per `duration`. */
  spin?: boolean
  /** Fade in at the start of the route and out at its end. */
  fade?: boolean
  /** Grow from nothing and thin out: a puff of smoke, a spray. */
  puff?: boolean
  /** No shadow on the ground under it: something in the air. */
  flying?: boolean
  /**
   * Comes and goes where it stands: an opacity on the inner layer, once per
   * `period` ms. `on` is the stretch of the cycle it shows, `[from, to]`, with
   * `fade` ms of fade either side (a window lit and put out); `flicker` is a
   * stutter at `from` instead (a neon tube catching). Under reduced motion it
   * is not shown at all, which leaves the room as it was rendered.
   */
  blink?: { period: number; on: [number, number]; fade?: number; flicker?: boolean }
}

/** An actor's bitmap, and where the world origin sits inside it, in device pixels. */
export interface Sprite {
  actor: Actor
  canvas: HTMLCanvasElement
  ox: number
  oy: number
}

/**
 * The unit a route on screen is written in: the frame's longer side is this
 * many of them. Declared here rather than in `render.ts` because the life
 * layer needs it and must not pull three.js in to read it.
 */
export const TILES_ACROSS = 80

/** Pixels per screen tile, for a frame `w × h`. The render's own figure. */
export function tilePx(w: number, h: number): number {
  return Math.max(w, h) / TILES_ACROSS
}

/** The screen point in CSS pixels of the frame. */
export function toPx(pt: ScreenPt, w: number, h: number, ppu: number): [number, number] {
  return [w / 2 + pt[0] * ppu, h / 2 - pt[1] * ppu]
}

/** The length of one leg, on screen: the route was projected, and its builder wrote the duration against the world. */
function legLength(p: ScreenPt, q: ScreenPt): number {
  return Math.hypot(q[0] - p[0], q[1] - p[1])
}

/**
 * True when a `loop` has to walk its closing leg rather than jump it.
 *
 * A loop wraps to the start, and there are two honest ways to do that. A cloud
 * or a puff **fades** at both ends of its run, so the wrap happens while there
 * is nothing on screen; that is what `fade` and `puff` are for. Anything else —
 * somebody walking a street, a car on its lap — has to *travel* back, or the
 * player watches it teleport home and set off again, which is what a walk round
 * this square looked like. A path that already ends where it started is a
 * circuit and closes itself.
 */
export function closesTheRing(actor: Actor): boolean {
  const motion = actor.motion ?? (actor.path.length > 1 ? 'loop' : 'bounce')
  if (motion !== 'loop' || actor.path.length < 2) return false
  if (actor.fade || actor.puff) return false
  const first = actor.path[0]
  const last = actor.path[actor.path.length - 1]
  return Math.hypot(first[0] - last[0], first[1] - last[1]) > 1e-6
}

/** The distance one cycle covers, in tiles: a loop closed, a bounce there and back. */
export function routeLength(actor: Actor): number {
  const motion = actor.motion ?? (actor.path.length > 1 ? 'loop' : 'bounce')
  let len = 0
  for (let i = 1; i < actor.path.length; i++) len += legLength(actor.path[i - 1], actor.path[i])
  if (closesTheRing(actor)) len += legLength(actor.path[actor.path.length - 1], actor.path[0])
  return motion === 'bounce' ? len * 2 : len
}

/**
 * Every point one cycle visits, in order: there and back for a bounce, round
 * to the start for a loop that walks its closing leg, the path as written
 * otherwise. Shared by the keyframes and the veil, so the two agree about
 * where the thing goes.
 */
export function cycleRoute(actor: Actor): ScreenPt[] {
  const pts = actor.path
  const motion = actor.motion ?? (pts.length > 1 ? 'loop' : 'bounce')
  if (motion === 'bounce') return [...pts, ...pts.slice(0, -1).reverse()]
  if (closesTheRing(actor)) return [...pts, pts[0]]
  return [...pts]
}

/** The scale at every point `cycleRoute` visits, in the same order. */
export function cycleScales(actor: Actor): number[] {
  const s = actor.scales && actor.scales.length === actor.path.length ? actor.scales : actor.path.map(() => 1)
  const motion = actor.motion ?? (actor.path.length > 1 ? 'loop' : 'bounce')
  if (motion === 'bounce') return [...s, ...s.slice(0, -1).reverse()]
  if (closesTheRing(actor)) return [...s, s[0]]
  return [...s]
}

/** ` scale(s)` for a scale that is not 1, nothing otherwise. */
function scaleCss(s: number): string {
  return Math.abs(s - 1) < 1e-4 ? '' : ` scale(${s.toFixed(4)})`
}

export interface Keyframe {
  offset: number
  transform: string
  opacity?: number
}

/**
 * The route as Web Animations keyframes, in CSS pixels, with the sprite's
 * origin on the path. Distance-weighted, so a leg twice as long takes twice
 * as long and the thing moves at one speed. A `bounce` goes there and back inside
 * one cycle; a `pass` crosses in the first `duration / every` of the cycle and
 * sits invisible for the rest. Facing is answered per leg, and `turn` flips
 * the sprite when a leg heads left.
 */
export function routeKeyframes(actor: Actor, w: number, h: number, ppu: number): Keyframe[] {
  const motion = actor.motion ?? (actor.path.length > 1 ? 'loop' : 'bounce')
  if (actor.path.length === 1) {
    const [x, y] = toPx(actor.path[0], w, h, ppu)
    return [{ offset: 0, transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)${scaleCss(actor.scales?.[0] ?? 1)}` }]
  }
  const route = cycleRoute(actor).map((p) => toPx(p, w, h, ppu))
  const scales = cycleScales(actor)
  const legs: number[] = []
  let total = 0
  for (let i = 1; i < route.length; i++) {
    const d = legLength(route[i - 1], route[i])
    legs.push(d)
    total += d
  }
  if (total === 0) total = 1
  // `pass` compresses the crossing into the head of the cycle.
  const every = motion === 'pass' ? passEvery(actor) : actor.duration
  const share = motion === 'pass' ? actor.duration / every : 1
  const frames: Keyframe[] = []
  let acc = 0
  for (let i = 0; i < route.length; i++) {
    const [x, y] = route[i]
    const at = (acc / total) * share
    const next = route[i + 1] ?? route[i]
    const prev = route[i - 1] ?? route[i]
    // Facing: the leg leaving this point, or the one arriving at the last.
    const dx = i + 1 < route.length ? next[0] - x : x - prev[0]
    const flip = actor.turn && dx < 0 ? ' scaleX(-1)' : ''
    const t = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)${scaleCss(scales[i])}${flip}`
    // A facing that changes mid-route is a discrete flip, so the frame before
    // the turn is repeated with the new facing a hair later.
    if (i > 0 && actor.turn) {
      const pdx = x - prev[0]
      const pflip = pdx < 0 ? ' scaleX(-1)' : ''
      if (pflip !== flip) frames.push({ offset: Math.max(0, at - 0.0005), transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)${scaleCss(scales[i])}${pflip}`, ...(actor.fade || motion === 'pass' ? { opacity: 1 } : {}) })
    }
    const fadeEdge = actor.fade && (i === 0 || i === route.length - 1)
    // Opacity is written on every frame once any frame carries it: a keyframe
    // without the property interpolates towards the next one that has it, so
    // a pass whose hidden tail alone said `opacity: 0` faded out across its
    // whole crossing and the ferry came through as a grey ghost.
    const carries = actor.fade || motion === 'pass'
    frames.push({ offset: at, transform: t, ...(carries ? { opacity: fadeEdge ? 0 : 1 } : {}) })
    if (i + 1 < route.length) acc += legs[i]
  }
  if (motion === 'pass' && share < 1) {
    const last = frames[frames.length - 1]
    frames.push({ offset: Math.min(1, share + 0.0005), transform: last.transform, opacity: 0 })
    frames.push({ offset: 1, transform: last.transform, opacity: 0 })
  }
  // Keyframe offsets must not decrease.
  for (let i = 1; i < frames.length; i++) if (frames[i].offset < frames[i - 1].offset) frames[i].offset = frames[i - 1].offset
  return frames
}

/**
 * A pass's period: as written, three durations when not, and never shorter
 * than the crossing itself — a period under the duration put every keyframe
 * past offset 1, which Web Animations refuses.
 */
export function passEvery(actor: Actor): number {
  return Math.max(actor.every ?? actor.duration * 3, actor.duration)
}

/** The cycle's length: the route's duration, or the pass's period. */
export function cycleMs(actor: Actor): number {
  return (actor.motion ?? 'loop') === 'pass' ? passEvery(actor) : actor.duration
}

/** The keyframes of a blink, as offsets and opacities (`Actor.blink`). */
export function blinkKeyframes(b: NonNullable<Actor['blink']>): { offset: number; opacity: number }[] {
  const [from, to] = b.on
  if (b.flicker) {
    // A stutter over half a second, then the tube holds.
    const t = 500 / b.period
    const f = (k: number) => Math.min(1, from + t * k)
    return [
      { offset: 0, opacity: 0 },
      { offset: from, opacity: 0 },
      { offset: f(0.15), opacity: 1 },
      { offset: f(0.3), opacity: 0.1 },
      { offset: f(0.5), opacity: 1 },
      { offset: f(0.62), opacity: 0.35 },
      { offset: f(1), opacity: 1 },
      { offset: Math.max(f(1), to), opacity: 1 },
      { offset: Math.min(1, Math.max(f(1), to) + t * 0.1), opacity: 0 },
      { offset: 1, opacity: 0 },
    ]
  }
  const fade = (b.fade ?? 600) / b.period
  return [
    { offset: 0, opacity: 0 },
    { offset: from, opacity: 0 },
    { offset: Math.min(1, from + fade), opacity: 1 },
    { offset: Math.max(from + fade, to - fade), opacity: 1 },
    { offset: Math.max(from + fade, to), opacity: 0 },
    { offset: 1, opacity: 0 },
  ]
}

