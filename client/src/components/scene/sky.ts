/**
 * The light a scene is rendered in: the hour and the sky, as numbers.
 *
 * A map says *where* a match is played; this file says *when* and *under what*.
 * The two ids come off the wire beside `map_id` (`time_of_day`, `weather`, drawn
 * by the server in `game/maps.go` so every seat sees one sky) and everything
 * the renderer, the weather overlay and the CSS table need from them is derived
 * here, once, as plain data: no framework, no three.js, so it is testable and
 * so a content page could read it.
 *
 * The four hours are the four moods a scene can carry with one set of props;
 * the six skies are the ones a diorama can show without changing its geometry
 * (an overlay for what falls, a tint for what the light does, a flag for what
 * settles on a roof). `game/maps.go` lists which of the six each map allows,
 * and `maps.test.ts` pins this file's lists to that one.
 *
 * The numbers behind the four hours live in `look.ts` (`LOOK.hours`), beside every
 * other visual number, so the dev panel can move a sun; this file is the
 * arithmetic that turns them into one rig per hour and sky.
 */
import { LOOK, WINDOWS_LIT_MAX, type HourLook, type SkyBody } from './look'

export const TIMES = ['dawn', 'day', 'dusk', 'night'] as const
export type TimeOfDay = (typeof TIMES)[number]

export const WEATHERS = ['clear', 'cloudy', 'rain', 'storm', 'snow', 'fog'] as const
export type Weather = (typeof WEATHERS)[number]

export function isTime(v: unknown): v is TimeOfDay {
  return typeof v === 'string' && (TIMES as readonly string[]).includes(v)
}

export function isWeather(v: unknown): v is Weather {
  return typeof v === 'string' && (WEATHERS as readonly string[]).includes(v)
}

/** An sRGB colour as a 0xRRGGBB number, the form three.js and the kit take. */
export type Hex = number

/**
 * Everything the renderer needs to light a scene, plus what the board needs to
 * dress the table and the overlay in the same light.
 */
export interface LightRig {
  time: TimeOfDay
  weather: Weather
  /** Sky gradient, top and horizon: the dome's, the air's colour, and CSS behind the render. */
  sky: { top: Hex; horizon: Hex }
  /** The key light. Elevation and azimuth in degrees; azimuth 0 is +z (towards the camera), 90 is +x. */
  sun: { color: Hex; intensity: number; elevation: number; azimuth: number; shadow: number }
  /** Hemisphere fill. */
  ambient: { sky: Hex; ground: Hex; intensity: number }
  /** Street lamps, signs and lanterns are lit. */
  lampsOn: boolean
  /** Share of windows lit, 0–1. */
  windowsLit: number
  /** Snow has settled on every flat top and on the ground. */
  snow: boolean
  /** The ground is wet: darker, with puddles catching the sky. */
  wet: boolean
  /** How dark the scene is overall, 0 (noon) to 1 (a stormy night). The CSS table dims by it. */
  dark: number
  /** The light's own colour as CSS, for the highlight the table catches. */
  tintCss: string
  /** The room's own grade (`LOOK.rooms`, over `LOOK.tone`). */
  grade: { shadowTint: Hex; highlightTint: Hex; splitStrength: number; saturation: number }
  /** Multiplies the shadow's softness: the room's. */
  shadowSoftness: number
  /** The body drawn in a vista's sky, or null: none up in the frame, or hidden by the weather. */
  body: (SkyBody & { visibility: number }) | null
  /** Stars in a vista's sky, 0–1. */
  stars: number
  /** Cloud over a vista's sky, 0–1. */
  cloud: number
  /** Multiplies the air (`LOOK.vista.haze`): the room's (`LOOK.rooms[id].haze`) times the weather's. */
  haze: number
  /** A room in space: its planet, or null for a room under an atmosphere. */
  space: { planet: { azimuth: number; elevation: number; size: number; lit: { azimuth: number; elevation: number } } } | null
}

// ─── Colour arithmetic, on plain numbers ────────────────────────────────────

function channels(c: Hex): [number, number, number] {
  return [(c >> 16) & 255, (c >> 8) & 255, c & 255]
}

function fromChannels(r: number, g: number, b: number): Hex {
  const cl = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
  return (cl(r) << 16) | (cl(g) << 8) | cl(b)
}

/** Linear blend of two colours, `t` towards `b`. */
export function mix(a: Hex, b: Hex, t: number): Hex {
  const [ar, ag, ab] = channels(a)
  const [br, bg, bb] = channels(b)
  return fromChannels(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t)
}

/** Multiplies every channel. */
export function scale(c: Hex, k: number): Hex {
  const [r, g, b] = channels(c)
  return fromChannels(r * k, g * k, b * k)
}

/** Pulls a colour towards its own grey by `t`. */
export function desaturate(c: Hex, t: number): Hex {
  const [r, g, b] = channels(c)
  const grey = 0.3 * r + 0.59 * g + 0.11 * b
  return fromChannels(r + (grey - r) * t, g + (grey - g) * t, b + (grey - b) * t)
}

/** A CSS `#rrggbb` as a number, for a builder reading a table's materials. */
export function cssHex(css: string): Hex {
  return parseInt(css.replace('#', ''), 16)
}

export function hexCss(c: Hex): string {
  return `#${c.toString(16).padStart(6, '0')}`
}

// ─── The rig ────────────────────────────────────────────────────────────────

/**
 * The hour and the sky together. The weather is applied *over* the hour: a
 * storm at noon is still lit from above, a storm at night is a night with less
 * moon, and both are wet.
 */
export function lightRig(time: TimeOfDay, weather: Weather, room?: string): LightRig {
  const h: HourLook = LOOK.hours[time]
  const r = (room ? LOOK.rooms[room] : undefined) ?? {}
  const roomSky = r.sky?.[time] ?? h.sky
  let skyTop = roomSky.top
  let skyHorizon = roomSky.horizon
  let sunColor = h.sun.color
  // The hour's own numbers, through the look's two global knobs.
  let sunIntensity = h.sun.intensity * LOOK.sun.intensity
  let shadow = 1
  let ambientSky = h.ambient.sky
  let ambientGround = h.ambient.ground
  let ambientIntensity = h.ambient.intensity * LOOK.ambient.intensity
  let lampsOn = h.lampsOn
  let windowsLit = h.windowsLit
  let dark = h.dark
  let snow = false
  let wet = false

  // Overcast, wet and white skies all sit on the same grey, which is the sky's
  // own light mixed down. The hour still shows through it: a grey dusk is warm
  // and a grey dawn is pink, which is what keeps twenty-four combinations from
  // being six.
  const overcast = mix(desaturate(skyHorizon, 0.55), 0x9aa4b4, 0.5)

  switch (weather) {
    case 'clear':
      break
    case 'cloudy':
      skyTop = mix(skyTop, overcast, 0.55)
      skyHorizon = mix(skyHorizon, overcast, 0.65)
      sunColor = desaturate(sunColor, 0.5)
      sunIntensity *= 0.6
      shadow = 0.45
      ambientIntensity *= 1.15
      dark = Math.min(1, dark + 0.1)
      break
    case 'rain':
      skyTop = mix(skyTop, overcast, 0.7)
      skyHorizon = mix(skyHorizon, overcast, 0.75)
      sunColor = mix(desaturate(sunColor, 0.6), 0x9fb3cf, 0.4)
      sunIntensity *= 0.5
      shadow = 0.3
      ambientSky = mix(ambientSky, 0x8fa0b8, 0.4)
      ambientIntensity *= 1.05
      wet = true
      lampsOn = true
      windowsLit = Math.max(windowsLit, 0.5)
      dark = Math.min(1, dark + 0.2)
      break
    case 'storm':
      skyTop = mix(skyTop, 0x1c2130, 0.8)
      skyHorizon = mix(skyHorizon, 0x3a4256, 0.8)
      sunColor = mix(desaturate(sunColor, 0.7), 0x8593b3, 0.6)
      // Dark, but not so dark that a storm at noon is a storm at midnight: the
      // hour has to survive the weather, or twenty-four combinations are six.
      sunIntensity *= 0.4
      shadow = 0.25
      ambientSky = mix(ambientSky, 0x5a6684, 0.55)
      ambientGround = scale(ambientGround, 0.7)
      wet = true
      lampsOn = true
      windowsLit = Math.max(windowsLit, WINDOWS_LIT_MAX)
      dark = Math.min(1, dark + 0.25)
      break
    case 'snow': {
      // Snow brightens a day and must not brighten a night: mixed towards
      // white by the same amount at every hour, a snowy midnight read as a
      // winter afternoon. After dark the snow takes the night's blue.
      const lit = 1 - h.dark
      skyTop = mix(skyTop, 0xc6cfdc, 0.6 * lit + 0.1)
      skyHorizon = mix(skyHorizon, mix(0x55618f, 0xe8edf4, lit), 0.65)
      sunColor = mix(desaturate(sunColor, 0.4), 0xdfe9ff, 0.4)
      sunIntensity *= 0.75
      shadow = 0.5
      ambientSky = mix(ambientSky, mix(0x6a7aae, 0xdfe6f2, lit), 0.5)
      ambientGround = mix(ambientGround, mix(0x2e3860, 0xb8c2d2, lit), 0.6)
      ambientIntensity *= 1 + 0.2 * lit
      snow = true
      windowsLit = Math.max(windowsLit, 0.4)
      dark = Math.max(0, dark - 0.1 * lit)
      break
    }
    case 'fog': {
      const veil = mix(overcast, 0xdde3ea, time === 'night' ? 0.1 : 0.35)
      skyTop = mix(skyTop, veil, 0.7)
      skyHorizon = mix(skyHorizon, veil, 0.85)
      sunColor = desaturate(sunColor, 0.6)
      sunIntensity *= 0.55
      shadow = 0.35
      ambientSky = mix(ambientSky, veil, 0.5)
      ambientIntensity *= 1.1
      lampsOn = true
      windowsLit = Math.max(windowsLit, 0.5)
      dark = Math.min(1, dark + 0.15)
      break
    }
  }

  // The key light is the hour's, or the room's own (`LOOK.rooms[id].sun`):
  // low over the horizon at the two ends of the day, lighting the room from
  // behind so the shadows come towards the table.
  const sunAngles = r.sun?.[time] ?? h.sun
  // A room may put its own body up (a sun where the hour has none) or take
  // the hour's down (`null`: there is no moon over the moon).
  const own = r.body?.[time]
  const bodyAt = own === null ? null : h.body ? { ...h.body, ...(own ?? {}) } : own && own.kind ? ({ azimuth: 180, elevation: 5, size: 1.5, ...own } as SkyBody) : null
  // What the weather leaves of it: a veil over it in a cloudy sky, nothing in
  // rain, a storm or a fog.
  // Space has no weather in its sky: a dust storm or a flare is on the ground.
  const visibility = r.space ? 1 : weather === 'clear' || weather === 'snow' ? 1 : weather === 'cloudy' ? 0.45 : 0
  const cloud = r.space ? 0 : Math.min(1, LOOK.vista.sky.clouds + (weather === 'cloudy' ? 0.45 : weather === 'rain' || weather === 'storm' ? 0.6 : weather === 'snow' ? 0.4 : 0))

  // The room's own light, over the hour and the sky.
  if (r.sunTint !== undefined) sunColor = mix(sunColor, r.sunTint, r.sunTintMix ?? 0)
  if (r.skyTint !== undefined) ambientSky = mix(ambientSky, r.skyTint, r.skyTintMix ?? 0)
  ambientIntensity *= r.ambient ?? 1

  return {
    time,
    weather,
    grade: {
      shadowTint: r.shadowTint ?? LOOK.tone.shadowTint,
      highlightTint: r.highlightTint ?? LOOK.tone.highlightTint,
      splitStrength: r.splitStrength ?? LOOK.tone.splitStrength,
      saturation: r.saturation ?? LOOK.tone.saturation,
    },
    shadowSoftness: r.shadowSoftness ?? 1,
    sky: { top: skyTop, horizon: skyHorizon },
    sun: { azimuth: sunAngles.azimuth, color: sunColor, intensity: sunIntensity, shadow, elevation: Math.max(3, Math.min(85, sunAngles.elevation + LOOK.sun.elevationOffset)) },
    ambient: { sky: ambientSky, ground: ambientGround, intensity: ambientIntensity },
    lampsOn,
    windowsLit: Math.min(WINDOWS_LIT_MAX, windowsLit),
    snow,
    wet,
    dark,
    tintCss: hexCss(mix(sunColor, 0xffffff, 0.25)),
    body: bodyAt && visibility > 0 ? { ...bodyAt, visibility } : null,
    stars: r.space ? 1 : visibility > 0 ? h.stars * visibility : 0,
    cloud,
    haze: (r.haze ?? 1) * LOOK.vista.haze.weather[weather],
    space: r.space ?? null,
  }
}

/**
 * The rig as CSS custom properties, for the sky painted behind the render, the
 * table's highlight and the overlay. One place turns numbers into strings.
 */
export function rigCssVars(rig: LightRig): string {
  const [dx, dy] = shadowDirection(rig)
  return [
    `--sky-top: ${hexCss(rig.sky.top)}`,
    `--sky-horizon: ${hexCss(rig.sky.horizon)}`,
    `--scene-tint: ${rig.tintCss}`,
    `--scene-dark: ${rig.dark.toFixed(2)}`,
    `--sun-dx: ${dx.toFixed(3)}`,
    `--sun-dy: ${dy.toFixed(3)}`,
  ].join('; ')
}

/**
 * Where a shadow falls on screen under this sun: a unit-ish vector, x right and
 * y down, longer the lower the sun. The CSS table's cast shadow takes it, so
 * the table's shadow lies the way every block's does in the render behind it.
 */
export function shadowDirection(rig: LightRig): [number, number] {
  const az = (rig.sun.azimuth * Math.PI) / 180
  const el = (rig.sun.elevation * Math.PI) / 180
  // The shadow runs away from the sun: world (-sin az, 0, -cos az).
  const wx = -Math.sin(az)
  const wz = -Math.cos(az)
  // Seen from the table: world +x is screen right, and +z comes towards the
  // camera, down the screen, foreshortened by the low eye.
  const len = Math.min(2.2, Math.max(0.35, 0.45 / Math.tan(el)))
  return [wx * len * 0.8, wz * len * 0.3]
}
