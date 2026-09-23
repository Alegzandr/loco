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
 * builder that throws, models that never arrive: the request resolves with a
 * null bitmap and the board falls back to the sky gradient the rig already
 * describes. A client that never answers `map_ready` is the one outcome the
 * gate cannot survive. **But a failure is not remembered like a frame**: most
 * of them are transient (a context limit, a context lost to a GPU reset), so
 * it is held for `FAILED_TTL_MS` — long enough that a drag does not retry it
 * on every pixel — and never where a frame would be evicted to make room.
 *
 * **One room is rendered once, however many ask for it.** The gate, the
 * loading screen and the board all ask while a match opens, off three
 * measurements that can differ by a pixel; a request that finds a render in
 * flight for the same scene, felt, tier and look at a size `sizeCloseEnough`
 * to its own joins it rather than starting a second one.
 *
 * **And that fallback is what the end-to-end suite runs on** (`NO_SCENE`): the
 * suite opens ~167 tables and asserts nothing about the room — appearance is
 * `make visual`'s, behaviour is Playwright's — while a headless render costs
 * 2.2s, 250 requests and 7MB of models *per table*, on a software GPU. The
 * whole gate is exercised either way: the entry is still built, `map_ready` is
 * still sent on it, and the board still draws the sky gradient underneath.
 */
import type { SceneSpec } from '../cards/maps'
import { sceneKey } from '../cards/maps'
import { lightRig, type LightRig } from './sky'
import type { RenderSize } from './render'
import type { FeltAnchor } from '../cards/layout'
import type { Sprite } from './life'
import { resolveGraphics, type GraphicsTier } from '../../hooks/graphicsPref'
import { nextPaint } from './nextPaint'
import { lookVersion } from './look'

export interface PreparedScene {
  key: string
  size: RenderSize
  felt: FeltAnchor
  /** The graphics tier the frame was rendered at: a different tier is a different frame. */
  tier: GraphicsTier
  /** The look's edition it was rendered with (`lookVersion()`). */
  look: number
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
/** How many rendered scenes to keep. A match, its rematch, and one resize. Least recently used goes first. */
const KEEP = 3
/**
 * How long a failed render answers for its key before the next request tries
 * again. A context limit or a lost context is gone a moment later, and
 * remembered for the tab it was the plain sky for every match after it.
 */
export const FAILED_TTL_MS = 10_000
/**
 * How long the room's models may take before the render gives up on them. The
 * loader keeps no clock of its own, and a fetch that stalls would otherwise
 * hold the render in flight — and every request joining it — for the tab.
 * Past the gate's own `MAP_PRELOAD_TIMEOUT_MS` on purpose: the gate has long
 * let the player in by then, on the sky, and this only lets the next request try.
 */
export const MODELS_TIMEOUT_MS = 20_000

/** Frames, least recently used first. Every entry here has a canvas. */
const cache = new Map<string, PreparedScene>()
/** Renders that came back empty, with when. Kept apart so a failure never evicts a frame. */
const failed = new Map<string, { entry: PreparedScene; at: number }>()

interface Flight {
  /** What must match for a request to join: the scene, the felt, the tier and the look. */
  group: string
  size: RenderSize
  promise: Promise<PreparedScene>
  /** The joiners' bars, fed from the one render. */
  listeners: Set<(p: number) => void>
  /** The last report, so a joiner's bar starts where the render is. */
  progress: number
}
const inFlight = new Map<string, Flight>()

/**
 * Skip the render and answer the gate with the sky gradient.
 *
 * Set by `e2e/playwright.config.ts` on the dev server it owns, never by a
 * test: a page reaches this suite four ways — the `page` fixture, a bare
 * `browser.newContext()`, a second tab, an invitation link — and an init
 * script attached at one of them is a room quietly rendered at the other
 * three. The dev server is the one thing all four share.
 *
 * `import.meta.env.DEV` is the guarantee it can never be on in production:
 * Vite replaces it with `false`, the constant folds, and the branch below —
 * with the lazy `import('./render')` inside it — is the only path left.
 */
const NO_SCENE = import.meta.env.DEV && import.meta.env.VITE_E2E_NO_SCENE === '1'

/** Test seam: `sceneCache.test.ts` asserts the flag is off unless asked for. */
export function skipsRender(): boolean {
  return NO_SCENE
}

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

/**
 * The look's edition is part of the key too: it only ever moves in dev, from
 * the panel, and a frame rendered with the old numbers must not answer a
 * request made with the new ones.
 */
function entryKey(spec: SceneSpec, size: RenderSize, felt: FeltAnchor, tier: GraphicsTier): string {
  return `${sceneKey(spec)}@${size.width}x${size.height}@${feltKey(felt)}@${tier}@look${lookVersion()}`
}

/** Everything in the key but the size: what two requests must share to share a frame. */
function groupOf(key: string, felt: FeltAnchor, tier: GraphicsTier, look: number): string {
  return `${key}@${feltKey(felt)}@${tier}@look${look}`
}

/** A frame for this scene, felt, tier and look near enough `size` to be stretched to it. */
function closeFrame(spec: SceneSpec, size: RenderSize, felt: FeltAnchor, tier: GraphicsTier): PreparedScene | null {
  const key = sceneKey(spec)
  const look = lookVersion()
  let best: PreparedScene | null = null
  for (const e of cache.values()) {
    if (e.key === key && e.tier === tier && e.look === look && sameFelt(e.felt, felt) && sizeCloseEnough(e.size, size)) best = e
  }
  return best
}

/** Moves a hit to the young end, so what is in use is what stays. */
function touch(k: string, e: PreparedScene): PreparedScene {
  cache.delete(k)
  cache.set(k, e)
  return e
}

/** A failure still answering for its key, or null once it has lapsed. */
function recentFailure(k: string): PreparedScene | null {
  const f = failed.get(k)
  if (!f) return null
  if (!NO_SCENE && Date.now() - f.at >= FAILED_TTL_MS) {
    failed.delete(k)
    return null
  }
  return f.entry
}

/**
 * Whatever is already rendered for this scene, synchronous, for a component's
 * first paint: the exact frame; else one near enough the size to pass for it;
 * else any frame of this scene (drawn stretched until the right one lands);
 * else a recent failure (the sky, and it says so); else null. A frame always
 * beats a failure: a transient loss must not put the sky over a room that is
 * sitting in the cache at another size.
 */
export function peekScene(spec: SceneSpec, size: RenderSize, felt: FeltAnchor, tier: GraphicsTier = resolveGraphics()): PreparedScene | null {
  const k = entryKey(spec, size, felt, tier)
  const exact = cache.get(k)
  if (exact) return exact
  const close = closeFrame(spec, size, felt, tier)
  if (close) return close
  const key = sceneKey(spec)
  let best: PreparedScene | null = null
  for (const e of cache.values()) if (e.key === key) best = e
  if (best) return best
  const miss = recentFailure(k)
  if (miss) return miss
  for (const f of failed.values()) if (f.entry.key === key) best = f.entry
  return best
}

/**
 * Where the bar stands once the engine's chunk is in, and once the models are:
 * the render's phases take the rest. On a rematch both land at once — the
 * chunk and the kits are cached per tab — so the bar is mostly the render.
 */
export const PROGRESS = { engine: 0.1, models: 0.35 } as const

/**
 * Renders `spec` at `size`, once, reporting progress in [0, 1]. Resolves with
 * the cached entry, bitmap or not. **Every report is painted**: the render
 * yields to the browser between its phases, so the bar moves while the room is
 * built rather than jumping from empty to full after one long freeze.
 */
export function prepareScene(
  spec: SceneSpec,
  size: RenderSize,
  felt: FeltAnchor,
  onProgress?: (p: number) => void,
  tier: GraphicsTier = resolveGraphics(),
): Promise<PreparedScene> {
  const k = entryKey(spec, size, felt, tier)
  const hit = cache.get(k) ?? closeFrame(spec, size, felt, tier) ?? recentFailure(k)
  if (hit) {
    if (hit.canvas) touch(entryKey(spec, hit.size, hit.felt, hit.tier), hit)
    onProgress?.(1)
    return Promise.resolve(hit)
  }
  // A render of this room already under way, at a size near enough: join it.
  // Two renders of one room at once are two full builds on the main thread
  // while the gate is up, and the second lands after it lifts.
  const look = lookVersion()
  const group = groupOf(sceneKey(spec), felt, tier, look)
  for (const f of inFlight.values()) {
    if (f.group !== group || !sizeCloseEnough(f.size, size)) continue
    if (onProgress) {
      if (f.progress > 0) onProgress(f.progress)
      f.listeners.add(onProgress)
    }
    return f.promise
  }

  const rig = lightRig(spec.time, spec.weather)
  const listeners = new Set<(p: number) => void>()
  if (onProgress) listeners.add(onProgress)
  const flight: Flight = { group, size, promise: Promise.resolve(null as unknown as PreparedScene), listeners, progress: 0 }
  const report = (p: number) => {
    flight.progress = p
    for (const l of listeners) l(p)
  }
  const run = async (): Promise<PreparedScene> => {
    let canvas: HTMLCanvasElement | null = null
    let sprites: Sprite[] = []
    // Nothing below is imported, fetched or drawn when the suite asked for
    // no room: the engine's chunk and the models are behind this line, which
    // is most of what the skip is worth.
    if (!NO_SCENE) {
      try {
        const { renderScene, prepareModels } = await import('./render')
        report(PROGRESS.engine)
        // The room's models: fetched from this origin once per tab, a stretch of
        // the bar on a first visit and nothing on a rematch.
        const models = await withTimeout(
          prepareModels(spec, (p) => report(PROGRESS.engine + p * (PROGRESS.models - PROGRESS.engine))),
          MODELS_TIMEOUT_MS,
          'models',
        )
        report(PROGRESS.models)
        // The bar has to be on screen before the main thread is taken for the
        // build: a `setTimeout(0)` here fired inside the same frame and the bar
        // was never painted between empty and full.
        await nextPaint()
        // The rest of the bar is the render's own phases, each painted before
        // the next one takes the thread.
        const out = await renderScene(spec, size, felt, models, tier, (p) => report(PROGRESS.models + p * (1 - PROGRESS.models)))
        canvas = out.frame
        sprites = out.sprites
      } catch (err) {
        // Left null: the sky gradient is the room now.
        if (import.meta.env.DEV) console.warn('scene render failed', err)
      }
    }
    const entry: PreparedScene = { key: sceneKey(spec), size, felt, tier, look, canvas, sprites, rig }
    remember(k, entry)
    inFlight.delete(k)
    report(1)
    return entry
  }
  // Registered before it starts: a run with nothing to await (`NO_SCENE`)
  // finishes inside the call, and must not leave itself behind as in flight.
  inFlight.set(k, flight)
  flight.promise = run()
  return flight.promise
}

/** `p`, or a rejection once `ms` have passed without it. */
function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

function remember(k: string, entry: PreparedScene) {
  if (!entry.canvas) {
    const now = Date.now()
    for (const [fk, f] of failed) if (now - f.at >= FAILED_TTL_MS) failed.delete(fk)
    failed.set(k, { entry, at: now })
    return
  }
  failed.delete(k)
  cache.delete(k)
  cache.set(k, entry)
  while (cache.size > KEEP) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

/** Test seam: forgets every frame, failure and render in flight. */
export function clearSceneCache() {
  cache.clear()
  failed.clear()
  inFlight.clear()
}
