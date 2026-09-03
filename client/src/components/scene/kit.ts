/**
 * The prop kit: everything a diorama is built out of.
 *
 * A scene is a few thousand coloured blocks, and this file is the only thing
 * that knows how a block becomes triangles. Each map builder (`maps/*.ts`) calls
 * `box`, `cyl`, `sphere` and the props composed from them, and never touches
 * three.js itself; `build()` then merges everything into four meshes, one per
 * material, so a whole city is a handful of draw calls.
 *
 * Three decisions make it look like the rest of the UI rather than a tech demo:
 *
 * - **Every block carries an ink outline**, the same rule every raised object
 *   in `tokens.css` obeys. It is an inverted hull: for each block a slightly
 *   larger copy goes into the `ink` bucket and is drawn back-face only, so the
 *   rim that pokes past the block's silhouette is the line. Built per block
 *   rather than by pushing vertices along normals, because a box's faces do not
 *   share vertices and a per-vertex push leaves the corners open.
 * - **Colour is a vertex attribute**, one material for every lit block, which is
 *   what lets the merge happen. Toon-shaded (`MeshToonMaterial`, a four-step
 *   ramp) so the light bands rather than blends: a gradient across a wall is a
 *   render, three flat tones are a drawing.
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
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DataTexture,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  NearestFilter,
  RedFormat,
  SphereGeometry,
  BackSide,
  AdditiveBlending,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Hex, LightRig } from './sky'
import { mix, scale } from './sky'
import type { Rng } from './rng'

export interface KitOptions {
  rig: LightRig
  rng: Rng
  /** Outline thickness in world units (solved from the render's pixel density). */
  outline: number
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
  /** Cast and receive shadows. Off for the ground itself (it only receives). */
  shadow?: boolean
}

export const INK = 0x120b24
const SNOW = 0xf4f7fb
const WINDOW_DARK = 0x1a2233
const WINDOW_GLOW = 0xffd98a

type Bucket = 'lit' | 'glow' | 'ink' | 'halo'

const _color = new Color()

export class Kit {
  readonly rig: LightRig
  readonly rng: Rng
  readonly outline: number
  private buckets: Record<Bucket, BufferGeometry[]> = { lit: [], glow: [], ink: [], halo: [] }
  private haloAlphas: number[] = []

  constructor(o: KitOptions) {
    this.rig = o.rig
    this.rng = o.rng
    this.outline = o.outline
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
    for (let i = 0; i < n; i++) {
      arr[i * 3] = _color.r
      arr[i * 3 + 1] = _color.g
      arr[i * 3 + 2] = _color.b
    }
    geom.setAttribute('color', new Float32BufferAttribute(arr, 3))
    this.buckets[bucket].push(geom)
  }

  private place(geom: BufferGeometry, x: number, y: number, z: number, rot = 0, tilt = 0) {
    if (tilt) geom.rotateZ(tilt)
    if (rot) geom.rotateY(rot)
    geom.translate(x, y, z)
    return geom
  }

  /** A block. `y` is its bottom, `x`/`z` its centre. */
  box(x: number, y: number, z: number, w: number, h: number, d: number, color: Hex, o: BlockOptions = {}) {
    const bucket: Bucket = o.glow ? 'glow' : 'lit'
    // A tilted block is placed by its centre, an upright one by its bottom.
    const cy = o.tilt ? y : y + h / 2
    this.push(this.place(new BoxGeometry(w, h, d), x, cy, z, o.rot, o.tilt), color, bucket)
    if (o.outline !== false) {
      const t = this.outline
      this.push(this.place(new BoxGeometry(w + 2 * t, h + 2 * t, d + 2 * t), x, cy, z, o.rot, o.tilt), INK, 'ink')
    }
    if (this.rig.snow && o.cap !== false && !o.glow && !o.tilt && h > 0.12 && w > 0.25 && d > 0.25) {
      const capH = Math.min(0.16, 0.06 + Math.min(w, d) * 0.04)
      this.push(this.place(new BoxGeometry(w * 0.98, capH, d * 0.98), x, y + h + capH / 2 - 0.01, z, o.rot), SNOW, 'lit')
    }
  }

  /** A vertical cylinder. `rTop` defaults to `r`; give 0 for a cone. */
  cyl(x: number, y: number, z: number, r: number, h: number, color: Hex, o: BlockOptions & { rTop?: number; seg?: number; axis?: 'x' | 'z' } = {}) {
    const rTop = o.rTop ?? r
    const seg = o.seg ?? 10
    const bucket: Bucket = o.glow ? 'glow' : 'lit'
    const make = (rt: number, rb: number, hh: number) => {
      const g = new CylinderGeometry(rt, rb, hh, seg)
      if (o.axis === 'x') g.rotateZ(Math.PI / 2)
      else if (o.axis === 'z') g.rotateX(Math.PI / 2)
      return g
    }
    const cy = o.axis ? y : y + h / 2
    this.push(this.place(make(rTop, r, h), x, cy, z, o.rot), color, bucket)
    if (o.outline !== false) {
      const t = this.outline
      this.push(this.place(make(rTop + t, r + t, h + 2 * t), x, cy, z, o.rot), INK, 'ink')
    }
    if (this.rig.snow && o.cap !== false && !o.glow && !o.axis && rTop > 0.2) {
      this.push(this.place(new CylinderGeometry(rTop * 0.97, rTop * 0.97, 0.1, seg), x, y + h + 0.04, z), SNOW, 'lit')
    }
  }

  cone(x: number, y: number, z: number, r: number, h: number, color: Hex, o: BlockOptions & { seg?: number } = {}) {
    const seg = o.seg ?? 4
    const bucket: Bucket = o.glow ? 'glow' : 'lit'
    this.push(this.place(new ConeGeometry(r, h, seg), x, y + h / 2, z, o.rot ?? Math.PI / 4), this.rig.snow && o.cap !== false ? mix(color, SNOW, 0.6) : color, bucket)
    if (o.outline !== false) {
      const t = this.outline
      this.push(this.place(new ConeGeometry(r + t, h + 2 * t, seg), x, y + h / 2, z, o.rot ?? Math.PI / 4), INK, 'ink')
    }
  }

  sphere(x: number, y: number, z: number, r: number, color: Hex, o: BlockOptions & { seg?: number } = {}) {
    const seg = o.seg ?? 8
    const bucket: Bucket = o.glow ? 'glow' : 'lit'
    this.push(this.place(new SphereGeometry(r, seg, Math.max(4, seg - 2)), x, y, z), color, bucket)
    if (o.outline !== false) {
      this.push(this.place(new SphereGeometry(r + this.outline, seg, Math.max(4, seg - 2)), x, y, z), INK, 'ink')
    }
  }

  /** A gabled roof: a triangular prism with its ridge along x, `y` its eave. */
  prism(x: number, y: number, z: number, w: number, h: number, d: number, color: Hex, o: BlockOptions = {}) {
    const bucket: Bucket = o.glow ? 'glow' : 'lit'
    const c = this.rig.snow && o.cap !== false ? mix(color, SNOW, 0.75) : color
    this.push(this.place(prismGeometry(w, h, d), x, y, z, o.rot), c, bucket)
    if (o.outline !== false) {
      const t = this.outline
      this.push(this.place(prismGeometry(w + 2 * t, h + 2 * t, d + 2 * t), x, y - t, z, o.rot), INK, 'ink')
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

  /** A window pane on a wall, lit or dark for tonight. */
  window(x: number, y: number, z: number, w: number, h: number, facing: 'x' | 'z', color = WINDOW_GLOW) {
    const lit = this.rng.chance(this.rig.windowsLit)
    const depth = 0.06
    if (facing === 'x') this.box(x, y, z, depth, h, w, lit ? color : WINDOW_DARK, { glow: lit, outline: false, cap: false })
    else this.box(x, y, z, w, h, depth, lit ? color : WINDOW_DARK, { glow: lit, outline: false, cap: false })
  }

  /**
   * A building: walls, a grid of windows on the two faces the camera sees, and
   * a roof of the builder's choice. `x, z` centre, `w, d` footprint, `h` height.
   */
  tower(x: number, z: number, w: number, h: number, d: number, color: Hex, o: {
    windowColor?: Hex
    floorH?: number
    roof?: 'flat' | 'gable' | 'hip' | 'none'
    roofColor?: Hex
    trim?: Hex
    windows?: boolean
    y?: number
  } = {}) {
    const y = o.y ?? 0
    this.box(x, y, z, w, h, d, color)
    if (o.windows !== false) {
      const floorH = o.floorH ?? 1.25
      const rows = Math.floor((h - 0.7) / floorH)
      for (let r = 0; r < rows; r++) {
        const wy = y + 0.55 + r * floorH
        const cols = Math.max(1, Math.floor(d / 0.95))
        for (let c = 0; c < cols; c++) {
          const wz = z - d / 2 + (c + 0.5) * (d / cols)
          this.window(x + w / 2 + 0.02, wy, wz, 0.5, 0.62, 'x', o.windowColor)
        }
        const cols2 = Math.max(1, Math.floor(w / 0.95))
        for (let c = 0; c < cols2; c++) {
          const wx = x - w / 2 + (c + 0.5) * (w / cols2)
          this.window(wx, wy, z + d / 2 + 0.02, 0.5, 0.62, 'z', o.windowColor)
        }
      }
    }
    if (o.trim !== undefined) {
      this.box(x, y + h - 0.18, z, w + 0.16, 0.2, d + 0.16, o.trim)
    }
    const roof = o.roof ?? 'flat'
    const rc = o.roofColor ?? scale(color, 0.75)
    if (roof === 'gable') this.prism(x, y + h, z, w + 0.3, Math.min(w, d) * 0.5, d + 0.3, rc)
    else if (roof === 'hip') this.cone(x, y + h, z, Math.max(w, d) * 0.72, Math.min(w, d) * 0.5, rc, { seg: 4 })
    else if (roof === 'flat') this.box(x, y + h, z, w + 0.1, 0.14, d + 0.1, this.top(rc))
  }

  /** A street lamp. Lit tonight or not, decided by the rig. */
  lamp(x: number, z: number, o: { h?: number; color?: Hex; post?: Hex; heads?: 1 | 2; style?: 'globe' | 'box' | 'lantern' } = {}) {
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
      const leaf = this.leaf(o.leaf ?? 0x3fae5a)
      this.cyl(x, 0, z, 0.12, h * 1.4, trunk, { seg: 6, rTop: 0.09, cap: false })
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2
        this.box(x + Math.cos(a) * 0.55, h * 1.35, z + Math.sin(a) * 0.55, 1.2, 0.1, 0.34, leaf, { rot: -a, cap: false })
      }
      return
    }
    const leaf = this.leaf(o.leaf ?? (kind === 'sakura' ? 0xf5a3c7 : 0x4bb35d))
    this.cyl(x, 0, z, 0.14, h, trunk, { seg: 6, cap: false })
    this.sphere(x, h + r * 0.75, z, r, leaf, { seg: 8 })
    this.sphere(x + r * 0.5, h + r * 0.55, z + r * 0.3, r * 0.65, scale(leaf, 1.08), { seg: 7 })
    this.sphere(x - r * 0.45, h + r * 0.9, z - r * 0.2, r * 0.6, scale(leaf, 0.92), { seg: 7 })
    if (this.rig.snow) this.sphere(x, h + r * 1.2, z, r * 0.7, SNOW, { seg: 7, outline: false })
  }

  bush(x: number, z: number, r = 0.5, color = 0x3f9e52) {
    const c = this.leaf(color)
    this.sphere(x, r * 0.7, z, r, c, { seg: 7 })
    this.sphere(x + r * 0.6, r * 0.5, z + r * 0.2, r * 0.7, scale(c, 1.1), { seg: 6 })
  }

  rock(x: number, z: number, r = 0.5, color = 0x8a8f99) {
    this.sphere(x, r * 0.45, z, r, color, { seg: 6 })
    this.sphere(x + r * 0.7, r * 0.3, z - r * 0.3, r * 0.6, scale(color, 0.9), { seg: 5 })
  }

  crate(x: number, z: number, s = 0.6, color = 0xb98a4d, y = 0, rot = 0) {
    this.box(x, y, z, s, s, s, color, { rot })
    this.box(x, y + s * 0.42, z, s + 0.04, s * 0.14, s + 0.04, scale(color, 0.78), { rot, outline: false, cap: false })
  }

  barrel(x: number, z: number, color = 0x8a5a2f, y = 0) {
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

  /** A little person, the kind a Habbo room is full of. Faces `rot`. */
  person(x: number, z: number, rot = 0, o: { shirt?: Hex; pants?: Hex; skin?: Hex; hair?: Hex; hat?: Hex } = {}) {
    const shirt = o.shirt ?? this.rng.pick([0xff3d68, 0x3d9bff, 0xffc93c, 0x2fd18a, 0xc56bff, 0xff8a3c, 0xffffff])
    const pants = o.pants ?? this.rng.pick([0x2a2f45, 0x4a5a80, 0x3d2c25, 0x6b7280])
    const skin = o.skin ?? this.rng.pick([0xf3c9a5, 0xd9a072, 0xa5683d, 0x6e4526, 0xf9dcc4])
    const hair = o.hair ?? this.rng.pick([0x2b1b12, 0x6b3d1c, 0xe0b04a, 0x1c1c1c, 0xb8574a, 0xd9d9d9])
    this.box(x, 0, z, 0.34, 0.42, 0.22, pants, { rot, cap: false })
    this.box(x, 0.42, z, 0.4, 0.44, 0.26, shirt, { rot, cap: false })
    this.sphere(x, 1.05, z, 0.2, skin, { seg: 7 })
    this.sphere(x - Math.sin(rot) * 0.03, 1.13, z - Math.cos(rot) * 0.03, 0.19, hair, { seg: 7, outline: false })
    if (o.hat !== undefined) this.cyl(x, 1.22, z, 0.2, 0.16, o.hat, { seg: 8, cap: false })
  }

  /** A car facing +x at rot 0. */
  car(x: number, z: number, rot = 0, color: Hex = 0xff3d68) {
    this.box(x, 0.3, z, 2.0, 0.5, 0.95, color, { rot })
    this.box(x - 0.1, 0.8, z, 1.1, 0.42, 0.85, 0x2a3a55, { rot, cap: true })
    for (const [dx, dz] of [[-0.65, 0.5], [0.65, 0.5], [-0.65, -0.5], [0.65, -0.5]]) {
      const wx = x + dx * Math.cos(rot) + dz * Math.sin(rot)
      const wz = z - dx * Math.sin(rot) + dz * Math.cos(rot)
      this.cyl(wx, 0.28, wz, 0.24, 0.2, 0x1c1c1c, { axis: 'z', rot, seg: 8 })
    }
    const on = this.rig.lampsOn
    const hx = x + 1.0 * Math.cos(rot)
    const hz = z - 1.0 * Math.sin(rot)
    this.box(hx, 0.5, hz, 0.06, 0.16, 0.7, on ? 0xfff3c4 : 0xe8e8e8, { rot, glow: on, outline: false, cap: false })
    if (on) this.halo(hx + 1.2 * Math.cos(rot), 0, hz - 1.2 * Math.sin(rot), 1.2, 0xfff3c4, 0.2)
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

  /** A road with a dashed centre line, along x (rot 0). */
  road(x: number, z: number, w: number, d: number, o: { rot?: number; color?: Hex; dashes?: boolean; sidewalk?: Hex } = {}) {
    const rot = o.rot ?? 0
    this.slab(x, z, w, d, this.ground(o.color ?? 0x3f4450), { rot, h: 0.06 })
    if (o.sidewalk !== undefined) {
      const sw = this.ground(o.sidewalk)
      this.slab(x, z, w, d + 1.2, sw, { rot, h: 0.04, y: -0.02 })
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
    for (const dx of [-0.8, 0.8]) {
      this.box(x + dx * Math.cos(rot), 0, z - dx * Math.sin(rot), 0.1, 2.1, 0.1, 0x6b4a2b, { rot, cap: false })
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
    const lit = merge(this.buckets.lit)
    if (lit) {
      const m = new Mesh(lit, new MeshToonMaterial({ vertexColors: true, gradientMap: toonRamp() }))
      m.castShadow = true
      m.receiveShadow = true
      g.add(m)
    }
    const glow = merge(this.buckets.glow)
    if (glow) g.add(new Mesh(glow, new MeshBasicMaterial({ vertexColors: true })))
    const ink = merge(this.buckets.ink)
    if (ink) g.add(new Mesh(ink, new MeshBasicMaterial({ vertexColors: true, side: BackSide })))
    const halo = merge(this.buckets.halo)
    if (halo) {
      const alpha = this.haloAlphas.reduce((a, b) => a + b, 0) / Math.max(1, this.haloAlphas.length)
      g.add(new Mesh(halo, new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: alpha, blending: AdditiveBlending, depthWrite: false })))
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

let ramp: DataTexture | null = null
/** Four flat bands of light. Shared: it never changes. */
function toonRamp(): DataTexture {
  if (ramp) return ramp
  ramp = new DataTexture(new Uint8Array([70, 140, 205, 255]), 4, 1, RedFormat)
  ramp.minFilter = NearestFilter
  ramp.magFilter = NearestFilter
  ramp.needsUpdate = true
  return ramp
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
