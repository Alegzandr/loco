/**
 * What each graphics tier buys, as numbers the renderer reads.
 *
 * A room is rendered once per match, so what a tier spends is time at the
 * loading gate and memory on the GPU for the length of one frame — never a
 * frame budget. The ladder is therefore about how far the one render may go:
 * how many times larger than the screen the frame is drawn before it is
 * scaled down (the edges), how sharp the table's grain stays at a grazing
 * look (the anisotropy), how large the sun's shadow map is (the softness
 * and the reach of the shadows), and which of the finishing passes run over
 * it (`post.ts`: the ambient occlusion, anti-aliasing, bloom, the tilt-shift
 * focus, the colour fringe at the corners, the vignette). The
 * *numbers* inside each pass are the look's (`look.ts`); a tier only says
 * which run.
 *
 * Framework-free and pure: `sceneQuality.test.ts` reads the ladder and
 * asserts it is a ladder.
 */
import type { GraphicsTier } from '../../hooks/graphicsPref'

export interface PostOptions {
  /** Ambient occlusion in the creases, from the depth of the frame. */
  ao: boolean
  /** Edge anti-aliasing in the finishing pass, on top of the supersampling. */
  fxaa: boolean
  /** Light spilling from the lamps, the neon and the windows after dark. */
  bloom: boolean
  /** The tilt-shift: sharp across the table's band, softening towards the top and bottom of the frame. */
  dof: boolean
  /** A slight colour fringe in the corners, a lens rather than a diagram. */
  aberration: boolean
  /** Darkening towards the edges, 0 for none. */
  vignette: number
  /** Mist lying in the low ground at dawn and in the fog (`post.ts: mistFor`). */
  mist: boolean
}

export interface RenderQuality {
  tier: GraphicsTier
  /** How many times larger than the bitmap each side is rendered, at most. */
  supersample: number
  /** The pixels one render may ask the GPU for. Past this the factor shrinks. */
  glPixels: number
  /**
   * The longest side the supersampled frame may have, before the device's own
   * limits (`MAX_TEXTURE_SIZE`, `MAX_RENDERBUFFER_SIZE`, `MAX_VIEWPORT_DIMS`)
   * are asked. 4096 is a side no mobile GPU refuses; at 4096 a 1440p screen
   * could never be supersampled more than 1.6×, whatever the tier said.
   */
  maxSide: number
  /** Anisotropic filtering on the table's grain, at most (the device may allow less). */
  anisotropy: number
  /** The side of the sun's shadow map, texels. */
  shadowMap: number
  /** The finishing passes, or null for the plain frame. */
  post: PostOptions | null
  /** Multisampling on the plain path. Off once supersampling covers it. */
  msaa: boolean
  /** The room mirrored in its water and its wet streets (`mirror.ts`): one more render of the room. */
  reflections: boolean
}

export const QUALITY: Record<GraphicsTier, RenderQuality> = {
  high: {
    tier: 'high',
    supersample: 3,
    glPixels: 16_000_000,
    maxSide: 8192,
    anisotropy: 16,
    shadowMap: 4096,
    post: { ao: true, fxaa: true, bloom: true, dof: true, aberration: true, vignette: 0.22, mist: true },
    msaa: false,
    reflections: true,
  },
  medium: {
    tier: 'medium',
    supersample: 2,
    glPixels: 7_000_000,
    maxSide: 4096,
    anisotropy: 8,
    shadowMap: 2048,
    post: { ao: true, fxaa: true, bloom: true, dof: false, aberration: false, vignette: 0.18, mist: true },
    msaa: false,
    reflections: true,
  },
  light: {
    tier: 'light',
    supersample: 1,
    glPixels: 4_000_000,
    maxSide: 4096,
    anisotropy: 4,
    shadowMap: 1024,
    post: null,
    msaa: true,
    reflections: false,
  },
}

export function renderQuality(tier: GraphicsTier): RenderQuality {
  return QUALITY[tier]
}

/**
 * Tooling's override: `make rooms` shoots the stills for the rooms page in
 * headless Chromium, whose GPU is a CPU, and wants the full render anyway —
 * it has all evening. Dev-only, set from the showcase's `?gfx=force`.
 */
let forceFull = false

export function setForceFullRender(on: boolean): void {
  forceFull = on
}

export function forceFullRender(): boolean {
  return forceFull
}
