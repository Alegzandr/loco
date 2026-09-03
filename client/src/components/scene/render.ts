/**
 * One frame of a room, rendered and handed back as a plain bitmap.
 *
 * This is the only file that owns a WebGL context, and it owns it for about a
 * second. A match is a hand of cards animating over the scene for twenty
 * minutes, and the board's compositing budget belongs to the cards: a live 3D
 * viewport under them would be a second render loop competing with every card
 * flight for the same frame. So the diorama is rendered **once**, the pixels are
 * copied into a 2D canvas, and the context is released. What the board draws
 * from then on is a static image, exactly as cheap as the photograph it
 * replaced, and everything that moves (the rain, the snow, the fog's drift) is
 * a CSS layer over it (`WeatherLayer.svelte`).
 *
 * Isometric, orthographic: the camera looks down from a corner at the angle a
 * Habbo room is drawn at, so a block's top and two faces are visible and every
 * block reads at the same scale wherever it stands. The visible width is fixed
 * in tiles rather than in pixels, so a phone and a monitor frame the same
 * plaza and the table (drawn in CSS over the centre) lands on the same paving.
 */
import {
  DirectionalLight,
  Fog,
  HemisphereLight,
  NoToneMapping,
  OrthographicCamera,
  PCFShadowMap,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
  Color,
} from 'three'
import type { SceneSpec } from '../cards/maps'
import { sceneKey } from '../cards/maps'
import type { FeltAnchor } from '../cards/layout'
import { lightRig } from './sky'
import { seededRng } from './rng'
import { Kit, type Anchor } from './kit'
import { BUILDERS } from './maps'

export interface RenderSize {
  /** Device pixels. */
  width: number
  height: number
  /** Device pixels per CSS pixel the size was solved at, for line weights. */
  pixelRatio: number
}

/**
 * Tiles across the longer side of the frame.
 *
 * The number is the density: the table (CSS, over the centre) hides a diamond
 * of roughly ±39 tiles by ±33 on a monitor at this figure, and what is left is
 * a band of 14 to 20 tiles around it. A house is five tiles, a person one, so
 * the band holds three rows of houses and a crowd, which is the Habbo density
 * the room is after. Halve it and the band holds one house.
 */
export const TILES_ACROSS = 80
/** How deep the visible world runs, top of frame to bottom, in tiles, at the pitch below. */
const DEPTH_SPAN = 120
const CAMERA_YAW = Math.PI / 4
const CAMERA_PITCH = (32 * Math.PI) / 180
const CAMERA_DIST = 180
/** Ink line weight, in CSS pixels. */
const OUTLINE_PX = 1.9

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

/**
 * Renders `spec` at `size` and returns a 2D canvas holding the frame.
 *
 * Throws when a context cannot be had (WebGL off, a driver blacklist, a
 * headless browser without GL). The caller treats that as "no scene", never as
 * "no match".
 */
export function renderScene(spec: SceneSpec, size: RenderSize, felt: FeltAnchor): HTMLCanvasElement {
  const rig = lightRig(spec.time, spec.weather)
  const key = sceneKey(spec)
  const ppu = Math.max(size.width, size.height) / TILES_ACROSS

  const gl = document.createElement('canvas')
  const renderer = new WebGLRenderer({ canvas: gl, antialias: true, alpha: false, powerPreference: 'high-performance' })
  try {
    renderer.setPixelRatio(1)
    renderer.setSize(size.width, size.height, false)
    renderer.outputColorSpace = SRGBColorSpace
    renderer.toneMapping = NoToneMapping
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = PCFShadowMap
    renderer.setClearColor(new Color(rig.sky.horizon))

    const scene = new Scene()
    if (rig.fog) {
      // The camera sits CAMERA_DIST from the plaza and the visible world spans
      // DEPTH_SPAN units of view depth around it, the far half being the top of
      // the screen. The rig's near/far are fractions of that span.
      const from = CAMERA_DIST - DEPTH_SPAN / 2
      scene.fog = new Fog(new Color(rig.fog.color), from + rig.fog.near * DEPTH_SPAN, from + rig.fog.far * DEPTH_SPAN)
    }

    const kit = new Kit({ rig, rng: seededRng(key), outline: (OUTLINE_PX * size.pixelRatio) / ppu, anchor: anchorFor(felt, size) })
    BUILDERS[spec.map.id](kit)
    const group = kit.build()
    scene.add(group)

    const hemi = new HemisphereLight(new Color(rig.ambient.sky), new Color(rig.ambient.ground), rig.ambient.intensity)
    scene.add(hemi)

    const sun = new DirectionalLight(new Color(rig.sun.color), rig.sun.intensity)
    const el = (rig.sun.elevation * Math.PI) / 180
    const az = (rig.sun.azimuth * Math.PI) / 180
    sun.position.set(Math.sin(az) * Math.cos(el) * 90, Math.sin(el) * 90, Math.cos(az) * Math.cos(el) * 90)
    sun.target.position.set(0, 0, 0)
    sun.castShadow = true
    sun.shadow.mapSize.set(3072, 3072)
    sun.shadow.camera.left = -110
    sun.shadow.camera.right = 110
    sun.shadow.camera.top = 110
    sun.shadow.camera.bottom = -110
    sun.shadow.camera.near = 1
    sun.shadow.camera.far = 320
    sun.shadow.bias = -0.0006
    sun.shadow.normalBias = 0.04
    sun.shadow.intensity = rig.sun.shadow
    scene.add(sun)
    scene.add(sun.target)

    const vw = size.width / ppu
    const vh = size.height / ppu
    const camera = new OrthographicCamera(-vw / 2, vw / 2, vh / 2, -vh / 2, 1, 500)
    camera.position.set(
      Math.sin(CAMERA_YAW) * Math.cos(CAMERA_PITCH) * CAMERA_DIST,
      Math.sin(CAMERA_PITCH) * CAMERA_DIST,
      Math.cos(CAMERA_YAW) * Math.cos(CAMERA_PITCH) * CAMERA_DIST,
    )
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()

    renderer.render(scene, camera)

    const out = document.createElement('canvas')
    out.width = size.width
    out.height = size.height
    const ctx = out.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    ctx.drawImage(gl, 0, 0)

    group.traverse((obj) => {
      const mesh = obj as { geometry?: { dispose(): void }; material?: { dispose(): void } }
      mesh.geometry?.dispose()
      mesh.material?.dispose()
    })
    return out
  } finally {
    renderer.dispose()
    renderer.forceContextLoss()
  }
}
