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

/** How far a shadow may run per unit of height, whatever the hour: past this a sprite's bitmap is mostly shadow. */
export const MAX_SHADOW_RUN = 3.5

/**
 * The direction a shadow runs along the ground, per unit of height: the true
 * run of this sun, capped so a sprite's bitmap stays a bitmap of the thing.
 */
export function shadowRun(rig: LightRig): [number, number] {
  const [sx, sy, sz] = sunDirection(rig)
  const len = Math.min(MAX_SHADOW_RUN, Math.hypot(sx, sz) / Math.max(0.05, sy))
  const h = Math.hypot(sx, sz) || 1
  return [(-sx / h) * len, (-sz / h) * len]
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
  const shadowRadius = LOOK.shadow.radius * (1 + Math.max(0, (35 - el) / 35) * 0.6)
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

// ─── Shadows, as shapes ─────────────────────────────────────────────────────
// The room's shadows are a map now; what is still a polygon is the *extent*
// of one, which the sprite pass needs before it has drawn anything: a
// sprite's bitmap has to be wide enough to hold the shadow the thing throws.

/** Andrew's monotone chain. Returns the hull counter-clockwise, no repeats. */
export function convexHull(points: [number, number][]): [number, number][] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (pts.length < 3) return pts
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: [number, number][] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: [number, number][] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return [...lower, ...upper]
}

/**
 * The shadow a solid throws on the plane `y = plane`, as a convex polygon in
 * `x, z`: every corner above the plane slides down the sun's ray until it
 * lands, every corner below stays where it is (its footprint is part of the
 * shadow too). A solid entirely under the plane throws nothing. Exact for
 * every convex solid the kit builds, which is all of them.
 */
export function shadowHull(points: P3[], run: [number, number], plane = 0): [number, number][] | null {
  if (!points.some(([, y]) => y > plane)) return null
  const flat: [number, number][] = points.map(([x, y, z]) => {
    const rise = Math.max(0, y - plane)
    return [x + run[0] * rise, z + run[1] * rise]
  })
  const hull = convexHull(flat)
  return hull.length >= 3 ? hull : null
}
