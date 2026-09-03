/**
 * The backdrop's own stack stays inside the backdrop.
 *
 * `<SceneBackdrop />` holds two canvases that swap places (so a new render can
 * be brought up over the one it replaces) and the weather layer above both, so
 * it declares `z-index` three times. `position: absolute` does **not** contain a
 * z-index: without an isolating property those three climb into the board's own
 * stacking context, where they outrank `.stage` — and the room is painted over
 * the cards. What that looks like is a match with no table, no hand and no
 * deck, which is exactly what shipped for as long as it took somebody to open
 * the game and ask where the cards had gone.
 *
 * A source scan because jsdom applies no component styles, and because what is
 * being asserted is a rule about the file rather than about a render.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

const read = (p: string) => readFileSync(join(process.cwd(), 'src', p), 'utf8')

describe('the rendered room paints under the board, never over it', () => {
  const source = read('components/scene/SceneBackdrop.svelte')
  const weather = read('components/scene/WeatherLayer.svelte')

  it('isolates the backdrop, because its children carry a z-index', () => {
    expect(source).toMatch(/z-index:\s*\d/)
    const scene = source.match(/\n {2}\.scene \{[\s\S]*?\n {2}\}/)
    expect(scene, '.scene rule not found').not.toBeNull()
    expect(scene![0]).toMatch(/isolation:\s*isolate/)
  })

  it('keeps the weather above both frames', () => {
    const frames = [...source.matchAll(/z-index:\s*(\d+)/g)].map((m) => Number(m[1]))
    const above = [...weather.matchAll(/z-index:\s*(\d+)/g)].map((m) => Number(m[1]))
    expect(frames.length).toBeGreaterThan(0)
    expect(above.length).toBeGreaterThan(0)
    expect(Math.min(...above)).toBeGreaterThan(Math.max(...frames))
  })

  it('brings a new render up over the old one instead of swapping for it', () => {
    // Two canvases, one of them held at zero for a flush so the fade has a
    // start, and the outgoing one left alone underneath.
    expect((source.match(/<canvas/g) ?? []).length).toBe(2)
    expect(source).toMatch(/class:entering=/)
    expect(source).toMatch(/\.frame\.entering \{[^}]*opacity:\s*0/)
    expect(source).toMatch(/\.frame\.entering \{[^}]*transition:\s*none/)
    expect(source).toMatch(/:root\[data-motion="reduce"\] \.frame \{[^}]*transition:\s*none/)
  })

  it('waits for the viewport to hold still before it renders again', () => {
    expect(source).toMatch(/RESIZE_SETTLE_MS\s*=\s*\d+/)
    expect(source).toMatch(/setTimeout\(request, RESIZE_SETTLE_MS\)/)
  })
})
