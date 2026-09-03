/**
 * The graphics ladder, and the two things about it that fail silently.
 *
 * A tier is a set of numbers the renderer reads (`scene/quality.ts`) and a
 * preference that resolves to one (`hooks/graphicsPref.ts`). Neither errors
 * when it stops being a ladder: a `medium` that renders larger than `high`
 * is merely a strange setting, and an `auto` that lands every phone on the
 * full render is merely a long loading gate on a phone. And the finishing
 * passes are a chain of shaders whose one contract with the plain path is
 * colour: a composite that forgot the output encoding comes out a stop
 * darker and nothing reports it.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, beforeEach } from 'vitest'
import { QUALITY, renderQuality } from '../components/scene/quality'
import {
  GRAPHICS_PREFS,
  GRAPHICS_STORAGE_KEY,
  autoTier,
  getGraphicsPref,
  resetGraphicsPref,
  resolveGraphics,
  setGraphicsPref,
} from '../hooks/graphicsPref'

const read = (p: string) => readFileSync(join(process.cwd(), 'src', p), 'utf8')

describe('the ladder is a ladder', () => {
  it('renders larger and finishes more, one rung at a time', () => {
    const [high, medium, light] = [QUALITY.high, QUALITY.medium, QUALITY.light]
    expect(high.supersample).toBeGreaterThan(medium.supersample)
    expect(medium.supersample).toBeGreaterThan(light.supersample)
    expect(high.glPixels).toBeGreaterThan(medium.glPixels)
    expect(medium.glPixels).toBeGreaterThan(light.glPixels)
    // The plain frame is a real tier, not a broken one: it multisamples where
    // the others supersample.
    expect(light.post).toBeNull()
    expect(light.msaa).toBe(true)
    expect(medium.post).not.toBeNull()
    expect(high.post).not.toBeNull()
    // Nothing the middle rung does is off on the top one.
    for (const key of ['fxaa', 'bloom', 'dof', 'grain', 'aberration'] as const) {
      if (medium.post![key]) expect(high.post![key], key).toBe(true)
    }
    expect(high.post!.vignette).toBeGreaterThanOrEqual(medium.post!.vignette)
  })

  it('names every tier a preference can resolve to', () => {
    for (const p of GRAPHICS_PREFS) {
      if (p === 'auto') continue
      expect(renderQuality(p).tier).toBe(p)
    }
  })
})

describe('auto follows the device', () => {
  it('lands a small machine low, a phone in the middle and a desktop high', () => {
    expect(autoTier({ memory: 2, cores: 8 })).toBe('light')
    expect(autoTier({ memory: 8, cores: 8, coarse: true })).toBe('medium')
    expect(autoTier({ memory: 8, cores: 4 })).toBe('medium')
    expect(autoTier({ memory: 16, cores: 12, coarse: false })).toBe('high')
    // A browser that says nothing about itself is a desktop until proven
    // otherwise: the cost of guessing high is a longer gate, not a slow match.
    expect(autoTier({})).toBe('high')
  })

  it('lets an explicit choice win over the device in both directions', () => {
    expect(resolveGraphics('light', { memory: 32, cores: 16 })).toBe('light')
    expect(resolveGraphics('high', { memory: 1, cores: 2, coarse: true })).toBe('high')
    expect(resolveGraphics('auto', { memory: 1 })).toBe('light')
  })
})

describe('the preference', () => {
  beforeEach(() => {
    localStorage.clear()
    resetGraphicsPref()
  })

  it('is auto until somebody says otherwise, and remembers what they said', () => {
    expect(getGraphicsPref()).toBe('auto')
    setGraphicsPref('light')
    expect(getGraphicsPref()).toBe('light')
    expect(localStorage.getItem(GRAPHICS_STORAGE_KEY)).toBe('light')
    resetGraphicsPref()
    expect(getGraphicsPref()).toBe('light')
  })

  it('treats a stored value it does not know as auto', () => {
    localStorage.setItem(GRAPHICS_STORAGE_KEY, 'ultra')
    resetGraphicsPref()
    expect(getGraphicsPref()).toBe('auto')
  })
})

describe('the finishing passes', () => {
  const post = read('components/scene/post.ts')
  const render = read('components/scene/render.ts')
  const cache = read('components/scene/sceneCache.ts')

  it('end on the same output encoding the plain frame gets', () => {
    // The scene is rendered into a linear target and the passes work in
    // linear; without this line the composite lands on the canvas unencoded,
    // a stop darker than the room was before there were passes.
    expect(post).toMatch(/gl_FragColor = vec4\(col, 1\.0\);\s*#include <colorspace_fragment>/)
  })

  it('fall back to the plain frame rather than to no room', () => {
    expect(render).toMatch(/try \{[\s\S]*renderWithPost\([\s\S]*\} catch/)
    expect(render).toMatch(/if \(!photographed\) renderer\.render\(scene, camera\)/)
  })

  it('release every target with the context', () => {
    expect(post).toMatch(/finally \{[\s\S]*for \(const t of targets\) t\.dispose\(\)/)
  })

  it('make the tier part of what a cached frame is', () => {
    // Moving the preference mid-match has to render the room again: a frame
    // rendered at `light` answering a `high` request is a preference that
    // does nothing until the next match.
    expect(cache).toMatch(/@\$\{tier\}`/)
    expect(read('components/scene/SceneBackdrop.svelte')).toMatch(/have\.tier === tier/)
  })
})
