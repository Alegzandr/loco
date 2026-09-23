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
    /**
     * The side of a sprite's own shadow map, texels. It is fitted to the
     * sprite's box — a car, a walker, a few tiles — so a small map already
     * holds more texels a tile than the room's does, and a room's worth of
     * sprites no longer renders the room-sized map once each.
     */
    spriteMap: number
    /** The colour of a sprite's ground shadow: this note… */
    spriteTint: Hex
    /** …mixed this far towards the hour's sky light. */
    spriteTintMix: number
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
    /**
     * The roughness of a surface at full gloss. A block carries a gloss of 0
     * to 1 in its vertices (`BlockOptions.gloss`): 0 is the matte above, 1 is
     * this. Glass, a wet street, water, a car's paint.
     */
    glossRoughness: number
    /**
     * How strongly a glossy surface mirrors the sky (the environment the rig
     * paints, `lighting.ts: skyEnvironment`). Only the reflection: the sky's
     * diffuse light is the hemisphere's, and a matte block reflects nothing.
     */
    envIntensity: number
    /** Window glass, 0–1. */
    glassGloss: number
    /** The ground under rain: a street that has taken water. 0–1. */
    wetGloss: number
    /** A car's paint, a spacesuit's visor and hull: the drawn kits that are not matte, 0–1. */
    paintGloss: number
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
    /** How fast the blur's weight falls with depth, per tile of depth over the camera's range: at 0.7 a tile's difference roughly halves it. */
    blurDepthFalloff: number
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
    /** How far past the threshold the bloom takes to reach full weight: the knee. */
    bloomKnee: number
    /** Bloom at noon… */
    bloomStrength: number
    /** …plus this much at midnight. */
    bloomDark: number
    /** The tilt-shift band: the sharp half-height as a multiple of the felt's, and the width of the ease past it, in frame heights. */
    dofBand: number
    dofEase: number
    /** How far out of focus the top and bottom of the frame go, 0–1. */
    dofMax: number
    /** The out-of-focus copy's blur step, in half-frame texels per tap. */
    dofSpread: number
    /** Film grain amplitude, 0 for none. */
    grain: number
    /** Colour fringe in the corners, in frame pixels at the supersampled size. */
    aberration: number
    /** Where the fringe starts and where it is full, as squared distance from the centre (0.25 is an edge's midpoint). */
    aberrationFrom: number
    aberrationTo: number
    /**
     * The vignette's shape (its strength is the tier's): the distance from the
     * centre, squashed vertically by `vignetteSquash` and scaled by
     * `vignetteScale` so a corner is about 1, darkens from `vignetteFrom` to
     * `vignetteTo`.
     */
    vignetteFrom: number
    vignetteTo: number
    vignetteSquash: number
    vignetteScale: number
  }
  water: {
    /** How much of the mirrored room a water surface shows over its own colour, 0–1. */
    reflect: number
    /** How much of the sky tints it, 0–1: little, or the sea goes pale. */
    sky: number
    /** How much of the mirrored room a wet street takes on top of its sheen: the lamps in it after dark. */
    wetMirror: number
    /** How far the swell moves the reflection, in frame uv per unit of slope. */
    ripple: number
    /** The swell's slope: the glints and the break in the reflection. */
    waveAmp: number
    /** The swell's frequency, per tile. */
    waveScale: number
    /** How far down the frame a wet street smears a reflection, per tap, in frame uv. */
    streak: number
    /** The mirror pass's size, as a share of the frame's. */
    scale: number
    /** The water's own roughness under the sun: what makes the glints small or broad. */
    roughness: number
  }
  pools: {
    /** How strongly a lamp lights the ground under it, per unit of the alpha the kit's halo asked for. */
    strength: number
    /** How far past the old disc's radius the light reaches, as a multiple: a falloff needs room. */
    reach: number
    /** Up to this height a surface takes the whole pool; above it the light fades, tile by tile. */
    lift: number
    /** A halo wider than this, tiles, is not a lamp's but the room's colour over the plaza, and stays an additive wash. */
    washFrom: number
    /** How strongly a lit ground-floor window spills onto the pavement in front of it. */
    windowSpill: number
    /** The map's resolution, texels per tile, and its largest side. */
    texelsPerTile: number
    maxSide: number
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
  shadow: { type: 'vsm', radius: 6, blurSamples: 12, bias: 0, normalBias: 0.3, spriteOpacity: 0.4, spriteMap: 512, spriteTint: 0x10163a, spriteTintMix: 0.35 },
  material: { roughness: 0.94, metalness: 0, glowIntensity: 1.8, haloIntensity: 0.45, footShade: 0.1, glossRoughness: 0.14, envIntensity: 1.0, glassGloss: 0.9, wetGloss: 0.55, paintGloss: 0.45 },
  outline: { px: 1.4, darken: 0.42, inkMix: 0.3 },
  ao: { radius: 1.8, radiusSmall: 0.45, intensity: 1.0, power: 2.0, samples: 16, blur: 4, blurDepthFalloff: 0.7 },
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
    bloomKnee: 0.5,
    bloomStrength: 0.06,
    bloomDark: 0.22,
    dofBand: 2.0,
    dofEase: 0.34,
    dofMax: 0.45,
    dofSpread: 1.4,
    grain: 0.028,
    aberration: 1.6,
    aberrationFrom: 0.09,
    aberrationTo: 0.5,
    vignetteFrom: 0.42,
    vignetteTo: 1.15,
    vignetteSquash: 1.15,
    vignetteScale: 1.41,
  },
  water: { reflect: 0.5, sky: 0.12, wetMirror: 0.7, ripple: 0.006, waveAmp: 0.22, waveScale: 1.1, streak: 0.007, scale: 0.5, roughness: 0.3 },
  pools: { strength: 6, reach: 1.6, washFrom: 8, lift: 0.7, windowSpill: 0.5, texelsPerTile: 8, maxSide: 1024 },
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
