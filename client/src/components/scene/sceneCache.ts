/**
 * The rendered scenes this tab holds, and the one way to ask for one.
 *
 * Two things draw a room — the loading screen, sharp, and the board, blurred —
 * and the loading gate is what waits for it. All three go through here, so a
 * match renders its room exactly once and a reload that lands on the same
 * scene at the same size draws it from memory.
 *
 * The engine is imported lazily: three.js is the largest thing in the bundle
 * and nothing on the home page, in a waiting room or on a content page needs
 * it. The chunk is fetched from this origin like every other, so the CSP is
 * untouched; the map-loading gate is what absorbs the time it takes.
 *
 * **A render that fails is a scene, not an error.** No WebGL, a lost context, a
 * builder that throws: the entry is kept with a null bitmap and the board falls
 * back to the sky gradient the rig already describes. A client that never
 * answers `map_ready` is the one outcome the gate cannot survive.
 */
import type { SceneSpec } from '../cards/maps'
import { sceneKey } from '../cards/maps'
import { lightRig, type LightRig } from './sky'
import type { RenderSize } from './render'
import type { FeltAnchor } from '../cards/layout'

export interface PreparedScene {
  key: string
  size: RenderSize
  felt: FeltAnchor
  /** The frame, or null when it could not be rendered. */
  canvas: HTMLCanvasElement | null
  rig: LightRig
}

/** Longest side, in device pixels. Past this the bitmap costs more than it shows. */
const MAX_SIDE = 2400
/** Device pixel ratio ceiling: a 3× phone does not need three times the pixels of a laptop. */
const MAX_DPR = 1.5
/** How many rendered scenes to keep. A match, its rematch, and one resize. */
const KEEP = 3

const cache = new Map<string, PreparedScene>()
const inFlight = new Map<string, Promise<PreparedScene>>()

/** The device-pixel size to render a `w × h` CSS-pixel viewport at. */
export function renderSizeFor(cssWidth: number, cssHeight: number): RenderSize {
  const dpr = Math.min(MAX_DPR, typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1)
  let width = Math.max(1, Math.round(cssWidth * dpr))
  let height = Math.max(1, Math.round(cssHeight * dpr))
  const longest = Math.max(width, height)
  if (longest > MAX_SIDE) {
    const k = MAX_SIDE / longest
    width = Math.round(width * k)
    height = Math.round(height * k)
  }
  return { width, height, pixelRatio: dpr }
}

/**
 * The felt to the nearest 2 CSS px: the podium is built under it, so two
 * viewports whose felt differs by more are two renders.
 */
function feltKey(f: FeltAnchor): string {
  const r = (v: number) => Math.round(v / 2) * 2
  return `${r(f.cx)},${r(f.cy)},${r(f.rx)},${r(f.ry)}`
}

function entryKey(spec: SceneSpec, size: RenderSize, felt: FeltAnchor): string {
  return `${sceneKey(spec)}@${size.width}x${size.height}@${feltKey(felt)}`
}

/**
 * Whatever is already rendered for this scene: the exact size if there is
 * one, otherwise any size (drawn stretched until the right one lands), else
 * null. Synchronous, for a component's first paint.
 */
export function peekScene(spec: SceneSpec, size: RenderSize, felt: FeltAnchor): PreparedScene | null {
  const exact = cache.get(entryKey(spec, size, felt))
  if (exact) return exact
  const key = sceneKey(spec)
  let best: PreparedScene | null = null
  for (const e of cache.values()) if (e.key === key) best = e
  return best
}

/**
 * Renders `spec` at `size`, once, reporting progress in [0, 1]. Resolves with
 * the cached entry, bitmap or not.
 */
export function prepareScene(
  spec: SceneSpec,
  size: RenderSize,
  felt: FeltAnchor,
  onProgress?: (p: number) => void,
): Promise<PreparedScene> {
  const k = entryKey(spec, size, felt)
  const hit = cache.get(k)
  if (hit) {
    onProgress?.(1)
    return Promise.resolve(hit)
  }
  const pending = inFlight.get(k)
  if (pending) return pending

  const rig = lightRig(spec.time, spec.weather)
  const work = (async (): Promise<PreparedScene> => {
    let canvas: HTMLCanvasElement | null = null
    try {
      const { renderScene } = await import('./render')
      onProgress?.(0.35)
      // Let the loading screen paint its first frame before the main thread
      // is taken for the build and the draw.
      await new Promise<void>((r) => setTimeout(r, 0))
      canvas = renderScene(spec, size, felt)
    } catch (err) {
      // Left null: the sky gradient is the room now.
      if (import.meta.env.DEV) console.warn('scene render failed', err)
    }
    const entry: PreparedScene = { key: sceneKey(spec), size, felt, canvas, rig }
    remember(k, entry)
    inFlight.delete(k)
    onProgress?.(1)
    return entry
  })()
  inFlight.set(k, work)
  return work
}

function remember(k: string, entry: PreparedScene) {
  cache.set(k, entry)
  while (cache.size > KEEP) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

/** Test seam. */
export function clearSceneCache() {
  cache.clear()
  inFlight.clear()
}
