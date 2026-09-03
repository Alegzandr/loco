/**
 * The rendered scenes this tab holds, and the one way to ask for one.
 *
 * Two things draw a room — the loading screen and the board, both sharp — and
 * the loading gate is what waits for it. Both go through here, so a
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
import type { Sprite } from './life'
import { resolveGraphics, type GraphicsTier } from '../../hooks/graphicsPref'

export interface PreparedScene {
  key: string
  size: RenderSize
  felt: FeltAnchor
  /** The graphics tier the frame was rendered at: a different tier is a different frame. */
  tier: GraphicsTier
  /** The frame, or null when it could not be rendered. */
  canvas: HTMLCanvasElement | null
  /** What moves in the room, one bitmap each. Empty when the frame is null. */
  sprites: Sprite[]
  rig: LightRig
}

/** Longest side, in device pixels. Past this the bitmap costs more than it shows. */
export const MAX_SIDE = 2800
/** Device pixel ratio ceiling: a 3× phone does not need three times the pixels of a laptop. */
export const MAX_DPR = 2
/** How many rendered scenes to keep. A match, its rematch, and one resize. */
const KEEP = 3

const cache = new Map<string, PreparedScene>()
const inFlight = new Map<string, Promise<PreparedScene>>()

/**
 * The device-pixel size to render a `w × h` CSS-pixel viewport at.
 *
 * **`pixelRatio` is what the returned size was actually solved at, not what the
 * screen asked for.** `anchorFor` divides CSS pixels by it to find the felt in
 * the render's own frame, so the two have to agree: when `MAX_SIDE` cut the
 * bitmap down and the ratio was handed back unchanged, the anchor came out
 * eight tiles to the right of the table and a fifth too large, and the podium
 * the whole room is composed around was built somewhere the table is not. It
 * only bit above 1600 CSS pixels on a screen denser than 1×, which is most
 * laptops and no CI run — `make visual` shoots at 1×, so nothing ever caught it.
 */
export function renderSizeFor(cssWidth: number, cssHeight: number): RenderSize {
  const dpr = Math.min(MAX_DPR, typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1)
  let ratio = dpr
  let width = Math.max(1, Math.round(cssWidth * dpr))
  let height = Math.max(1, Math.round(cssHeight * dpr))
  const longest = Math.max(width, height)
  if (longest > MAX_SIDE) {
    const k = MAX_SIDE / longest
    width = Math.round(width * k)
    height = Math.round(height * k)
    ratio = dpr * k
  }
  return { width, height, pixelRatio: ratio }
}

/**
 * Two render sizes near enough that stretching one beats rendering the other.
 *
 * Three things ask for this room while a match opens — the loading gate (off
 * the viewport), the screen it puts up, and the board mounted behind it (both
 * off their own element) — and they only agree to the pixel when nothing sits
 * between the element and the edge of the window. A scrollbar, a browser bar
 * animating away, a `dvh` that is not `innerHeight`: any of those made the
 * board's request a different cache key, so the room the gate had just waited
 * for was rendered a second time, on the main thread, at the moment the table
 * opened — which is the freeze the loading screen exists to hide. Within four
 * per cent the frame already up is stretched instead, by less than the width of
 * an outline.
 */
export function sizeCloseEnough(have: RenderSize, want: RenderSize): boolean {
  const off = (x: number, y: number) => Math.abs(x - y) / Math.max(x, y, 1)
  return off(have.width, want.width) < 0.04 && off(have.height, want.height) < 0.04
}

/**
 * The felt to the nearest 2 CSS px: the podium is built under it, so two
 * viewports whose felt differs by more are two renders.
 */
function feltKey(f: FeltAnchor): string {
  const r = (v: number) => Math.round(v / 2) * 2
  return `${r(f.cx)},${r(f.cy)},${r(f.rx)},${r(f.ry)}`
}

/**
 * Two anchors the same podium was built under. By value, never by identity:
 * the anchor is a `$derived` object, so a viewport that has not moved still
 * hands out a new one on every re-run.
 */
export function sameFelt(a: FeltAnchor, b: FeltAnchor): boolean {
  return feltKey(a) === feltKey(b)
}

function entryKey(spec: SceneSpec, size: RenderSize, felt: FeltAnchor, tier: GraphicsTier): string {
  return `${sceneKey(spec)}@${size.width}x${size.height}@${feltKey(felt)}@${tier}`
}

/**
 * Whatever is already rendered for this scene: the exact size if there is
 * one, otherwise any size (drawn stretched until the right one lands), else
 * null. Synchronous, for a component's first paint.
 */
export function peekScene(spec: SceneSpec, size: RenderSize, felt: FeltAnchor, tier: GraphicsTier = resolveGraphics()): PreparedScene | null {
  const exact = cache.get(entryKey(spec, size, felt, tier))
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
  tier: GraphicsTier = resolveGraphics(),
): Promise<PreparedScene> {
  const k = entryKey(spec, size, felt, tier)
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
    let sprites: Sprite[] = []
    try {
      const { renderScene, prepareModels } = await import('./render')
      onProgress?.(0.2)
      // The room's models: fetched from this origin once per tab, the middle
      // half of the bar on a first visit and nothing on a rematch.
      const models = await prepareModels(spec, (p) => onProgress?.(0.2 + p * 0.55))
      onProgress?.(0.75)
      // Let the loading screen paint its first frame before the main thread
      // is taken for the build and the draw.
      await new Promise<void>((r) => setTimeout(r, 0))
      const out = renderScene(spec, size, felt, models, tier)
      canvas = out.frame
      sprites = out.sprites
    } catch (err) {
      // Left null: the sky gradient is the room now.
      if (import.meta.env.DEV) console.warn('scene render failed', err)
    }
    const entry: PreparedScene = { key: sceneKey(spec), size, felt, tier, canvas, sprites, rig }
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
