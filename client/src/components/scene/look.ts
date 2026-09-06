/**
 * The look of a room: every visual number the render reads, in one file.
 *
 * A room is a diorama of coloured blocks photographed once per match, and
 * what makes it read as a *rendered* diorama rather than a coloured drawing is
 * the light: a low warm sun with long soft shadows, a cool sky filling the
 * shade, ambient occlusion in the creases, a filmic tone curve and a grade
 * that keeps the warm/cool split. All of that is numbers, and all of the
 * numbers are here — the hours (`HOURS`, the sun and the sky per time of
 * day), the lights, the shadows, the materials, the outline, the
 * occlusion, the tone mapping and the finishing passes. `sky.ts` turns the
 * hours into a rig, `lighting.ts` turns the rig into three.js lights,
 * `post.ts` reads the tone and post blocks, `kit.ts` the material block.
 * Nothing in the render carries a visual constant of its own.
 *
 * **Framework-free and three-free**, so a content page and a test can read it,
 * and so the dev panel (`dev/lookPanel.ts`, lil-gui, `?look=1` in dev) can
 * edit it in place: every field is plain data. A change is published through
 * `bumpLook()`; the cache keys a frame on `lookVersion()`, so the room is
 * rendered again with the new numbers and faded in over the old one.
 *
 * Colours are `0xRRGGBB` sRGB, as everywhere in the kit. Angles are degrees.
 * Distances are tiles.
 */

export type Hex = number

export interface HourLook {
  /** The sky gradient, top and horizon. Painted in CSS behind the render, and the fog's colour. */
  sky: { top: Hex; horizon: Hex }
  /**
   * The key light. `elevation` above the horizon; `azimuth` 0 is +z (towards
   * the camera), 90 is +x. Chosen so the shadows fall towards the camera or
   * across the plaza, never straight away from it: a shadow the viewer cannot
   * see is a light that reads as flat.
   */
  sun: { color: Hex; intensity: number; elevation: number; azimuth: number }
  /** The hemisphere fill: the sky's colour from above, the ground's bounce from below. */
  ambient: { sky: Hex; ground: Hex; intensity: number }
  /** Street lamps, signs and lanterns are lit. */
  lampsOn: boolean
  /**
   * Share of windows lit, 0–1. **Under a half at every hour** (`WINDOWS_LIT_MAX`,
   * `sceneLighting.test.ts`): a district where four windows in five are lit
   * after dark is a wall of light, and a card table in front of a wall of
   * light is a table nobody rests their eyes at. A city at night is mostly
   * dark windows with a few lit, which is also what makes the lit ones read.
   */
  windowsLit: number
  /** How dark the hour is overall, 0 at noon to 1 at midnight. The CSS table dims by it, the bloom grows with it. */
  dark: number
}

export type ShadowType = 'vsm' | 'pcf'
export type ToneMapping = 'aces' | 'agx' | 'neutral' | 'none'
/** What the composite shows: the room, or one of the passes on its own, for tuning it. */
export type DebugView = 'off' | 'ao' | 'lit' | 'depth'

export interface Look {
  hours: Record<'dawn' | 'day' | 'dusk' | 'night', HourLook>
  sun: {
    /** Multiplies every hour's sun. */
    intensity: number
    /** Added to every hour's elevation, degrees: one knob to lower the sun everywhere. */
    elevationOffset: number
  }
  ambient: {
    /** Multiplies every hour's hemisphere. */
    intensity: number
    /** A second, cooler and dimmer sun from opposite the first, with no shadow: the sky's bounce on the far wall. 0 for none. */
    rim: number
  }
  shadow: {
    type: ShadowType
    /** Blur radius, in shadow-map texels: the penumbra. */
    radius: number
    /** VSM blur taps. */
    blurSamples: number
    bias: number
    /** Tiles. Under 0.3 the drum's top shadowed itself in diagonal stripes on the small maps. */
    normalBias: number
    /** The ground shadow a sprite carries on its own bitmap, 0–1. */
    spriteOpacity: number
  }
  material: {
    roughness: number
    metalness: number
    /** How much brighter than white an unlit face (a lamp, a lit window, neon) is: what the bloom sees. */
    glowIntensity: number
    /** The additive pools of light under the lamps, as a multiple of what the kit asked for. */
    haloIntensity: number
    /** How much darker a wall is at its foot than at its top, 0–1: the contact the occlusion pass sharpens. */
    footShade: number
  }
  outline: {
    /** Ink line weight in CSS pixels. */
    px: number
    /** The ink is the block's own colour scaled by this, then mixed towards `INK`… */
    darken: number
    /** …by this much. */
    inkMix: number
  }
  ao: {
    /** The wide radius, tiles: the darkening of a whole courtyard and the foot of a wall. */
    radius: number
    /** The tight radius, tiles: the crease between two blocks. */
    radiusSmall: number
    /** 0 for none, 1 for full. */
    intensity: number
    /** Contrast on the occlusion term: above 1 keeps the open ground clean and deepens the creases. */
    power: number
    /** Samples per pixel per radius. */
    samples: number
    /** Blur taps each way, in occlusion-map pixels. */
    blur: number
  }
  tone: {
    mapping: ToneMapping
    exposure: number
    /** How much the exposure rises with the rig's `dark`: a stormy night is still a room a spectator reads at 720p. */
    nightLift: number
    /** About mid-grey, after the tone curve. */
    contrast: number
    saturation: number
    /** Split toning, in display space: the shade is pulled towards this colour… */
    shadowTint: Hex
    /** …and the light towards this one… */
    highlightTint: Hex
    /** …by this much. */
    splitStrength: number
  }
  post: {
    /** Luminance above which a pixel blooms, in linear light after exposure. */
    bloomThreshold: number
    /** Bloom at noon… */
    bloomStrength: number
    /** …plus this much at midnight. */
    bloomDark: number
    /** The tilt-shift band: the sharp half-height as a multiple of the felt's, and the width of the ease past it, in frame heights. */
    dofBand: number
    dofEase: number
    /** How far out of focus the top and bottom of the frame go, 0–1. */
    dofMax: number
    /** Film grain amplitude, 0 for none. */
    grain: number
    /** Colour fringe in the corners, in frame pixels at the supersampled size. */
    aberration: number
  }
  fog: {
    /** How much of the rig's distance fog reaches the render. */
    strength: number
  }
  /** Dev only: the composite shows one pass alone. Always `off` in a build. */
  debug: DebugView
}

/** The most windows any hour may light, as a share. */
export const WINDOWS_LIT_MAX = 0.5

export const LOOK: Look = {
  hours: {
    dawn: {
      sky: { top: 0x5f74c8, horizon: 0xf9b184 },
      sun: { color: 0xffc48f, intensity: 3.0, elevation: 26, azimuth: 135 },
      ambient: { sky: 0x8fa3e6, ground: 0x7a6068, intensity: 1.1 },
      lampsOn: true,
      windowsLit: 0.15,
      dark: 0.3,
    },
    day: {
      sky: { top: 0x64b4ff, horizon: 0xd6eeff },
      sun: { color: 0xffe4b4, intensity: 3.3, elevation: 38, azimuth: 150 },
      ambient: { sky: 0xa8c4e8, ground: 0x8f8570, intensity: 1.15 },
      lampsOn: false,
      windowsLit: 0,
      dark: 0,
    },
    dusk: {
      sky: { top: 0x3e3f95, horizon: 0xff9a55 },
      sun: { color: 0xffa050, intensity: 3.0, elevation: 26, azimuth: -60 },
      ambient: { sky: 0x8a7cc4, ground: 0x7a5a50, intensity: 1.5 },
      lampsOn: true,
      windowsLit: 0.35,
      dark: 0.45,
    },
    night: {
      sky: { top: 0x070b2a, horizon: 0x1c2c66 },
      sun: { color: 0xa8bfff, intensity: 2.2, elevation: 44, azimuth: -40 },
      ambient: { sky: 0x3e55a8, ground: 0x1a2140, intensity: 1.6 },
      lampsOn: true,
      windowsLit: 0.45,
      dark: 1,
    },
  },
  sun: { intensity: 1, elevationOffset: 0 },
  ambient: { intensity: 1, rim: 0.35 },
  shadow: { type: 'vsm', radius: 6, blurSamples: 12, bias: 0, normalBias: 0.3, spriteOpacity: 0.4 },
  material: { roughness: 0.94, metalness: 0, glowIntensity: 1.8, haloIntensity: 0.45, footShade: 0.1 },
  outline: { px: 1.4, darken: 0.42, inkMix: 0.3 },
  ao: { radius: 1.8, radiusSmall: 0.45, intensity: 1.0, power: 2.0, samples: 16, blur: 4 },
  tone: {
    mapping: 'aces',
    exposure: 1.05,
    nightLift: 0.7,
    contrast: 1.06,
    saturation: 1.06,
    shadowTint: 0x35508f,
    highlightTint: 0xffcf8a,
    splitStrength: 0.09,
  },
  post: {
    bloomThreshold: 0.8,
    bloomStrength: 0.06,
    bloomDark: 0.22,
    dofBand: 2.0,
    dofEase: 0.34,
    dofMax: 0.45,
    grain: 0.028,
    aberration: 1.6,
  },
  fog: { strength: 1 },
  debug: 'off',
}

// ─── Editing it live ─────────────────────────────────────────────────────────

let version = 0
const listeners = new Set<() => void>()

/** Which edition of the look a frame was rendered with: part of the cache key. */
export function lookVersion(): number {
  return version
}

/** Says the look changed. The backdrop renders the room again on it. */
export function bumpLook(): void {
  version++
  listeners.forEach((l) => l())
}

/** A partial look, as the panel exports it and as `?lookPatch=` carries it. */
export type LookPatch = { [K in keyof Look]?: Partial<Look[K]> }

/**
 * Applies a partial look over `LOOK`, one level deep per block (an hour is
 * replaced whole), and publishes the change. Dev tooling only: the panel's
 * presets and the showcase's `?lookPatch=<json>`.
 */
export function applyLookPatch(patch: LookPatch): void {
  for (const key of Object.keys(patch) as (keyof Look)[]) {
    const block = patch[key]
    if (block && typeof block === 'object') Object.assign(LOOK[key] as object, block)
    else if (block !== undefined) (LOOK as unknown as Record<string, unknown>)[key] = block
  }
  bumpLook()
}

export function subscribeLook(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** The mapping's name as the renderer and the composite both read it. */
export const TONE_MAPPINGS: readonly ToneMapping[] = ['aces', 'agx', 'neutral', 'none']
export const SHADOW_TYPES: readonly ShadowType[] = ['vsm', 'pcf']
export const DEBUG_VIEWS: readonly DebugView[] = ['off', 'ao', 'lit', 'depth']
