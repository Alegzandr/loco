/**
 * One frame of a room, rendered and handed back as a plain bitmap, with the
 * sprites of whatever moves in it.
 *
 * This is the only file that owns a WebGL context, and it owns it for about a
 * second. A match is a hand of cards animating over the scene for twenty
 * minutes, and the board's compositing budget belongs to the cards: a live 3D
 * viewport under them would be a second render loop competing with every card
 * flight for the same frame. So the room is rendered **once**, the pixels are
 * copied into a 2D canvas, and the context is released. What the board draws
 * from then on is a static image, and everything that moves — the rain, the
 * gulls, the boat drifting across the bay — is a layer over it
 * (`WeatherLayer.svelte`, `LifeLayer.svelte`).
 *
 * **A room is seen from the table** (`view.ts`): a perspective camera at eye
 * height, solved to the felt the board draws, with the horizon in the frame.
 * The table top is the felt cast back onto its plane, so the CSS table lands on
 * it to the pixel; beyond it a near, a middle and a far ground recede to the
 * horizon under a sky with its body in it (`dome.ts`).
 *
 * **The room is lit, and it is lit once.** A sun, a sky and a rim
 * (`lighting.ts`, from the rig's numbers) light every block through its
 * normals; the sun throws one PCF shadow map over the near ground, and the
 * frame is **supersampled**: rendered larger than the bitmap it lands in and
 * scaled down. Because there is exactly one frame, the lighting is allowed what
 * a live viewport on a phone could not afford, and the match still costs
 * nothing per frame. The budget is in pixels (the tier's `glPixels`).
 *
 * **And then it is photographed** (`post.ts`): the occlusion in the creases,
 * the bloom, the air over the far ground, a filmic tone curve and a warm/cool
 * grade, a lens focused on the table, a fringe in the corners, a
 * vignette — once, before it is copied out. The tier is the player's
 * (`hooks/graphicsPref.ts`, `quality.ts`). Every number any of this reads is
 * `look.ts`'s.
 */
import { Box3, Color, Fog, FogExp2, Group, PerspectiveCamera, Scene, ShaderMaterial, SRGBColorSpace, Vector3, WebGLRenderer, WebGLRenderTarget, type Texture } from 'three'
import type { LightRig } from './sky'
import type { SceneSpec } from '../cards/maps'
import { sceneKey } from '../cards/maps'
import type { FeltAnchor } from '../cards/layout'
import { lightRig } from './sky'
import { seededRng } from './rng'
import { Kit, setGrainAnisotropy } from './kit'
import { BUILDERS, KITS, PLACED } from './maps'
import type { Builder } from './maps/vista'
import { cameraSpec, solveView, type View } from './view'
import { makeDome, skyDirection } from './dome'
import { TILES_ACROSS, type Actor, type Sprite } from './life'
import { loadModelLib, type ModelLib } from './models/lib'
import { forceFullRender, renderQuality, type RenderQuality } from './quality'
import { floatTargets, makeSpriteGrader, renderWithPost, type SpriteGrader } from './post'
import { makeMirror, renderReflection } from './mirror'
import { configureShadows, makeLights, makeTableLamp, skyEnvironment, toneMappingFor } from './lighting'
import { lightingFor } from './shade'
import { LOOK } from './look'
import { resolveGraphics, type GraphicsTier } from '../../hooks/graphicsPref'
import { nextPaint } from './nextPaint'

/** Loads the kits `spec`'s room is built from. Fetched once per tab. */
export function prepareModels(spec: SceneSpec, onProgress?: (p: number) => void): Promise<ModelLib> {
  return loadModelLib(KITS[spec.map.id], onProgress, PLACED)
}

export interface RenderSize {
  /** Device pixels. */
  width: number
  height: number
  /** Device pixels per CSS pixel the size was solved at, for line weights. */
  pixelRatio: number
}

export interface RenderedScene {
  frame: HTMLCanvasElement
  sprites: Sprite[]
}

export { TILES_ACROSS }
/**
 * The supersampling factor a bitmap of this size can afford on this tier, on
 * a device whose longest renderable side is `deviceSide` (unknown: the tier's
 * own ceiling stands).
 */
export function supersampleFor(size: RenderSize, q: RenderQuality = renderQuality('medium'), deviceSide = Infinity): number {
  const px = size.width * size.height
  const byBudget = Math.sqrt(q.glPixels / Math.max(1, px))
  const bySide = Math.min(q.maxSide, deviceSide) / Math.max(size.width, size.height)
  return Math.max(1, Math.min(q.supersample, byBudget, bySide))
}

/** The longest side this context will render and sample, whichever limit bites first. */
function deviceMaxSide(renderer: WebGLRenderer): number {
  try {
    const gl = renderer.getContext()
    const dims = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array | null
    return Math.min(
      renderer.capabilities.maxTextureSize,
      Number(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)) || Infinity,
      dims ? Math.min(dims[0], dims[1]) : Infinity,
    )
  } catch {
    return 4096
  }
}

/** True on a GPU that is a CPU: SwiftShader, llvmpipe, Mesa's software paths. */
function softwareGl(renderer: WebGLRenderer): boolean {
  try {
    const gl = renderer.getContext()
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER))
    return /swiftshader|llvmpipe|softpipe|software/i.test(name)
  } catch {
    return false
  }
}

/**
 * Throws when the context can no longer be trusted to hold what was drawn.
 *
 * A context lost mid-render (a GPU reset, the browser reclaiming the oldest of
 * too many contexts, a tab put to sleep) raises nothing: every call after it is
 * a no-op and the canvas reads back empty, so the frame copied out of it is a
 * black or transparent rectangle cached as the room for the whole match. So the
 * context is asked before a bitmap is accepted, and an out-of-memory flag —
 * the other way a draw fails in silence — counts the same. Any other error flag
 * is left alone: three probes enums a driver may not know, and those are not a
 * broken frame. The throw is the ordinary failure path: no scene, sky gradient.
 */
function assertAlive(renderer: WebGLRenderer): void {
  const gl = renderer.getContext()
  if (gl.isContextLost()) throw new Error('webgl context lost')
  // `getError` returns one flag per call; a handful drains them.
  for (let i = 0; i < 8; i++) {
    const err = gl.getError()
    if (err === gl.NO_ERROR) return
    if (err === gl.OUT_OF_MEMORY || err === gl.CONTEXT_LOST_WEBGL) throw new Error(`webgl error 0x${err.toString(16)}`)
  }
}

// ─── The rooms seen from the table ──────────────────────────────────────────

/** The camera `view.ts` solved, as three.js builds it: a window on a frame centred on the lens axis. */
export function vistaCamera(v: View, near: number, far: number): PerspectiveCamera {
  const spec = cameraSpec(v)
  const camera = new PerspectiveCamera(spec.fov, spec.fullW / spec.fullH, near, far)
  camera.setViewOffset(spec.fullW, spec.fullH, spec.offX, spec.offY, v.w, v.h)
  camera.position.set(v.eye[0], v.eye[1], v.eye[2])
  camera.rotation.set(-v.pitch, 0, 0)
  camera.updateMatrixWorld()
  camera.updateProjectionMatrix()
  return camera
}

interface VistaJob {
  renderer: WebGLRenderer
  scene: Scene
  rig: LightRig
  key: string
  size: RenderSize
  felt: FeltAnchor
  models: ModelLib
  q: RenderQuality
  ss: number
  post: RenderQuality['post'] | null
  software: boolean
  floatOk: boolean
  env: Texture | null
  builder: Builder
  report: (p: number) => Promise<void>
}

/**
 * A room seen from the table: the camera solved to the felt (`view.ts`), the
 * table top cast back under it, the dome of the sky, the sea mirroring both,
 * and the air laid over the far (`post.ts: AirOptions`); what moves in it is
 * `vistaSprites`.
 */
async function renderVista(job: VistaJob): Promise<{ frame: HTMLCanvasElement; reflection: WebGLRenderTarget | null; sprites: Sprite[] }> {
  const { renderer, scene, rig, key, size, felt, models, q, ss, post, software, floatOk, env, builder, report } = job
  const gw = Math.round(size.width * ss)
  const gh = Math.round(size.height * ss)
  const k = size.pixelRatio
  const cam = LOOK.vista.camera
  const view = solveView(size.width, size.height, { cx: felt.cx * k, cy: felt.cy * k, rx: felt.rx * k, ry: felt.ry * k, unit: felt.unit === undefined ? undefined : felt.unit * k }, cam)
  // A line of `outline.px` CSS pixels wherever a block stands, thinning with
  // the distance: ten thousand full-weight lines on the far shore read as a
  // scribble, and the air takes them anyway.
  const inkAt = (x: number, y: number, z: number) => {
    const p = view.project([x, y, z])
    const depth = p ? p[2] : cam.far
    const fade = 1 - (1 - LOOK.vista.inkFar) * Math.min(1, depth / LOOK.vista.inkFade)
    return LOOK.outline.px * k * view.tileAt(depth) * fade
  }
  const t0 = performance.now()
  const kit = new Kit({ rig, rng: seededRng(key), outline: inkAt(0, cam.tableTop, 0), outlineAt: inkAt, models, view, lightPools: true })
  const actors: Actor[] = builder(kit) ?? []
  await report(RENDER_STEPS.built)
  const mirror = makeMirror(rig)
  const group = kit.build(env, mirror)
  scene.add(group)
  const eye = new Vector3(...view.eye)
  const dome = makeDome(rig, eye, cam.far * 0.8, seededRng(`${key}:sky`).next() * 1000)
  scene.add(dome)
  if (!post) {
    // No finishing pass, so no air: three's own fog stands in for it.
    scene.fog = new Fog(new Color(rig.sky.horizon), LOOK.vista.haze.distance * 0.15, LOOK.vista.haze.distance * 5)
  }
  await report(RENDER_STEPS.merged)

  const lights = makeLights(rig, q)
  scene.add(lights.group)
  const felt0 = view.tableOutline(64)
  const lamp = makeTableLamp(rig, [felt0.reduce((a, p) => a + p[0], 0) / felt0.length, cam.tableTop, felt0.reduce((a, p) => a + p[2], 0) / felt0.length])
  scene.add(lamp, lamp.target)
  // The near and the middle ground, not the far shore: the room's reach.
  const r = rig.shadowReach
  lights.fitShadow(new Box3(new Vector3(-r.side, -1, -r.back), new Vector3(r.side, r.up, view.eye[2] + 2)))
  renderer.shadowMap.needsUpdate = true

  const camera = vistaCamera(view, cam.near, cam.far)
  let reflection: WebGLRenderTarget | null = null
  if (kit.reflective && q.reflections && !software) {
    try {
      reflection = renderReflection(renderer, scene, camera, mirror, kit.waterLevel, gw, gh, floatOk)
    } catch (err) {
      if (import.meta.env.DEV) console.warn('reflection failed, sky only', err)
      mirror.uniforms.uReflectOn.value = 0
    }
  }
  mirror.uniforms.uRes.value.set(gw, gh)

  let photographed = false
  let canvasSize = { width: gw, height: gh }
  if (post) {
    try {
      const haze = LOOK.vista.haze
      const lin = (hex: number) => {
        const c = new Color(hex)
        return new Vector3(c.r, c.g, c.b)
      }
      canvasSize = renderWithPost(renderer, scene, camera, gw, gh, rig, post, seededRng(key).next() * 1000, {
        distance: haze.distance,
        max: haze.max * rig.haze,
        color: lin(rig.sky.horizon),
        lightDir: skyDirection(rig.sun.azimuth, rig.sun.elevation),
        lightColor: lin(rig.sun.color).multiplyScalar(rig.body ? rig.body.visibility : 0.3),
        sunGlow: haze.sunGlow,
        sunGlowPower: haze.sunGlowPower,
        desaturate: haze.desaturate,
        focus: Math.hypot(...view.eye),
        dof: LOOK.vista.dof,
        bloom: LOOK.vista.bloom,
        glow: Math.max(0, rig.haze - 1) * LOOK.post.bloomWeather,
      }, size)
      photographed = true
    } catch (err) {
      if (import.meta.env.DEV) console.warn('post-processing failed, plain frame', err)
      renderer.setRenderTarget(null)
      renderer.setSize(gw, gh, false)
      canvasSize = { width: gw, height: gh }
      renderer.setClearColor(new Color(rig.sky.horizon), 1)
      renderer.shadowMap.needsUpdate = true
    }
  }
  if (!photographed) renderer.render(scene, camera)
  assertAlive(renderer)
  const frame = document.createElement('canvas')
  frame.width = size.width
  frame.height = size.height
  const ctx = frame.getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(renderer.domElement, 0, 0, canvasSize.width, canvasSize.height, 0, 0, size.width, size.height)
  assertAlive(renderer)
  await report(RENDER_STEPS.drawn)
  if (import.meta.env.DEV) {
    const fov = (2 * Math.atan(view.w / 2 / view.f) * 180) / Math.PI
    console.debug(`scene ${key} vista @${size.width}×${size.height} ×${ss.toFixed(2)} pcf fov ${fov.toFixed(1)} horizon ${(view.horizonY / view.h).toFixed(3)} eye ${view.eye.map((v) => v.toFixed(2)).join(',')}: ${(performance.now() - t0).toFixed(0)} ms`)
  }
  dispose(group)
  dome.geometry.dispose()
  ;(dome.material as ShaderMaterial).dispose()
  lights.dispose()
  lamp.dispose()
  await report(RENDER_STEPS.placed)
  const sprites = await vistaSprites(job, view, actors, inkAt, photographed, report)
  return { frame, reflection, sprites }
}

/** How far past the frame's edge a route may start or end, pixels, and still be worth a sprite. */
const VISTA_ROUTE_SLACK = 400

/**
 * The sprites of a room seen from the table. Each actor carries its route in
 * the world (`Actor.world`): it is built standing at the route's first point,
 * photographed there by the room's own camera cropped to it (`setViewOffset`),
 * and its route projected into the frame, with the scale at each point that
 * the change of distance asks (`Actor.scales`). The air is laid over it as
 * fog, so a boat on the far side of the bay is as grey as the water round it.
 * A route that never enters the frame is dropped.
 */
async function vistaSprites(
  job: VistaJob,
  view: View,
  actors: Actor[],
  inkAt: (x: number, y: number, z: number) => number,
  photographed: boolean,
  report: (p: number) => Promise<void>,
): Promise<Sprite[]> {
  const { renderer, rig, key, size, models, q, ss, env } = job
  const cam = LOOK.vista.camera
  const W = size.width
  const H = size.height
  const ppu = Math.max(W, H) / TILES_ACROSS
  const drawn: Sprite[] = []
  const spriteScene = new Scene()
  const haze = LOOK.vista.haze
  spriteScene.fog = new FogExp2(new Color(rig.sky.horizon), (haze.max * rig.haze) / (haze.distance * 1.4))
  const spriteLights = makeLights(rig, { ...q, shadowMap: LOOK.shadow.spriteMap })
  spriteLights.sun.castShadow = false
  spriteScene.add(spriteLights.group)
  renderer.setClearColor(0x000000, 0)
  let grader: SpriteGrader | null = photographed ? makeSpriteGrader(renderer, rig) : null
  const spec = cameraSpec(view)
  try {
    for (const [n, actor] of actors.entries()) {
      if (!actor.world || actor.world.length === 0) continue
      if (n > 0 && n % SPRITES_PER_PAINT === 0) await report(RENDER_STEPS.placed + (1 - RENDER_STEPS.placed) * (n / actors.length))
      const pts = actor.world.map((p) => view.project(p))
      if (pts.some((p) => p === null)) continue
      const proj = pts as [number, number, number][]
      const inFrame = proj.some(([x, y]) => x > -VISTA_ROUTE_SLACK && x < W + VISTA_ROUTE_SLACK && y > -VISTA_ROUTE_SLACK && y < H + VISTA_ROUTE_SLACK)
      if (!inFrame) continue
      const d0 = proj[0][2]
      actor.path = proj.map(([x, y]) => [(x - W / 2) / ppu, (H / 2 - y) / ppu])
      actor.scales = proj.map((p) => d0 / p[2])
      const [wx, wy, wz] = actor.world[0]
      const k = new Kit({ rig, rng: seededRng(`${key}:${actor.id}`), outline: inkAt(wx, wy, wz), outlineAt: (x, y, z) => inkAt(x + wx, y + wy, z + wz), shadows: false, models, view })
      actor.build(k)
      const g = k.build(env)
      g.position.set(wx, wy, wz)
      g.updateMatrixWorld(true)
      const box = new Box3().setFromObject(g)
      if (box.isEmpty()) {
        dispose(g)
        continue
      }
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
        const p = view.project([x, y, z])
        if (!p) continue
        minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0])
        minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1])
      }
      if (!Number.isFinite(minX)) {
        dispose(g)
        continue
      }
      const pad = 3
      minX = Math.floor(minX - pad)
      minY = Math.floor(minY - pad)
      const sw = Math.max(2, Math.ceil(maxX + pad - minX))
      const sh = Math.max(2, Math.ceil(maxY + pad - minY))
      const camera = vistaCamera(view, cam.near, cam.far)
      camera.setViewOffset(spec.fullW, spec.fullH, spec.offX + minX, spec.offY + minY, sw, sh)
      camera.updateProjectionMatrix()
      const pw = Math.round(sw * ss)
      const ph = Math.round(sh * ss)
      renderer.setSize(pw, ph, false)
      spriteScene.add(g)
      if (grader) {
        try {
          grader.render(spriteScene, camera, pw, ph)
        } catch (err) {
          if (import.meta.env.DEV) console.warn('sprite grade failed, plain sprites', err)
          grader.dispose()
          grader = null
          renderer.setClearColor(0x000000, 0)
        }
      }
      if (!grader) {
        renderer.setRenderTarget(null)
        renderer.clear()
        renderer.render(spriteScene, camera)
      }
      spriteScene.remove(g)
      if (renderer.getContext().isContextLost()) {
        dispose(g)
        break
      }
      const canvas = document.createElement('canvas')
      canvas.width = sw
      canvas.height = sh
      const sctx = canvas.getContext('2d')
      if (sctx) {
        sctx.imageSmoothingEnabled = true
        sctx.imageSmoothingQuality = 'high'
        sctx.drawImage(renderer.domElement, 0, 0, pw, ph, 0, 0, sw, sh)
      }
      drawn.push({ actor, canvas, ox: proj[0][0] - minX, oy: proj[0][1] - minY })
      dispose(g)
    }
  } finally {
    spriteLights.dispose()
    grader?.dispose()
  }
  return drawn
}

function dispose(group: Group) {
  group.traverse((obj) => {
    const mesh = obj as { geometry?: { dispose(): void }; material?: { dispose(): void } }
    mesh.geometry?.dispose()
    mesh.material?.dispose()
  })
}

/**
 * Where the bar stands after each phase of `renderScene`, in [0, 1] of the
 * render. The sprites take what is left after `placed`.
 */
export const RENDER_STEPS = { built: 0.2, merged: 0.35, drawn: 0.65, placed: 0.75 } as const
/** Sprites rendered between two paints of the bar. */
const SPRITES_PER_PAINT = 4

/**
 * Renders `spec` at `size` and returns the frame plus one sprite per actor the
 * builder declared.
 *
 * Throws when a context cannot be had (WebGL off, a driver blacklist, a
 * headless browser without GL). The caller treats that as "no scene", never as
 * "no match".
 *
 * **Asynchronous in phases, and the phases are the progress bar.** The build,
 * the merge, the draw, the depth pass and the sprites each take a slice of the
 * main thread, and between two of them the function reports where it is and
 * waits for a paint (`nextPaint`). Done in one synchronous stretch, the whole
 * render was a freeze the loading screen could not draw through: its bar was
 * painted empty before and full after, whatever was reported in between. The
 * weights are a rough measure of where a room's second goes, not a promise.
 */
export async function renderScene(
  spec: SceneSpec,
  size: RenderSize,
  felt: FeltAnchor,
  models: ModelLib,
  tier: GraphicsTier = resolveGraphics(),
  onProgress?: (p: number) => void,
): Promise<RenderedScene> {
  const report = async (p: number) => {
    onProgress?.(p)
    await nextPaint()
  }
  const rig = lightRig(spec.time, spec.weather, spec.map.id)
  const key = sceneKey(spec)
  const q = renderQuality(tier)

  const gl = document.createElement('canvas')
  // `alpha` so the sprites come out on nothing. Multisampling only where the
  // supersampling does not already cover the edges: on the light tier.
  const renderer = new WebGLRenderer({ canvas: gl, antialias: q.msaa, alpha: true, stencil: false, powerPreference: 'high-performance' })
  let env: Texture | null = null
  let reflection: WebGLRenderTarget | null = null
  try {
    renderer.setPixelRatio(1)
    renderer.outputColorSpace = SRGBColorSpace
    // The tone curve on the plain path; the composite applies the same one
    // itself, since a render target gets none from the renderer.
    renderer.toneMapping = toneMappingFor(LOOK.tone.mapping)
    renderer.toneMappingExposure = lightingFor(rig).exposure
    configureShadows(renderer)
    // A GPU that cannot render into a float target draws every target of the
    // finishing passes as nothing at all, without an error: it gets the plain
    // frame.
    const floatOk = floatTargets(renderer)
    // A software GPU pays for every supersampled pixel on the CPU, and the one
    // place this runs on one is headless Chromium in CI, behind the
    // map-loading gate's clock. It gets the plain frame — unless tooling asked
    // for the full one, which is `make rooms` with all evening to spend.
    const software = softwareGl(renderer) && !forceFullRender()
    const ss = software ? 1 : supersampleFor(size, q, deviceMaxSide(renderer))
    setGrainAnisotropy(Math.min(q.anisotropy, renderer.capabilities.getMaxAnisotropy()))
    const post = software || !floatOk ? null : q.post
    const gw = Math.round(size.width * ss)
    const gh = Math.round(size.height * ss)

    // ─── The room ────────────────────────────────────────────────────────
    renderer.setSize(gw, gh, false)
    renderer.setClearColor(new Color(rig.sky.horizon), 1)
    const scene = new Scene()
    env = floatOk ? skyEnvironment(renderer, rig) : null
    const out = await renderVista({ renderer, scene, rig, key, size, felt, models, q, ss, post, software, floatOk, env, builder: BUILDERS[spec.map.id], report })
    reflection = out.reflection
    return { frame: out.frame, sprites: out.sprites }
  } finally {
    env?.dispose()
    reflection?.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
  }
}
