/**
 * The camera of a room seen from the table: in perspective, at eye height,
 * with the horizon in the frame.
 *
 * A room used to be photographed from above, orthographic, at the angle a
 * Habbo room is drawn at (`render.ts`, `maps/common.ts`): every block the same
 * size wherever it stood, no sky, no horizon, and so no depth — the room read
 * as a board laid out round the table rather than as a place the table stood
 * in. What gives a picture depth is a near, a middle and a far that recede
 * towards a horizon under a sky, and that takes a perspective camera looking
 * out rather than down (`docs/notes/visual.md`, "The view").
 *
 * **The felt is fixed and the camera is solved to it.** The board draws the
 * table in CSS (`layout.ts: feltInViewport`), a screen ellipse the render has
 * no say over. Under a perspective camera a table top is the ground-plane
 * image of that ellipse through the lens — itself an ellipse, not centred
 * where the screen one is — so the top is built from the felt's own outline
 * cast back onto the table's plane (`View.tableOutline`), and lands under the
 * CSS felt to the pixel whatever the camera. What is left to choose is the
 * camera, and two things decide it:
 *
 * - **Where the horizon sits** (`VistaParams.horizon`, a share of the frame's
 *   height from the top): above the felt, so the sky and the far shore show
 *   between the seat pills.
 * - **What shape the table is on the ground** (`VistaParams.aspect`, its depth
 *   over its width). The nearer the horizon comes down to the felt's top edge,
 *   the farther away that edge is on the ground: a horizon just over the felt
 *   is a table fifteen metres deep. So the shape is held and the focal length
 *   is what gives.
 *
 * Both are met by solving the focal length (`solveView`, a bisection), inside
 * a range of fields of view a lens can honestly have (`fov`). Where the range
 * cannot hold both — a phone on its side, where the felt is nearly the whole
 * height — the table keeps its shape and the horizon goes where it goes.
 *
 * World axes as everywhere in the kit: `y` up, the camera looks towards `-z`,
 * `x` is screen right. The table's centre is the world's origin, on the plane
 * `y = tableTop`. Distances are tiles, and a tile is about a metre (a person is
 * 1.6). Screen points are pixels of the frame the view was solved for, `y`
 * down. No three.js here: `render.ts` builds the camera from the numbers
 * (`cameraSpec`), and a test can assert the geometry in jsdom.
 */

export type V3 = [number, number, number]

/** The felt's ellipse, in pixels of the frame, `y` down. */
export interface FeltPx {
  cx: number
  cy: number
  rx: number
  ry: number
  /** Frame pixels per board pixel, when the felt is the board's (`FeltAnchor.unit`). */
  unit?: number
}

export interface VistaParams {
  /** Where the horizon sits, as a share of the frame's height from the top. */
  horizon: number
  /** Where the horizon may go no higher than, when the lens range cannot hold `horizon` and `aspect` together. */
  horizonMin: number
  /** The table's depth over its width, on the ground. 1 is round. */
  aspect: number
  /** How deep the table may grow to keep the horizon at `horizonMin`. */
  aspectMax: number
  /** The field of view across the frame, degrees, allowed range. */
  fov: [number, number]
  /** How much of the angle down to the table the camera is turned through, 0–1. 0 keeps every vertical vertical. */
  tilt: number
  /** Half the table's width, tiles. */
  tableHalfWidth: number
  /** The table top's height over the ground, tiles. */
  tableTop: number
}

export interface View {
  /** The frame, pixels. */
  w: number
  h: number
  /** Focal length, pixels. */
  f: number
  /** The principal point, pixels, `y` down: where the lens axis meets the frame. */
  px: number
  py: number
  /** Radians the camera looks down by. */
  pitch: number
  /** The camera, world. */
  eye: V3
  /** The camera's axes, world, unit. */
  right: V3
  up: V3
  forward: V3
  /** The horizon's height in the frame, pixels, `y` down (may be off the frame). */
  horizonY: number
  /** The table's plane. */
  tableTop: number
  /** Where a world point lands, pixels, and its depth along the lens axis. Null behind the camera. */
  project(p: V3): [number, number, number] | null
  /** The felt's ellipse on the frame this view was solved to. */
  felt: FeltPx
  /** The unit ray through a pixel. */
  ray(x: number, y: number): V3
  /** Where the ray through a pixel meets the plane `y = plane`. Null when it never does (at or above the horizon). */
  onPlane(x: number, y: number, plane: number): V3 | null
  /** World tiles per frame pixel at this depth along the axis: what a line of one pixel is, there. */
  tileAt(depth: number): number
  /**
   * The felt's outline cast back onto the table's plane, `n` points, world,
   * counter-clockwise seen from above. `inset` takes both semi-axes in by that
   * many frame pixels first: an ellipse concentric with the felt, the kind
   * every line round the table is. Point `i` of every ring is at the same
   * angle, so rings can be lofted into one surface (`Kit.loft`).
   */
  tableOutline(n?: number, inset?: number): V3[]
}

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const deg = (d: number) => (d * Math.PI) / 180

/** The view for a lens of focal `f`, principal point `(px, py)`, pitch, eye. */
function makeView(w: number, h: number, f: number, px: number, py: number, pitch: number, eye: V3, tableTop: number, felt: FeltPx): View {
  const s = Math.sin(pitch)
  const c = Math.cos(pitch)
  const right: V3 = [1, 0, 0]
  const forward: V3 = [0, -s, -c]
  const up: V3 = [0, c, -s]
  const ray = (x: number, y: number): V3 => {
    const a = (x - px) / f
    const b = -(y - py) / f
    const d: V3 = [right[0] * a + up[0] * b + forward[0], right[1] * a + up[1] * b + forward[1], right[2] * a + up[2] * b + forward[2]]
    const l = Math.hypot(d[0], d[1], d[2])
    return [d[0] / l, d[1] / l, d[2] / l]
  }
  const onPlane = (x: number, y: number, plane: number): V3 | null => {
    const d = ray(x, y)
    if (d[1] > -1e-6) return null
    const t = (plane - eye[1]) / d[1]
    if (t <= 0) return null
    return [eye[0] + d[0] * t, plane, eye[2] + d[2] * t]
  }
  return {
    w,
    h,
    f,
    px,
    py,
    pitch,
    eye,
    right,
    up,
    forward,
    horizonY: py - f * Math.tan(pitch),
    tableTop,
    felt,
    project(p) {
      const v = sub(p, eye)
      const z = dot(v, forward)
      if (z <= 1e-6) return null
      return [px + (f * dot(v, right)) / z, py - (f * dot(v, up)) / z, z]
    },
    ray,
    onPlane,
    tileAt: (depth) => depth / f,
    tableOutline(n = 96, inset = 0) {
      const out: V3[] = []
      const rx = Math.max(1, felt.rx - inset)
      const ry = Math.max(1, felt.ry - inset)
      for (let i = 0; i < n; i++) {
        // Clockwise on screen (y down) is counter-clockwise seen from above.
        const t = (i / n) * Math.PI * 2
        const p = onPlane(felt.cx + Math.cos(t) * rx, felt.cy + Math.sin(t) * ry, tableTop)
        if (p) out.push(p)
      }
      return out
    },
  }
}

/**
 * The table's shape on the ground for a lens: its outline cast from an eye one
 * tile over the table's plane, and the extent of that outline — width, depth,
 * centre. Linear in the eye's height, so one cast serves every height.
 */
function castTable(w: number, h: number, f: number, px: number, py: number, pitch: number, felt: FeltPx) {
  const v = makeView(w, h, f, px, py, pitch, [0, 1, 0], 0, felt)
  const pts = v.tableOutline(64)
  if (pts.length < 64) return null
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const [x, , z] of pts) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x)
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z)
  }
  return { halfWidth: (maxX - minX) / 2, aspect: (maxZ - minZ) / (maxX - minX), cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 }
}

/**
 * The pitch and principal point for a lens of focal `f` with the horizon at
 * `horizonY`: the camera turned down through `tilt` of the angle to the felt's
 * centre, the principal point wherever that puts the horizon where it was asked.
 */
function aim(f: number, horizonY: number, felt: FeltPx, tilt: number): { pitch: number; py: number } {
  // The felt's centre is `delta` below the horizon, whatever the pitch: the
  // horizon is the ray at zero, and the angle between two rays through the
  // same lens does not care where the axis points — to first order. Iterated
  // a few times for the rest.
  let pitch = 0
  let py = horizonY
  for (let i = 0; i < 6; i++) {
    const delta = pitch + Math.atan((felt.cy - py) / f)
    pitch = tilt * delta
    py = horizonY + f * Math.tan(pitch)
  }
  return { pitch, py }
}

/**
 * Solves the camera to a frame and its felt: the focal length that puts the
 * horizon where `p.horizon` asks with a table of `p.aspect`, inside `p.fov`;
 * then the eye's height that makes the table `p.tableHalfWidth` wide, and its
 * position that puts the table's centre on the origin.
 */
export function solveView(w: number, h: number, felt: FeltPx, p: VistaParams): View {
  const fFor = (fovDeg: number) => w / 2 / Math.tan(deg(fovDeg) / 2)
  const fMin = fFor(p.fov[1])
  const fMax = fFor(p.fov[0])
  const feltTop = felt.cy - felt.ry
  // A horizon at or under the felt's top edge puts that edge at infinity.
  const horizonAt = (share: number) => Math.min(share * h, feltTop - 2)
  const aspectFor = (f: number, horizonY: number) => {
    const { pitch, py } = aim(f, horizonY, felt, p.tilt)
    return castTable(w, h, f, felt.cx, py, pitch, felt)?.aspect ?? Infinity
  }
  // With the horizon held, a longer lens deepens the table: the felt spans a
  // smaller angle, so the same screen height between its edges is a longer run
  // of ground. Bisect `f` for the aspect asked.
  let horizonY = horizonAt(p.horizon)
  let lo = fMin
  let hi = fMax
  const aLo = aspectFor(lo, horizonY)
  const aHi = aspectFor(hi, horizonY)
  let f: number
  if (aLo <= p.aspect && aHi >= p.aspect) {
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2
      if (aspectFor(mid, horizonY) < p.aspect) lo = mid
      else hi = mid
    }
    f = (lo + hi) / 2
  } else {
    // The range cannot hold both: the lens at the end nearer the answer, and
    // the horizon moved (bisected) until the table is the shape asked. A
    // higher horizon is a rounder table.
    f = aLo > p.aspect ? fMin : fMax
    const horizonFor = (aspect: number) => {
      let top = -h * 4
      let bottom = feltTop - 2
      if (aspectFor(f, top) > aspect) return top
      for (let i = 0; i < 40; i++) {
        const mid = (top + bottom) / 2
        if (aspectFor(f, mid) > aspect) bottom = mid
        else top = mid
      }
      return (top + bottom) / 2
    }
    horizonY = horizonFor(p.aspect)
    // A horizon pushed off the top of the frame is a room with no sky: the
    // table may deepen (up to `aspectMax`) to keep a strip of it.
    const floor = horizonAt(p.horizonMin)
    if (horizonY < floor) horizonY = aspectFor(f, floor) <= p.aspectMax ? floor : horizonFor(p.aspectMax)
  }
  const { pitch, py } = aim(f, horizonY, felt, p.tilt)
  const cast = castTable(w, h, f, felt.cx, py, pitch, felt)
  const unit = cast ?? { halfWidth: 1, cx: 0, cz: -4 }
  const height = p.tableHalfWidth / unit.halfWidth
  const eye: V3 = [-unit.cx * height, p.tableTop + height, -unit.cz * height]
  return makeView(w, h, f, felt.cx, py, pitch, eye, p.tableTop, felt)
}

/**
 * What `render.ts` builds a `PerspectiveCamera` from: the vertical field of a
 * frame centred on the principal point and large enough to hold this one, and
 * where this one sits in it (`setViewOffset`). A ratio, so the same numbers
 * serve the supersampled size.
 */
export function cameraSpec(v: View): { fov: number; fullW: number; fullH: number; offX: number; offY: number } {
  const fullW = 2 * Math.max(v.px, v.w - v.px)
  const fullH = 2 * Math.max(v.py, v.h - v.py)
  return {
    fov: (2 * Math.atan(fullH / 2 / v.f) * 180) / Math.PI,
    fullW,
    fullH,
    offX: fullW / 2 - v.px,
    offY: fullH / 2 - v.py,
  }
}
