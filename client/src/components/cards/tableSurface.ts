/**
 * The table's surfaces as images: the grain of the rim's material, one per
 * room. The felt carries no texture at all, by the player's choice: its cloth
 * is its colour and the light on it (`docs/notes/visual.md`, "The table").
 *
 * Each is an SVG whose only content is a filter — fractal noise shaped by a
 * transfer curve and poured into the material's own colours — served as a
 * `data:` URI (`img-src 'self' data:`). No canvas and no script: the same
 * string is a background on the board, a `<pattern>` under the play
 * direction's inlay, and a background on the rooms page, which ships no
 * JavaScript and gets it at build time. The browser rasterises each once and
 * keeps it, the rule every card face keeps too: one cached image, not
 * geometry per instance.
 *
 * Everything is seeded and pure, so a room's table is the same table on every
 * seat, every visit and every page.
 */
import type { RimKind, TableMaterials } from './maps'

interface Noise {
  /** Base frequency along x and along y: unequal is a grain with a direction. */
  fx: number
  fy: number
  octaves: number
  seed: number
  /** Turbulence rather than fractal noise: sharper, swirling (the burl). */
  turbulence?: boolean
}

interface Layer {
  noise: Noise
  /** The noise (0–1) mapped to the layer's opacity, sampled evenly. */
  curve: number[]
  color: string
}

const SAMPLES = 49

/** Transparent below `from`, `alpha` at `to` and past it; `from > to` runs it backwards. */
function ramp(from: number, to: number, alpha: number): number[] {
  return Array.from({ length: SAMPLES }, (_, i) => {
    const x = i / (SAMPLES - 1)
    const t = Math.max(0, Math.min(1, (x - from) / (to - from)))
    return alpha * t
  })
}

/**
 * Growth rings: the noise's level lines, `count` of them across its range,
 * each a dark line of `alpha` sharpened by `sharp`. On noise stretched along
 * x, a level line is a grain line.
 */
function rings(count: number, alpha: number, sharp: number): number[] {
  return Array.from({ length: SAMPLES * 2 }, (_, i) => {
    const x = i / (SAMPLES * 2 - 1)
    return alpha * Math.pow(0.5 + 0.5 * Math.cos(2 * Math.PI * count * x), sharp)
  })
}

function svgTexture(w: number, h: number, base: string, layers: Layer[]): string {
  const parts = [`<feFlood flood-color='${base}' result='b'/>`]
  const merge = [`<feMergeNode in='b'/>`]
  layers.forEach((l, i) => {
    const n = l.noise
    parts.push(
      `<feTurbulence type='${n.turbulence ? 'turbulence' : 'fractalNoise'}' baseFrequency='${n.fx} ${n.fy}' numOctaves='${n.octaves}' seed='${n.seed}' stitchTiles='stitch' result='t${i}'/>`,
      `<feColorMatrix in='t${i}' type='matrix' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0' result='r${i}'/>`,
      `<feComponentTransfer in='r${i}' result='a${i}'><feFuncA type='table' tableValues='${l.curve.map((v) => +v.toFixed(3)).join(' ')}'/></feComponentTransfer>`,
      `<feFlood flood-color='${l.color}' result='c${i}'/>`,
      `<feComposite in='c${i}' in2='a${i}' operator='in' result='l${i}'/>`,
    )
    merge.push(`<feMergeNode in='l${i}'/>`)
  })
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'>` +
    `<filter id='f' x='0' y='0' width='100%' height='100%' color-interpolation-filters='sRGB'>` +
    parts.join('') +
    `<feMerge>${merge.join('')}</feMerge></filter>` +
    `<rect width='100%' height='100%' filter='url(#f)'/></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

export interface Surface {
  /** The image, a `data:` URI (not wrapped in `url()`). */
  uri: string
  /** One tile, board pixels. */
  w: number
  h: number
}

/** Each material's grain, in the table's own colours. */
function rimLayers(t: TableMaterials): Layer[] {
  const k: RimKind = t.rimKind
  switch (k) {
    case 'oak':
      // Quartersawn: straight rings, fine open pores, and the pale ray flecks
      // that only oak cut on the quarter shows.
      return [
        { noise: { fx: 0.0035, fy: 0.05, octaves: 3, seed: 7 }, curve: rings(15, 0.55, 2.2), color: t.grain },
        { noise: { fx: 0.03, fy: 0.55, octaves: 2, seed: 11 }, curve: ramp(0.55, 0.78, 0.4), color: t.grain },
        { noise: { fx: 0.012, fy: 0.22, octaves: 2, seed: 19 }, curve: ramp(0.6, 0.74, 0.3), color: t.rimLight },
      ]
    case 'teak':
      // Tight, straight, oily: fine rings, darker streaks, and pores.
      return [
        { noise: { fx: 0.002, fy: 0.07, octaves: 3, seed: 23 }, curve: rings(22, 0.42, 2.6), color: t.grain },
        { noise: { fx: 0.0012, fy: 0.02, octaves: 2, seed: 29 }, curve: ramp(0.45, 0.72, 0.35), color: t.grain },
        { noise: { fx: 0.05, fy: 0.9, octaves: 2, seed: 31 }, curve: ramp(0.58, 0.8, 0.35), color: t.grain },
        { noise: { fx: 0.004, fy: 0.12, octaves: 2, seed: 37 }, curve: ramp(0.62, 0.78, 0.18), color: t.rimLight },
      ]
    case 'burl':
      // Walnut burl: swirls round the eyes, and the eyes themselves.
      return [
        { noise: { fx: 0.011, fy: 0.014, octaves: 4, seed: 41, turbulence: true }, curve: rings(7, 0.62, 1.4), color: t.grain },
        { noise: { fx: 0.05, fy: 0.05, octaves: 2, seed: 43 }, curve: ramp(0.68, 0.78, 0.7), color: t.grain },
        { noise: { fx: 0.006, fy: 0.007, octaves: 3, seed: 47 }, curve: ramp(0.55, 0.75, 0.25), color: t.rimLight },
      ]
    case 'titanium':
      // Brushed: long fine scratches one way, and a slow shimmer along them.
      return [
        { noise: { fx: 0.0015, fy: 0.9, octaves: 2, seed: 53 }, curve: ramp(0.3, 0.7, 0.4), color: t.grain },
        { noise: { fx: 0.001, fy: 0.55, octaves: 2, seed: 59 }, curve: ramp(0.52, 0.8, 0.3), color: t.rimLight },
      ]
    case 'lacquer': {
      // A piano finish: depth rather than grain, a cloud under the glass,
      // and where the room sows it, gold dust in the coat (nashiji).
      const layers: Layer[] = [
        { noise: { fx: 0.006, fy: 0.008, octaves: 3, seed: 61 }, curve: ramp(0.35, 0.72, 0.4), color: t.grain },
      ]
      if (t.fleck) {
        layers.push({ noise: { fx: 0.9, fy: 0.9, octaves: 1, seed: 67 }, curve: ramp(0.74, 0.8, 0.9), color: t.fleck })
      }
      return layers
    }
  }
}

/** The rim's material: its colour and its grain, a tile running along x. */
export function rimSurface(t: TableMaterials): Surface {
  const w = 720
  const h = 240
  return { uri: svgTexture(w, h, t.rim, rimLayers(t)), w, h }
}

/** How much a finish shines, 0 (oiled, matte) to 1 (a piano's lacquer). */
export const RIM_GLOSS: Record<RimKind, number> = {
  lacquer: 1,
  burl: 0.75,
  teak: 0.6,
  titanium: 0.5,
  oak: 0.3,
}

/**
 * What a glossy rim mirrors, as background layers clipped to the rim: a broad
 * sheen along the far side where the light comes from, and a few narrow
 * streaks round the ring — the room's lights caught in the finish. Tinted by
 * the hour (`--scene-tint`) and by the material's own sheen.
 */
export function rimGloss(t: TableMaterials): string {
  const g = RIM_GLOSS[t.rimKind]
  const pct = (a: number) => `${Math.round(a * g * 100)}%`
  const hl = (a: number) => `color-mix(in srgb, var(--scene-tint, #ffffff) ${pct(a)}, transparent)`
  const sheen = (a: number) => `color-mix(in srgb, var(--tbl-rim-light) ${pct(a)}, transparent)`
  const streaks = [
    [-52, 3, hl(0.55)],
    [-24, 6, sheen(0.5)],
    [18, 4, hl(0.7)],
    [44, 2, sheen(0.6)],
    [128, 5, sheen(0.3)],
    [212, 3, hl(0.35)],
  ] as const
  // Written by where they sit round the ring (0 is the top, clockwise) and
  // laid in that order, because a conic's stops must climb.
  const stops = streaks
    .map(([at, width, color]) => ({ at: (at + 360) % 360, width, color }))
    .sort((x, y) => x.at - y.at)
    .map(({ at, width, color }) => `transparent ${at - width}deg, ${color} ${at}deg, transparent ${at + width}deg`)
  return [
    `radial-gradient(ellipse 62% 46% at 50% 0%, ${hl(0.4)} 0%, transparent 70%) border-box`,
    `conic-gradient(from 0deg at 50% 50%, transparent 0deg, ${stops.join(', ')}, transparent 360deg) border-box`,
    `radial-gradient(ellipse 80% 40% at 50% 100%, rgba(0, 0, 0, ${(0.35 * (1.2 - g * 0.4)).toFixed(2)}) 0%, transparent 75%) border-box`,
  ].join(', ')
}

/** Everything the table's CSS reads, as declarations: the board and the rooms page both set these. */
export function tableCssVars(t: TableMaterials): string[] {
  const rim = rimSurface(t)
  return [
    `--tbl-felt: ${t.felt}`,
    `--tbl-felt-deep: ${t.feltDeep}`,
    `--tbl-rim: ${t.rim}`,
    `--tbl-rim-light: ${t.rimLight}`,
    `--tbl-base: ${t.base}`,
    `--tbl-inlay: ${t.inlay}`,
    `--tbl-rim-tex: url("${rim.uri}")`,
    `--tbl-rim-size: ${rim.w}px ${rim.h}px`,
    `--tbl-rim-gloss: ${rimGloss(t)}`,
  ]
}
