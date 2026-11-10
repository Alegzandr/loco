/**
 * The painted rooms.
 *
 * A room that has a plate is not built in blocks: it is one painting, made
 * from the block room's own render (`?bare=1`, `tools/plates`) so the camera
 * is the game's, and the table is the only thing rendered over it. The
 * painting was made through one lens, and every frame the game solves has its
 * own (`view.ts`), so a plate carries the lens it was painted through: the
 * render lays it by its horizon and its focal length, never by its edges
 * (`plateUv`). A floor is a plane, and a plane seen from the same height
 * through another focal length is the same picture scaled about the horizon.
 *
 * Framework-free and three-free: the numbers and the arithmetic. The texture
 * and the shader are `plate.ts`'.
 */
import type { MapId } from '../cards/maps'
import type { Hex, TimeOfDay } from './sky'
import marina from '../../assets/plates/marina.webp?url'
import neon from '../../assets/plates/neon.webp?url'
import orbit from '../../assets/plates/orbit.webp?url'
import rune from '../../assets/plates/rune.webp?url'
import sakura from '../../assets/plates/sakura.webp?url'
import velvet from '../../assets/plates/velvet.webp?url'

export interface PlateDef {
  /** The painting, served from this origin. */
  src: string
  /** Its size, pixels. */
  w: number
  h: number
  /** The lens it was painted through: focal length, pixels of the plate. */
  f: number
  /** Where its horizon lies, pixels down from its top, and its vanishing column. */
  horizon: number
  cx: number
  /** The one hour it is painted at: the room is lit for it whatever hour is dealt. */
  time: TimeOfDay
  /** What the floor runs out into past the painting's foot: its own darkest note. */
  floor: Hex
}

/**
 * Every plate is shot at 2304x1296, a 16:9 frame: the widest lens the camera
 * uses, so no frame with its lens on its middle asks for a column a painting
 * does not have. The three numbers are `solveView`'s for that frame.
 */
const LENS = { w: 2304, h: 1296, f: 1279.43, horizon: 154.04, cx: 1152 } as const

/**
 * Each at its room's own hour (the one the rooms page shows it at). Painted
 * by `tools/plates/paint.py`; the seeds are the top's and the floor's, and
 * neon's floor was painted with `--dim 0.3`.
 */
export const PLATES: Partial<Record<MapId, PlateDef>> = {
  neon: { ...LENS, src: neon, time: 'night', floor: 0x090212 }, // 13, 33
  rune: { ...LENS, src: rune, time: 'dusk', floor: 0x2c2e37 }, // 12, 22
  velvet: { ...LENS, src: velvet, time: 'dusk', floor: 0x0f0d0f }, // 4402, 6601
  orbit: { ...LENS, src: orbit, time: 'night', floor: 0x0e253a }, // 11, 22
  sakura: { ...LENS, src: sakura, time: 'day', floor: 0x47322e }, // 11, 22
  marina: { ...LENS, src: marina, time: 'dawn', floor: 0x39291d }, // 12, 21
}

/** The hour a room is shown at: its plate's, when it has one, or the one dealt. */
export function plateHour(id: MapId, dealt: TimeOfDay): TimeOfDay {
  return PLATES[id]?.time ?? dealt
}

/** The part of a frame's lens the plate is laid by. */
export interface PlateLens {
  /** Focal length, the frame's pixels. */
  f: number
  /** The principal column and the horizon's row, the frame's pixels, `y` down. */
  px: number
  horizonY: number
}

/**
 * Where a frame pixel reads the plate, as `[u, v]` with `v` down, both 0-1
 * inside the painting and outside that range past its edges. The two horizons
 * are laid on each other and the plate is scaled by the ratio of the focal
 * lengths: what is `d` pixels under the horizon through one lens is
 * `d * f / f0` under it through the other.
 */
export function plateUv(p: PlateDef, lens: PlateLens, x: number, y: number): [number, number] {
  const s = lens.f / p.f
  return [(p.cx + (x - lens.px) / s) / p.w, (p.horizon + (y - lens.horizonY) / s) / p.h]
}
