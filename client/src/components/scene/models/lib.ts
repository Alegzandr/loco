/**
 * The models a room is built from, loaded once and baked into buffers.
 *
 * `loadModelLib(kits)` fetches every model the manifest lists for those kits
 * from this origin (`/models/<kit>/<name>.glb`, packed there by
 * `tools/models/pack.mjs`), samples its palette texture into vertex colours,
 * scales it into tiles, stands it on the ground, and keeps the result. A
 * model is fetched once per tab whatever the number of rooms that use it.
 *
 * Only `render.ts` imports this file: it pulls the GLTF loader and three.js
 * with it, and the engine is a lazy chunk.
 */
import { AnimationMixer, Mesh, SkinnedMesh, Vector3, type Material, type Object3D, type Texture } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import manifest from './manifest.json'
import { bounds, matchesKey, smoothNormals, type Baked } from './bake'
import type { Hex } from '../sky'
import { cssHex } from '../sky'

export type KitName = keyof typeof manifest.kits

export interface ModelLib {
  /** `kit/name`, or `kit/name#walk` for a person mid-stride. */
  get(id: string): Baked | undefined
  has(id: string): boolean
}

const baked = new Map<string, Baked>()
const pending = new Map<string, Promise<void>>()
const loader = new GLTFLoader()

/** The poses a person is baked in. Keyed by the clip name and the moment in it. */
const POSES: Record<string, { clip: string; at: number }> = {
  idle: { clip: 'idle', at: 0.3 },
  walk: { clip: 'walk', at: 0.35 },
}

function keysOf(kit: KitName): Hex[] {
  return manifest.kits[kit].glow.map((c) => cssHex(c))
}

/** The palette image as pixels, once per texture. */
const pixels = new WeakMap<Texture, { data: Uint8ClampedArray; w: number; h: number }>()
function pixelsOf(tex: Texture): { data: Uint8ClampedArray; w: number; h: number } | null {
  const hit = pixels.get(tex)
  if (hit) return hit
  const img = tex.image as ImageBitmap | HTMLImageElement | undefined
  if (!img || !img.width) return null
  const c = document.createElement('canvas')
  c.width = img.width
  c.height = img.height
  const ctx = c.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(img, 0, 0)
  const out = { data: ctx.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height }
  pixels.set(tex, out)
  return out
}

interface Part {
  position: number[]
  normal: number[]
  color: number[]
  glow: number[]
  index: number[]
}

/** Appends one mesh's triangles to `part`, in world space, colours baked. */
function appendMesh(mesh: Mesh, part: Part, keys: Hex[], pose: { clip: string; at: number } | null, root: Object3D) {
  const geom = mesh.geometry
  const pos = geom.getAttribute('position')
  const nrm = geom.getAttribute('normal')
  const uv = geom.getAttribute('uv')
  const idx = geom.index
  const base = part.position.length / 3
  mesh.updateWorldMatrix(true, false)
  const v = new Vector3()
  const n = new Vector3()
  const skinned = mesh instanceof SkinnedMesh && pose ? mesh : null
  const nm = mesh.normalMatrix.getNormalMatrix(mesh.matrixWorld)
  const materials: Material[] = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  const groups = geom.groups.length ? geom.groups : [{ start: 0, count: idx ? idx.count : pos.count, materialIndex: 0 }]
  // Colour per vertex: by group's material, sampled from the palette at the uv.
  const colorOf = new Float32Array(pos.count * 3)
  const glowOf = new Uint8Array(pos.count)
  for (const g of groups) {
    const mat = materials[g.materialIndex ?? 0] as Material & { map?: Texture | null; color?: { r: number; g: number; b: number } }
    const px = mat?.map ? pixelsOf(mat.map) : null
    const cr = mat?.color?.r ?? 0.8, cg = mat?.color?.g ?? 0.8, cb = mat?.color?.b ?? 0.8
    const end = Math.min(g.start + g.count, idx ? idx.count : pos.count)
    for (let k = g.start; k < end; k++) {
      const vi = idx ? idx.getX(k) : k
      let r = cr, gg = cg, b = cb
      if (px && uv) {
        // glTF textures are not flipped: v runs down the image.
        const u = uv.getX(vi) - Math.floor(uv.getX(vi))
        const w = uv.getY(vi) - Math.floor(uv.getY(vi))
        const x = Math.min(px.w - 1, Math.floor(u * px.w))
        const y = Math.min(px.h - 1, Math.floor(w * px.h))
        const o = (y * px.w + x) * 4
        // Palette values are sRGB; the factor colour three gives is linear, so
        // bring the sampled texel to linear too and let the renderer's output
        // conversion put both back.
        r = srgbToLinear(px.data[o] / 255) * cr
        gg = srgbToLinear(px.data[o + 1] / 255) * cg
        b = srgbToLinear(px.data[o + 2] / 255) * cb
        glowOf[vi] = matchesKey(px.data[o] / 255, px.data[o + 1] / 255, px.data[o + 2] / 255, keys) ? 1 : 0
      } else {
        glowOf[vi] = matchesKey(linearToSrgb(r), linearToSrgb(gg), linearToSrgb(b), keys) ? 1 : 0
      }
      colorOf[vi * 3] = r
      colorOf[vi * 3 + 1] = gg
      colorOf[vi * 3 + 2] = b
    }
  }
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    n.fromBufferAttribute(nrm, i)
    if (skinned) {
      skinned.applyBoneTransform(i, v)
      // The normal follows the bind pose closely enough for a flat tone.
    }
    v.applyMatrix4(mesh.matrixWorld)
    n.applyMatrix3(nm).normalize()
    part.position.push(v.x, v.y, v.z)
    part.normal.push(n.x, n.y, n.z)
    part.color.push(colorOf[i * 3], colorOf[i * 3 + 1], colorOf[i * 3 + 2])
    part.glow.push(glowOf[i])
  }
  if (idx) for (let k = 0; k < idx.count; k++) part.index.push(base + idx.getX(k))
  else for (let k = 0; k < pos.count; k++) part.index.push(base + k)
  void root
}

function srgbToLinear(c: number): number {
  return c < 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}
function linearToSrgb(c: number): number {
  return c < 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
}

async function bakeOne(kit: KitName, name: string, poseName: string | null): Promise<void> {
  const spec = manifest.kits[kit]
  const gltf = await loader.loadAsync(`/models/${kit}/${name}.glb`)
  const root = gltf.scene
  const pose = poseName ? POSES[poseName] : null
  if (pose) {
    const clip = gltf.animations.find((a) => a.name === pose.clip)
    if (clip) {
      const mixer = new AnimationMixer(root)
      mixer.clipAction(clip).play()
      mixer.update(pose.at)
      root.updateMatrixWorld(true)
      root.traverse((o) => {
        if (o instanceof SkinnedMesh) o.skeleton.update()
      })
    }
  }
  root.updateMatrixWorld(true)
  const part: Part = { position: [], normal: [], color: [], glow: [], index: [] }
  const keys = keysOf(kit)
  root.traverse((o) => {
    if (o instanceof Mesh && o.geometry?.getAttribute('position')) appendMesh(o, part, keys, pose, root)
  })
  const position = Float32Array.from(part.position)
  const { min, max } = bounds(position)
  const s = spec.scale
  // Into tiles, centred on the ground under the model, standing on y = 0.
  const cx = (min[0] + max[0]) / 2
  const cz = (min[2] + max[2]) / 2
  for (let i = 0; i < position.length; i += 3) {
    position[i] = (position[i] - cx) * s
    position[i + 1] = (position[i + 1] - min[1]) * s
    position[i + 2] = (position[i + 2] - cz) * s
  }
  const index = Uint32Array.from(part.index)
  const b: Baked = {
    position,
    normal: Float32Array.from(part.normal),
    color: Float32Array.from(part.color),
    glow: Uint8Array.from(part.glow),
    index,
    smooth: smoothNormals(position, index),
    w: (max[0] - min[0]) * s,
    h: (max[1] - min[1]) * s,
    d: (max[2] - min[2]) * s,
  }
  baked.set(poseName ? `${kit}/${name}#${poseName}` : `${kit}/${name}`, b)
  // Free what the loader built; the buffers above are all that is kept.
  root.traverse((o) => {
    const m = o as Mesh
    m.geometry?.dispose()
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : []
    for (const mat of mats) mat.dispose()
  })
}

function load(id: string): Promise<void> {
  if (baked.has(id)) return Promise.resolve()
  const hit = pending.get(id)
  if (hit) return hit
  const [path, poseName] = id.split('#')
  const [kit, name] = path.split('/') as [KitName, string]
  const p = bakeOne(kit, name, poseName ?? null)
    .catch((err) => {
      // A model that will not load is a model the room does without.
      if (import.meta.env.DEV) console.warn(`model ${id} failed`, err)
    })
    .finally(() => pending.delete(id))
  pending.set(id, p)
  return p
}

/**
 * Loads every model of the named kits, people in both poses, reporting
 * progress in [0, 1]. Resolves with the library; a model that failed is
 * simply absent from it.
 */
export async function loadModelLib(kits: readonly KitName[], onProgress?: (p: number) => void): Promise<ModelLib> {
  const ids: string[] = []
  for (const kit of kits) {
    for (const name of manifest.kits[kit].models) {
      if (kit === 'people') ids.push(`${kit}/${name}#idle`, `${kit}/${name}#walk`)
      else ids.push(`${kit}/${name}`)
    }
  }
  let done = 0
  await Promise.all(
    ids.map((id) =>
      load(id).then(() => {
        done++
        onProgress?.(done / Math.max(1, ids.length))
      }),
    ),
  )
  return {
    get: (id) => baked.get(id),
    has: (id) => baked.has(id),
  }
}

/** Test seam. */
export function clearModelLib() {
  baked.clear()
  pending.clear()
}
