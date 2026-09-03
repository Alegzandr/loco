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
 * **The room is drawn, not lit.** There is no light in the scene and no shadow
 * map: every face's tone was multiplied into its vertex colour by the kit as
 * it was built (`shade.ts`), and every shadow is a flat polygon it laid on the
 * ground. So the frame is flat colour, ink and hard shadow, the way an
 * illustrated city is, and the one thing a GPU is asked for here is edges —
 * **supersampled**: the frame is rendered larger than the bitmap it lands in
 * and scaled down, on top of multisampling, so an ink line a tile long is one
 * clean stroke at any angle. The budget is in pixels (`MAX_GL_PIXELS`), so a
 * phone gets the full factor and a 4K monitor gets what fits.
 *
 * **And then it is photographed** (`post.ts`): the flat frame goes through
 * the finishing passes the graphics tier allows — a last edge pass, the
 * lamps' bloom, a tilt-shift focus on the table's band, grain, a fringe in
 * the corners, a vignette — once, before it is copied out. The tier is the
 * player's (`hooks/graphicsPref.ts`, `quality.ts`) and says how far the
 * supersampling goes and which passes run; `light` is the plain frame.
 *
 * Isometric, orthographic: the camera looks down from a corner at the angle a
 * Habbo room is drawn at, so a block's top and two faces are visible and every
 * block reads at the same scale wherever it stands. The visible width is fixed
 * in tiles rather than in pixels, so a phone and a monitor frame the same
 * plaza and the table (drawn in CSS over the centre) lands on the same paving.
 */
import { Box3, Color, DoubleSide, Fog, Group, Mesh, OrthographicCamera, Scene, ShaderMaterial, SRGBColorSpace, Vector3, WebGLRenderer, WebGLRenderTarget, NoToneMapping } from 'three'
import type { SceneSpec } from '../cards/maps'
import { sceneKey } from '../cards/maps'
import type { FeltAnchor } from '../cards/layout'
import { lightRig } from './sky'
import { seededRng } from './rng'
import { Kit, type Anchor } from './kit'
import { BUILDERS, KITS } from './maps'
import { TILES_ACROSS, lengthInside, occluded, selectActors, type Actor, type DepthMap, type ScreenPt, type Sprite } from './life'
import { at } from './maps/common'
import { loadModelLib, type ModelLib } from './models/lib'
import { forceFullRender, renderQuality, type RenderQuality } from './quality'
import { renderWithPost } from './post'
import { resolveGraphics, type GraphicsTier } from '../../hooks/graphicsPref'

/** Loads the kits `spec`'s room is built from. Fetched once per tab. */
export function prepareModels(spec: SceneSpec, onProgress?: (p: number) => void): Promise<ModelLib> {
  return loadModelLib(KITS[spec.map.id], onProgress)
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
const CAMERA_PITCH = (32 * Math.PI) / 180
const CAMERA_DIST = 180
const CAMERA_NEAR = 1
const CAMERA_FAR = 500
/** Frame pixels per pixel of the depth map: a route is tested to the quarter tile, not the pixel. */
const DEPTH_SCALE = 2
/** Ink line weight, in CSS pixels. */
const OUTLINE_PX = 1.8
/**
 * Supersampling: the frame is rendered up to this many times larger on each
 * side and scaled down. This is the `medium` tier's factor; `quality.ts` has
 * the ladder, and the high tier goes one further with the finishing passes
 * over it.
 */
export const SUPERSAMPLE = renderQuality('medium').supersample
/** The pixels one render may ask the GPU for on `medium`. Past this the factor shrinks. */
export const MAX_GL_PIXELS = renderQuality('medium').glPixels
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
 * context. The shadows and the halos are left out — a shadow is on the ground
 * and a halo is light, and neither stands in front of anything.
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

function dispose(group: Group) {
  group.traverse((obj) => {
    const mesh = obj as { geometry?: { dispose(): void }; material?: { dispose(): void } }
    mesh.geometry?.dispose()
    mesh.material?.dispose()
  })
}

/**
 * Renders `spec` at `size` and returns the frame plus one sprite per actor the
 * builder declared.
 *
 * Throws when a context cannot be had (WebGL off, a driver blacklist, a
 * headless browser without GL). The caller treats that as "no scene", never as
 * "no match".
 */
export function renderScene(spec: SceneSpec, size: RenderSize, felt: FeltAnchor, models: ModelLib, tier: GraphicsTier = resolveGraphics()): RenderedScene {
  const rig = lightRig(spec.time, spec.weather)
  const key = sceneKey(spec)
  const ppu = Math.max(size.width, size.height) / TILES_ACROSS
  const q = renderQuality(tier)
  const ssWanted = supersampleFor(size, q)
  const outline = (OUTLINE_PX * size.pixelRatio) / ppu

  const gl = document.createElement('canvas')
  // `stencil` is off by default since r163 and the shadows draw through it;
  // `alpha` so the sprites come out on nothing. Multisampling only where the
  // supersampling does not already cover the edges: on the light tier.
  const renderer = new WebGLRenderer({ canvas: gl, antialias: q.msaa, alpha: true, stencil: true, powerPreference: 'high-performance' })
  try {
    renderer.setPixelRatio(1)
    renderer.outputColorSpace = SRGBColorSpace
    renderer.toneMapping = NoToneMapping
    // A software GPU pays for every supersampled pixel on the CPU, and the one
    // place this runs on one is headless Chromium in CI, behind the
    // map-loading gate's clock. It gets the plain frame — unless tooling asked
    // for the full one, which is `make rooms` with all evening to spend.
    const software = softwareGl(renderer) && !forceFullRender()
    const ss = software ? 1 : ssWanted
    const post = software ? null : q.post
    const gw = Math.round(size.width * ss)
    const gh = Math.round(size.height * ss)

    // ─── The room ────────────────────────────────────────────────────────
    renderer.setSize(gw, gh, false)
    renderer.setClearColor(new Color(rig.sky.horizon), 1)
    const scene = new Scene()
    if (rig.fog) {
      // The camera sits CAMERA_DIST from the plaza and the visible world spans
      // DEPTH_SPAN units of view depth around it, the far half being the top of
      // the screen. The rig's near/far are fractions of that span.
      const from = CAMERA_DIST - DEPTH_SPAN / 2
      scene.fog = new Fog(new Color(rig.fog.color), from + rig.fog.near * DEPTH_SPAN, from + rig.fog.far * DEPTH_SPAN)
    }
    const t0 = performance.now()
    const vw = size.width / ppu
    const vh = size.height / ppu
    const kit = new Kit({ rig, rng: seededRng(key), outline, anchor: anchorFor(felt, size), frame: { w: vw, h: vh }, models })
    const candidates: Actor[] = BUILDERS[spec.map.id](kit) ?? []
    const t1 = performance.now()
    const group = kit.build()
    const t2 = performance.now()
    scene.add(group)

    const camera = isoCamera()
    camera.left = -vw / 2
    camera.right = vw / 2
    camera.top = vh / 2
    camera.bottom = -vh / 2
    camera.updateProjectionMatrix()
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
      }
    }
    if (!photographed) renderer.render(scene, camera)
    const t3 = performance.now()

    const frame = document.createElement('canvas')
    frame.width = size.width
    frame.height = size.height
    const ctx = frame.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(gl, 0, 0, gw, gh, 0, 0, size.width, size.height)

    // ─── Where a thing on the ground may go ──────────────────────────────
    // Every route the builder handed in is a candidate: it is kept where the
    // thing would stand on ground the plan has not claimed, inside the frame
    // or just off it, and with nothing the render drew standing nearer the
    // camera across its silhouette. A candidate with no such stretch is
    // dropped, and of each `pick` group the longest survivors are kept.
    const depth = readDepth(renderer, scene, group, camera, size, ppu)
    const pad = 3
    const standable = (pt: ScreenPt, actor: Actor) => {
      if (Math.abs(pt[0]) > vw / 2 + pad || Math.abs(pt[1]) > vh / 2 + pad) return false
      const body = actor.body ?? { w: 0.7, h: 1.2 }
      const foot = body.foot ?? body.w
      const [x, z] = at(pt[0], pt[1])
      if (!kit.free(x, z, foot, foot)) return false
      return !occluded(depth, pt, body)
    }
    // A route is worth what anybody sees of it: the part inside the frame,
    // and not under the hand and the action bar, which sit under the felt.
    const { sx: ax, sy: ay, a, b } = kit.anchor
    const seen = (pt: ScreenPt) => Math.abs(pt[0]) < vw / 2 && Math.abs(pt[1]) < vh / 2 && !(Math.abs(pt[0] - ax) < a * 0.55 && pt[1] < ay - b + 1)
    const worth = (actor: Actor) => lengthInside(actor, seen)
    const actors = selectActors(candidates, standable, worth)
    dispose(group)

    // ─── The sprites ─────────────────────────────────────────────────────
    // Same kit, same light, same line weight, same camera: an actor is a
    // piece of the room that happens to be on its own bitmap. Its bounds are
    // measured in view space so the bitmap is exactly as big as it needs to
    // be, and the origin — the ground point the path carries — is recorded.
    const sprites: Sprite[] = []
    renderer.setClearColor(0x000000, 0)
    const spriteScene = new Scene()
    if (scene.fog) spriteScene.fog = scene.fog
    const corner = new Vector3()
    for (const actor of actors) {
      const k = new Kit({ rig, rng: seededRng(`${key}:${actor.id}`), outline, anchor: { sx: 0, sy: 0, a: 0, b: 0 }, shadows: !actor.flying, models })
      actor.build(k)
      const g = k.build()
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
      // View-space extent of the world box: project its eight corners.
      const view = camera.matrixWorldInverse
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
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
      renderer.setSize(Math.round(sw * ss), Math.round(sh * ss), false)
      spriteScene.add(g)
      renderer.render(spriteScene, camera)
      spriteScene.remove(g)
      const canvas = document.createElement('canvas')
      canvas.width = sw
      canvas.height = sh
      const sctx = canvas.getContext('2d')
      if (sctx) {
        sctx.imageSmoothingEnabled = true
        sctx.imageSmoothingQuality = 'high'
        sctx.drawImage(gl, 0, 0, Math.round(sw * ss), Math.round(sh * ss), 0, 0, sw, sh)
      }
      corner.set(0, 0, 0).applyMatrix4(view)
      sprites.push({ actor, canvas, ox: (corner.x - minX) * ppu, oy: (maxY - corner.y) * ppu })
      dispose(g)
    }
    if (import.meta.env.DEV) {
      // Where a room's second goes, for whoever is making it heavier.
      const t4 = performance.now()
      console.debug(
        `scene ${key} @${size.width}×${size.height} ×${ss.toFixed(2)} ${tier}${photographed ? '+post' : ''} felt ${felt.cx.toFixed(0)},${felt.cy.toFixed(0)},${felt.rx.toFixed(0)},${felt.ry.toFixed(0)}: build ${(t1 - t0).toFixed(0)} ms, merge ${(t2 - t1).toFixed(0)} ms, draw ${(t3 - t2).toFixed(0)} ms, ${sprites.length} of ${candidates.length} sprites ${(t4 - t3).toFixed(0)} ms`,
      )
    }
    return { frame, sprites }
  } finally {
    renderer.dispose()
    renderer.forceContextLoss()
  }
}
