/**
 * What falls over a room, and the two ways a CSS weather layer lies.
 *
 * Every layer here is one tiled gradient under one transform animation, which
 * is what makes the weather free — and it is also what makes it easy to get
 * silently wrong in two ways nothing errors on:
 *
 * 1. **A cycle that is not a whole tile jumps.** The layer travels, wraps back
 *    to its start, and unless the distance it travelled is an exact multiple of
 *    the background tile, the pattern lands somewhere else than it left. At a
 *    percentage of the frame it is a multiple only by coincidence, and the rain
 *    stepped sideways once a cycle on most screens.
 * 2. **A `repeating-linear-gradient` written as ranges has hard edges.** The
 *    fog's drifting half stepped from transparent to 0.12 in one stop, which
 *    over a city reads as a set of vertical bands laid across it, not as haze.
 *
 * A source scan, because jsdom applies no component styles and because both of
 * these are properties of the stylesheet rather than of a render.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

const source = readFileSync(join(process.cwd(), 'src', 'components/scene/WeatherLayer.svelte'), 'utf8')

/** A `@keyframes` block, by name. */
function keyframes(name: string): string {
  const m = source.match(new RegExp(String.raw`@keyframes ${name} \{[\s\S]*?\n {2}\}`))
  expect(m, `@keyframes ${name} not found`).not.toBeNull()
  return m![0]
}

/**
 * The rule that paints this selector.
 *
 * There is more than one block per selector — `.fog` shares its geometry with
 * the rain and the snow and declares its own paint — so this takes the one with
 * a background in it.
 */
function painted(selector: string): string {
  const re = new RegExp('\\n {2}[^\\n{}]*' + selector + ' \\{[\\s\\S]*?\\n {2}\\}', 'g')
  const blocks = [...source.matchAll(re)].map((m) => m[0])
  expect(blocks.length, `${selector} rule not found`).toBeGreaterThan(0)
  const one = blocks.find((b) => b.includes('background'))
  expect(one, `${selector} paints nothing`).toBeDefined()
  return one!
}

/** The `background-size` tile of a rule, as written. */
function tile(selector: string): string {
  const m = painted(selector).match(/background-size:\s*([^;]+);/)
  expect(m, `${selector} declares no background-size`).not.toBeNull()
  return m![1].trim()
}

describe('a falling layer travels a whole tile, so the pattern has no seam', () => {
  const cases: [string, string, string][] = [
    ['\\.rain', 'rainFall', '240px'],
    ['\\.rainFar', 'rainFallFar', '160px'],
    ['\\.snow', 'snowFall', '180px'],
    ['\\.snowMid', 'snowFallMid', '260px'],
    ['\\.snowFar', 'snowFallFar', '340px'],
  ]

  for (const [selector, frames, step] of cases) {
    it(`${selector.replace('\\', '')} falls exactly its own ${step} tile`, () => {
      expect(tile(selector)).toContain(step)
      const to = keyframes(frames).match(/to \{\s*transform: (translate3d\([^)]*\));/)
      expect(to, `${frames} has no \`to\``).not.toBeNull()
      expect(to![1]).toBe(`translate3d(0, ${step}, 0)`)
    })
  }

  it('drifts the fog by exactly the tile it is drawn with', () => {
    // Three frame-widths wide, one tile per frame: a third of the element.
    expect(tile('\\.fog')).toContain('33.3333%')
    expect(keyframes('fogDrift')).toContain('translate3d(-33.3333%, 0, 0)')
  })
})

describe('the fog is haze, not a set of bands', () => {
  const fog = painted('\\.fog')

  it('has no repeating gradient in it at all', () => {
    // A repeating gradient is not the failure by itself — writing its stops as
    // ranges is — but the tile is the frame now, so a plain one tiles it and
    // there is no reason left to reach for the other.
    expect(fog).not.toContain('repeating-linear-gradient')
  })

  it('steps nowhere: no two stops sit at the same place', () => {
    // `rgba(...) 0 180px` is one colour held across a range and then cut, which
    // is a hard edge. A stop list with no two stops at one position can only
    // interpolate.
    const stops = [...fog.matchAll(/rgba\([^)]*\)\s+([\d.]+%)/g)].map((m) => m[1])
    expect(stops.length).toBeGreaterThan(6)
    for (const [i, at] of stops.entries()) {
      if (i === 0) continue
      expect(at, `two stops at ${at}`).not.toBe(stops[i - 1])
    }
  })
})

describe('rain a spectator reads as rain', () => {
  it('takes over two thirds of a second to fall one tile', () => {
    // 240px in 0.72s is about 330 pixels a second. It was 0.55s for the whole
    // frame — three times that on a laptop, which is not rain but static.
    const d = painted('\\.rain').match(/animation: rainFall ([\d.]+)s/)
    expect(d).not.toBeNull()
    expect(Number(d![1])).toBeGreaterThanOrEqual(0.65)
  })

  it('still holds its first frame under reduced motion', () => {
    expect(source).toMatch(/:root\[data-motion="reduce"\] \.rain,/)
    expect(source).toMatch(/:root\[data-motion="reduce"\] \.flash \{[^}]*display:\s*none/)
  })
})
