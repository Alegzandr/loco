/**
 * What moves in a room, and how it is described.
 *
 * The room is rendered once and released (`render.ts`), so nothing in it can
 * move. What can move is a **sprite over it**: a small thing built with the
 * same kit under the same light — a boat, a balloon, a passer-by, a puff of
 * smoke — rendered to its own little bitmap in the same pass as the room, then
 * carried along a path by a transform animation (`LifeLayer.svelte`). The
 * board's compositing budget still belongs to the cards: an actor is one
 * layer moving under one animation, exactly what the weather already is, and
 * the render loop it would otherwise take stays closed.
 *
 * A builder returns its actors beside the room it built (`maps/*.ts`), with
 * paths in the same screen tiles it composes everything else in. This file is
 * the description and the arithmetic; no three.js, no framework.
 *
 * **A route is a candidate until the render has looked at it.** A sprite is
 * drawn over the whole frame, so a walker behind a house would walk across
 * its roof; the render answers with a depth map (`DepthMap`, one extra pass
 * over the room, read back once) and `trimRoute` keeps the stretch of every
 * route along which the thing would neither stand inside anything the ground
 * plan has claimed nor be overlapped on screen by anything standing nearer
 * the camera. What is left of a loop is a walk there and back; what is left
 * of nothing is dropped. A builder may hand in more candidates than it wants
 * (`pick`), and the longest survivors are kept.
 */
import type { Kit } from './kit'

const PITCH = (32 * Math.PI) / 180
export const PITCH_SIN = Math.sin(PITCH)
export const PITCH_COS = Math.cos(PITCH)
const PITCH_TAN = Math.tan(PITCH)

/** A point on screen, in tiles from the frame's centre, `sy` up. */
export type ScreenPt = [number, number]

export interface Actor {
  /** Stable within a room: the sprite's seed and the layer's key. */
  id: string
  /** Builds the thing at the origin, standing on `y = 0`, heading +x. */
  build: (k: Kit) => void
  /** The route, in screen tiles. One point is a thing that stays put. */
  path: ScreenPt[]
  /**
   * One cycle along the route, in ms: there and back for a `bounce`. Written
   * over by `trimRoute` when `speed` is set, since the route it is the cycle
   * of is the trimmed one.
   */
  duration: number
  /**
   * Ground tiles per second, for a thing on the ground. `walker` and
   * `traffic` declare one and let the route decide the duration: a leg up the
   * screen is longer on the ground than it looks, and a walker whose duration
   * was written by hand crossed the plaza at a run.
   */
  speed?: number
  /**
   * What the thing takes up, in tiles: `w` across the screen, `h` up from
   * its ground point, `foot` on the ground (`w` when absent). This is the
   * silhouette `trimRoute` tests against the depth map and the footprint it
   * asks the ground plan for. Absent on something in the air.
   */
  body?: Body
  /**
   * The builder handed in more of these than it wants: after trimming, the
   * `keep` longest routes in `group` survive and the rest are dropped.
   */
  pick?: { group: string; keep: number }
  /** The shortest route worth animating, in ground tiles. Four by default. */
  minLen?: number
  /**
   * The fraction of the surviving route this one walks, `[from, to]` of its
   * length: three strollers handed the same arc take three stretches of it
   * rather than the same walk three times.
   */
  part?: [number, number]
  /**
   * `loop` wraps to the start (a road, a circuit), `bounce` turns around
   * (a walk to the corner and back), `pass` crosses once and is gone until the
   * next time (a plane, a ferry).
   */
  motion?: 'loop' | 'bounce' | 'pass'
  /** For `pass`: how often, in ms. Defaults to three times the duration. */
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
}

export interface Body {
  w: number
  h: number
  foot?: number
}

/** A person: under a tile across, a tile and a half tall, a third of a tile on the ground. */
export const PERSON_BODY: Body = { w: 0.7, h: 1.6, foot: 0.3 }
/** A car heading along a road: what it covers on screen at either diagonal. */
export const CAR_BODY: Body = { w: 2.4, h: 1.2, foot: 1.0 }

/** An actor's bitmap, and where the world origin sits inside it, in device pixels. */
export interface Sprite {
  actor: Actor
  canvas: HTMLCanvasElement
  ox: number
  oy: number
}

/**
 * Tiles across the longer side of the frame.
 *
 * The number is the density: the table (CSS, over the centre) hides a diamond
 * of roughly ±39 tiles by ±33 on a monitor at this figure, and what is left is
 * a band of 14 to 20 tiles around it. A house is five tiles, a person one, so
 * the band holds three rows of houses and a crowd, which is the Habbo density
 * the room is after. Halve it and the band holds one house. Declared here
 * rather than in `render.ts` because the life layer needs it and must not pull
 * three.js in to read it.
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

/**
 * The ground distance between two screen points, in tiles: a leg up the
 * screen is foreshortened by the pitch, so a thing on the ground that moved at
 * one screen speed ran along the depth of the frame.
 */
export function groundDist(p: ScreenPt, q: ScreenPt): number {
  return Math.hypot(q[0] - p[0], (q[1] - p[1]) / PITCH_SIN)
}

/** The length of one leg for this actor: on the ground, or in the air as drawn. */
function legLength(actor: Actor, p: ScreenPt, q: ScreenPt): number {
  return actor.flying ? Math.hypot(q[0] - p[0], q[1] - p[1]) : groundDist(p, q)
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
  for (let i = 1; i < actor.path.length; i++) len += legLength(actor, actor.path[i - 1], actor.path[i])
  if (closesTheRing(actor)) len += legLength(actor, actor.path[actor.path.length - 1], actor.path[0])
  return motion === 'bounce' ? len * 2 : len
}

/** The cycle's length in ms: from the speed and the route when there is a speed, else as written. */
export function durationFor(actor: Actor): number {
  if (!actor.speed || actor.speed <= 0) return actor.duration
  return Math.max(1000, (routeLength(actor) / actor.speed) * 1000)
}

export interface Keyframe {
  offset: number
  transform: string
  opacity?: number
}

/**
 * The route as Web Animations keyframes, in CSS pixels, with the sprite's
 * origin on the path. Distance-weighted on the ground (`groundDist`), so a leg
 * twice as long takes twice as long and the thing moves at one speed. A `bounce` goes there and back inside
 * one cycle; a `pass` crosses in the first `duration / every` of the cycle and
 * sits invisible for the rest. Facing is answered per leg, and `turn` flips
 * the sprite when a leg heads left.
 */
export function routeKeyframes(actor: Actor, w: number, h: number, ppu: number): Keyframe[] {
  const pts = actor.path.map((p) => toPx(p, w, h, ppu))
  const motion = actor.motion ?? (pts.length > 1 ? 'loop' : 'bounce')
  if (pts.length === 1) {
    const [x, y] = pts[0]
    return [{ offset: 0, transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)` }]
  }
  const route =
    motion === 'bounce'
      ? [...pts, ...pts.slice(0, -1).reverse()]
      : closesTheRing(actor)
        ? [...pts, pts[0]]
        : [...pts]
  const legs: number[] = []
  let total = 0
  for (let i = 1; i < route.length; i++) {
    const d = legLength(actor, route[i - 1], route[i])
    legs.push(d)
    total += d
  }
  if (total === 0) total = 1
  // `pass` compresses the crossing into the head of the cycle.
  const every = motion === 'pass' ? (actor.every ?? actor.duration * 3) : actor.duration
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
    const t = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)${flip}`
    // A facing that changes mid-route is a discrete flip, so the frame before
    // the turn is repeated with the new facing a hair later.
    if (i > 0 && actor.turn) {
      const pdx = x - prev[0]
      const pflip = pdx < 0 ? ' scaleX(-1)' : ''
      if (pflip !== flip) frames.push({ offset: Math.max(0, at - 0.0005), transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)${pflip}`, ...(actor.fade || motion === 'pass' ? { opacity: 1 } : {}) })
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

/** The cycle's length: the route's duration, or the pass's period. */
export function cycleMs(actor: Actor): number {
  return (actor.motion ?? 'loop') === 'pass' ? (actor.every ?? actor.duration * 3) : actor.duration
}

// ─── What the render answers about a route ──────────────────────────────────

/**
 * The room's depth, one value per `scale` device pixels of the frame, read
 * back from one extra pass over the same scene (`render.ts`). A value is the
 * window depth the GPU wrote — 0 at the near plane, 1 at the far — and the
 * camera's geometry is carried beside it so a ground point's own depth can be
 * written in the same units: `origin` is the depth of the ground under the
 * frame's centre, `perTile` a tile of eye depth.
 */
export interface DepthMap {
  data: Float32Array
  w: number
  h: number
  /** Frame device pixels per depth pixel. */
  scale: number
  /** The frame, in device pixels. */
  fw: number
  fh: number
  /** Device pixels per screen tile. */
  ppu: number
  origin: number
  perTile: number
}

/**
 * The window depth of a point `up` screen tiles above the ground at screen
 * height `sy`. The camera looks down at the pitch, so a tile up the screen on
 * the ground is `1 / tan(pitch)` of eye depth farther, and a tile up a thing
 * standing there is `tan(pitch)` nearer.
 */
export function depthAt(map: DepthMap, sy: number, up: number): number {
  return map.origin + (sy / PITCH_TAN) * map.perTile - up * PITCH_TAN * map.perTile
}

/** How much nearer, in tiles toward the camera, something has to stand to count as in front. */
export const OCCLUSION_SLACK = 0.3

/**
 * True when something the render drew stands between the camera and a thing
 * of `body` standing at `pt`: any pixel of its silhouette where the frame's
 * depth is nearer than the thing's own by more than the slack. Off the map
 * nothing is known and nothing is in front.
 */
export function occluded(map: DepthMap, pt: ScreenPt, body: Body): boolean {
  const [px, py] = toPx(pt, map.fw, map.fh, map.ppu)
  const tall = body.h * PITCH_COS
  const slack = OCCLUSION_SLACK * PITCH_COS * map.perTile
  const step = 0.25
  for (let u = -body.w / 2; u <= body.w / 2 + 1e-6; u += step) {
    const x = Math.round((px + u * map.ppu) / map.scale)
    if (x < 0 || x >= map.w) continue
    for (let v = step / 2; v <= tall; v += step) {
      const y = Math.round((py - v * map.ppu) / map.scale)
      if (y < 0 || y >= map.h) continue
      if (map.data[y * map.w + x] < depthAt(map, pt[1], v) - slack) return true
    }
  }
  return false
}

/** Whether a thing of this actor's body may stand at `pt`. */
export type Standable = (pt: ScreenPt, actor: Actor) => boolean

/** The point `dist` tiles along a polyline, on the ground. */
function pointAlong(path: ScreenPt[], dist: number): ScreenPt {
  let acc = 0
  for (let i = 1; i < path.length; i++) {
    const d = groundDist(path[i - 1], path[i])
    if (acc + d >= dist && d > 0) {
      const t = (dist - acc) / d
      return [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * t, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * t]
    }
    acc += d
  }
  return path[path.length - 1]
}

/**
 * The stretch of the route the thing can actually take, or null when there is
 * none worth taking.
 *
 * The route is sampled every `step` ground tiles and each sample asked of
 * `ok`; the longest run of good samples is the route that survives, with the
 * original corners kept along it. A loop that is whole stays a loop; one that
 * is cut becomes a walk there and back along its longest good arc, turning
 * round where it was cut. A `pass` fades at its ends instead, over one tile:
 * where it was cut is where the thing walks behind something, and an end
 * that was not cut is off the frame. Something in the air is
 * returned as it is: nothing stands in front of the sky. Either way the
 * duration is resolved from `speed` here, since it is the survivor's length
 * it depends on.
 */
export function trimRoute(actor: Actor, ok: Standable, step = 0.5): Actor | null {
  if (actor.flying || actor.path.length < 2) return { ...actor, duration: durationFor(actor) }
  const motion = actor.motion ?? 'loop'
  const closed = motion === 'loop' && actor.path.length > 2
  const pts = closed ? [...actor.path, actor.path[0]] : actor.path
  const samples: ScreenPt[] = []
  const corner: boolean[] = []
  for (let i = 1; i < pts.length; i++) {
    const d = groundDist(pts[i - 1], pts[i])
    const n = Math.max(1, Math.ceil(d / step))
    for (let j = 0; j < n; j++) {
      const t = j / n
      samples.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t])
      corner.push(j === 0)
    }
  }
  if (!closed) {
    samples.push(pts[pts.length - 1])
    corner.push(true)
  }
  const n = samples.length
  const good = samples.map((p) => ok(p, actor))
  if (good.every(Boolean)) {
    if (actor.part) return finish({ ...actor, motion: motion === 'loop' ? 'bounce' : motion, fade: actor.fade || motion === 'pass' }, actor.minLen ?? 4)
    if (routeLength({ ...actor, motion: 'pass' }) < (actor.minLen ?? 4)) return null
    const whole = { ...actor, duration: durationFor(actor) }
    if (motion === 'pass') whole.fade = true
    return whole
  }
  // The longest run of good samples; around the end for a loop.
  let bestStart = -1
  let bestLen = 0
  const from = closed ? good.indexOf(false) + 1 : 0
  let runStart = -1
  let runLen = 0
  for (let k = 0; k < n; k++) {
    const i = (from + k) % n
    if (good[i]) {
      if (runStart < 0) runStart = i
      runLen++
      if (runLen > bestLen) {
        bestLen = runLen
        bestStart = runStart
      }
    } else {
      runStart = -1
      runLen = 0
    }
  }
  if (bestLen < 2) return null
  const path: ScreenPt[] = []
  for (let k = 0; k < bestLen; k++) {
    const i = (bestStart + k) % n
    if (k === 0 || k === bestLen - 1 || corner[i]) path.push(samples[i])
  }
  // A pass fades where it was cut: that is where it walks behind something.
  // A bounce turns round there instead, which needs no fade.
  const trimmed: Actor = { ...actor, path, motion: motion === 'loop' ? 'bounce' : motion, fade: actor.fade || motion === 'pass' }
  return finish(trimmed, actor.minLen ?? 4)
}

/** A polyline cut to the stretch between `from` and `to` tiles along it. */
function cut(path: ScreenPt[], from: number, to: number): ScreenPt[] {
  const out: ScreenPt[] = [pointAlong(path, from)]
  let acc = 0
  for (let i = 1; i < path.length - 1; i++) {
    acc += groundDist(path[i - 1], path[i])
    if (acc > from && acc < to) out.push(path[i])
  }
  out.push(pointAlong(path, to))
  return out
}

/** The trimmed route's part, its fades and its duration, or null when too short. */
function finish(trimmed: Actor, minLen: number): Actor | null {
  let path = trimmed.path
  let len = routeLength({ ...trimmed, motion: 'pass' })
  if (trimmed.part) {
    const [p, q] = trimmed.part
    path = cut(path, Math.max(0, Math.min(p, q)) * len, Math.min(1, Math.max(p, q)) * len)
    len = routeLength({ ...trimmed, path, motion: 'pass' })
  }
  if (len < minLen) return null
  // One tile of fade at each end: the corner it turns is the edge of a thing.
  const edge = Math.min(1, len / 3)
  const a = pointAlong(path, edge)
  const b = pointAlong(path, len - edge)
  const last = path[path.length - 1]
  const inner = path.slice(1, -1).filter((p) => groundDist(path[0], p) > edge && groundDist(p, last) > edge)
  trimmed.path = [path[0], a, ...inner, b, last]
  trimmed.duration = durationFor(trimmed)
  return trimmed
}

/** How much a surviving route is worth to a `pick`: its length, unless told otherwise. */
export type Worth = (actor: Actor) => number

/**
 * How much of the route, in ground tiles, runs where `inside` says: the frame,
 * less the hand. A pass that enters from off the frame is worth the part of
 * it anybody sees.
 */
export function lengthInside(actor: Actor, inside: (pt: ScreenPt) => boolean, step = 1): number {
  let total = 0
  for (let i = 1; i < actor.path.length; i++) {
    const p = actor.path[i - 1]
    const q = actor.path[i]
    const d = groundDist(p, q)
    const n = Math.max(1, Math.ceil(d / step))
    for (let j = 0; j < n; j++) {
      const t = (j + 0.5) / n
      if (inside([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t])) total += d / n
    }
  }
  return total
}

/**
 * Every actor the room ends up with: each candidate trimmed to where it can
 * stand, and of those a builder handed in as a `pick` group, the `keep` worth
 * most — the longest, unless `worth` says otherwise. Deterministic: ties go
 * by id.
 */
export function selectActors(actors: Actor[], ok: Standable, worth: Worth = routeLength): Actor[] {
  const kept: Actor[] = []
  const groups = new Map<string, Actor[]>()
  for (const a of actors) {
    const t = trimRoute(a, ok)
    if (!t) continue
    if (!t.pick) {
      kept.push(t)
      continue
    }
    const list = groups.get(t.pick.group)
    if (list) list.push(t)
    else groups.set(t.pick.group, [t])
  }
  for (const list of groups.values()) {
    list.sort((p, q) => worth(q) - worth(p) || (p.id < q.id ? -1 : 1))
    kept.push(...list.slice(0, list[0].pick!.keep))
  }
  return kept
}
