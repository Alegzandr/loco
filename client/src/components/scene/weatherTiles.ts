/**
 * What the weather is made of: one seamless tile per layer, drawn once.
 *
 * The weather over a room is a stack of compositor layers, each a tiled
 * bitmap under one transform animation (`WeatherLayer.svelte`), and this file
 * is where the bitmap comes from. It used to be a CSS gradient — a
 * `repeating-linear-gradient` of one-pixel lines for rain, six radial dots
 * for snow — and it looked like it: every streak the same length and the same
 * white, every flake the same dot, a pattern the eye picked out in a second.
 * A drawn tile is the same cost to the compositor (a layer is a bitmap
 * whatever painted it) and can hold sixty streaks of different lengths, weights
 * and fades, flakes with soft edges and a few big blurred ones close to the
 * lens, haze made of overlapping blobs rather than bands.
 *
 * Two halves, and the split is what makes it testable in jsdom, which has no
 * canvas: **what to draw** is pure and seeded (`rainDrops`, `snowFlakes`,
 * `fogBlobs` — a list of shapes inside the tile), and **drawing it** is the
 * one function that touches a `CanvasRenderingContext2D`. Every shape near an
 * edge is drawn again one tile over, so the tile wraps without a seam in
 * either direction.
 *
 * The tile's size is what the layer travels per cycle (`TILES`, in CSS px),
 * and the seconds one cycle takes (`FALL_S`, `DRIFT_S`) sit beside it, so a
 * speed is a number somebody can read rather than the ratio of two
 * declarations in a stylesheet. `sceneWeather.test.ts` reads both.
 */
import { seededRng, type Rng } from './rng'

export type TileKind =
  | 'rainNear'
  | 'rainMid'
  | 'rainFar'
  | 'snowNear'
  | 'snowMid'
  | 'snowFar'
  | 'fogA'
  | 'fogB'
  | 'cloud'
  | 'dust'

export interface TileSpec {
  /** CSS px. The layer travels exactly this far per cycle. */
  w: number
  h: number
  /**
   * Drawing resolution relative to CSS px, before the device ratio. Haze and
   * cloud shadow are soft by nature and are drawn at a third of the size they
   * are shown at; a streak of rain is one pixel wide and is drawn at full.
   */
  res: number
}

export const TILES: Record<TileKind, TileSpec> = {
  rainNear: { w: 320, h: 480, res: 1 },
  rainMid: { w: 280, h: 400, res: 1 },
  rainFar: { w: 240, h: 320, res: 1 },
  snowNear: { w: 320, h: 440, res: 1 },
  snowMid: { w: 260, h: 360, res: 1 },
  snowFar: { w: 220, h: 300, res: 1 },
  fogA: { w: 1200, h: 720, res: 0.35 },
  fogB: { w: 1500, h: 720, res: 0.3 },
  cloud: { w: 1600, h: 900, res: 0.25 },
  dust: { w: 360, h: 360, res: 1 },
}

/**
 * Seconds per cycle of a falling layer, i.e. per `TILES[k].h` of travel. The
 * near layer is the fastest and the far the slowest, which is what parallax
 * is; and none of them is faster than about 550 px/s, because past that a
 * spectator reads static, not rain (it was 1000 px/s once, and it did).
 */
export const FALL_S: Partial<Record<TileKind, number>> = {
  rainNear: 0.9,
  rainMid: 1.05,
  rainFar: 1.25,
  snowNear: 5,
  snowMid: 7,
  snowFar: 10,
}

/** Seconds per cycle of a drifting layer, i.e. per `TILES[k].w` of travel. */
export const DRIFT_S: Partial<Record<TileKind, number>> = {
  fogA: 70,
  fogB: 110,
  cloud: 120,
  dust: 14,
}

/** How far a snow layer sways sideways, CSS px, and how long one sway takes. */
export const SWAY: Partial<Record<TileKind, { px: number; s: number }>> = {
  snowNear: { px: 18, s: 3.1 },
  snowMid: { px: 12, s: 4.3 },
  snowFar: { px: 8, s: 5.7 },
}

/**
 * How far the wind leans the rain, in degrees: `.wind` is a `skewX` of minus
 * this around the frame's bottom edge, so its top slides right by
 * `H × tan(lean)` — which is what the sheet's left overhang has to cover.
 */
export const LEAN_DEG = { rain: 9, storm: 15 } as const

// ─── Where a sheet stands ───────────────────────────────────────────────────

/**
 * A length as a sum of the things it may depend on: the frame's width and
 * height, the tile's, and a constant in CSS px. One form, two readings: `css`
 * writes it as a `calc()` for the stylesheet and `evalLen` as a number for the
 * test, so the geometry the test proves is the geometry the page gets.
 */
export interface Len {
  /** × the frame's width. */
  fw?: number
  /** × the frame's height. */
  fh?: number
  /** × the tile's width (`--tile-w`). */
  tw?: number
  /** × the tile's height (`--tile-h`). */
  th?: number
  px?: number
}

export interface SheetBox {
  left: Len
  top: Len
  width: Len
  height: Len
}

/** A tangent rounded *up*, so the overhang written into the CSS is never short of the skew. */
const tanUp = (deg: number) => Math.ceil(Math.tan((deg * Math.PI) / 180) * 1e4) / 1e4

/**
 * The box a sheet is laid out in, relative to the frame, before its animation
 * moves it. The smallest box that keeps the frame covered for the whole
 * travel, at any width and any height — never a percentage of the frame for
 * the overhang, because the travel is a tile and a tile is not a percentage:
 *
 * - **A drift** travels `0 → −tile-w` (either way round: `driftBack` plays the
 *   same range reversed), so it starts at the frame's left edge and is one
 *   tile wider than the frame. It was 300% of the frame: on a phone narrower
 *   than the tile the cloud sheet left the frame for half of every cycle.
 * - **A fall** travels `0 → +tile-h`, so it starts one tile above the frame
 *   and is one tile taller. It was 200%: in landscape on a phone the top band
 *   went bare once a cycle.
 * - **The lean** slides the top of a fall right by `H × tan(lean)`, so the
 *   left overhang is that, in the frame's height (`cqh`). It was 25% of the
 *   width, which a portrait phone's height outruns.
 * - **The sway** moves a snow sheet `±px` sideways, so it overhangs by that
 *   on both sides.
 */
export function sheetBox(kind: TileKind, leanDeg = 0): SheetBox {
  if (FALL_S[kind] === undefined) {
    return { left: {}, top: {}, width: { fw: 1, tw: 1 }, height: { fh: 1 } }
  }
  const t = leanDeg > 0 ? tanUp(leanDeg) : 0
  const sway = SWAY[kind]?.px ?? 0
  return {
    left: { fh: -t, px: -sway },
    top: { th: -1 },
    width: { fw: 1, fh: t, px: 2 * sway },
    height: { fh: 1, th: 1 },
  }
}

/** A `Len` as a number, for a frame and tile of this size. */
export function evalLen(l: Len, frame: { w: number; h: number }, tile: { w: number; h: number }): number {
  return (l.fw ?? 0) * frame.w + (l.fh ?? 0) * frame.h + (l.tw ?? 0) * tile.w + (l.th ?? 0) * tile.h + (l.px ?? 0)
}

/**
 * A `Len` as CSS. `axis` is the property's: a percentage on `left`/`width`
 * is of the width and on `top`/`height` of the height, and the other side of
 * the frame is read off the container (`.weather` is a size container).
 */
export function cssLen(l: Len, axis: 'x' | 'y'): string {
  const terms: string[] = []
  const add = (k: number | undefined, unit: string) => {
    if (k) terms.push(`${k} * ${unit}`)
  }
  add(l.fw, axis === 'x' ? '100%' : '100cqw')
  add(l.fh, axis === 'y' ? '100%' : '100cqh')
  add(l.tw, 'var(--tile-w)')
  add(l.th, 'var(--tile-h)')
  if (l.px) terms.push(`${l.px}px`)
  return terms.length ? `calc(${terms.join(' + ')})` : '0px'
}

/** The inline declarations that lay a sheet out: `sheetBox`, written as CSS. */
export function sheetStyle(kind: TileKind, leanDeg = 0): string {
  const b = sheetBox(kind, leanDeg)
  return `left: ${cssLen(b.left, 'x')}; top: ${cssLen(b.top, 'y')}; width: ${cssLen(b.width, 'x')}; height: ${cssLen(b.height, 'y')}`
}

// ─── What to draw ───────────────────────────────────────────────────────────

export interface Drop {
  x: number
  y: number
  len: number
  width: number
  alpha: number
}

export interface Flake {
  x: number
  y: number
  r: number
  /** How far past `r` the edge fades, as a multiple of it. */
  soft: number
  alpha: number
}

export interface Blob {
  x: number
  y: number
  rx: number
  ry: number
  alpha: number
}

interface RainParams {
  n: number
  len: [number, number]
  width: [number, number]
  alpha: [number, number]
}

/**
 * Nearer is fewer, longer and brighter: a streak close to the lens is a
 * motion-blurred drop, far off it is a thread.
 */
const RAIN: Record<'rainNear' | 'rainMid' | 'rainFar', RainParams> = {
  rainNear: { n: 30, len: [36, 72], width: [1.7, 2.5], alpha: [0.26, 0.5] },
  rainMid: { n: 46, len: [22, 44], width: [1.1, 1.6], alpha: [0.2, 0.4] },
  rainFar: { n: 70, len: [10, 22], width: [0.8, 1.1], alpha: [0.12, 0.26] },
}

interface SnowParams {
  n: number
  r: [number, number]
  soft: number
  alpha: [number, number]
  /** A few flakes so close they are out of focus: bigger, softer, fainter. */
  near: number
}

const SNOW: Record<'snowNear' | 'snowMid' | 'snowFar', SnowParams> = {
  snowNear: { n: 14, r: [2.4, 3.8], soft: 1.6, alpha: [0.75, 0.95], near: 3 },
  snowMid: { n: 26, r: [1.5, 2.5], soft: 1.4, alpha: [0.65, 0.9], near: 0 },
  snowFar: { n: 42, r: [0.9, 1.5], soft: 1.3, alpha: [0.45, 0.75], near: 0 },
}

interface BlobParams {
  n: number
  rx: [number, number]
  ry: [number, number]
  alpha: [number, number]
}

const BLOBS: Record<'fogA' | 'fogB' | 'cloud', BlobParams> = {
  fogA: { n: 14, rx: [220, 420], ry: [80, 160], alpha: [0.05, 0.11] },
  fogB: { n: 12, rx: [300, 540], ry: [110, 200], alpha: [0.04, 0.09] },
  cloud: { n: 7, rx: [340, 600], ry: [170, 280], alpha: [0.1, 0.18] },
}

const span = (rng: Rng, [lo, hi]: [number, number]) => rng.range(lo, hi)

export function rainDrops(kind: 'rainNear' | 'rainMid' | 'rainFar'): Drop[] {
  const { w, h } = TILES[kind]
  const p = RAIN[kind]
  const rng = seededRng(`weather:${kind}`)
  const out: Drop[] = []
  for (let i = 0; i < p.n; i++) {
    out.push({ x: rng.range(0, w), y: rng.range(0, h), len: span(rng, p.len), width: span(rng, p.width), alpha: span(rng, p.alpha) })
  }
  return out
}

export function snowFlakes(kind: 'snowNear' | 'snowMid' | 'snowFar'): Flake[] {
  const { w, h } = TILES[kind]
  const p = SNOW[kind]
  const rng = seededRng(`weather:${kind}`)
  const out: Flake[] = []
  for (let i = 0; i < p.n; i++) {
    out.push({ x: rng.range(0, w), y: rng.range(0, h), r: span(rng, p.r), soft: p.soft, alpha: span(rng, p.alpha) })
  }
  for (let i = 0; i < p.near; i++) {
    out.push({ x: rng.range(0, w), y: rng.range(0, h), r: rng.range(5, 8), soft: 2.6, alpha: rng.range(0.3, 0.45) })
  }
  return out
}

export function fogBlobs(kind: 'fogA' | 'fogB' | 'cloud'): Blob[] {
  const { w, h } = TILES[kind]
  const p = BLOBS[kind]
  const rng = seededRng(`weather:${kind}`)
  const out: Blob[] = []
  for (let i = 0; i < p.n; i++) {
    out.push({ x: rng.range(0, w), y: rng.range(0, h), rx: span(rng, p.rx), ry: span(rng, p.ry), alpha: span(rng, p.alpha) })
  }
  return out
}

/** Specks on the wind, for a storm on a world with nothing to rain. */
export function dustSpecks(): Flake[] {
  const { w, h } = TILES.dust
  const rng = seededRng('weather:dust')
  const out: Flake[] = []
  for (let i = 0; i < 70; i++) {
    out.push({ x: rng.range(0, w), y: rng.range(0, h), r: rng.range(0.6, 1.5), soft: 1.4, alpha: rng.range(0.14, 0.34) })
  }
  return out
}

// ─── Drawing it ─────────────────────────────────────────────────────────────

/** The offsets a shape is drawn at so the tile wraps: itself and its eight neighbours. */
const WRAP: [number, number][] = [
  [0, 0],
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
]

function drawDrops(ctx: CanvasRenderingContext2D, w: number, h: number, drops: Drop[]) {
  ctx.lineCap = 'round'
  for (const d of drops) {
    for (const [ox, oy] of WRAP) {
      const x = d.x + ox * w
      const y = d.y + oy * h
      if (y + d.len < 0 || y > h || x < -4 || x > w + 4) continue
      // A streak fades in and out along its length: a drop caught mid-fall by
      // a shutter, not a dash.
      const g = ctx.createLinearGradient(x, y, x, y + d.len)
      g.addColorStop(0, `rgba(225, 236, 255, 0)`)
      g.addColorStop(0.45, `rgba(225, 236, 255, ${d.alpha.toFixed(3)})`)
      g.addColorStop(1, `rgba(225, 236, 255, 0)`)
      ctx.strokeStyle = g
      ctx.lineWidth = d.width
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x, y + d.len)
      ctx.stroke()
    }
  }
}

function drawFlakes(ctx: CanvasRenderingContext2D, w: number, h: number, flakes: Flake[], rgb = '255, 255, 255') {
  for (const f of flakes) {
    const edge = f.r * f.soft
    for (const [ox, oy] of WRAP) {
      const x = f.x + ox * w
      const y = f.y + oy * h
      if (x + edge < 0 || x - edge > w || y + edge < 0 || y - edge > h) continue
      const g = ctx.createRadialGradient(x, y, 0, x, y, edge)
      g.addColorStop(0, `rgba(${rgb}, ${f.alpha.toFixed(3)})`)
      g.addColorStop(f.r / edge, `rgba(${rgb}, ${(f.alpha * 0.85).toFixed(3)})`)
      g.addColorStop(1, `rgba(${rgb}, 0)`)
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(x, y, edge, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

function drawBlobs(ctx: CanvasRenderingContext2D, w: number, h: number, blobs: Blob[], rgb: string) {
  for (const b of blobs) {
    for (const [ox, oy] of WRAP) {
      const x = b.x + ox * w
      const y = b.y + oy * h
      if (x + b.rx < 0 || x - b.rx > w || y + b.ry < 0 || y - b.ry > h) continue
      // An ellipse of haze: a unit circle gradient scaled, so the fall-off is
      // radial in the blob's own shape.
      ctx.save()
      ctx.translate(x, y)
      ctx.scale(b.rx, b.ry)
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
      g.addColorStop(0, `rgba(${rgb}, ${b.alpha.toFixed(3)})`)
      g.addColorStop(0.55, `rgba(${rgb}, ${(b.alpha * 0.55).toFixed(3)})`)
      g.addColorStop(1, `rgba(${rgb}, 0)`)
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(0, 0, 1, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
  }
}

function paint(kind: TileKind, ctx: CanvasRenderingContext2D, w: number, h: number) {
  switch (kind) {
    case 'rainNear':
    case 'rainMid':
    case 'rainFar':
      drawDrops(ctx, w, h, rainDrops(kind))
      return
    case 'snowNear':
    case 'snowMid':
    case 'snowFar':
      drawFlakes(ctx, w, h, snowFlakes(kind))
      return
    case 'fogA':
    case 'fogB':
      drawBlobs(ctx, w, h, fogBlobs(kind), '236, 241, 248')
      return
    case 'cloud':
      drawBlobs(ctx, w, h, fogBlobs(kind), '8, 12, 30')
      return
    case 'dust':
      drawFlakes(ctx, w, h, dustSpecks(), '226, 208, 176')
      return
  }
}

const urls = new Map<string, string>()

/**
 * The tile as a data URL, drawn at `dpr` device pixels per CSS pixel, cached
 * per kind and ratio for the life of the tab. Empty where there is no 2D
 * context (jsdom), which the layer treats as "no bitmap" rather than an error.
 * WebP where the browser can encode it, PNG where it cannot (Safari) — both
 * answer `img-src 'self' data:`.
 */
export function tileUrl(kind: TileKind, dpr = 1): string {
  const key = `${kind}@${dpr}`
  const hit = urls.get(key)
  if (hit !== undefined) return hit
  const { w, h, res } = TILES[kind]
  const k = res * dpr
  let url = ''
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(w * k))
    canvas.height = Math.max(1, Math.round(h * k))
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.scale(k, k)
      paint(kind, ctx, w, h)
      url = canvas.toDataURL('image/webp', 0.82)
    }
  }
  urls.set(key, url)
  return url
}

/** Test seam. */
export function clearTileCache(): void {
  urls.clear()
}
