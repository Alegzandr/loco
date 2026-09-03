/**
 * The prop kit: everything a diorama is built out of.
 *
 * A scene is a few thousand coloured blocks, and this file is the only thing
 * that knows how a block becomes triangles. Each map builder (`maps/*.ts`) calls
 * `box`, `cyl`, `sphere` and the props composed from them, and never touches
 * three.js itself; `build()` then merges everything into five meshes, one per
 * material, so a whole city is a handful of draw calls.
 *
 * Four decisions make it look like the rest of the UI rather than a tech demo:
 *
 * - **Every block carries an ink outline**, the same rule every raised object
 *   in `tokens.css` obeys. It is an inverted hull: for each block a slightly
 *   larger copy goes into the `ink` bucket and is drawn back-face only, so the
 *   rim that pokes past the block's silhouette is the line. Built per block
 *   rather than by pushing vertices along normals, because a box's faces do not
 *   share vertices and a per-vertex push leaves the corners open.
 * - **Colour is a vertex attribute, and so is the light.** One unlit material
 *   for every block, which is what lets the merge happen; the tone of each face
 *   (`shade.ts`: the top in the light, one side half-lit, the other in shade)
 *   is multiplied into the vertex colour as the block is pushed, from its
 *   normal. No light object, no shadow map: a gradient across a wall is a
 *   render, three flat tones are a drawing, and a toon ramp under a real light
 *   was a gradient cut into four.
 * - **Every outlined block throws a shadow on the ground**, a flat polygon in
 *   the `shadow` bucket (its corners slid along the sun and wrapped in a hull),
 *   drawn once through the stencil so two shadows overlapping stay one tone.
 * - **The weather is answered here, not in every builder**: `snow` puts a cap on
 *   every flat top, `wet` darkens and puddles the ground the builder asks for,
 *   `lampsOn` decides whether a lamp's head goes into the unlit `glow` bucket or
 *   the lit one. A builder says "this is a lamp"; the kit says what a lamp looks
 *   like tonight.
 *
 * Coordinates: x to the right, z towards the camera, y up. One unit is one tile.
 * Every `x, z` is the prop's centre on the ground and every `y` its bottom.
 */
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  EqualStencilFunc,
  Float32BufferAttribute,
  Group,
  IncrementStencilOp,
  KeepStencilOp,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  BackSide,
  AdditiveBlending,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Hex, LightRig } from './sky'
import { mix, scale } from './sky'
import type { Rng } from './rng'
import { shadeFor, shadowHull, shadowRun, SHADOW_PLANE_Y, type Shader } from './shade'
import { Placer, type Footprint } from './placer'
import type { ModelLib } from './models/lib'
import { hullFor, splitGlow } from './models/bake'

/**
 * Where the table is, in screen tiles: the centre of the felt's ellipse and its
 * semi-axes, `sy` up. `render.ts` solves it from the felt's place in the
 * viewport, and the podium is built under it.
 */
export interface Anchor {
  sx: number
  sy: number
  a: number
  b: number
}

export interface KitOptions {
  rig: LightRig
  rng: Rng
  /** Outline thickness in world units (solved from the render's pixel density). */
  outline: number
  anchor: Anchor
  /**
   * The frame, in screen tiles across and up, for a builder composing against
   * its edges (a route that starts off it). Absent for a sprite kit.
   */
  frame?: { w: number; h: number }
  /** Lay shadows on the ground. Off for a sprite of something in the air. */
  shadows?: boolean
  /** The loaded models this room may place (`k.model`). None for a sprite kit that needs none. */
  models?: ModelLib
}

export interface ModelOptions {
  /** Rotation about y, radians. */
  rot?: number
  /** Bottom, tiles. */
  y?: number
  /** Extra scale on top of the kit's. */
  scale?: number
  /** Claim the footprint with the placer, and refuse when it is taken. On by default. */
  collide?: boolean
  /** Grow the claimed footprint by this many tiles. */
  margin?: number
  shadow?: boolean
  outline?: boolean
}

export interface BlockOptions {
  /** Rotation around y, radians. */
  rot?: number
  /** Rotation around z, radians, applied before `rot`: a spoke, a leaning plank. */
  tilt?: number
  /** Unlit (a lamp head, a lit window, a neon tube). */
  glow?: boolean
  /** Skip the ink hull (thin details, things inside other things). */
  outline?: boolean
  /** Take a snow cap when it snows. On by default for anything with a flat top. */
  cap?: boolean
  /** Throw a shadow on the ground. On by default for every outlined, lit block. */
  shadow?: boolean
}

export const INK = 0x120b24
/** How much darker a wall is at its foot than at its top, 0–1. */
const GROUND_SHADE = 0.16
/**
 * A block's outline is a darker note of its own colour, never black. The
 * interface draws its ink in `INK` because a button is one object on a
 * plain ground; a city is ten thousand objects, and ten thousand black
 * rims on it read as wire rather than as drawing. An illustrated map
 * separates its shapes with a deeper tone of each fill, and so does this.
 */
export function inkFor(c: Hex): Hex {
  return mix(scale(c, 0.42), INK, 0.3)
}
const SNOW = 0xf4f7fb
const WINDOW_DARK = 0x1a2233
const WINDOW_GLOW = 0xffd98a

type Bucket = 'lit' | 'glow' | 'ink' | 'halo' | 'shadow'

const _color = new Color()
const _m = new Matrix4()
const _r = new Matrix4()

const warned = new Set<string>()
function missing(id: string) {
  if (warned.has(id)) return
  warned.add(id)
  console.warn(`kit: no model "${id}" in this room's library`)
}

export class Kit {
  readonly rig: LightRig
  readonly rng: Rng
  readonly outline: number
  readonly anchor: Anchor
  /** The frame in screen tiles, or a default wide enough for any builder to compose against. */
  readonly frame: { w: number; h: number }
  readonly shader: Shader
  /** The ground plan: every model placed, every zone claimed (`placer.ts`). */
  readonly placer = new Placer(0.35)
  private readonly models: ModelLib | null
  private readonly run: [number, number]
  private readonly shadows: boolean
  private buckets: Record<Bucket, BufferGeometry[]> = { lit: [], glow: [], ink: [], halo: [], shadow: [] }
  private haloAlphas: number[] = []
  /** Every pane on every wall, two sheets (`quad`). */
  private sheets: Record<'lit' | 'glow', { pos: number[]; nrm: number[]; col: number[]; idx: number[] }> = {
    lit: { pos: [], nrm: [], col: [], idx: [] },
    glow: { pos: [], nrm: [], col: [], idx: [] },
  }

  constructor(o: KitOptions) {
    this.rig = o.rig
    this.rng = o.rng
    this.outline = o.outline
    this.anchor = o.anchor
    this.frame = o.frame ?? { w: 80, h: 80 }
    this.shader = shadeFor(o.rig)
    this.run = shadowRun(o.rig)
    this.shadows = o.shadows ?? true
    this.models = o.models ?? null
  }

  // ─── Ground plan ──────────────────────────────────────────────────────────

  /** Claims ground nothing may be built on: the plaza, the water, a road. */
  claim(x: number, z: number, w: number, d: number, rot = 0) {
    this.placer.claim({ x, z, w, d, rot })
  }

  /** True when a footprint is free of everything placed and claimed so far. */
  free(x: number, z: number, w: number, d: number, rot = 0): boolean {
    return this.placer.free({ x, z, w, d, rot })
  }

  // ─── Models ───────────────────────────────────────────────────────────────

  /** True when this room's library holds the model. */
  has(id: string): boolean {
    return this.models?.has(id) ?? false
  }

  /** The footprint a model would take at `(x, z)`, or null for one this room does not have. */
  footprintOf(id: string, x: number, z: number, o: ModelOptions = {}): Footprint | null {
    const b = this.models?.get(id)
    if (!b) return null
    const s = o.scale ?? 1
    return { x, z, w: b.w * s + 2 * (o.margin ?? 0), d: b.d * s + 2 * (o.margin ?? 0), rot: o.rot ?? 0 }
  }

  /**
   * A loaded model, standing on `y` with its ground centre at `(x, z)`.
   *
   * Goes through the placer first: a footprint already taken is refused and
   * nothing is built, which is the answer a builder moves on from. Then the
   * same road every block takes — colours baked, tone of the hour multiplied
   * in, a shadow on the ground, an outline hull — with one difference: after
   * dark the faces painted in the kit's glow colours (lit windows, lamps,
   * signs) go to the unlit bucket in the warm glow every window here wears.
   * Returns whether it was placed.
   */
  model(id: string, x: number, z: number, o: ModelOptions = {}): boolean {
    const b = this.models?.get(id)
    if (!b) {
      if (import.meta.env.DEV) missing(id)
      return false
    }
    const fp = this.footprintOf(id, x, z, o)!
    if (o.collide !== false && !this.placer.place(fp)) return false
    const s = o.scale ?? 1
    const y = o.y ?? 0
    const rot = o.rot ?? 0
    const on = this.rig.lampsOn
    const { lit, glow } = on ? splitGlow(b) : { lit: b.index, glow: null }

    const make = (position: Float32Array, index: Uint32Array | null, color?: Float32Array) => {
      const g = new BufferGeometry()
      g.setAttribute('position', new Float32BufferAttribute(position, 3))
      g.setAttribute('normal', new Float32BufferAttribute(b.normal, 3))
      if (color) g.setAttribute('color', new Float32BufferAttribute(color, 3))
      g.setIndex(new BufferAttribute(index ?? b.index, 1))
      _m.makeTranslation(x, y, z)
      if (rot) _m.multiply(_r.makeRotationY(rot))
      if (s !== 1) _m.multiply(_r.makeScale(s, s, s))
      g.applyMatrix4(_m)
      return g
    }

    const body = make(b.position, lit, b.color)
    if (o.shadow !== false) this.shadowOf(body, { outline: o.outline })
    this.pushBaked(body, 'lit')
    if (glow && glow.length) {
      const g = make(b.position, glow)
      this.push(g, WINDOW_GLOW, 'glow')
    }
    if (o.outline !== false) {
      // The hull is the model pushed along its smoothed normals, in model
      // units: the outline is world units, so divide by the scale it will get.
      const hull = make(hullFor(b, this.outline / s), null, b.color)
      this.pushBaked(hull, 'ink')
    }
    return true
  }

  /**
   * A geometry that carries its own base colours. In the lit bucket each is
   * multiplied by the tone of its face and the ground shade like a block's
   * single colour is; in the ink bucket each becomes its own darker note.
   */
  private pushBaked(geom: BufferGeometry, bucket: 'lit' | 'ink') {
    if (!geom.index) throw new Error('kit: every geometry must be indexed, or the bucket will not merge')
    const col = geom.getAttribute('color')
    const n = col.count
    const arr = new Float32Array(n * 3)
    if (bucket === 'lit') {
      const nrm = geom.getAttribute('normal')
      const pos = geom.getAttribute('position')
      let lo = Infinity
      let hi = -Infinity
      for (let i = 0; i < n; i++) {
        const yy = pos.getY(i)
        if (yy < lo) lo = yy
        if (yy > hi) hi = yy
      }
      const span = hi - lo
      for (let i = 0; i < n; i++) {
        const ny = nrm.getY(i)
        const t = this.shader.tone(nrm.getX(i), ny, nrm.getZ(i))
        const k = span > 0.6 && Math.abs(ny) < 0.6 ? 1 - GROUND_SHADE * (1 - (pos.getY(i) - lo) / span) : 1
        arr[i * 3] = col.getX(i) * t[0] * k
        arr[i * 3 + 1] = col.getY(i) * t[1] * k
        arr[i * 3 + 2] = col.getZ(i) * t[2] * k
      }
    } else {
      for (let i = 0; i < n; i++) {
        _color.setRGB(col.getX(i), col.getY(i), col.getZ(i))
        _color.setHex(inkFor(_color.getHex()))
        arr[i * 3] = _color.r
        arr[i * 3 + 1] = _color.g
        arr[i * 3 + 2] = _color.b
      }
    }
    geom.setAttribute('color', new Float32BufferAttribute(arr, 3))
    this.buckets[bucket].push(geom)
  }

  // ─── Weather-aware colours ────────────────────────────────────────────────

  /** A ground colour, as tonight leaves it: white under snow, dark and cool when wet. */
  ground(c: Hex): Hex {
    if (this.rig.snow) return mix(c, SNOW, 0.85)
    if (this.rig.wet) return mix(scale(c, 0.72), 0x2a3550, 0.25)
    return c
  }

  /** A roof or any flat top: capped white when it snows, otherwise itself. */
  top(c: Hex): Hex {
    return this.rig.snow ? mix(c, SNOW, 0.9) : c
  }

  /** Foliage: bare-ish and frosted under snow. */
  leaf(c: Hex): Hex {
    return this.rig.snow ? mix(c, 0xdfe7ee, 0.55) : c
  }

  // ─── Primitives ───────────────────────────────────────────────────────────

  private push(geom: BufferGeometry, color: Hex, bucket: Bucket) {
    geom.deleteAttribute('uv')
    if (!geom.index) throw new Error('kit: every geometry must be indexed, or the bucket will not merge')
    const n = geom.getAttribute('position').count
    const arr = new Float32Array(n * 3)
    _color.setHex(color)
    if (bucket === 'lit') {
      // The light, baked: each vertex's colour is the block's times the tone of
      // the face it belongs to. Every primitive here has flat normals, so a
      // face is one tone edge to edge — except that a wall darkens towards its
      // foot (`GROUND_SHADE`), which is what an illustrator does to sit a
      // building on the ground, and what vertex interpolation gives for free.
      const nrm = geom.getAttribute('normal')
      const pos = geom.getAttribute('position')
      let lo = Infinity
      let hi = -Infinity
      for (let i = 0; i < n; i++) {
        const y = pos.getY(i)
        if (y < lo) lo = y
        if (y > hi) hi = y
      }
      const span = hi - lo
      for (let i = 0; i < n; i++) {
        const ny = nrm.getY(i)
        const t = this.shader.tone(nrm.getX(i), ny, nrm.getZ(i))
        // Only the sides, only on something tall enough to have a foot.
        const k = span > 0.6 && Math.abs(ny) < 0.6 ? 1 - GROUND_SHADE * (1 - (pos.getY(i) - lo) / span) : 1
        arr[i * 3] = _color.r * t[0] * k
        arr[i * 3 + 1] = _color.g * t[1] * k
        arr[i * 3 + 2] = _color.b * t[2] * k
      }
    } else {
      for (let i = 0; i < n; i++) {
        arr[i * 3] = _color.r
        arr[i * 3 + 1] = _color.g
        arr[i * 3 + 2] = _color.b
      }
    }
    geom.setAttribute('color', new Float32BufferAttribute(arr, 3))
    this.buckets[bucket].push(geom)
  }

  /**
   * One matrix, one pass over the vertices. `rotateZ` + `rotateY` + `translate`
   * were three passes each with a normal-matrix update, on fifteen thousand
   * blocks a room.
   */
  private place(geom: BufferGeometry, x: number, y: number, z: number, rot = 0, tilt = 0) {
    _m.makeTranslation(x, y, z)
    if (rot) _m.multiply(_r.makeRotationY(rot))
    if (tilt) _m.multiply(_r.makeRotationZ(tilt))
    geom.applyMatrix4(_m)
    return geom
  }

  /**
   * The shadow of a placed solid, on the ground beside it. Whether a block
   * throws one follows whether it is outlined: the two together are what says
   * "this is an object" rather than "this is a surface".
   */
  private shadowOf(geom: BufferGeometry, o: BlockOptions) {
    if (!this.shadows || o.shadow === false || o.outline === false || o.glow) return
    const pos = geom.getAttribute('position')
    const pts: [number, number, number][] = []
    for (let i = 0; i < pos.count; i++) pts.push([pos.getX(i), pos.getY(i), pos.getZ(i)])
    const hull = shadowHull(pts, this.run)
    if (!hull) return
    const flat = new Float32Array(hull.length * 3)
    for (let i = 0; i < hull.length; i++) {
      flat[i * 3] = hull[i][0]
      flat[i * 3 + 1] = SHADOW_PLANE_Y
      flat[i * 3 + 2] = hull[i][1]
    }
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(flat, 3))
    const idx: number[] = []
    for (let i = 1; i + 1 < hull.length; i++) idx.push(0, i, i + 1)
    g.setIndex(idx)
    this.buckets.shadow.push(g)
  }

  /** A block. `y` is its bottom, `x`/`z` its centre. */
  box(x: number, y: number, z: number, w: number, h: number, d: number, color: Hex, o: BlockOptions = {}) {
    const bucket: Bucket = o.glow ? 'glow' : 'lit'
    // A tilted block is placed by its centre, an upright one by its bottom.
    const cy = o.tilt ? y : y + h / 2
    const body = this.place(boxGeometry(w, h, d), x, cy, z, o.rot, o.tilt)
    this.shadowOf(body, o)
    this.push(body, color, bucket)
    if (o.outline !== false) {
      const t = this.outline
      this.push(this.place(boxGeometry(w + 2 * t, h + 2 * t, d + 2 * t), x, cy, z, o.rot, o.tilt), inkFor(color), 'ink')
    }
    if (this.rig.snow && o.cap !== false && !o.glow && !o.tilt && h > 0.12 && w > 0.25 && d > 0.25) {
      const capH = Math.min(0.16, 0.06 + Math.min(w, d) * 0.04)
      this.push(this.place(boxGeometry(w * 0.98, capH, d * 0.98), x, y + h + capH / 2 - 0.01, z, o.rot), SNOW, 'lit')
    }
  }

  /** A vertical cylinder. `rTop` defaults to `r`; give 0 for a cone. */
  cyl(x: number, y: number, z: number, r: number, h: number, color: Hex, o: BlockOptions & { rTop?: number; seg?: number; axis?: 'x' | 'z' } = {}) {
    const rTop = o.rTop ?? r
    const seg = o.seg ?? 10
    const bucket: Bucket = o.glow ? 'glow' : 'lit'
    const make = (rt: number, rb: number, hh: number) => {
      const g = cylinderGeometry(rt, rb, hh, seg)
      if (o.axis === 'x') g.rotateZ(Math.PI / 2)
      else if (o.axis === 'z') g.rotateX(Math.PI / 2)
      return g
    }
    const cy = o.axis ? y : y + h / 2
    const body = this.place(make(rTop, r, h), x, cy, z, o.rot)
    this.shadowOf(body, o)
    this.push(body, color, bucket)
    if (o.outline !== false) {
      const t = this.outline
      this.push(this.place(make(rTop + t, r + t, h + 2 * t), x, cy, z, o.rot), inkFor(color), 'ink')
    }
    if (this.rig.snow && o.cap !== false && !o.glow && !o.axis && rTop > 0.2) {
      this.push(this.place(new CylinderGeometry(rTop * 0.97, rTop * 0.97, 0.1, seg), x, y + h + 0.04, z), SNOW, 'lit')
    }
  }

  /**
   * An elliptical drum: semi-axes `a` along x and `b` along z before `rot`.
   * What the podium under the table is made of, since a screen ellipse is a
   * ground ellipse and never a ground circle.
   */
  oval(x: number, y: number, z: number, a: number, b: number, h: number, color: Hex, o: BlockOptions & { seg?: number } = {}) {
    const seg = o.seg ?? 48
    const bucket: Bucket = o.glow ? 'glow' : 'lit'
    const make = (ra: number, rb: number, hh: number) => {
      const g = new CylinderGeometry(1, 1, hh, seg)
      g.scale(ra, 1, rb)
      return g
    }
    const body = this.place(make(a, b, h), x, y + h / 2, z, o.rot)
    this.shadowOf(body, o)
    this.push(body, color, bucket)
    if (o.outline !== false) {
      const t = this.outline
      this.push(this.place(make(a + t, b + t, h + 2 * t), x, y + h / 2, z, o.rot), inkFor(color), 'ink')
    }
    if (this.rig.snow && o.cap !== false && !o.glow) {
      this.push(this.place(make(a * 0.98, b * 0.98, 0.1), x, y + h + 0.04, z, o.rot), SNOW, 'lit')
    }
  }

  cone(x: number, y: number, z: number, r: number, h: number, color: Hex, o: BlockOptions & { seg?: number } = {}) {
    const seg = o.seg ?? 4
    const bucket: Bucket = o.glow ? 'glow' : 'lit'
    const body = this.place(coneGeometry(r, h, seg), x, y + h / 2, z, o.rot ?? Math.PI / 4)
    this.shadowOf(body, o)
    this.push(body, this.rig.snow && o.cap !== false ? mix(color, SNOW, 0.6) : color, bucket)
    if (o.outline !== false) {
      const t = this.outline
      this.push(this.place(coneGeometry(r + t, h + 2 * t, seg), x, y + h / 2, z, o.rot ?? Math.PI / 4), inkFor(color), 'ink')
    }
  }

  sphere(x: number, y: number, z: number, r: number, color: Hex, o: BlockOptions & { seg?: number } = {}) {
    const seg = o.seg ?? 8
    const bucket: Bucket = o.glow ? 'glow' : 'lit'
    const body = this.place(sphereGeometry(r, seg), x, y, z)
    this.shadowOf(body, o)
    this.push(body, color, bucket)
    if (o.outline !== false) {
      this.push(this.place(sphereGeometry(r + this.outline, seg), x, y, z), inkFor(color), 'ink')
    }
  }

  /** A gabled roof: a triangular prism with its ridge along x, `y` its eave. */
  prism(x: number, y: number, z: number, w: number, h: number, d: number, color: Hex, o: BlockOptions = {}) {
    const bucket: Bucket = o.glow ? 'glow' : 'lit'
    const c = this.rig.snow && o.cap !== false ? mix(color, SNOW, 0.75) : color
    const body = this.place(prismGeometry(w, h, d), x, y, z, o.rot)
    this.shadowOf(body, o)
    this.push(body, c, bucket)
    if (o.outline !== false) {
      const t = this.outline
      this.push(this.place(prismGeometry(w + 2 * t, h + 2 * t, d + 2 * t), x, y - t, z, o.rot), inkFor(color), 'ink')
    }
  }

  /** A flat disc on the ground (a rug, a pad marking, a puddle). Never outlined. */
  disc(x: number, y: number, z: number, r: number, color: Hex, o: { glow?: boolean; seg?: number } = {}) {
    this.push(this.place(new CylinderGeometry(r, r, 0.04, o.seg ?? 16), x, y + 0.02, z), color, o.glow ? 'glow' : 'lit')
  }

  /**
   * A pool of light: an additive translucent disc, drawn flat on the ground or
   * as a sprite-ish sphere around a lamp head. Only when the lamps are on.
   */
  halo(x: number, y: number, z: number, r: number, color: Hex, alpha = 0.35, flat = true) {
    if (!this.rig.lampsOn) return
    const g = flat ? new CylinderGeometry(r, r, 0.02, 16) : new SphereGeometry(r, 10, 8)
    this.push(this.place(g, x, flat ? y + 0.03 : y, z), color, 'halo')
    this.haloAlphas.push(alpha)
  }

  // ─── Props ────────────────────────────────────────────────────────────────

  /** A flat slab: paving, a road, a deck. Receives shadows, casts none. */
  slab(x: number, z: number, w: number, d: number, color: Hex, o: { y?: number; h?: number; outline?: boolean; rot?: number } = {}) {
    this.box(x, o.y ?? 0, z, w, o.h ?? 0.08, d, color, { outline: o.outline ?? false, cap: false, rot: o.rot })
  }

  /** The ground under everything, sized to run past every edge of the view. */
  floor(color: Hex, size = 96, y = -1) {
    this.box(0, y, 0, size, 1, size, this.ground(color), { outline: false, cap: false })
    if (this.rig.snow) this.box(0, 0, 0, size, 0.02, size, SNOW, { outline: false, cap: false })
  }

  /** Puddles, where the builder says the ground is open. Only when wet. */
  puddles(x: number, z: number, radius: number, count: number) {
    if (!this.rig.wet) return
    for (let i = 0; i < count; i++) {
      const a = this.rng.next() * Math.PI * 2
      const rr = Math.sqrt(this.rng.next()) * radius
      const px = x + Math.cos(a) * rr
      const pz = z + Math.sin(a) * rr
      const r = this.rng.range(0.4, 1.1)
      this.push(this.place(new CylinderGeometry(r, r * 0.8, 0.02, 12), px, 0.05, pz), mix(this.rig.sky.horizon, 0xffffff, 0.1), 'halo')
      this.haloAlphas.push(0.28)
    }
  }

  /**
   * A window on a wall, lit or dark for tonight: a pale frame a hair proud of
   * the wall, the pane set into it, a sill under it. The frame is what makes
   * a grid of rectangles read as windows rather than as a pattern painted on
   * the block, and the sill is the one horizontal a façade of them needs.
   */
  window(x: number, y: number, z: number, w: number, h: number, facing: 'x' | 'z', color = WINDOW_GLOW, o: { frame?: Hex; sill?: boolean; rot?: number } = {}) {
    const lit = this.rng.chance(this.rig.windowsLit)
    const frame = o.frame ?? 0xf4efe6
    const pane = lit ? color : WINDOW_DARK
    const fw = w + 0.16
    const fh = h + 0.14
    // Two quads on the wall, not two blocks: a window is the one prop a room
    // has ten thousand of, and every one of them goes into a single sheet per
    // bucket (`quad`, flushed by `build`).
    this.quad(x, y + h / 2, z, fw, fh, facing, o.rot ?? 0, frame, false, 0.01)
    this.quad(x, y + h / 2, z, w, h, facing, o.rot ?? 0, pane, lit, 0.03)
    if (o.sill !== false) {
      if (facing === 'x') this.box(x + 0.05, y - 0.12, z, 0.14, 0.07, fw + 0.1, scale(frame, 0.9), { rot: o.rot, outline: false, cap: false })
      else this.box(x, y - 0.12, z + 0.05, fw + 0.1, 0.07, 0.14, scale(frame, 0.9), { rot: o.rot, outline: false, cap: false })
    }
  }

  /**
   * A flat rectangle on a wall, `facing` +x or +z at rot 0, centred on
   * `(x, y, z)` and pushed `out` along its normal. Appended to one of two
   * sheets — lit, or glowing — that `build` turns into a single geometry each,
   * so a city's worth of panes is two draw calls' worth of triangles rather
   * than twenty thousand boxes' worth of allocations.
   */
  private quad(x: number, y: number, z: number, w: number, h: number, facing: 'x' | 'z', rot: number, color: Hex, glow: boolean, out: number) {
    const sheet = glow ? this.sheets.glow : this.sheets.lit
    const c = Math.cos(rot)
    const s = Math.sin(rot)
    // Local axes: `u` across the face, `n` its normal, both rotated by `rot`
    // about y the way `rotateY` sends +x to (cos, 0, −sin) and +z to (sin, 0, cos).
    const [ux, uz, nx, nz] = facing === 'z' ? [c, -s, s, c] : [s, c, c, -s]
    const cx = x + nx * out
    const cz = z + nz * out
    const hw = w / 2
    const hh = h / 2
    const base = sheet.pos.length / 3
    for (const [du, dv] of [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]] as const) {
      sheet.pos.push(cx + ux * du, y + dv, cz + uz * du)
      sheet.nrm.push(nx, 0, nz)
    }
    _color.setHex(color)
    const t = glow ? [1, 1, 1] : this.shader.tone(nx, 0, nz)
    for (let i = 0; i < 4; i++) sheet.col.push(_color.r * t[0], _color.g * t[1], _color.b * t[2])
    sheet.idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }

  private flushSheets() {
    for (const bucket of ['lit', 'glow'] as const) {
      const s = this.sheets[bucket]
      if (s.idx.length === 0) continue
      const g = new BufferGeometry()
      g.setAttribute('position', new Float32BufferAttribute(s.pos, 3))
      g.setAttribute('normal', new Float32BufferAttribute(s.nrm, 3))
      g.setAttribute('color', new Float32BufferAttribute(s.col, 3))
      g.setIndex(s.idx)
      this.buckets[bucket].push(g)
      this.sheets[bucket] = { pos: [], nrm: [], col: [], idx: [] }
    }
  }

  /** A door in a wall facing +z at rot 0: a dark leaf in a frame, with a step. */
  door(x: number, y: number, z: number, w: number, h: number, color: Hex, o: { rot?: number; frame?: Hex; facing?: 'x' | 'z' } = {}) {
    const frame = o.frame ?? 0xf4efe6
    if (o.facing === 'x') {
      this.box(x, y, z, 0.06, h + 0.12, w + 0.18, frame, { rot: o.rot, outline: false, cap: false })
      this.box(x + 0.04, y, z, 0.06, h, w, color, { rot: o.rot, outline: false, cap: false })
      this.box(x + 0.16, y, z, 0.3, 0.1, w + 0.4, scale(frame, 0.85), { rot: o.rot, outline: false, cap: false })
    } else {
      this.box(x, y, z, w + 0.18, h + 0.12, 0.06, frame, { rot: o.rot, outline: false, cap: false })
      this.box(x, y, z + 0.04, w, h, 0.06, color, { rot: o.rot, outline: false, cap: false })
      this.box(x, y, z + 0.16, w + 0.4, 0.1, 0.3, scale(frame, 0.85), { rot: o.rot, outline: false, cap: false })
    }
  }

  /**
   * A building: walls, a grid of windows on the two faces the camera sees, a
   * door at the foot of the front, a line at every floor, and a roof of the
   * builder's choice with something standing on it. `x, z` centre, `w, d`
   * footprint, `h` height.
   */
  tower(x: number, z: number, w: number, h: number, d: number, color: Hex, o: {
    windowColor?: Hex
    floorH?: number
    roof?: 'flat' | 'gable' | 'hip' | 'none'
    roofColor?: Hex
    trim?: Hex
    windows?: boolean
    /** A door on the +z face. On by default at ground level. */
    door?: boolean
    /** A line at each floor, a shade darker than the wall. On by default. */
    bands?: boolean
    /** Rooftop furniture on a flat roof. On by default. */
    furniture?: boolean
    y?: number
  } = {}) {
    const y = o.y ?? 0
    this.box(x, y, z, w, h, d, color)
    const floorH = o.floorH ?? 1.25
    const frame = mix(color, 0xffffff, 0.55)
    if (o.windows !== false) {
      const rows = Math.floor((h - 0.7) / floorH)
      for (let r = 0; r < rows; r++) {
        const wy = y + 0.55 + r * floorH
        const cols = Math.max(1, Math.floor(d / 1.15))
        // No sill on a tower's windows: at this size the frame is the whole
        // drawing, and a third block per window is a third of the city.
        for (let c = 0; c < cols; c++) {
          const wz = z - d / 2 + (c + 0.5) * (d / cols)
          this.window(x + w / 2 + 0.02, wy, wz, 0.5, 0.62, 'x', o.windowColor, { frame, sill: false })
        }
        const cols2 = Math.max(1, Math.floor(w / 1.15))
        for (let c = 0; c < cols2; c++) {
          const wx = x - w / 2 + (c + 0.5) * (w / cols2)
          // The door takes the middle of the ground floor.
          if (r === 0 && o.door !== false && y === 0 && Math.abs(wx - x) < w / cols2 / 2) continue
          this.window(wx, wy, z + d / 2 + 0.02, 0.5, 0.62, 'z', o.windowColor, { frame, sill: false })
        }
      }
      if (o.bands !== false) {
        for (let r = 1; r < rows; r++) {
          const by = y + r * floorH + 0.1
          this.box(x, by, z, w + 0.06, 0.06, d + 0.06, scale(color, 0.86), { outline: false, cap: false })
        }
      }
    }
    if (o.door !== false && y === 0) this.door(x, 0, z + d / 2 + 0.02, 0.7, 1.15, scale(color, 0.45), { frame })
    if (o.trim !== undefined) {
      this.box(x, y + h - 0.18, z, w + 0.16, 0.2, d + 0.16, o.trim)
    }
    const roof = o.roof ?? 'flat'
    const rc = o.roofColor ?? scale(color, 0.75)
    if (roof === 'gable') this.prism(x, y + h, z, w + 0.3, Math.min(w, d) * 0.5, d + 0.3, rc)
    else if (roof === 'hip') this.cone(x, y + h, z, Math.max(w, d) * 0.72, Math.min(w, d) * 0.5, rc, { seg: 4 })
    else if (roof === 'flat') {
      this.box(x, y + h, z, w + 0.1, 0.14, d + 0.1, this.top(rc))
      // A parapet round the edge, and something on the roof: a tank, a vent,
      // an aerial. A flat roof with nothing on it is a lid.
      this.box(x, y + h + 0.14, z, w + 0.1, 0.22, 0.12, scale(rc, 0.9), { outline: false, cap: false })
      this.box(x, y + h + 0.14, z - d / 2, w + 0.1, 0.22, 0.12, scale(rc, 0.9), { outline: false, cap: false })
      if (o.furniture !== false && w > 2.4 && d > 2.4) {
        const pick = this.rng.next()
        const rx = x - w / 2 + this.rng.range(0.9, Math.max(1, w - 0.9))
        const rz = z - d / 2 + this.rng.range(0.9, Math.max(1, d - 0.9))
        if (pick < 0.35) {
          this.box(rx, y + h + 0.14, rz, 1.1, 0.7, 0.9, 0x9aa3b5)
          this.cyl(rx + 0.3, y + h + 0.84, rz - 0.2, 0.22, 0.12, 0x5a606d, { seg: 8, outline: false, cap: false })
        } else if (pick < 0.65) {
          this.cyl(rx, y + h + 0.14, rz, 0.5, 1.1, 0x8a6a45, { seg: 8 })
          this.cone(rx, y + h + 1.24, rz, 0.58, 0.3, scale(0x8a6a45, 0.8), { seg: 8 })
        } else {
          this.cyl(rx, y + h + 0.14, rz, 0.05, 1.4, 0x5a606d, { seg: 4, outline: false, cap: false })
          this.box(rx, y + h + 1.3, rz, 0.7, 0.05, 0.05, 0x5a606d, { outline: false, cap: false })
        }
      }
    }
  }

  /** A street lamp. Lit tonight or not, decided by the rig. */
  lamp(x: number, z: number, o: { h?: number; color?: Hex; post?: Hex; heads?: 1 | 2; style?: 'globe' | 'box' | 'lantern' } = {}) {
    // A drawn street light where the room has one; the pool of light is ours.
    if (this.models?.has('roads/light-curved') && o.style !== 'lantern') {
      const id = o.heads === 2 ? 'roads/light-curved-double' : 'roads/light-curved'
      if (this.model(id, x, z, { rot: this.rng.range(0, Math.PI * 2), margin: 0.1 })) {
        if (this.rig.lampsOn) this.halo(x, 0, z, 1.8, o.color ?? 0xffe1a1, 0.22)
        return
      }
    }
    const h = o.h ?? 2.6
    const post = o.post ?? 0x2a2f3a
    const glow = o.color ?? 0xffe1a1
    const on = this.rig.lampsOn
    this.cyl(x, 0, z, 0.16, 0.25, post, { seg: 6 })
    this.cyl(x, 0.25, z, 0.07, h - 0.25, post, { seg: 6, outline: true, cap: false })
    const heads = o.heads ?? 1
    for (let i = 0; i < heads; i++) {
      const hx = heads === 2 ? x + (i === 0 ? -0.4 : 0.4) : x
      if (heads === 2) this.box(x, h - 0.05, z, 0.9, 0.06, 0.06, post, { outline: false })
      if (o.style === 'lantern') {
        this.box(hx, h - 0.1, z, 0.34, 0.4, 0.34, on ? glow : 0x3b3f4a, { glow: on, cap: false })
        this.cone(hx, h + 0.3, z, 0.3, 0.2, post, { cap: false })
      } else if (o.style === 'box') {
        this.box(hx, h - 0.12, z, 0.5, 0.2, 0.3, on ? glow : 0x3b3f4a, { glow: on, cap: false })
      } else {
        this.sphere(hx, h + 0.1, z, 0.24, on ? glow : 0x505662, { glow: on, seg: 8 })
      }
      if (on) {
        this.halo(hx, h + 0.1, z, 0.55, glow, 0.35, false)
        this.halo(hx, 0, z, 1.8, glow, 0.22)
      }
    }
  }

  /** A tree. Four kinds, one silhouette each. */
  tree(x: number, z: number, o: { kind?: 'round' | 'pine' | 'sakura' | 'palm'; h?: number; r?: number; leaf?: Hex; trunk?: Hex } = {}) {
    // A drawn tree where the room has one. The cherry stays ours: no kit here
    // has a pink crown, and it is what the village is.
    const kindId = o.kind ?? 'round'
    if (kindId !== 'sakura' && this.models?.has('nature/tree_default')) {
      const pool =
        kindId === 'pine'
          ? ['nature/tree_pineDefaultA', 'nature/tree_pineRoundA', 'nature/tree_pineTallA', 'nature/tree_pineSmallA']
          : kindId === 'palm'
            ? ['nature/tree_palm', 'nature/tree_palmBend', 'nature/tree_palmDetailedTall', 'nature/tree_palmDetailedShort']
            : ['nature/tree_default', 'nature/tree_oak', 'nature/tree_fat', 'nature/tree_detailed', 'nature/tree_tall', 'nature/tree_simple', 'nature/tree_plateau']
      const scale = ((o.h ?? 1.6) / 1.6) * (o.r ? o.r / 0.9 : 1) * 0.55 + 0.45
      if (this.model(this.rng.pick(pool), x, z, { rot: this.rng.range(0, Math.PI * 2), scale, margin: -0.4 })) return
    }
    const kind = o.kind ?? 'round'
    const trunk = o.trunk ?? 0x6b4a2b
    const h = o.h ?? 1.6
    const r = o.r ?? 0.9
    if (kind === 'pine') {
      const leaf = this.leaf(o.leaf ?? 0x2f8f56)
      this.cyl(x, 0, z, 0.14, h * 0.5, trunk, { seg: 6, cap: false })
      this.cone(x, h * 0.35, z, r, h * 0.9, leaf, { seg: 6 })
      this.cone(x, h * 0.85, z, r * 0.75, h * 0.75, scale(leaf, 1.1), { seg: 6 })
      this.cone(x, h * 1.3, z, r * 0.5, h * 0.6, scale(leaf, 1.2), { seg: 6 })
      return
    }
    if (kind === 'palm') {
      // A frond in two segments, out and then steeply down, and longer on
      // alternate ones. A crown of five flat planks draws a five-pointed star,
      // and a star is exactly what this camera sees of anything horizontal: the
      // palms read as green asterisks lying on the sand.
      const leaf = this.leaf(o.leaf ?? 0x3fae5a)
      const crown = h * 1.4
      this.cyl(x, 0, z, 0.12, crown, trunk, { seg: 6, rTop: 0.09, cap: false })
      this.sphere(x, crown + 0.04, z, 0.17, scale(trunk, 1.15), { seg: 6, outline: false })
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.35
        const [dx, dz] = [Math.cos(a), Math.sin(a)]
        const reach = i % 2 ? 1.0 : 0.82
        this.box(x + dx * 0.4 * reach, crown + 0.08, z + dz * 0.4 * reach, 0.8 * reach, 0.09, 0.28, leaf, { rot: -a, tilt: 0.24, cap: false, outline: false })
        this.box(x + dx * 1.1 * reach, crown - 0.34, z + dz * 1.1 * reach, 0.95 * reach, 0.08, 0.2, scale(leaf, 0.88), { rot: -a, tilt: -0.95, cap: false, outline: false })
      }
      return
    }
    // A round crown is a cluster: one big ball, three around it, a lighter
    // one on top catching the light. Three balls read as a bunch of grapes;
    // five with a highlight read as a tree.
    const leaf = this.leaf(o.leaf ?? (kind === 'sakura' ? 0xf5a3c7 : 0x4bb35d))
    this.cyl(x, 0, z, 0.14, h, trunk, { seg: 6, rTop: 0.11, cap: false })
    this.sphere(x, h + r * 0.75, z, r, leaf, { seg: 9 })
    this.sphere(x + r * 0.5, h + r * 0.55, z + r * 0.3, r * 0.65, scale(leaf, 1.06), { seg: 7 })
    this.sphere(x - r * 0.5, h + r * 0.6, z - r * 0.2, r * 0.6, scale(leaf, 0.94), { seg: 7 })
    this.sphere(x - r * 0.1, h + r * 0.5, z + r * 0.55, r * 0.55, scale(leaf, 1.0), { seg: 7 })
    this.sphere(x + r * 0.15, h + r * 1.25, z - r * 0.1, r * 0.6, mix(leaf, 0xffffff, 0.16), { seg: 7 })
    if (kind === 'sakura' && !this.rig.snow) {
      for (let i = 0; i < 3; i++) this.sphere(x + this.rng.range(-r, r), h + r * 0.3 + this.rng.range(0, r), z + this.rng.range(-r, r), 0.12, 0xffffff, { seg: 4, outline: false })
    }
    if (this.rig.snow) this.sphere(x, h + r * 1.2, z, r * 0.7, SNOW, { seg: 7, outline: false })
  }

  bush(x: number, z: number, r = 0.5, color = 0x3f9e52, o: { berries?: Hex } = {}) {
    if (this.models?.has('nature/plant_bush')) {
      const pool = ['nature/plant_bush', 'nature/plant_bushDetailed', 'nature/plant_bushLarge', 'nature/plant_bushSmall']
      if (this.model(this.rng.pick(pool), x, z, { rot: this.rng.range(0, Math.PI * 2), scale: 0.6 + r, margin: -0.3 })) return
    }
    const c = this.leaf(color)
    this.sphere(x, r * 0.7, z, r, c, { seg: 7 })
    this.sphere(x + r * 0.6, r * 0.5, z + r * 0.2, r * 0.7, scale(c, 1.1), { seg: 6 })
    this.sphere(x - r * 0.5, r * 0.55, z - r * 0.3, r * 0.55, scale(c, 0.95), { seg: 6 })
    if (o.berries !== undefined && !this.rig.snow) {
      for (let i = 0; i < 4; i++) this.sphere(x + this.rng.range(-r, r) * 0.8, r * 0.7 + this.rng.range(0, r * 0.6), z + this.rng.range(-r, r) * 0.8, 0.08, o.berries, { seg: 4, outline: false })
    }
  }

  /**
   * A bed of flowers: a low kerb of earth and a scatter of coloured heads
   * on it. The cheapest thing that makes a block of ground look tended.
   */
  flowerbed(x: number, z: number, w: number, d: number, o: { colors?: readonly Hex[]; kerb?: Hex; rot?: number } = {}) {
    const colors = o.colors ?? [0xff5a3c, 0xffc93c, 0xff8fb8, 0xffffff, 0xc56bff]
    const kerb = o.kerb ?? 0x9a8f80
    this.box(x, 0, z, w, 0.22, d, kerb, { rot: o.rot })
    this.box(x, 0.22, z, w - 0.2, 0.08, d - 0.2, this.ground(0x5b3d2a), { rot: o.rot, outline: false, cap: false })
    if (this.rig.snow) return
    const n = Math.round(w * d * 1.6)
    const rot = o.rot ?? 0
    for (let i = 0; i < n; i++) {
      const lx = this.rng.range(-w / 2 + 0.25, w / 2 - 0.25)
      const lz = this.rng.range(-d / 2 + 0.25, d / 2 - 0.25)
      const px = x + lx * Math.cos(rot) + lz * Math.sin(rot)
      const pz = z - lx * Math.sin(rot) + lz * Math.cos(rot)
      this.sphere(px, 0.42, pz, 0.12, this.leaf(0x4bb35d), { seg: 4, outline: false })
      this.sphere(px, 0.58, pz, 0.11, this.rng.pick(colors), { seg: 5, outline: false })
    }
  }

  /** A pot with a shrub in it, for a doorstep or a sidewalk. */
  planter(x: number, z: number, o: { pot?: Hex; leaf?: Hex; r?: number } = {}) {
    const r = o.r ?? 0.32
    this.cyl(x, 0, z, r, r * 1.1, o.pot ?? 0xc0623a, { seg: 8, rTop: r * 1.1, cap: false })
    this.bush(x, z, r * 0.9, o.leaf ?? 0x3f9e52)
  }

  rock(x: number, z: number, r = 0.5, color = 0x8a8f99) {
    if (this.models?.has('nature/rock_smallA')) {
      const pool = r > 0.8 ? ['nature/rock_largeA', 'nature/rock_largeB', 'nature/rock_tallA'] : ['nature/rock_smallA', 'nature/rock_smallB', 'nature/stone_smallA']
      if (this.model(this.rng.pick(pool), x, z, { rot: this.rng.range(0, Math.PI * 2), scale: 0.5 + r, margin: -0.3 })) return
    }
    this.sphere(x, r * 0.45, z, r, color, { seg: 6 })
    this.sphere(x + r * 0.7, r * 0.3, z - r * 0.3, r * 0.6, scale(color, 0.9), { seg: 5 })
  }

  crate(x: number, z: number, s = 0.6, color = 0xb98a4d, y = 0, rot = 0) {
    if (this.models?.has('pirate/crate')) {
      if (this.model(this.rng.chance(0.7) ? 'pirate/crate' : 'pirate/crate-bottles', x, z, { rot, y, scale: s / 0.7, margin: -0.2 })) return
    }
    this.box(x, y, z, s, s, s, color, { rot })
    this.box(x, y + s * 0.42, z, s + 0.04, s * 0.14, s + 0.04, scale(color, 0.78), { rot, outline: false, cap: false })
  }

  barrel(x: number, z: number, color = 0x8a5a2f, y = 0) {
    if (this.models?.has('pirate/barrel')) {
      if (this.model('pirate/barrel', x, z, { y, scale: 0.65, margin: -0.2 })) return
    }
    this.cyl(x, y, z, 0.32, 0.8, color, { seg: 8 })
    this.cyl(x, y + 0.14, z, 0.34, 0.08, 0x3a3a3a, { seg: 8, outline: false, cap: false })
    this.cyl(x, y + 0.58, z, 0.34, 0.08, 0x3a3a3a, { seg: 8, outline: false, cap: false })
  }

  bench(x: number, z: number, rot = 0, color = 0x9c6a3c) {
    this.box(x, 0.4, z, 1.5, 0.1, 0.45, color, { rot })
    this.box(x, 0.5, z - 0.2, 1.5, 0.45, 0.08, color, { rot, cap: false })
    this.box(x - 0.6, 0, z, 0.1, 0.4, 0.4, 0x2b2b2b, { rot, outline: false, cap: false })
    this.box(x + 0.6, 0, z, 0.1, 0.4, 0.4, 0x2b2b2b, { rot, outline: false, cap: false })
  }

  /**
   * A little person, the kind a Habbo room is full of. Faces `rot` (+z at 0).
   * Two legs, a body, two arms, a head with hair, and something on the head
   * or in the hand now and then: enough parts that a crowd is a crowd of
   * people rather than of bollards. `stride` splits the legs mid-step.
   */
  person(x: number, z: number, rot = 0, o: { shirt?: Hex; pants?: Hex; skin?: Hex; hair?: Hex; hat?: Hex; stride?: number; bag?: Hex } = {}) {
    // A drawn person where the room has them: a spacesuit on the moon, one of
    // twelve townsfolk anywhere else, mid-stride when walking. The kit's own
    // colours are the kit's; what a builder asked for in `o` styled the block
    // person and is not carried over.
    if (this.models?.has('space/astronautA')) {
      if (this.model(this.rng.chance(0.5) ? 'space/astronautA' : 'space/astronautB', x, z, { rot, scale: 0.8, margin: -0.2 })) return
    } else if (this.models?.has('people/character-male-a#idle')) {
      const who = this.rng.pick(['female-a', 'female-b', 'female-c', 'female-d', 'female-e', 'female-f', 'male-a', 'male-b', 'male-c', 'male-d', 'male-e', 'male-f'])
      const id = `people/character-${who}#${(o.stride ?? 0) > 0 ? 'walk' : 'idle'}`
      if (this.model(id, x, z, { rot, margin: -0.15 })) return
    }
    const shirt = o.shirt ?? this.rng.pick([0xff3d68, 0x3d9bff, 0xffc93c, 0x2fd18a, 0xc56bff, 0xff8a3c, 0xffffff, 0x5ad1e6])
    const pants = o.pants ?? this.rng.pick([0x2a2f45, 0x4a5a80, 0x3d2c25, 0x6b7280, 0x8a4a5a])
    const skin = o.skin ?? this.rng.pick([0xf3c9a5, 0xd9a072, 0xa5683d, 0x6e4526, 0xf9dcc4])
    const hair = o.hair ?? this.rng.pick([0x2b1b12, 0x6b3d1c, 0xe0b04a, 0x1c1c1c, 0xb8574a, 0xd9d9d9, 0xff6b3c])
    const s = Math.sin(rot)
    const c = Math.cos(rot)
    // Local (lx: across the body, lz: forward) to world.
    const at = (lx: number, lz: number): [number, number] => [x + lx * c + lz * s, z - lx * s + lz * c]
    const stride = o.stride ?? 0
    // A passer-by nobody dressed gets a hat or a bag now and then.
    const dressed = o.shirt !== undefined || o.hat !== undefined || o.bag !== undefined
    const hat = o.hat ?? (!dressed && this.rng.chance(0.14) ? this.rng.pick([0xf4d35e, 0xd94c4c, 0x2a2f3a, 0xffffff]) : undefined)
    const bag = o.bag ?? (!dressed && this.rng.chance(0.2) ? this.rng.pick([0xb98a4d, 0xff3d68, 0x3d9bff, 0x2a2f3a]) : undefined)
    for (const side of [-1, 1]) {
      const [lx, lz] = at(side * 0.09, side * stride * 0.12)
      this.box(lx, 0, lz, 0.15, 0.42, 0.2, pants, { rot, cap: false, outline: side === -1 })
    }
    this.box(x, 0.4, z, 0.4, 0.46, 0.26, shirt, { rot, cap: false })
    for (const side of [-1, 1]) {
      const [ax, az] = at(side * 0.25, -side * stride * 0.1)
      this.box(ax, 0.44, az, 0.1, 0.38, 0.14, shirt, { rot, cap: false, outline: false })
      const [hx, hz] = at(side * 0.25, -side * stride * 0.1)
      this.sphere(hx, 0.42, hz, 0.07, skin, { seg: 4, outline: false })
    }
    this.sphere(x, 1.05, z, 0.2, skin, { seg: 8 })
    const [bx, bz] = at(0, -0.04)
    this.sphere(bx, 1.12, bz, 0.2, hair, { seg: 7, outline: false })
    if (hat !== undefined) {
      this.cyl(x, 1.18, z, 0.27, 0.05, hat, { seg: 8, cap: false, outline: false })
      this.cyl(x, 1.2, z, 0.17, 0.18, hat, { seg: 8, cap: false })
    }
    if (bag !== undefined) {
      const [gx, gz] = at(0.36, 0)
      this.box(gx, 0.36, gz, 0.16, 0.22, 0.14, bag, { rot, cap: false })
    }
  }

  /**
   * A car facing +x at rot 0: a body with a lighter bonnet line, a cabin with
   * glass all round, wheels with hubs, lights front and back.
   */
  car(x: number, z: number, rot = 0, color: Hex = 0xff3d68) {
    // A drawn car where the room has them. Kenney's are long along z and
    // drive towards +z; ours face +x at rot 0, so a quarter turn goes on.
    if (this.models?.has('cars/sedan')) {
      const pool = ['cars/sedan', 'cars/sedan-sports', 'cars/hatchback-sports', 'cars/suv', 'cars/suv-luxury', 'cars/van', 'cars/taxi', 'cars/delivery', 'cars/truck']
      if (this.model(this.rng.pick(pool), x, z, { rot: rot + Math.PI / 2, margin: 0.1 })) {
        if (this.rig.lampsOn) this.halo(x + 1.6 * Math.cos(rot), 0, z - 1.6 * Math.sin(rot), 1.2, 0xfff3c4, 0.2)
        return
      }
      return
    }
    const s = Math.sin(rot)
    const c = Math.cos(rot)
    const at = (lx: number, lz: number): [number, number] => [x + lx * c + lz * s, z - lx * s + lz * c]
    this.box(x, 0.28, z, 2.1, 0.5, 1.0, color, { rot })
    this.box(x, 0.78, z, 2.15, 0.05, 1.04, mix(color, 0xffffff, 0.35), { rot, outline: false, cap: false })
    this.box(x - 0.15 * c, 0.8, z + 0.15 * s, 1.15, 0.44, 0.9, color, { rot, cap: true })
    // Glass: a band around the cabin, slightly proud of it.
    this.box(x - 0.15 * c, 0.9, z + 0.15 * s, 1.19, 0.26, 0.94, 0x9fd8ff, { rot, outline: false, cap: false })
    for (const [dx, dz] of [[-0.68, 0.52], [0.68, 0.52], [-0.68, -0.52], [0.68, -0.52]]) {
      const [wx, wz] = at(dx, dz)
      this.cyl(wx, 0.26, wz, 0.24, 0.2, 0x1c1c1c, { axis: 'z', rot, seg: 8 })
      this.cyl(wx, 0.26, wz, 0.12, 0.22, 0xc9d3dd, { axis: 'z', rot, seg: 6, outline: false })
    }
    const [bx, bz] = at(0, 0)
    this.box(bx, 0.16, bz, 2.24, 0.1, 1.06, 0x2a2f3a, { rot, outline: false, cap: false })
    const on = this.rig.lampsOn
    const [hx, hz] = at(1.06, 0)
    this.box(hx, 0.5, hz, 0.06, 0.16, 0.7, on ? 0xfff3c4 : 0xe8e8e8, { rot, glow: on, outline: false, cap: false })
    const [tx, tz] = at(-1.06, 0)
    this.box(tx, 0.5, tz, 0.06, 0.14, 0.7, on ? 0xff4a4a : 0xb83a3a, { rot, glow: on, outline: false, cap: false })
    if (on) this.halo(hx + 1.2 * c, 0, hz - 1.2 * s, 1.2, 0xfff3c4, 0.2)
  }

  /** A fence run from (x1,z1) to (x2,z2). */
  fence(x1: number, z1: number, x2: number, z2: number, color = 0x8a6a45, h = 0.9) {
    const dx = x2 - x1
    const dz = z2 - z1
    const len = Math.hypot(dx, dz)
    const rot = -Math.atan2(dz, dx)
    const posts = Math.max(2, Math.round(len / 1.4) + 1)
    for (let i = 0; i < posts; i++) {
      const t = i / (posts - 1)
      this.box(x1 + dx * t, 0, z1 + dz * t, 0.14, h, 0.14, color, { cap: false })
    }
    this.box((x1 + x2) / 2, h * 0.75, (z1 + z2) / 2, len, 0.08, 0.06, color, { rot, cap: false, outline: false })
    this.box((x1 + x2) / 2, h * 0.35, (z1 + z2) / 2, len, 0.08, 0.06, color, { rot, cap: false, outline: false })
  }

  /** A road with a dashed centre line, along x (rot 0), and a pavement `sidewalkWidth` wide either side. */
  road(x: number, z: number, w: number, d: number, o: { rot?: number; color?: Hex; dashes?: boolean; sidewalk?: Hex; sidewalkWidth?: number } = {}) {
    const rot = o.rot ?? 0
    this.slab(x, z, w, d, this.ground(o.color ?? 0x3f4450), { rot, h: 0.06 })
    if (o.sidewalk !== undefined) {
      const sw = this.ground(o.sidewalk)
      this.slab(x, z, w, d + 2 * (o.sidewalkWidth ?? 0.6), sw, { rot, h: 0.04, y: -0.02 })
    }
    if (o.dashes !== false && !this.rig.snow) {
      const n = Math.floor(w / 1.6)
      for (let i = 0; i < n; i++) {
        const t = -w / 2 + (i + 0.5) * (w / n)
        this.slab(x + t * Math.cos(rot), z - t * Math.sin(rot), 0.8, 0.12, 0xf2e6b5, { rot, h: 0.02, y: 0.06 })
      }
    }
  }

  /** A stall with a striped awning. */
  stall(x: number, z: number, rot = 0, a: Hex = 0xff3d68, b: Hex = 0xfff5e6) {
    this.box(x, 0, z, 1.8, 0.9, 1.0, 0x9c6a3c, { rot })
    // Four legs, and thick enough to be seen. Two posts a tenth of a tile wide,
    // set on the stall's centre line, are hidden by the canopy from this camera
    // and by the counter from every other: what was on screen was a striped
    // roof floating a tile above a box, in every market in the game.
    for (const dx of [-0.82, 0.82]) {
      for (const dz of [-0.62, 0.62]) {
        this.box(x + dx * Math.cos(rot) + dz * Math.sin(rot), 0, z - dx * Math.sin(rot) + dz * Math.cos(rot), 0.16, 2.05, 0.16, 0x6b4a2b, { rot, cap: false })
      }
    }
    const stripes = 6
    for (let i = 0; i < stripes; i++) {
      const t = -1.0 + (i + 0.5) * (2.0 / stripes)
      this.box(x + t * Math.cos(rot), 2.05, z - t * Math.sin(rot), 2.0 / stripes + 0.02, 0.1, 1.4, i % 2 ? b : a, { rot, outline: false, cap: false })
    }
    this.box(x, 2.0, z, 2.1, 0.06, 1.5, INK, { rot, outline: false, cap: false })
    for (let i = 0; i < 4; i++) {
      const t = -0.6 + i * 0.4
      this.box(x + t * Math.cos(rot), 0.9, z - t * Math.sin(rot) + 0.1, 0.3, 0.22, 0.3, this.rng.pick([0xff5a3c, 0xffc93c, 0x2fd18a, 0xc56bff]), { rot, cap: false, outline: false })
    }
  }

  /**
   * A shop awning over a façade: a canopy sloping down away from the wall, with
   * a valance along its front edge.
   *
   * `x, z` is the point on the wall it hangs off — the canopy starts *at* the
   * wall plane and comes forward from it — `rot` the wall's facing (0 = facing
   * +z) and `w` its width. **Never wider than the façade it is on**: an awning
   * overhanging its own shop is the first thing the eye catches, and it was on
   * every row house in the harbour and every shopfront in the boulevard.
   */
  awning(x: number, z: number, rot: number, w: number, color: Hex, o: { y?: number; depth?: number } = {}) {
    const y = o.y ?? 2.1
    const dep = o.depth ?? 0.85
    const s = Math.sin(rot)
    const c = Math.cos(rot)
    // The canopy's *depth* is its own x, so `tilt` tips it away from the wall
    // rather than along it. Rotated by `rot - π/2` that axis points out of the
    // façade.
    this.box(x + (dep / 2) * s, y - 0.06, z + (dep / 2) * c, dep, 0.1, w, this.top(color), {
      rot: rot - Math.PI / 2,
      tilt: -0.2,
      cap: false,
    })
    // The valance: the strip that hangs off the front edge, and the whole
    // reason a flat plate reads as fabric.
    this.box(x + dep * s, y - 0.32, z + dep * c, w, 0.22, 0.07, scale(color, 0.86), {
      rot,
      outline: false,
      cap: false,
    })
  }

  /**
   * A cord slung between two points and sagging, with something hung off it at
   * intervals.
   *
   * The cord is the point. Both the square and the boulevard hung their lights
   * by placing the bulbs on a sine and drawing nothing between them, so what
   * was on screen was a curved line of lanterns floating in the air with two
   * posts standing some way off — and on the square, where the run is long and
   * the lanterns are big, it read as a wall of them.
   */
  festoon(
    x1: number,
    z1: number,
    y: number,
    x2: number,
    z2: number,
    n: number,
    sag: number,
    hang: (x: number, y: number, z: number, i: number) => void,
    cord: Hex = 0x2a2a2a,
  ) {
    const on = (t: number): [number, number, number] => [x1 + (x2 - x1) * t, y - Math.sin(t * Math.PI) * sag, z1 + (z2 - z1) * t]
    const rot = -Math.atan2(z2 - z1, x2 - x1)
    const steps = n * 2
    for (let i = 0; i < steps; i++) {
      const [ax, ay, az] = on(i / steps)
      const [bx, by, bz] = on((i + 1) / steps)
      const flat = Math.hypot(bx - ax, bz - az)
      const len = Math.hypot(flat, by - ay)
      this.box((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, len, 0.05, 0.05, cord, {
        rot,
        tilt: Math.atan2(by - ay, flat),
        outline: false,
        cap: false,
      })
    }
    for (let i = 1; i < n; i++) {
      const [hx, hy, hz] = on(i / n)
      hang(hx, hy, hz, i)
    }
  }

  /** A hanging paper lantern, lit tonight. */
  lantern(x: number, y: number, z: number, color: Hex = 0xff5a3c, r = 0.22) {
    const on = this.rig.lampsOn
    this.cyl(x, y, z, r, r * 1.6, on ? mix(color, 0xffe9b0, 0.35) : color, { seg: 8, glow: on, cap: false })
    this.cyl(x, y + r * 1.6, z, r * 0.4, 0.06, INK, { seg: 6, outline: false, cap: false })
    if (on) this.halo(x, y + r * 0.8, z, r * 2.2, color, 0.3, false)
  }

  /** A flag on a pole. */
  flag(x: number, z: number, color: Hex, h = 3.2) {
    this.cyl(x, 0, z, 0.06, h, 0xd8dbe3, { seg: 6, cap: false, outline: false })
    this.box(x + 0.45, h - 0.6, z, 0.9, 0.55, 0.05, color, { cap: false })
  }

  // ─── Build ────────────────────────────────────────────────────────────────

  /** Merges every bucket into one mesh each and returns the group. */
  build(): Group {
    const g = new Group()
    this.flushSheets()
    const lit = merge(this.buckets.lit)
    if (lit) g.add(new Mesh(lit, new MeshBasicMaterial({ vertexColors: true })))
    const glow = merge(this.buckets.glow)
    if (glow) g.add(new Mesh(glow, new MeshBasicMaterial({ vertexColors: true })))
    const ink = merge(this.buckets.ink)
    if (ink) g.add(new Mesh(ink, new MeshBasicMaterial({ vertexColors: true, side: BackSide })))
    const shadow = merge(this.buckets.shadow)
    if (shadow) {
      // Drawn after every solid (so the depth test hides it behind whatever
      // stands in front of it) and through the stencil: a pixel already in
      // shadow refuses a second shadow, so overlapping polygons stay one tone
      // rather than stacking their alpha into a dark blot at every crowded
      // corner. The renderer is asked for a stencil buffer for exactly this.
      const m = new Mesh(
        shadow,
        new MeshBasicMaterial({
          color: this.shader.shadow.color,
          transparent: true,
          opacity: this.shader.shadow.alpha,
          depthWrite: false,
          side: DoubleSide,
          stencilWrite: true,
          stencilFunc: EqualStencilFunc,
          stencilRef: 0,
          stencilFail: KeepStencilOp,
          stencilZFail: KeepStencilOp,
          stencilZPass: IncrementStencilOp,
        }),
      )
      m.renderOrder = 1
      g.add(m)
    }
    const halo = merge(this.buckets.halo)
    if (halo) {
      const alpha = this.haloAlphas.reduce((a, b) => a + b, 0) / Math.max(1, this.haloAlphas.length)
      const m = new Mesh(halo, new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: alpha, blending: AdditiveBlending, depthWrite: false }))
      m.renderOrder = 2
      g.add(m)
    }
    return g
  }
}

function merge(list: BufferGeometry[]): BufferGeometry | null {
  if (list.length === 0) return null
  const merged = mergeGeometries(list, false)
  for (const g of list) g.dispose()
  return merged
}

// ─── Primitive cache ────────────────────────────────────────────────────────
// A room is fifteen thousand blocks, and three.js builds each primitive from
// scratch with a Vector3 per vertex: the harbour's build was a quarter of a
// second and the neon city's over a second, most of it in `BoxGeometry`. A
// unit primitive cloned and scaled is a typed-array copy and a matrix, an
// order of magnitude cheaper, and a box scaled along its own axes keeps its
// flat axis-aligned normals — `scale()` runs them through the normal matrix
// and renormalises. Spheres and cones take a uniform scale in x/z, so a unit
// one per segment count serves every radius; a cylinder with two radii is the
// one shape that cannot be a scale and is built as before.

const unitBox = new BoxGeometry(1, 1, 1)
unitBox.deleteAttribute('uv')
const unitSpheres = new Map<number, SphereGeometry>()
const unitCones = new Map<number, ConeGeometry>()
const unitCylinders = new Map<number, CylinderGeometry>()

function boxGeometry(w: number, h: number, d: number): BufferGeometry {
  return unitBox.clone().scale(w, h, d)
}

function sphereGeometry(r: number, seg: number): BufferGeometry {
  let u = unitSpheres.get(seg)
  if (!u) {
    u = new SphereGeometry(1, seg, Math.max(4, seg - 2))
    u.deleteAttribute('uv')
    unitSpheres.set(seg, u)
  }
  return u.clone().scale(r, r, r)
}

function coneGeometry(r: number, h: number, seg: number): BufferGeometry {
  let u = unitCones.get(seg)
  if (!u) {
    u = new ConeGeometry(1, 1, seg)
    u.deleteAttribute('uv')
    unitCones.set(seg, u)
  }
  return u.clone().scale(r, h, r)
}

function cylinderGeometry(rTop: number, rBottom: number, h: number, seg: number): BufferGeometry {
  if (rTop !== rBottom) return new CylinderGeometry(rTop, rBottom, h, seg)
  let u = unitCylinders.get(seg)
  if (!u) {
    u = new CylinderGeometry(1, 1, 1, seg)
    u.deleteAttribute('uv')
    unitCylinders.set(seg, u)
  }
  return u.clone().scale(rTop, h, rTop)
}

/** A triangular prism, ridge along x, base at y = 0, centred on x and z. */
function prismGeometry(w: number, h: number, d: number): BufferGeometry {
  const hw = w / 2
  const hd = d / 2
  // Six faces as triangles, normals outward, non-indexed like BoxGeometry.
  const tri = (a: number[], b: number[], c: number[]) => [...a, ...b, ...c]
  const A = [-hw, 0, hd], B = [hw, 0, hd], C = [hw, 0, -hd], D = [-hw, 0, -hd]
  const E = [-hw, h, 0], F = [hw, h, 0]
  const pos = [
    // front slope (facing +z)
    ...tri(A, B, F), ...tri(A, F, E),
    // back slope (facing -z)
    ...tri(C, D, E), ...tri(C, E, F),
    // gable ends
    ...tri(B, C, F),
    ...tri(D, A, E),
    // bottom
    ...tri(B, A, D), ...tri(B, D, C),
  ]
  const geom = new BufferGeometry()
  geom.setAttribute('position', new Float32BufferAttribute(pos, 3))
  // Indexed like every three.js primitive, or `mergeGeometries` refuses the
  // whole bucket: it merges indexed with indexed and nothing else. Trivial
  // index, since every face keeps its own vertices for the flat normals.
  geom.setIndex([...Array(pos.length / 3).keys()])
  geom.computeVertexNormals()
  return geom
}
