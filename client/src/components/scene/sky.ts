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
 */

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
  /** Sky gradient, top and horizon. Painted in CSS behind the render and used as the fog colour. */
  sky: { top: Hex; horizon: Hex }
  /** The key light. Elevation and azimuth in degrees; azimuth 0 is +z (towards the camera), 90 is +x. */
  sun: { color: Hex; intensity: number; elevation: number; azimuth: number; shadow: number }
  /** Hemisphere fill. */
  ambient: { sky: Hex; ground: Hex; intensity: number }
  /** Distance fog, or null. `near`/`far` are fractions of the visible depth, 0 = the bottom of the frame, 1 = the top. */
  fog: { color: Hex; near: number; far: number } | null
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
}

interface Base {
  sky: { top: Hex; horizon: Hex }
  sun: { color: Hex; intensity: number; elevation: number; azimuth: number }
  ambient: { sky: Hex; ground: Hex; intensity: number }
  lampsOn: boolean
  windowsLit: number
  dark: number
}

/**
 * The hour on its own. Azimuths are chosen so the shadows fall towards the
 * camera or across the plaza, never straight away from it: a shadow the viewer
 * cannot see is a light that reads as flat.
 */
const HOURS: Record<TimeOfDay, Base> = {
  dawn: {
    sky: { top: 0x5a6ec0, horizon: 0xf7a97b },
    sun: { color: 0xffb07a, intensity: 1.55, elevation: 16, azimuth: 120 },
    ambient: { sky: 0x93a3de, ground: 0x6d5860, intensity: 0.95 },
    lampsOn: true,
    windowsLit: 0.3,
    dark: 0.3,
  },
  day: {
    sky: { top: 0x63b3ff, horizon: 0xd2ecff },
    sun: { color: 0xfff5dc, intensity: 2.3, elevation: 56, azimuth: 60 },
    ambient: { sky: 0xbfe1ff, ground: 0x8f927c, intensity: 0.85 },
    lampsOn: false,
    windowsLit: 0,
    dark: 0,
  },
  dusk: {
    sky: { top: 0x3b3d8f, horizon: 0xff9752 },
    sun: { color: 0xff8b3d, intensity: 1.5, elevation: 11, azimuth: -110 },
    ambient: { sky: 0x7c5fae, ground: 0x5d4048, intensity: 0.8 },
    lampsOn: true,
    windowsLit: 0.7,
    dark: 0.45,
  },
  night: {
    sky: { top: 0x060a26, horizon: 0x1b2a60 },
    sun: { color: 0x9fb6ff, intensity: 0.55, elevation: 48, azimuth: -40 },
    ambient: { sky: 0x2b3c80, ground: 0x0f1428, intensity: 0.55 },
    lampsOn: true,
    windowsLit: 0.85,
    dark: 1,
  },
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
export function lightRig(time: TimeOfDay, weather: Weather): LightRig {
  const h = HOURS[time]
  let skyTop = h.sky.top
  let skyHorizon = h.sky.horizon
  let sunColor = h.sun.color
  let sunIntensity = h.sun.intensity
  let shadow = 1
  let ambientSky = h.ambient.sky
  let ambientGround = h.ambient.ground
  let ambientIntensity = h.ambient.intensity
  let lampsOn = h.lampsOn
  let windowsLit = h.windowsLit
  let dark = h.dark
  let fog: LightRig['fog'] = null
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
      sunIntensity *= 0.32
      shadow = 0.2
      ambientSky = mix(ambientSky, 0x5a6684, 0.55)
      ambientGround = scale(ambientGround, 0.7)
      wet = true
      lampsOn = true
      windowsLit = Math.max(windowsLit, 0.75)
      dark = Math.min(1, dark + 0.4)
      break
    case 'snow':
      skyTop = mix(skyTop, 0xc6cfdc, 0.6)
      skyHorizon = mix(skyHorizon, 0xe8edf4, 0.65)
      sunColor = mix(desaturate(sunColor, 0.4), 0xdfe9ff, 0.4)
      sunIntensity *= 0.75
      shadow = 0.5
      ambientSky = mix(ambientSky, 0xdfe6f2, 0.5)
      ambientGround = mix(ambientGround, 0xb8c2d2, 0.6)
      ambientIntensity *= 1.2
      snow = true
      windowsLit = Math.max(windowsLit, 0.4)
      dark = Math.max(0, dark - 0.1)
      break
    case 'fog': {
      const veil = mix(overcast, 0xdde3ea, time === 'night' ? 0.1 : 0.45)
      skyTop = mix(skyTop, veil, 0.7)
      skyHorizon = mix(skyHorizon, veil, 0.85)
      sunColor = desaturate(sunColor, 0.6)
      sunIntensity *= 0.55
      shadow = 0.35
      ambientSky = mix(ambientSky, veil, 0.5)
      ambientIntensity *= 1.1
      fog = { color: skyHorizon, near: 0.3, far: 0.95 }
      lampsOn = true
      windowsLit = Math.max(windowsLit, 0.5)
      dark = Math.min(1, dark + 0.15)
      break
    }
  }

  return {
    time,
    weather,
    sky: { top: skyTop, horizon: skyHorizon },
    sun: { ...h.sun, color: sunColor, intensity: sunIntensity, shadow },
    ambient: { sky: ambientSky, ground: ambientGround, intensity: ambientIntensity },
    fog,
    lampsOn,
    windowsLit,
    snow,
    wet,
    dark,
    tintCss: hexCss(mix(sunColor, 0xffffff, 0.25)),
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
  const dx = (wx - wz) / Math.SQRT2
  const dy = ((wx + wz) / Math.SQRT2) * Math.sin((32 * Math.PI) / 180)
  const len = Math.min(2.2, Math.max(0.35, 0.45 / Math.tan(el)))
  return [dx * len, dy * len]
}
