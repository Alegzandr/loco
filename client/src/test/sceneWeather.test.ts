/**
 * What falls over a room, and the two ways a tiled weather layer lies.
 *
 * Every layer is one drawn tile under one transform animation, which is what
 * makes the weather free — and it is also what makes it easy to get silently
 * wrong in two ways nothing errors on:
 *
 * 1. **A cycle that is not a whole tile jumps.** The layer travels, wraps back
 *    to its start, and unless the distance it travelled is exactly the tile it
 *    is painted with, the pattern lands somewhere else than it left. The tile
 *    and the travel are therefore one number, written by `tiled()` as the
 *    background size and as `--tile-w` / `--tile-h`, and the keyframes travel
 *    by those and by nothing else.
 * 2. **A tile that does not wrap shows a seam.** Every shape near an edge is
 *    drawn again one tile over; a shape placed outside the tile would be
 *    drawn nowhere.
 *
 * The shapes are pure and seeded, so they are asserted directly; the layer's
 * mechanism is a source scan, because jsdom applies no component styles and
 * because what is being asserted is a property of the stylesheet.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  DRIFT_S,
  FALL_S,
  LEAN_DEG,
  SWAY,
  TILES,
  fogBlobs,
  rainDrops,
  snowFlakes,
  dustSpecks,
  sheetBox,
  sheetStyle,
  evalLen,
  tileUrl,
  type TileKind,
} from '../components/scene/weatherTiles'

const source = readFileSync(join(process.cwd(), 'src', 'components/scene/WeatherLayer.svelte'), 'utf8')

/** A `@keyframes` block, by name. */
function keyframes(name: string): string {
  const m = source.match(new RegExp(String.raw`@keyframes ${name} \{[\s\S]*?\n {2}\}`))
  expect(m, `@keyframes ${name} not found`).not.toBeNull()
  return m![0]
}

describe('a layer travels exactly one tile per cycle, so the pattern has no seam', () => {
  it('paints every sheet with the tile it travels by', () => {
    // One rule paints every sheet, and the size it paints with is the pair of
    // variables the keyframes travel by.
    const sheet = source.match(/\n {2}\.sheet \{[\s\S]*?\n {2}\}/)
    expect(sheet, '.sheet rule not found').not.toBeNull()
    expect(sheet![0]).toMatch(/background-size:\s*var\(--tile-w\) var\(--tile-h\);/)
    // No sheet declares a size of its own.
    expect((source.match(/background-size:/g) ?? []).length).toBe(1)
  })

  it('falls by --tile-h and drifts by --tile-w, never by a literal', () => {
    expect(keyframes('fall')).toContain('transform: translate3d(0, var(--tile-h), 0);')
    expect(keyframes('drift')).toContain('transform: translate3d(calc(-1 * var(--tile-w)), 0, 0);')
    for (const name of ['fall', 'drift']) {
      expect(keyframes(name), `${name} travels by a literal`).not.toMatch(/translate3d\([^)]*\d+(px|%)/)
    }
  })

  it('writes both variables and the cycle from the one tile table', () => {
    // `tiled()` is the only thing that writes them, off `TILES` and the two
    // duration tables: a sheet cannot be handed a tile and a different travel.
    expect(source).toMatch(/--tile-w: \$\{t\.w\}px/)
    expect(source).toMatch(/--tile-h: \$\{t\.h\}px/)
    expect(source).toMatch(/--cycle: \$\{cycle\}s/)
    expect(source).not.toMatch(/--tile-[wh]:\s*\d/)
  })

  it('leans the rain by a skew rather than a diagonal travel', () => {
    // A diagonal travel wraps only when both legs are whole tiles, which pins
    // the angle to the tile's shape. The skew leans the sheet and leaves the
    // vertical wrap alone.
    expect(source).toMatch(/\.wind \{[^}]*transform:\s*skewX\(calc\(-1 \* var\(--lean\)\)\)/s)
    expect(keyframes('fall')).not.toMatch(/translate3d\(\s*[^0]/)
  })
})

describe('the shapes wrap and stay inside their tile', () => {
  const rains = ['rainNear', 'rainMid', 'rainFar'] as const
  const snows = ['snowNear', 'snowMid', 'snowFar'] as const

  it('places every drop, flake and blob inside the tile it belongs to', () => {
    for (const k of rains) {
      const { w, h } = TILES[k]
      const drops = rainDrops(k)
      expect(drops.length).toBeGreaterThan(20)
      for (const d of drops) {
        expect(d.x).toBeGreaterThanOrEqual(0)
        expect(d.x).toBeLessThan(w)
        expect(d.y).toBeGreaterThanOrEqual(0)
        expect(d.y).toBeLessThan(h)
        expect(d.len).toBeGreaterThan(0)
        expect(d.alpha).toBeGreaterThan(0)
        expect(d.alpha).toBeLessThanOrEqual(1)
      }
    }
    for (const k of snows) {
      const { w, h } = TILES[k]
      for (const f of snowFlakes(k)) {
        expect(f.x).toBeGreaterThanOrEqual(0)
        expect(f.x).toBeLessThan(w)
        expect(f.y).toBeGreaterThanOrEqual(0)
        expect(f.y).toBeLessThan(h)
      }
    }
    for (const k of ['fogA', 'fogB', 'cloud'] as const) {
      const { w, h } = TILES[k]
      const blobs = fogBlobs(k)
      expect(blobs.length).toBeGreaterThan(3)
      for (const b of blobs) {
        expect(b.x).toBeGreaterThanOrEqual(0)
        expect(b.x).toBeLessThan(w)
        expect(b.y).toBeGreaterThanOrEqual(0)
        expect(b.y).toBeLessThan(h)
      }
    }
    expect(dustSpecks().length).toBeGreaterThan(20)
  })

  it('is the same tile every time: a place does not rearrange itself on reload', () => {
    expect(rainDrops('rainNear')).toEqual(rainDrops('rainNear'))
    expect(snowFlakes('snowMid')).toEqual(snowFlakes('snowMid'))
    expect(fogBlobs('fogA')).toEqual(fogBlobs('fogA'))
  })

  it('is not the one streak sixty times', () => {
    // The whole reason the gradient went: every streak was the same length
    // and the same white. A drawn tile carries a spread of both.
    const drops = rainDrops('rainMid')
    const lens = drops.map((d) => d.len)
    const alphas = drops.map((d) => d.alpha)
    expect(Math.max(...lens) / Math.min(...lens)).toBeGreaterThan(1.5)
    expect(Math.max(...alphas) - Math.min(...alphas)).toBeGreaterThan(0.1)
  })

  it('draws the near sheet longer and brighter than the far one', () => {
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
    const near = rainDrops('rainNear')
    const far = rainDrops('rainFar')
    expect(mean(near.map((d) => d.len))).toBeGreaterThan(mean(far.map((d) => d.len)))
    expect(mean(near.map((d) => d.alpha))).toBeGreaterThan(mean(far.map((d) => d.alpha)))
    expect(near.length).toBeLessThan(far.length)
  })

  it('survives a browser with no canvas as an empty tile, never a throw', () => {
    // jsdom has no 2D context. The layer is handed an empty URL and paints
    // nothing, which is a room with no rain rather than a room with no table.
    expect(() => tileUrl('rainNear', 2)).not.toThrow()
    expect(typeof tileUrl('snowFar')).toBe('string')
  })
})

describe('rain a spectator reads as rain', () => {
  it('falls between 200 and 600 pixels a second, nearer faster', () => {
    // It was 1000 px/s once, which on a laptop is static, not rain.
    const speed = (k: TileKind) => TILES[k].h / FALL_S[k]!
    for (const k of ['rainNear', 'rainMid', 'rainFar'] as const) {
      expect(speed(k), k).toBeGreaterThanOrEqual(200)
      expect(speed(k), k).toBeLessThanOrEqual(600)
    }
    expect(speed('rainNear')).toBeGreaterThan(speed('rainMid'))
    expect(speed('rainMid')).toBeGreaterThan(speed('rainFar'))
  })

  it('lets snow fall slowly and sway, nearer wider', () => {
    const speed = (k: TileKind) => TILES[k].h / FALL_S[k]!
    for (const k of ['snowNear', 'snowMid', 'snowFar'] as const) {
      expect(speed(k), k).toBeLessThan(120)
      expect(SWAY[k]?.px, `${k} sways`).toBeGreaterThan(0)
    }
    expect(SWAY.snowNear!.px).toBeGreaterThan(SWAY.snowFar!.px)
  })

  it('drifts the haze slower than anything falls', () => {
    for (const k of ['fogA', 'fogB', 'cloud'] as const) {
      expect(TILES[k].w / DRIFT_S[k]!, k).toBeLessThan(30)
    }
  })

  it('still holds its first frame under reduced motion, and gives its layers back', () => {
    expect(source).toMatch(/:root\[data-motion="reduce"\] \.sheet,\s*:root\[data-motion="reduce"\] \.sway \{[^}]*animation:\s*none/)
    // A sheet that no longer moves has no reason to keep a compositor layer.
    expect(source).toMatch(/:root\[data-motion="reduce"\] \.sheet,\s*:root\[data-motion="reduce"\] \.sway \{[^}]*will-change:\s*auto/)
    expect(source).toMatch(/:root\[data-motion="reduce"\] \.flash,\s*:root\[data-motion="reduce"\] \.bolt \{[^}]*display:\s*none/)
  })

  it('draws fewer sheets on a lighter tier and never none', () => {
    expect(source).toMatch(/tier === 'high' \? \['rainFar', 'rainMid', 'rainNear'\]/)
    expect(source).toMatch(/: \['rainMid'\]/)
    expect(source).toMatch(/: \['snowMid'\]/)
    expect(source).toMatch(/tier === 'light' \? \['fogA'\] : \['fogB', 'fogA'\]/)
  })
})

/**
 * Evaluates the CSS `sheetStyle` writes, for one frame and tile: the terms are
 * `k * 100%`, `k * 100cqh`, `k * 100cqw`, `k * var(--tile-w|h)` and `Npx`.
 * Reading the string rather than `sheetBox` is what proves the page gets the
 * geometry the coverage below is proved for.
 */
function cssBox(style: string, frame: { w: number; h: number }, tile: { w: number; h: number }) {
  const out: Record<string, number> = {}
  for (const decl of style.split(';')) {
    const [prop, value] = decl.split(':').map((x) => x.trim())
    const axis = prop === 'left' || prop === 'width' ? 'x' : 'y'
    const body = value.replace(/^calc\((.*)\)$/, '$1')
    let sum = 0
    for (const term of body.split(' + ')) {
      const m = term.match(/^(-?[\d.]+) \* (100%|100cqh|100cqw|var\(--tile-w\)|var\(--tile-h\))$/)
      if (m) {
        const unit = { '100%': axis === 'x' ? frame.w : frame.h, '100cqh': frame.h, '100cqw': frame.w, 'var(--tile-w)': tile.w, 'var(--tile-h)': tile.h }[m[2]]!
        sum += Number(m[1]) * unit
        continue
      }
      const px = term.match(/^(-?[\d.]+)px$/)
      expect(px, `unreadable term ${term} in ${prop}`).not.toBeNull()
      sum += Number(px![1])
    }
    out[prop] = sum
  }
  return out as { left: number; top: number; width: number; height: number }
}

describe('a sheet covers the frame for the whole of its travel, at any size', () => {
  const widths = [320, 360, 390, 414, 568, 667, 768, 844, 1024, 1280, 1366, 1440, 1600, 1920, 2560, 3440, 3840]
  const heights = [320, 360, 390, 414, 480, 568, 667, 768, 844, 900, 1080, 1440, 1600, 2160]
  const phases = Array.from({ length: 21 }, (_, i) => i / 20)
  const EPS = 1e-6

  /**
   * Whether every pixel of a `w × h` frame is under the sheet at this point of
   * its travel. The frame's preimage through the skew is a parallelogram and
   * the sheet a rectangle, so the four corners decide it.
   */
  function covers(kind: TileKind, leanDeg: number, w: number, h: number, phase: number, sway: number): boolean {
    const tile = TILES[kind]
    const box = cssBox(sheetStyle(kind, leanDeg), { w, h }, tile)
    const falling = FALL_S[kind] !== undefined
    // The travel: down one tile for a fall, left one tile for a drift. A
    // reversed drift plays the same range backwards, so the range is all
    // there is to check.
    const dx = (falling ? 0 : -tile.w * phase) + sway
    const dy = falling ? tile.h * phase : 0
    const tan = Math.tan((leanDeg * Math.PI) / 180)
    for (const [X, Y] of [[0, 0], [w, 0], [0, h], [w, h]]) {
      // skewX(-lean) about the bottom edge moves a point right by (h - y) tan.
      const x = X - (h - Y) * tan
      if (x < box.left + dx - EPS || x > box.left + dx + box.width + EPS) return false
      if (Y < box.top + dy - EPS || Y > box.top + dy + box.height + EPS) return false
    }
    return true
  }

  const cases: [TileKind, number][] = [
    ['rainNear', LEAN_DEG.rain],
    ['rainMid', LEAN_DEG.rain],
    ['rainFar', LEAN_DEG.rain],
    ['rainNear', LEAN_DEG.storm],
    ['rainMid', LEAN_DEG.storm],
    ['rainFar', LEAN_DEG.storm],
    ['snowNear', 0],
    ['snowMid', 0],
    ['snowFar', 0],
    ['fogA', 0],
    ['fogB', 0],
    ['cloud', 0],
    ['dust', 0],
  ]

  it.each(cases)('%s at a lean of %i° never shows the frame an edge', (kind, lean) => {
    const sway = SWAY[kind]?.px ?? 0
    for (const w of widths) {
      for (const h of heights) {
        for (const p of phases) {
          for (const s of sway ? [-sway, 0, sway] : [0]) {
            expect(covers(kind, lean, w, h, p, s), `${kind} ${w}×${h} at ${p} of the cycle, sway ${s}`).toBe(true)
          }
        }
      }
    }
  })

  it('catches the old boxes: this is the test that would have failed', () => {
    // A 390px phone under a 1600px cloud tile, a 300%-wide sheet at -100%:
    // off the frame for about half of every cycle.
    const old = { left: -390, width: 3 * 390 }
    const bare = phases.filter((p) => old.left - 1600 * p + old.width < 390).length
    expect(bare / phases.length).toBeGreaterThan(0.4)
    // And the 25% overhang against a portrait phone's lean.
    expect(844 * Math.tan((LEAN_DEG.rain * Math.PI) / 180)).toBeGreaterThan(0.25 * 390)
  })

  it('is no larger than it has to be', () => {
    // A drift is exactly one tile wider and no taller; a fall one tile taller
    // and wider only by the lean and the sway.
    const f = { w: 1920, h: 1080 }
    const d = sheetBox('cloud')
    expect(evalLen(d.width, f, TILES.cloud)).toBe(1920 + 1600)
    expect(evalLen(d.height, f, TILES.cloud)).toBe(1080)
    const r = sheetBox('rainNear', LEAN_DEG.storm)
    expect(evalLen(r.height, f, TILES.rainNear)).toBe(1080 + 480)
    expect(evalLen(r.width, f, TILES.rainNear)).toBeLessThan(1920 + 1080 * 0.27)
  })

  it('is laid out by `sheetStyle` and by nothing in the stylesheet', () => {
    expect(source).toMatch(/sheetStyle\(kind, leanDeg\)/)
    for (const rule of ['sheet', 'fall', 'drift']) {
      const m = source.match(new RegExp(String.raw`\n {2}\.${rule} \{[\s\S]*?\n {2}\}`))
      expect(m, `.${rule} rule not found`).not.toBeNull()
      expect(m![0], `.${rule} sizes itself`).not.toMatch(/\b(left|top|width|height):/)
    }
    // The rain is handed the lean the wind skews by.
    expect(source).toMatch(/tiled\(kind, lean\)/)
    expect(source).toMatch(/--lean: \{lean\}deg/)
    // `cqh` needs a size container, and the frame is it.
    expect(source).toMatch(/\.weather \{[^}]*container-type:\s*size/)
  })
})
