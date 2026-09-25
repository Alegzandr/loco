/**
 * The light of a room, as arithmetic on plain numbers.
 *
 * The room is lit, not drawn: a warm sun low over the diorama, a cool sky
 * filling the shade, a long soft shadow on the ground beside every block and
 * occlusion in the creases — the way a low-poly scene comes out of a renderer,
 * which is the look the rooms are judged against. The lights themselves are
 * three.js objects (`lighting.ts`); what this file holds is everything about
 * them that can be stated without three.js — the sun's direction and colour,
 * the sky's, how soft the shadow is tonight, the run a shadow makes on the
 * ground — so that a test can assert the warm/cool split at every hour and the
 * sprite pass can size a bitmap around a shadow it has not drawn yet.
 *
 * No three.js in this file, so the arithmetic is testable in jsdom.
 */
import type { Hex, LightRig } from './sky'
import { mix } from './sky'
import { LOOK } from './look'

export type Rgb = [number, number, number]

/** A world point, `y` up. */
export type P3 = [number, number, number]

/** Unit vector *towards* the sun, from the rig's azimuth and elevation. */
export function sunDirection(rig: LightRig): P3 {
  const el = (rig.sun.elevation * Math.PI) / 180
  const az = (rig.sun.azimuth * Math.PI) / 180
  return [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)]
}

export function channels(c: Hex): Rgb {
  return [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255]
}

/** Red minus blue, 0–255 scale: positive is warm, negative is cool. */
export function warmth(c: Hex): number {
  return ((c >> 16) & 255) - (c & 255)
}

/** The key light, as numbers the renderer builds a `DirectionalLight` from. */
export interface SunLight {
  color: Hex
  intensity: number
  /** Towards the sun, unit. */
  direction: P3
}

/** The fill, as numbers the renderer builds a `HemisphereLight` from. */
export interface SkyLight {
  sky: Hex
  ground: Hex
  intensity: number
}

/**
 * The lighting of the hour: the sun and the sky the rig describes, with the
 * one thing the look adds — a second, cooler sun from behind (`rim`), which
 * is the sky's bounce on the wall the sun does not reach. It is what keeps a
 * far wall a colour rather than a silhouette, and it carries no shadow.
 */
export interface Lighting {
  sun: SunLight
  sky: SkyLight
  rim: SunLight | null
  /** Blur radius of the shadow, in shadow-map texels. Softer the lower the sun. */
  shadowRadius: number
  /** How much of the sun the overcast leaves: 1 clear, towards 0 under a storm. */
  shadowStrength: number
  /** The tone curve's exposure tonight: the look's, lifted with the dark so a stormy night stays a room. */
  exposure: number
}

export function lightingFor(rig: LightRig): Lighting {
  const direction = sunDirection(rig)
  const [dx, , dz] = direction
  const el = rig.sun.elevation
  // A low sun throws a longer shadow, and a longer shadow is a softer one:
  // the penumbra grows with the distance between the caster and the ground.
  const shadowRadius = LOOK.shadow.radius * (1 + Math.max(0, (35 - el) / 35) * 0.6) * rig.shadowSoftness
  const rimK = LOOK.ambient.rim
  return {
    sun: { color: rig.sun.color, intensity: rig.sun.intensity, direction },
    sky: { sky: rig.ambient.sky, ground: rig.ambient.ground, intensity: rig.ambient.intensity },
    rim:
      rimK > 0
        ? {
            // From opposite the sun and lower, in the sky's own colour.
            color: mix(rig.ambient.sky, 0xffffff, 0.2),
            intensity: rig.sun.intensity * rimK * 0.35,
            direction: [-dx, 0.35, -dz],
          }
        : null,
    shadowRadius,
    shadowStrength: rig.sun.shadow,
    exposure: LOOK.tone.exposure * (1 + rig.dark * LOOK.tone.nightLift),
  }
}

/**
 * The sky a glossy surface mirrors, as three colours: the zenith, the horizon
 * and the ground seen below it. The rig's own gradient — the one painted in
 * CSS behind the render — so a wet street at dusk holds the dusk, and the
 * ground's bounce, so what a reflection finds under the horizon is not black.
 */
export function skyDome(rig: LightRig): { top: Hex; horizon: Hex; ground: Hex } {
  return { top: rig.sky.top, horizon: rig.sky.horizon, ground: mix(rig.ambient.ground, rig.sky.horizon, 0.25) }
}

// ─── Shadows, as shapes ─────────────────────────────────────────────────────
// The room's shadows are a map now; what is still a polygon is the *extent*
// of one, which the sprite pass needs before it has drawn anything: a
// sprite's bitmap has to be wide enough to hold the shadow the thing throws.

