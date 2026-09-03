/**
 * What each graphics tier buys, as numbers the renderer reads.
 *
 * A room is rendered once per match, so what a tier spends is time at the
 * loading gate and memory on the GPU for the length of one frame — never a
 * frame budget. The ladder is therefore about how far the one render may go:
 * how many times larger than the screen the frame is drawn before it is
 * scaled down (the edges), and which of the finishing passes run over it
 * (`post.ts`: anti-aliasing, bloom, the tilt-shift focus, grain, the colour
 * fringe at the corners, the vignette).
 *
 * Framework-free and pure: `sceneQuality.test.ts` reads the ladder and
 * asserts it is a ladder.
 */
import type { GraphicsTier } from '../../hooks/graphicsPref'

export interface PostOptions {
  /** Edge anti-aliasing in the finishing pass, on top of the supersampling. */
  fxaa: boolean
  /** Light spilling from the lamps, the neon and the windows after dark. */
  bloom: boolean
  /** The tilt-shift: sharp across the table's band, softening towards the top and bottom of the frame. */
  dof: boolean
  /** Fine static grain, so a flat wall is a surface rather than a fill. */
  grain: boolean
  /** A slight colour fringe in the corners, a lens rather than a diagram. */
  aberration: boolean
  /** Darkening towards the edges, 0 for none. */
  vignette: number
}

export interface RenderQuality {
  tier: GraphicsTier
  /** How many times larger than the bitmap each side is rendered, at most. */
  supersample: number
  /** The pixels one render may ask the GPU for. Past this the factor shrinks. */
  glPixels: number
  /** The finishing passes, or null for the plain frame. */
  post: PostOptions | null
  /** Multisampling on the plain path. Off once supersampling covers it. */
  msaa: boolean
}

export const QUALITY: Record<GraphicsTier, RenderQuality> = {
  high: {
    tier: 'high',
    supersample: 3,
    glPixels: 12_000_000,
    post: { fxaa: true, bloom: true, dof: true, grain: true, aberration: true, vignette: 0.22 },
    msaa: false,
  },
  medium: {
    tier: 'medium',
    supersample: 2,
    glPixels: 7_000_000,
    post: { fxaa: true, bloom: true, dof: false, grain: false, aberration: false, vignette: 0.18 },
    msaa: false,
  },
  light: {
    tier: 'light',
    supersample: 1,
    glPixels: 4_000_000,
    post: null,
    msaa: true,
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
