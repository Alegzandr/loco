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
  /** The sky gradient, top and horizon: the dome's (`dome.ts`), the air's colour, and CSS behind the render. */
  sky: { top: Hex; horizon: Hex }
  /**
   * The key light. `elevation` above the horizon; `azimuth` 0 is +z (towards
   * the camera, behind it), 180 straight ahead. At the two ends of the day
   * it is the body in the frame, lighting the room from behind so the long
   * shadows come towards the table; at noon it is high and to the side.
   */
  sun: { color: Hex; intensity: number; elevation: number; azimuth: number }
  /** The body drawn in the sky, or null for one out of the frame (noon: the sun is overhead). */
  body: SkyBody | null
  /** Stars, 0–1. */
  stars: number
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
  /**
   * The sun's shadow: one PCF map over the near ground (`render.ts`). Not
   * VSM: three keeps the VSM moments in half floats, and over the depth a sun
   * sees the mean quantises in steps of a hand's width — at a metre a tile,
   * a staircase along every shadow edge on the planks.
   */
  shadow: {
    /** Blur radius, in shadow-map texels: the penumbra. */
    radius: number
    bias: number
    /** Tiles. A tile is a metre and a texel a centimetre or two: more shifts a shadow off its caster. */
    normalBias: number
    /** The side of a sprite's shadow map, texels: small, a sprite casts on nothing of the room's. */
    spriteMap: number
    /**
     * How far the map reaches from the table, tiles: `side` either way across,
     * `back` away from the camera, `up` the top of what receives. The texels are
     * spread over it, so a room reaches further only when a caster stands there.
     */
    reach: ShadowReach
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
    /**
     * The wide glow a light lays in the air round it, at midnight (it follows
     * the hour's `dark`): what makes a lamp a light and not a coloured dot.
     */
    bloomWide: number
    /** How wide, in sixteenth-frame texels per tap. */
    bloomWideSpread: number
    /** How much more of it per unit of air the weather adds over a clear night: a lamp in the fog is a ball of light. */
    bloomWeather: number
    /**
     * What counts as a light, in linear light after exposure (where it starts,
     * and the knee to full): a light shines through the mist and the air
     * rather than sinking into them like a wall.
     */
    emitFrom: number
    emitKnee: number
    /** How much of the air a light sees through, 0-1, when the lamps are on. */
    pierce: number
    /** The out-of-focus copy's blur step, in half-frame texels per tap. */
    dofSpread: number
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
    /**
     * How much of the mirrored room a water surface shows over its own colour
     * when looked straight into, 0–1: the Fresnel term takes it to a mirror
     * at the horizon (`mirror.ts`).
     */
    reflect: number
    /** How far the swell stretches a reflection down the frame: the road of light towards a low sun. */
    stretch: number
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
  mist: {
    /** How thick the mist lies at a clear dawn, and in a fog at any hour. 0 for none. */
    dawn: number
    fog: number
    /** The height over which it thins by e, tiles. */
    height: number
    /** Where it starts, tiles from the lens: it is full four times as far. */
    near: number
    /** The size of its banks: the noise's frequency, per tile. */
    scale: number
    /** How far its colour is lifted from the horizon towards white, and how bright it is in linear light. */
    lift: number
    brightness: number
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
  /** The view from the table (`view.ts`): the camera, the drawn sky, the air. */
  vista: VistaLook
  /**
   * The table's finishes (`kit.ts: Finish`, `docs/notes/visual.md`, "The
   * table"): the one object in the room that is not a block. Physically based
   * rather than the room's matte, because it is the thing nearest the camera
   * and made of what a room's matte cannot say — varnish, lacquer, metal,
   * polished stone.
   */
  table: TableLook
  /** Each room's own light (`RoomLook`), by map id. */
  rooms: Record<string, RoomLook>
  /** Dev only: the composite shows one pass alone. Always `off` in a build. */
  debug: DebugView
}

export interface ShadowReach {
  side: number
  back: number
  up: number
}

/** A body in the sky: where it stands, what it is, how large it is drawn. */
export interface SkyBody {
  kind: 'sun' | 'moon'
  /** Degrees, same convention as the sun: 0 towards the camera, 180 straight ahead. */
  azimuth: number
  /** Degrees above the horizon. */
  elevation: number
  /** Its angular radius, degrees: drawn larger than life, the way a painter does. */
  size: number
}

export interface FinishLook {
  roughness: number
  metalness: number
  /** The varnish or lacquer over it, 0–1, when the finish does not say. */
  clearcoat: number
  clearcoatRoughness: number
  /** A cloth's sheen, 0–1: the light caught along its fibres at a grazing look. */
  sheen?: number
  sheenRoughness?: number
  /** The sheen's colour, as a mix from the cloth's own colour towards white, 0–1. */
  sheenLift?: number
}

export interface TableLook {
  wood: FinishLook
  lacquer: FinishLook
  metal: FinishLook
  brushed: FinishLook
  marble: FinishLook
  /** The felt: a cloth, matte, with a sheen and nothing drawn on it. */
  cloth: FinishLook
  /**
   * The rail round the felt and the racetrack inside it, as the render builds
   * them (`vista.ts: vistaTable`). Widths are board pixels taken in on both
   * axes, so every line round the table is an ellipse concentric with the
   * felt, and the rail and the track together are `layout.ts: CLOTH_INSET`;
   * heights are metres.
   */
  rail: {
    /** The rail's width, and how high its crown stands over the cloth. */
    width: number
    height: number
    /** The racetrack's width inside it, and the metal filet along its inner edge. */
    track: number
    filet: number
  }
  /** Metres of skirt under the edge, set back: what the edge's shadow falls on. */
  skirt: number
  /**
   * The lamp over the table (`lighting.ts: makeTableLamp`): every card table
   * is played under one, and without it a table at dusk is lit by a sun a few
   * degrees up and is black. Warm, straight down, its pool reaching the rail
   * and fading over it. Its strength runs from `day` at noon to `night` in
   * the dark (`LightRig.dark`).
   */
  lamp: {
    color: Hex
    day: number
    night: number
    /** Metres over the cloth. */
    height: number
    /** The cone's half-angle, degrees, and the share of it that fades. */
    angle: number
    penumbra: number
  }
  /** How strongly the finishes mirror the sky. */
  envIntensity: number
  /** Metres of the piece one tile of its grain covers, along it and across it. */
  grainSpan: [number, number]
}

export interface VistaLook {
  camera: {
    /** Where the horizon sits, share of the frame from the top. */
    horizon: number
    horizonMin: number
    /** The table's depth over its width on the ground. */
    aspect: number
    aspectMax: number
    /** The range of fields of view across the frame, degrees. */
    fov: [number, number]
    /** How far the camera turns down towards the table, 0–1. */
    tilt: number
    /** Half the table's width, and the height of its top, tiles (metres). */
    tableHalfWidth: number
    tableTop: number
    /** The nearest and farthest the camera draws, tiles. */
    near: number
    far: number
  }
  /**
   * The air between the table and the horizon (aerial perspective): the far
   * sinks into the colour of the sky low down, and towards the sun it glows.
   */
  haze: {
    /** Tiles over which the air takes a third of what is behind it. */
    distance: number
    /** The most it may take, 0–1: the horizon's own silhouettes still show. */
    max: number
    /** How much brighter and warmer the air is towards the sun, 0 for none. */
    sunGlow: number
    /** How narrow that glow is: a power on the cosine. */
    sunGlowPower: number
    /** How much the far loses of its saturation on top, 0–1. */
    desaturate: number
    /** How much thicker the weather makes it: a fog closes the bay, a storm greys it. */
    weather: Record<'clear' | 'cloudy' | 'rain' | 'storm' | 'snow' | 'fog', number>
  }
  sky: {
    /** How the gradient climbs: a power on the height above the horizon. */
    curve: number
    /** The glow round the body, as a multiple of its colour, and how wide, degrees. */
    halo: number
    haloSize: number
    /** The wide bloom of light round a low sun, over the whole of that side of the sky. */
    aureole: number
    /** The body's brightness, in linear light: what the bloom sees. */
    bodyGlow: number
    /** How much cloud, 0–1, on a clear sky; the weather adds to it. */
    clouds: number
    /** The clouds' size, per degree of sky. */
    cloudScale: number
  }
  /** The ink in a room seen from the table: `outline.px` near, thinning to this share of it by `fade` tiles. */
  inkFar: number
  inkFade: number
  /** How far out of focus the far goes, 0–1: a lens focused on the table. */
  dof: number
  /** Bloom on top of the look's own: a sun in the frame spills. */
  bloom: number
}

/**
 * What makes one room's light its own, on top of the hour and the sky
 * (`sky.ts: lightRig`, its third argument). Every field is optional and
 * moves a number the hour already set; none of them may undo the warm/cool
 * split (`sceneLighting.test.ts` runs the split per room too).
 */
export interface RoomLook {
  /** The sun pulled towards this colour… */
  sunTint?: Hex
  /** …by this much. */
  sunTintMix?: number
  /** The sky's light pulled towards this colour… */
  skyTint?: Hex
  /** …by this much. */
  skyTintMix?: number
  /** Multiplies the sky's light: under 1 is a place with little sky (the moon). */
  ambient?: number
  /** Multiplies the shadow's softness: under 1 is a harder shadow. */
  shadowSoftness?: number
  /** The shadow map's reach, over `LOOK.shadow.reach`: a room whose middle ground has a row of casters out past it. */
  shadowReach?: Partial<ShadowReach>
  /** The body in this room's sky, per hour, over `LOOK.hours[h].body`: where the sun rises is a room's. */
  body?: Partial<Record<'dawn' | 'day' | 'dusk' | 'night', Partial<SkyBody> | null>>
  /** This room's key light, per hour, over `LOOK.hours[h].sun`. */
  sun?: Partial<Record<'dawn' | 'day' | 'dusk' | 'night', { azimuth: number; elevation: number }>>
  /** This room's sky, per hour, over `LOOK.hours[h].sky`. */
  sky?: Partial<Record<'dawn' | 'day' | 'dusk' | 'night', { top: Hex; horizon: Hex }>>
  /** Multiplies the air's thickness (`LOOK.vista.haze`): under 1 is a place with little air. */
  haze?: number
  /**
   * A room with no air at all: the sky is black at every hour and full of
   * stars, and a planet hangs in it — where, how large, lit by the sun.
   */
  space?: { planet: { azimuth: number; elevation: number; size: number; lit: { azimuth: number; elevation: number } } }
  /** The grade's split tones and saturation, in place of the look's own. */
  shadowTint?: Hex
  highlightTint?: Hex
  splitStrength?: number
  saturation?: number
}

/** The most windows any hour may light, as a share. */
export const WINDOWS_LIT_MAX = 0.5

export const LOOK: Look = {
  hours: {
    dawn: {
      sky: { top: 0x3d3f8e, horizon: 0xff9a6a },
      sun: { color: 0xffc48f, intensity: 3.0, elevation: 7, azimuth: 205 },
      body: { kind: 'sun', azimuth: 205, elevation: 4, size: 1.6 },
      stars: 0,
      ambient: { sky: 0x8fa3e6, ground: 0x7a6068, intensity: 1.1 },
      lampsOn: true,
      windowsLit: 0.15,
      dark: 0.3,
    },
    day: {
      sky: { top: 0x2f7fe0, horizon: 0xbfe1f7 },
      // High and to the side, its body out of the frame.
      sun: { color: 0xffe4b4, intensity: 3.3, elevation: 48, azimuth: 130 },
      body: null,
      stars: 0,
      ambient: { sky: 0xa8c4e8, ground: 0x8f8570, intensity: 1.15 },
      lampsOn: false,
      windowsLit: 0,
      dark: 0,
    },
    dusk: {
      sky: { top: 0x2a2468, horizon: 0xff7a45 },
      sun: { color: 0xffa050, intensity: 3.0, elevation: 6, azimuth: 158 },
      body: { kind: 'sun', azimuth: 158, elevation: 3.5, size: 1.8 },
      stars: 0.15,
      ambient: { sky: 0x8a7cc4, ground: 0x7a5a50, intensity: 1.5 },
      lampsOn: true,
      windowsLit: 0.35,
      dark: 0.45,
    },
    night: {
      sky: { top: 0x070a26, horizon: 0x2a3b78 },
      // The moon, high enough to throw a shadow, its disc low in the frame.
      sun: { color: 0xa8bfff, intensity: 2.2, elevation: 24, azimuth: 200 },
      body: { kind: 'moon', azimuth: 200, elevation: 4.5, size: 1.3 },
      stars: 1,
      ambient: { sky: 0x3e55a8, ground: 0x1a2140, intensity: 1.6 },
      lampsOn: true,
      windowsLit: 0.45,
      dark: 1,
    },
  },
  sun: { intensity: 1, elevationOffset: 0 },
  ambient: { intensity: 1, rim: 0.35 },
  shadow: { radius: 6, bias: -0.0004, normalBias: 0.03, spriteMap: 512, reach: { side: 16, back: 42, up: 12 } },
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
    bloomWide: 0.35,
    bloomWideSpread: 1.6,
    bloomWeather: 0.35,
    emitFrom: 0.7,
    emitKnee: 0.45,
    pierce: 0.85,
    dofSpread: 1.4,
    aberration: 1.6,
    aberrationFrom: 0.09,
    aberrationTo: 0.5,
    vignetteFrom: 0.42,
    vignetteTo: 1.15,
    vignetteSquash: 1.15,
    vignetteScale: 1.41,
  },
  water: { reflect: 0.12, stretch: 4, sky: 0.12, wetMirror: 0.7, ripple: 0.006, waveAmp: 0.22, waveScale: 1.1, streak: 0.007, scale: 0.5, roughness: 0.3 },
  mist: { dawn: 0.55, fog: 0.5, height: 5, near: 22, scale: 0.02, lift: 0.35, brightness: 0.75 },
  pools: { strength: 6, reach: 1.6, washFrom: 8, lift: 0.7, windowSpill: 0.5, texelsPerTile: 8, maxSide: 1024 },
  vista: {
    camera: { horizon: 0.13, horizonMin: 0.05, aspect: 1.5, aspectMax: 2.4, fov: [58, 84], tilt: 0.3, tableHalfWidth: 2.2, tableTop: 0.9, near: 0.3, far: 6000 },
    haze: { distance: 700, max: 0.75, sunGlow: 0.7, sunGlowPower: 8, desaturate: 0.25, weather: { clear: 1, cloudy: 1.25, rain: 2, storm: 2.4, snow: 1.8, fog: 4.5 } },
    sky: { curve: 0.32, halo: 1.2, haloSize: 2.5, aureole: 0.6, bodyGlow: 10, clouds: 0.5, cloudScale: 0.09 },
    inkFar: 0.15,
    inkFade: 60,
    dof: 0.25,
    bloom: 0.22,
  },
  table: {
    wood: { roughness: 0.62, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.2 },
    lacquer: { roughness: 0.34, metalness: 0, clearcoat: 0.18, clearcoatRoughness: 0.08 },
    metal: { roughness: 0.16, metalness: 1, clearcoat: 0, clearcoatRoughness: 0 },
    brushed: { roughness: 0.36, metalness: 1, clearcoat: 0, clearcoatRoughness: 0 },
    marble: { roughness: 0.22, metalness: 0, clearcoat: 0.2, clearcoatRoughness: 0.08 },
    cloth: { roughness: 0.92, metalness: 0, clearcoat: 0, clearcoatRoughness: 0, sheen: 0.6, sheenRoughness: 0.55, sheenLift: 0.35 },
    rail: { width: 19, height: 0.05, track: 22, filet: 2 },
    skirt: 0.14,
    lamp: { color: 0xffe2b8, day: 1.0, night: 1.5, height: 3.4, angle: 52, penumbra: 1 },
    envIntensity: 0.3,
    grainSpan: [1.6, 0.3],
  },
  rooms: {
    // The city under its signs: a violet sky light, the highlights pushed
    // towards pink and the shade towards indigo.
    neon: {
      // A city's night is never dark: violet with its own light low down.
      sky: { night: { top: 0x0b0a2a, horizon: 0x5b2a7e }, dusk: { top: 0x241c5c, horizon: 0xff6a7a } },
      body: { night: { azimuth: 212, elevation: 3.4, size: 1.2 } },
      skyTint: 0x6a4cff, skyTintMix: 0.2, shadowTint: 0x3b2f9a, highlightTint: 0xff9ad5, splitStrength: 0.12, saturation: 1.1 },
    // The village: a gold that is a little older than the day's.
    rune: {
      sunTint: 0xffc27a, sunTintMix: 0.12, highlightTint: 0xffd08a, splitStrength: 0.1 },
    // The hotel: brass in the light, a deep blue in the shade.
    // Its promenade of palms runs out to 160 tiles, 22 either side: under the
    // default reach not one of them cast a shadow.
    velvet: {
      shadowReach: { side: 30, back: 165 },
      sunTint: 0xffc58a, sunTintMix: 0.15, shadowTint: 0x2c3f86, highlightTint: 0xffc070, splitStrength: 0.12, saturation: 1.04 },
    // No air: little sky light, a hard shadow, a sun that is white, and the
    // shade lit by the Earth's blue.
    orbit: {
      // No air: a black sky at every hour, the Earth in it, and the far as
      // sharp as the near.
      space: { planet: { azimuth: 198, elevation: 4.5, size: 4, lit: { azimuth: 120, elevation: 20 } } },
      // Lit low and from ahead at every hour by a white sun: long shadows
      // towards the table and a dark ground, which is what a moon looks like.
      // Its "night" is the long lunar evening, the sun just off the frame.
      sun: { night: { azimuth: 140, elevation: 5 }, dawn: { azimuth: 150, elevation: 6 }, dusk: { azimuth: 150, elevation: 6 }, day: { azimuth: 160, elevation: 22 } },
      ambient: 0.35,
      haze: 0.06,
      sky: { dawn: { top: 0x020308, horizon: 0x0c1022 }, day: { top: 0x020308, horizon: 0x10152a }, dusk: { top: 0x020308, horizon: 0x0c1022 }, night: { top: 0x010205, horizon: 0x070a18 } },
      body: { night: null, dawn: { azimuth: 150, elevation: 4, size: 1.2 }, dusk: { azimuth: 150, elevation: 4, size: 1.2 } }, sunTint: 0xfff4e4, sunTintMix: 0.85, skyTint: 0x8a96b0, skyTintMix: 0.5, shadowSoftness: 0.4, saturation: 0.95, splitStrength: 0.07 },
    // The cherry trees: a pink in the highlights.
    sakura: {
      // A spring noon is clear: blue overhead, and the air thin enough that
      // the mountain stands out behind the pagoda.
      sky: { day: { top: 0x3f8fe8, horizon: 0xcfe6f5 } },
      haze: 0.7, highlightTint: 0xffc6d8, shadowTint: 0x4a5aa8, saturation: 1.05 },
    // The harbour: teal in the shade, a sunlit sand in the light. Seen from
    // a table on the quay, the bay running out to the horizon.
    marina: { shadowTint: 0x2f6f8f, highlightTint: 0xffd9a0, splitStrength: 0.1, saturation: 1.08 },
  },
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
export const DEBUG_VIEWS: readonly DebugView[] = ['off', 'ao', 'lit', 'depth']
