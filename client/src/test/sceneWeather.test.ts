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
import { DRIFT_S, FALL_S, SWAY, TILES, fogBlobs, rainDrops, snowFlakes, dustSpecks, tileUrl, type TileKind } from '../components/scene/weatherTiles'

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
    expect(source).toMatch(/\.wind \{[^}]*transform:\s*skewX\(/s)
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

  it('still holds its first frame under reduced motion', () => {
    expect(source).toMatch(/:root\[data-motion="reduce"\] \.sheet,\s*:root\[data-motion="reduce"\] \.sway \{[^}]*animation:\s*none/)
    expect(source).toMatch(/:root\[data-motion="reduce"\] \.flash,\s*:root\[data-motion="reduce"\] \.bolt \{[^}]*display:\s*none/)
  })

  it('draws fewer sheets on a lighter tier and never none', () => {
    expect(source).toMatch(/tier === 'high' \? \['rainFar', 'rainMid', 'rainNear'\]/)
    expect(source).toMatch(/: \['rainMid'\]/)
    expect(source).toMatch(/: \['snowMid'\]/)
  })
})
