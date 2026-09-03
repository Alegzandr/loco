/**
 * How a block is coloured, and where its shadow falls: the whole of the
 * room's lighting, as arithmetic on plain numbers.
 *
 * The room is a drawing, not a render. An illustrated isometric city gives
 * every block three flat tones — the top in the light, one side half-lit, the
 * other in shade — and a hard shadow lying on the ground beside it, and that is
 * all the light there is. So nothing here goes through a light object or a
 * shadow map: **the tone is baked into the vertex colour when the block is
 * built** (`Shader.tone`, called by the kit for every vertex from its normal),
 * and **the shadow is a flat polygon on the ground** (`shadowHull`), the
 * block's corners projected along the sun and wrapped in a convex hull. A
 * toon ramp under a real light banded on every cylinder and a PCF shadow map
 * put noise on every façade; a tone per face and a polygon per block put
 * neither anywhere, and both cost nothing to draw.
 *
 * No three.js in this file, so the arithmetic is testable in jsdom.
 */
import type { Hex, LightRig } from './sky'
import { mix } from './sky'

export type Rgb = [number, number, number]

/** A world point, `y` up. */
export type P3 = [number, number, number]

/**
 * The plane every shadow is drawn on, in tiles above the ground.
 *
 * Above the paving, the roads, the crossings and the dashes (the highest is
 * 0.08) so a shadow crossing a street is drawn on it rather than under it, and
 * below anything that stands: the ground plane of a block starting at 0 is
 * cut a tenth of a tile up, where its own faces are in front of the plane
 * from this camera.
 */
export const SHADOW_PLANE_Y = 0.12

/** Unit vector *towards* the sun, from the rig's azimuth and elevation. */
export function sunDirection(rig: LightRig): P3 {
  const el = (rig.sun.elevation * Math.PI) / 180
  const az = (rig.sun.azimuth * Math.PI) / 180
  return [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)]
}

/**
 * The direction a shadow runs along the ground, per unit of height, and
 * capped: a dawn sun eleven degrees up throws a shadow five times a block's
 * height, which on a street of ten-tile houses is a street of shadow.
 */
export function shadowRun(rig: LightRig): [number, number] {
  const [sx, sy, sz] = sunDirection(rig)
  const len = Math.min(1.25, Math.max(0.3, Math.hypot(sx, sz) / Math.max(0.05, sy)))
  const h = Math.hypot(sx, sz) || 1
  return [(-sx / h) * len, (-sz / h) * len]
}

function channels(c: Hex): Rgb {
  return [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255]
}

export interface Shader {
  /** Multipliers for a face with this unit normal. */
  tone(nx: number, ny: number, nz: number): Rgb
  /** The shadow polygon's colour and alpha, tonight. */
  shadow: { color: Hex; alpha: number }
}

/**
 * The three tones of the hour.
 *
 * Exposure follows `rig.dark` (noon 1, a stormy night about half) and the
 * light's own colour tints everything a little more the darker it is, so a
 * dusk is amber and a night is blue rather than merely dim. The lit side
 * takes a step down from the top and the far side two, and the far side leans
 * towards the sky's ambient rather than the sun's colour — a cool shadow
 * beside a warm light is what makes a flat drawing read as lit at all.
 * Anything in between is snapped to the nearest of the three: a cylinder is
 * three stripes, a ball three crescents, never a gradient.
 */
export function shadeFor(rig: LightRig): Shader {
  const [sx, , sz] = sunDirection(rig)
  const h = Math.hypot(sx, sz) || 1
  const ux = sx / h
  const uz = sz / h
  const exposure = 1 - rig.dark * 0.55
  const tintK = 0.22 + rig.dark * 0.3
  const warm = channels(mix(0xffffff, rig.sun.color, tintK))
  const cool = channels(mix(mix(0xffffff, rig.sun.color, tintK), rig.ambient.sky, 0.45 + rig.dark * 0.2))
  // The steps between the three tones are what the eye reads as light, and
  // they were 1 / 0.84 / 0.66: a sixth of a stop between the roof and the wall
  // in the sun, and a fifth between that wall and the one in shade. At that
  // spacing a street of cubes comes out as one flat wash of its own colour —
  // "there is no lighting" is the correct reading of it. An illustrated
  // isometric puts the shaded side at about half the lit one, so these do too.
  const LIT = 0.74
  const SHADE = 0.47
  const UNDER = 0.32
  const top: Rgb = [warm[0] * exposure, warm[1] * exposure, warm[2] * exposure]
  const lit: Rgb = [warm[0] * exposure * LIT, warm[1] * exposure * LIT, warm[2] * exposure * LIT]
  const shade: Rgb = [cool[0] * exposure * SHADE, cool[1] * exposure * SHADE, cool[2] * exposure * SHADE]
  const under: Rgb = [cool[0] * exposure * UNDER, cool[1] * exposure * UNDER, cool[2] * exposure * UNDER]
  return {
    tone(nx, ny, nz) {
      if (ny > 0.6) return top
      if (ny < -0.6) return under
      // How much this face looks towards the sun, on the ground plane.
      const facing = nx * ux + nz * uz
      return facing > 0 ? lit : shade
    },
    shadow: {
      color: mix(0x10163a, rig.ambient.sky, 0.35),
      // A drawing's shadow is a shape, not a tint: at 0.26 of a sky-blue it was
      // a smudge nobody read as a shadow, which is the other half of the room
      // looking unlit. It still thins with the hour and with the sky.
      alpha: Math.max(0.12, (0.38 - rig.dark * 0.16) * rig.sun.shadow),
    },
  }
}

// ─── Shadows ────────────────────────────────────────────────────────────────

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
 * The shadow a solid throws on the plane, as a convex polygon in `x, z`.
 *
 * Every corner above the plane slides down the sun's ray until it lands;
 * every corner below it stays where it is (its footprint is part of the
 * shadow too, or a house would throw only the shape of its roof and float off
 * its own shade). A solid entirely under the plane throws nothing. Convex is
 * exact for every convex solid the kit builds, which is all of them.
 */
export function shadowHull(points: P3[], run: [number, number], plane = SHADOW_PLANE_Y): [number, number][] | null {
  if (!points.some(([, y]) => y > plane)) return null
  const flat: [number, number][] = points.map(([x, y, z]) => {
    const rise = Math.max(0, y - plane)
    return [x + run[0] * rise, z + run[1] * rise]
  })
  const hull = convexHull(flat)
  return hull.length >= 3 ? hull : null
}
