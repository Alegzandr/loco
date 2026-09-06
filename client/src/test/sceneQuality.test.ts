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
    // The shadow map: every tier has one, the higher the larger.
    expect(high.shadowMap).toBeGreaterThan(medium.shadowMap)
    expect(medium.shadowMap).toBeGreaterThan(light.shadowMap)
    expect(light.shadowMap).toBeGreaterThanOrEqual(1024)
    // The plain frame is a real tier, not a broken one: it multisamples where
    // the others supersample.
    expect(light.post).toBeNull()
    expect(light.msaa).toBe(true)
    expect(medium.post).not.toBeNull()
    expect(high.post).not.toBeNull()
    // Nothing the middle rung does is off on the top one.
    for (const key of ['ao', 'fxaa', 'bloom', 'dof', 'grain', 'aberration'] as const) {
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

  it('apply the same tone curve the plain frame gets, and apply it once', () => {
    // A render target gets no tone mapping from the renderer, so the
    // composite applies the curve itself, with three's own functions; the
    // plain path has it from `renderer.toneMapping`. Both read `look.ts`.
    expect(post).toMatch(/ACESFilmicToneMapping\(c\)/)
    expect(post).toMatch(/AgXToneMapping\(c\)/)
    expect(render).toMatch(/renderer\.toneMapping = toneMappingFor\(LOOK\.tone\.mapping\)/)
    expect(render).toMatch(/renderer\.toneMappingExposure = lightingFor\(rig\)\.exposure/)
    // The curve is applied once, in the composite, and the grade comes after it.
    expect(post.indexOf('col = tone(col)')).toBeGreaterThan(post.indexOf('col += texture2D(tBloom, uv).rgb * uBloom'))
    expect(post.indexOf('col = tone(col)')).toBeLessThan(post.indexOf('uSaturation)'))
  })

  it('read the depth of the frame for the occlusion, and multiply it in before the bloom and the focus', () => {
    expect(post).toMatch(/new DepthTexture\(width, height, FloatType\)/)
    const lit = post.indexOf("pass(lit, litRT)")
    expect(lit).toBeGreaterThan(post.indexOf('pass(ao, aoA)'))
    expect(lit).toBeLessThan(post.indexOf('pass(bright, bloomA)'))
    expect(post).toMatch(/tDiffuse: \{ value: litRT\.texture \}/)
  })

  it('light the room in the scene and render its shadow map once per frame', () => {
    expect(render).toMatch(/makeLights\(rig, q\)/)
    expect(render).toMatch(/lights\.fitShadow\(frameBox\(/)
    expect(render).toMatch(/renderer\.shadowMap\.needsUpdate = true/)
    expect(read('components/scene/lighting.ts')).toMatch(/renderer\.shadowMap\.autoUpdate = false/)
    // Every bucket that is a thing is lit and shadowed; what glows, the ink
    // and the halos are unlit and cast nothing.
    const kit = read('components/scene/kit.ts')
    expect(kit).toMatch(/new MeshStandardMaterial\(\{ vertexColors: true, roughness: LOOK\.material\.roughness/)
    expect(kit).toMatch(/m\.castShadow = true[\s\S]{1,12}m\.receiveShadow = true/)
    expect(kit).not.toMatch(/shadowHull|stencil/i)
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
    expect(cache).toMatch(/@\$\{tier\}@look\$\{lookVersion\(\)\}`/)
    expect(read('components/scene/SceneBackdrop.svelte')).toMatch(/have\.tier === tier/)
  })
})
