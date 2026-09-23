/**
 * One frame of a room, rendered and handed back as a plain bitmap, with the
 * sprites of whatever moves in it.
 *
 * This is the only file that owns a WebGL context, and it owns it for about a
 * second. A match is a hand of cards animating over the scene for twenty
 * minutes, and the board's compositing budget belongs to the cards: a live 3D
 * viewport under them would be a second render loop competing with every card
 * flight for the same frame. So the diorama is rendered **once**, the pixels
 * are copied into a 2D canvas, and the context is released. What the board
 * draws from then on is a static image, exactly as cheap as the photograph it
 * replaced, and everything that moves — the rain, the snow, the boat, the
 * balloon — is a layer over it (`WeatherLayer.svelte`, `LifeLayer.svelte`).
 *
 * **The room is lit, and it is lit once.** A sun, a sky and a rim
 * (`lighting.ts`, from the rig's numbers) light every block through its
 * normals; the sun throws one shadow map fitted to the frame, soft and long,
 * and the frame is **supersampled**: rendered larger than the bitmap it lands
 * in and scaled down, so an ink line a tile long is one clean stroke at any
 * angle. Because there is exactly one frame, the lighting is allowed what a
 * live viewport on a phone could not afford — a 4096 shadow map, a screen-space
 * occlusion pass, a half-float target — and the match still costs nothing
 * per frame. The budget is in pixels (the tier's `glPixels`), so a phone gets the
 * full factor and a 4K monitor gets what fits.
 *
 * **And then it is photographed** (`post.ts`): the lit frame goes through
 * the finishing passes the graphics tier allows — the occlusion in the
 * creases, a last edge pass, the lamps' bloom, a filmic tone curve and a
 * warm/cool grade, a tilt-shift focus on the table's band, grain, a fringe in
 * the corners, a vignette — once, before it is copied out. The tier is the
 * player's (`hooks/graphicsPref.ts`, `quality.ts`) and says how far the
 * supersampling goes, how large the shadow map is and which passes run;
 * `light` is the lit frame with its shadow and nothing over it. Every number
 * any of this reads is `look.ts`'s.
 *
 * Isometric, orthographic: the camera looks down from a corner at the angle a
 * Habbo room is drawn at, so a block's top and two faces are visible and every
 * block reads at the same scale wherever it stands. The visible width is fixed
 * in tiles rather than in pixels, so a phone and a monitor frame the same
 * plaza and the table (drawn in CSS over the centre) lands on the same paving.
 */
import { Box3, Color, DoubleSide, Fog, Group, Mesh, OrthographicCamera, PCFShadowMap, PlaneGeometry, Scene, ShaderMaterial, ShadowMaterial, SRGBColorSpace, Vector3, WebGLRenderer, WebGLRenderTarget, type Texture } from 'three'
import type { SceneSpec } from '../cards/maps'
import { sceneKey } from '../cards/maps'
import type { FeltAnchor } from '../cards/layout'
import { lightRig, mix } from './sky'
import { seededRng } from './rng'
import { Kit, type Anchor } from './kit'
import { BUILDERS, KITS, PLACED } from './maps'
import { DEFAULT_BODY, PITCH_COS, PITCH_SIN, TILES_ACROSS, lengthInside, occluded, occlusionVeil, selectActors, type Actor, type DepthMap, type ScreenPt, type Sprite, type Veil } from './life'
import { at } from './maps/common'
import { loadModelLib, type ModelLib } from './models/lib'
import { forceFullRender, renderQuality, type RenderQuality } from './quality'
import { floatTargets, makeSpriteGrader, renderWithPost, type SpriteGrader } from './post'
import { makeMirror, renderReflection } from './mirror'
import { configureShadows, frameBox, makeLights, shadowReach, skyEnvironment, toneMappingFor } from './lighting'
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
/** How deep the visible world runs, top of frame to bottom, in tiles, at the pitch below. */
const DEPTH_SPAN = 120
const CAMERA_YAW = Math.PI / 4
/** The pitch is structural — every composition helper (`maps/common.ts`, `life.ts`) is written to it — so it is theirs, not the look's. */
const CAMERA_PITCH = Math.atan2(PITCH_SIN, PITCH_COS)
const CAMERA_DIST = 180
const CAMERA_NEAR = 1
const CAMERA_FAR = 500
/** Frame pixels per pixel of the depth map: a route is tested to the quarter tile, not the pixel. */
const DEPTH_SCALE = 2
/** A texture side no mobile GPU refuses. */
const MAX_GL_SIDE = 4096

/**
 * The felt's ellipse, from CSS pixels of the viewport to screen tiles. The
 * podium is built under this, so it is solved exactly rather than rounded.
 */
export function anchorFor(felt: FeltAnchor, size: RenderSize): Anchor {
  const ppu = Math.max(size.width, size.height) / TILES_ACROSS
  const k = size.pixelRatio
  return {
    sx: (felt.cx * k - size.width / 2) / ppu,
    sy: (size.height / 2 - felt.cy * k) / ppu,
    a: (felt.rx * k) / ppu,
    b: (felt.ry * k) / ppu,
  }
}

/** The supersampling factor a bitmap of this size can afford on this tier. */
export function supersampleFor(size: RenderSize, q: RenderQuality = renderQuality('medium')): number {
  const px = size.width * size.height
  const byBudget = Math.sqrt(q.glPixels / Math.max(1, px))
  const bySide = MAX_GL_SIDE / Math.max(size.width, size.height)
  return Math.max(1, Math.min(q.supersample, byBudget, bySide))
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

function isoCamera(): OrthographicCamera {
  const camera = new OrthographicCamera(-1, 1, 1, -1, CAMERA_NEAR, CAMERA_FAR)
  camera.position.set(
    Math.sin(CAMERA_YAW) * Math.cos(CAMERA_PITCH) * CAMERA_DIST,
    Math.sin(CAMERA_PITCH) * CAMERA_DIST,
    Math.cos(CAMERA_YAW) * Math.cos(CAMERA_PITCH) * CAMERA_DIST,
  )
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  return camera
}

/**
 * The depth of the room, as a bitmap: the same scene, every surface
 * writing its eye depth over the near-to-far range packed into RGBA, read back
 * into a `DepthMap` at `DEPTH_SCALE` frame pixels per value. This is what
 * lets a route be trimmed to where nothing stands in front of it, with the
 * houses being blocks the ground plan never claimed and the plaza's props
 * being wherever a builder put them: the render is asked rather than the
 * plan. One extra pass, one readback, and the target is released with the
 * context. The halos are left out — light stands in front of nothing.
 */
function readDepth(renderer: WebGLRenderer, scene: Scene, group: Group, camera: OrthographicCamera, size: RenderSize, ppu: number): DepthMap {
  const w = Math.max(1, Math.ceil(size.width / DEPTH_SCALE))
  const h = Math.max(1, Math.ceil(size.height / DEPTH_SCALE))
  const material = new ShaderMaterial({
    side: DoubleSide,
    uniforms: { uNear: { value: CAMERA_NEAR }, uFar: { value: CAMERA_FAR } },
    vertexShader: `
      varying float vDepth;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      #include <packing>
      uniform float uNear;
      uniform float uFar;
      varying float vDepth;
      void main() {
        gl_FragColor = packDepthToRGBA(clamp((vDepth - uNear) / (uFar - uNear), 0.0, 1.0));
      }`,
  })
  const target = new WebGLRenderTarget(w, h, { depthBuffer: true, stencilBuffer: false })
  const hidden: Mesh[] = []
  group.traverse((obj) => {
    const mesh = obj as Mesh
    const m = mesh.material as { transparent?: boolean } | undefined
    if (mesh.isMesh && m?.transparent) {
      mesh.visible = false
      hidden.push(mesh)
    }
  })
  const fog = scene.fog
  scene.fog = null
  scene.overrideMaterial = material
  const bytes = new Uint8Array(w * h * 4)
  try {
    renderer.setRenderTarget(target)
    renderer.setClearColor(0xffffff, 1)
    renderer.clear()
    renderer.render(scene, camera)
    renderer.readRenderTargetPixels(target, 0, 0, w, h, bytes)
  } finally {
    renderer.setRenderTarget(null)
    scene.overrideMaterial = null
    scene.fog = fog
    for (const m of hidden) m.visible = true
    target.dispose()
    material.dispose()
  }
  // Unpacked, and turned the right way up: GL reads rows from the bottom.
  const data = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * w * 4
    const dst = y * w
    for (let x = 0; x < w; x++) {
      const i = src + x * 4
      data[dst + x] = (bytes[i] + bytes[i + 1] / 255 + bytes[i + 2] / 65025 + bytes[i + 3] / 16581375) / 255
    }
  }
  return {
    data,
    w,
    h,
    scale: DEPTH_SCALE,
    fw: size.width,
    fh: size.height,
    ppu,
    origin: (CAMERA_DIST - CAMERA_NEAR) / (CAMERA_FAR - CAMERA_NEAR),
    perTile: 1 / (CAMERA_FAR - CAMERA_NEAR),
  }
}

/**
 * A veil as the image a layer can wear: alpha only, at the depth map's own
 * resolution, and the browser stretches it over the frame — the edge of a
 * building is soft by a frame pixel, which reads as the anti-aliasing the
 * room already has. Null when the actor has nothing in front of it.
 */
function veilImage(veil: Veil | null): string | null {
  if (!veil) return null
  const canvas = document.createElement('canvas')
  canvas.width = veil.w
  canvas.height = veil.h
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const img = ctx.createImageData(veil.w, veil.h)
  for (let i = 0; i < veil.data.length; i++) img.data[i * 4 + 3] = veil.data[i]
  ctx.putImageData(img, 0, 0)
  return canvas.toDataURL('image/png')
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
  const ppu = Math.max(size.width, size.height) / TILES_ACROSS
  const q = renderQuality(tier)
  const ssWanted = supersampleFor(size, q)
  const outline = (LOOK.outline.px * size.pixelRatio) / ppu

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
    // A GPU that cannot render into a float target draws the VSM shadow map
    // and every target of the finishing passes as nothing at all, without an
    // error: it gets a PCF shadow (a depth map, bytes) and the plain frame.
    const floatOk = floatTargets(renderer)
    if (!floatOk) renderer.shadowMap.type = PCFShadowMap
    // A software GPU pays for every supersampled pixel on the CPU, and the one
    // place this runs on one is headless Chromium in CI, behind the
    // map-loading gate's clock. It gets the plain frame — unless tooling asked
    // for the full one, which is `make rooms` with all evening to spend.
    const software = softwareGl(renderer) && !forceFullRender()
    const ss = software ? 1 : ssWanted
    const post = software || !floatOk ? null : q.post
    const gw = Math.round(size.width * ss)
    const gh = Math.round(size.height * ss)

    // ─── The room ────────────────────────────────────────────────────────
    renderer.setSize(gw, gh, false)
    renderer.setClearColor(new Color(rig.sky.horizon), 1)
    const scene = new Scene()
    if (rig.fog && LOOK.fog.strength > 0) {
      // The camera sits CAMERA_DIST from the plaza and the visible world spans
      // DEPTH_SPAN units of view depth around it, the far half being the top of
      // the screen. The rig's near/far are fractions of that span; the look
      // pushes both out to thin it.
      const from = CAMERA_DIST - DEPTH_SPAN / 2
      const k = 1 / Math.max(0.05, LOOK.fog.strength)
      scene.fog = new Fog(new Color(rig.fog.color), from + rig.fog.near * DEPTH_SPAN, from + rig.fog.near * DEPTH_SPAN + (rig.fog.far - rig.fog.near) * DEPTH_SPAN * k)
    }
    const t0 = performance.now()
    const vw = size.width / ppu
    const vh = size.height / ppu
    // The sky, for what is glossy to mirror (glass, paint, a wet street). A
    // GPU that cannot filter it into a float target gets none, and its glossy
    // surfaces are only shinier under the sun.
    env = floatOk ? skyEnvironment(renderer, rig) : null
    const kit = new Kit({ rig, rng: seededRng(key), outline, anchor: anchorFor(felt, size), frame: { w: vw, h: vh }, models })
    const candidates: Actor[] = BUILDERS[spec.map.id](kit) ?? []
    const t1 = performance.now()
    await report(RENDER_STEPS.built)
    const mirror = makeMirror(rig, { h: vh }, PITCH_COS)
    const group = kit.build(env, mirror)
    const t2 = performance.now()
    await report(RENDER_STEPS.merged)
    scene.add(group)

    // The light: the sun's shadow map fitted to exactly what the frame shows.
    const lights = makeLights(rig, q)
    scene.add(lights.group)
    lights.fitShadow(frameBox(vw, vh, CAMERA_PITCH, at))
    renderer.shadowMap.needsUpdate = true
    // The room's penumbra, in texels and in texels a tile: a sprite's own map
    // is a different size over a different box, and its shadow has to come out
    // exactly as soft on the ground as the room's.
    const roomShadow = lights.sun.shadow
    const roomRadius = roomShadow.radius
    const roomTexelsPerTile = q.shadowMap / Math.max(1e-3, roomShadow.camera.right - roomShadow.camera.left)

    const camera = isoCamera()
    camera.left = -vw / 2
    camera.right = vw / 2
    camera.top = vh / 2
    camera.bottom = -vh / 2
    camera.updateProjectionMatrix()
    // The reflection: the room mirrored in its water and its wet streets, one
    // more render of it before the real one, which reads it (`mirror.ts`). A
    // GPU that refuses the target keeps the sky in its water and nothing else.
    if (kit.reflective && q.reflections && !software) {
      try {
        reflection = renderReflection(renderer, scene, camera, mirror, kit.waterLevel, gw, gh, floatOk)
      } catch (err) {
        if (import.meta.env.DEV) console.warn('reflection failed, sky only', err)
        mirror.uniforms.uReflectOn.value = 0
      }
    }
    mirror.uniforms.uRes.value.set(gw, gh)
    // The photograph. The focus band is the felt, in the render's own pixels;
    // a GPU that refuses a target this size throws inside, and the plain frame
    // is the answer rather than no room.
    let photographed = false
    if (post) {
      try {
        const k = size.pixelRatio * ss
        renderWithPost(renderer, scene, camera, gw, gh, rig, { cx: felt.cx * k, cy: felt.cy * k, rx: felt.rx * k, ry: felt.ry * k }, post, seededRng(key).next() * 1000)
        photographed = true
      } catch (err) {
        if (import.meta.env.DEV) console.warn('post-processing failed, plain frame', err)
        renderer.setRenderTarget(null)
        renderer.setClearColor(new Color(rig.sky.horizon), 1)
        renderer.shadowMap.needsUpdate = true
      }
    }
    if (!photographed) renderer.render(scene, camera)

    // Copied out *before* the paint the report waits for: the context keeps no
    // drawing buffer (`preserveDrawingBuffer` is off, and should be), so once
    // the browser has composited a frame the canvas may read back cleared. And
    // the frame is only accepted from a context that is still there.
    assertAlive(renderer)
    const frame = document.createElement('canvas')
    frame.width = size.width
    frame.height = size.height
    const ctx = frame.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(gl, 0, 0, gw, gh, 0, 0, size.width, size.height)
    assertAlive(renderer)
    const t3 = performance.now()
    await report(RENDER_STEPS.drawn)

    // ─── Where a thing on the ground may go ──────────────────────────────
    // Every route the builder handed in is a candidate: it is kept where the
    // thing would stand on ground the plan has not claimed, inside the frame
    // or just off it. A candidate with no such stretch is dropped, and of
    // each `pick` group the survivors worth most are kept. What stands in
    // front of a route does not cut it — the sprite's layer is veiled there
    // (below) — but it counts for nothing: the worth is what anybody sees.
    const depth = readDepth(renderer, scene, group, camera, size, ppu)
    const pad = 3
    const standable = (pt: ScreenPt, actor: Actor) => {
      if (Math.abs(pt[0]) > vw / 2 + pad || Math.abs(pt[1]) > vh / 2 + pad) return false
      const body = actor.body ?? DEFAULT_BODY
      const foot = body.foot ?? body.w
      const [x, z] = at(pt[0], pt[1])
      // With no margin: a passer-by brushes past a lamp post; only standing
      // inside something is refused. The margin is for building.
      return kit.free(x, z, foot, foot, 0, 0)
    }
    // A route is worth what anybody sees of it: the part inside the frame,
    // not under the hand and the action bar, which sit under the felt, and
    // not behind something the room drew nearer the camera.
    const { sx: ax, sy: ay, a, b } = kit.anchor
    const seen = (pt: ScreenPt) => Math.abs(pt[0]) < vw / 2 && Math.abs(pt[1]) < vh / 2 && !(Math.abs(pt[0] - ax) < a * 0.55 && pt[1] < ay - b + 1)
    const worth = (actor: Actor) => lengthInside(actor, (pt) => seen(pt) && (actor.flying === true || !occluded(depth, pt, actor.body ?? DEFAULT_BODY)))
    const actors = selectActors(candidates, standable, worth)
    dispose(group)
    lights.dispose()
    await report(RENDER_STEPS.placed)

    // ─── The sprites ─────────────────────────────────────────────────────
    // Same kit, same light, same line weight, same camera: an actor is a
    // piece of the room that happens to be on its own bitmap. Its bounds are
    // measured in view space so the bitmap is exactly as big as it needs to
    // be — the shadow it throws on the ground included, which it carries on
    // a catcher of its own — and the origin, the ground point the path
    // carries, is recorded.
    const sprites: Sprite[] = []
    renderer.setClearColor(0x000000, 0)
    const spriteScene = new Scene()
    if (scene.fog) spriteScene.fog = scene.fog
    // A sprite's shadow map is its own and small (`LOOK.shadow.spriteMap`),
    // fitted to the sprite: the room's 4096 map rendered again per walker was
    // most of what the sprites cost.
    const spriteLights = makeLights(rig, { ...q, shadowMap: LOOK.shadow.spriteMap })
    spriteScene.add(spriteLights.group)
    // The room's grade, when the room had one: a sprite rendered straight to
    // the canvas gets the tone curve and nothing else, and read as a sticker on
    // a ground that went through the whole photograph.
    let grader: SpriteGrader | null = photographed ? makeSpriteGrader(renderer, rig) : null
    const catcherMaterial = new ShadowMaterial({ color: new Color(mix(LOOK.shadow.spriteTint, rig.ambient.sky, LOOK.shadow.spriteTintMix)), opacity: LOOK.shadow.spriteOpacity * rig.sun.shadow, transparent: true, depthWrite: false })
    const corner = new Vector3()
    for (const [i, actor] of actors.entries()) {
      // A sprite is a build and a draw of its own, so a room full of them is
      // the last quarter of the bar, paid a few at a time.
      if (i > 0 && i % SPRITES_PER_PAINT === 0) await report(RENDER_STEPS.placed + (1 - RENDER_STEPS.placed) * (i / actors.length))
      const k = new Kit({ rig, rng: seededRng(`${key}:${actor.id}`), outline, anchor: { sx: 0, sy: 0, a: 0, b: 0 }, shadows: !actor.flying, models })
      actor.build(k)
      const g = k.build(env)
      const box = new Box3()
      g.traverse((obj) => {
        const mesh = obj as Mesh
        if (!mesh.geometry) return
        mesh.geometry.computeBoundingBox()
        if (mesh.geometry.boundingBox) box.union(mesh.geometry.boundingBox)
      })
      if (box.isEmpty()) {
        dispose(g)
        continue
      }
      // Something on the ground throws its shadow on a catcher of its own: a
      // plane under it that draws nothing but the shadow, at the room's own
      // shadow colour, on the sprite's transparent background. The bitmap is
      // sized to the reach of that shadow, not only to the thing.
      let catcher: Mesh | null = null
      const extent = k.shadows ? shadowReach(box, rig) : box
      if (k.shadows) {
        const cw = extent.max.x - extent.min.x + 1
        const cd = extent.max.z - extent.min.z + 1
        catcher = new Mesh(new PlaneGeometry(cw, cd), catcherMaterial)
        catcher.rotation.x = -Math.PI / 2
        catcher.position.set((extent.min.x + extent.max.x) / 2, 0.01, (extent.min.z + extent.max.z) / 2)
        catcher.receiveShadow = true
        spriteScene.add(catcher)
      }
      spriteLights.fitShadow(extent)
      const sc = spriteLights.sun.shadow.camera
      spriteLights.sun.shadow.radius = roomRadius * (LOOK.shadow.spriteMap / Math.max(1e-3, sc.right - sc.left) / roomTexelsPerTile)
      // View-space extent of the world box: project its eight corners.
      const view = camera.matrixWorldInverse
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
      for (const x of [extent.min.x, extent.max.x]) for (const y of [extent.min.y, extent.max.y]) for (const z of [extent.min.z, extent.max.z]) {
        corner.set(x, y, z).applyMatrix4(view)
        minX = Math.min(minX, corner.x)
        maxX = Math.max(maxX, corner.x)
        minY = Math.min(minY, corner.y)
        maxY = Math.max(maxY, corner.y)
      }
      const pad = outline * 2 + 0.15
      minX -= pad
      maxX += pad
      minY -= pad
      maxY += pad
      const sw = Math.max(2, Math.ceil((maxX - minX) * ppu))
      const sh = Math.max(2, Math.ceil((maxY - minY) * ppu))
      camera.left = minX
      camera.right = minX + sw / ppu
      camera.top = maxY
      camera.bottom = maxY - sh / ppu
      camera.updateProjectionMatrix()
      const pw = Math.round(sw * ss)
      const ph = Math.round(sh * ss)
      renderer.setSize(pw, ph, false)
      spriteScene.add(g)
      renderer.shadowMap.needsUpdate = true
      if (grader) {
        try {
          grader.render(spriteScene, camera, pw, ph)
        } catch (err) {
          // The same fallback as the room's: the plain sprite, never none.
          if (import.meta.env.DEV) console.warn('sprite grade failed, plain sprites', err)
          grader.dispose()
          grader = null
          renderer.setClearColor(0x000000, 0)
          renderer.shadowMap.needsUpdate = true
        }
      }
      if (!grader) renderer.render(spriteScene, camera)
      spriteScene.remove(g)
      if (catcher) {
        spriteScene.remove(catcher)
        catcher.geometry.dispose()
      }
      // A context lost now takes the sprites and not the room: the frame is
      // already out, and a sprite copied from a dead canvas is a hole.
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
        sctx.drawImage(gl, 0, 0, pw, ph, 0, 0, sw, sh)
      }
      corner.set(0, 0, 0).applyMatrix4(view)
      const mask = veilImage(occlusionVeil(depth, actor))
      sprites.push({ actor, canvas, ox: (corner.x - minX) * ppu, oy: (maxY - corner.y) * ppu, ...(mask ? { mask } : {}) })
      dispose(g)
    }
    catcherMaterial.dispose()
    spriteLights.dispose()
    grader?.dispose()
    if (import.meta.env.DEV) {
      // Where a room's second goes, for whoever is making it heavier.
      const t4 = performance.now()
      console.debug(
        `scene ${key} @${size.width}×${size.height} ×${ss.toFixed(2)} ${tier}${photographed ? '+post' : ''} felt ${felt.cx.toFixed(0)},${felt.cy.toFixed(0)},${felt.rx.toFixed(0)},${felt.ry.toFixed(0)}: build ${(t1 - t0).toFixed(0)} ms, merge ${(t2 - t1).toFixed(0)} ms, draw ${(t3 - t2).toFixed(0)} ms, ${sprites.length} of ${candidates.length} sprites ${(t4 - t3).toFixed(0)} ms`,
      )
    }
    return { frame, sprites }
  } finally {
    env?.dispose()
    reflection?.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
  }
}
