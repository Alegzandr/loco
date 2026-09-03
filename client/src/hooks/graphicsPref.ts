/**
 * How much the room's render is allowed to cost, as a preference.
 *
 * A room is rendered once per match and then kept as a bitmap, so what this
 * setting spends is a second or two of main thread at the loading gate and a
 * few compositor layers of weather for the rest of the match — never a frame
 * budget. That is why `auto` can be generous: the question is not "can this
 * device hold sixty frames of it" but "how long may the gate take, and how
 * many layers may sit over the board".
 *
 * `auto` follows what the device says about itself and the two explicit
 * tiers win over it in both directions: a laptop on battery may ask for less,
 * a phone somebody knows to be fast may ask for everything. Framework-free,
 * like every other preference module here, and read by the renderer and the
 * weather layer alike through `resolveGraphics()`.
 */

export type GraphicsPref = 'auto' | 'high' | 'medium' | 'light'
/** What a preference resolves to: the three sizes the render is built at. */
export type GraphicsTier = 'high' | 'medium' | 'light'

export const GRAPHICS_STORAGE_KEY = 'loco_graphics'
export const GRAPHICS_PREFS: readonly GraphicsPref[] = ['auto', 'high', 'medium', 'light']

let pref: GraphicsPref = read()
const listeners = new Set<() => void>()

function read(): GraphicsPref {
  try {
    const v = localStorage.getItem(GRAPHICS_STORAGE_KEY)
    return v === 'high' || v === 'medium' || v === 'light' ? v : 'auto'
  } catch {
    return 'auto'
  }
}

export function getGraphicsPref(): GraphicsPref {
  return pref
}

export function setGraphicsPref(next: GraphicsPref): void {
  if (next === pref) return
  pref = next
  try {
    localStorage.setItem(GRAPHICS_STORAGE_KEY, next)
  } catch {
    // Same trade as the other preferences: the session keeps it, the next load
    // goes back to `auto`.
  }
  listeners.forEach((l) => l())
}

/** Framework-free, so Svelte reads the same answer (`hooks/uiPrefs.svelte.ts`). */
export function subscribeGraphics(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** Test/showcase seam, like `resetMotionPref`. */
export function resetGraphicsPref(): void {
  pref = read()
  listeners.forEach((l) => l())
}

/**
 * What the device says about itself, as far as a browser will tell: the
 * memory class, the core count, and whether the pointer is a finger. None of
 * it is a benchmark, and none of it is needed to be one — the render is a
 * one-off, so the cost of guessing high on a slow device is a longer loading
 * gate, not a slow match.
 */
export interface DeviceHints {
  /** `navigator.deviceMemory`, GiB, Chromium only. */
  memory?: number
  /** `navigator.hardwareConcurrency`. */
  cores?: number
  /** `(pointer: coarse)`: a phone or a tablet. */
  coarse?: boolean
}

export function deviceHints(): DeviceHints {
  if (typeof navigator === 'undefined') return {}
  const nav = navigator as Navigator & { deviceMemory?: number }
  return {
    memory: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : undefined,
    cores: typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : undefined,
    coarse: typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches,
  }
}

/**
 * The tier `auto` lands on for a device. Pure, so the ladder is testable:
 * a machine reporting little memory gets the light render, a phone or a small
 * core count the middle one, and everything else the full one.
 */
export function autoTier(h: DeviceHints): GraphicsTier {
  if (h.memory !== undefined && h.memory < 4) return 'light'
  if (h.coarse) return 'medium'
  if (h.cores !== undefined && h.cores <= 4) return 'medium'
  return 'high'
}

/** The one answer the renderer and the weather ask: which tier, right now. */
export function resolveGraphics(p: GraphicsPref = pref, hints: DeviceHints = deviceHints()): GraphicsTier {
  return p === 'auto' ? autoTier(hints) : p
}
