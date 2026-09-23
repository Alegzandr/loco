/**
 * Mist lies in the low ground at dawn and in the fog, and nowhere else.
 *
 * `post.ts` rebuilds each pixel's world height from the frame's own depth and
 * lays the mist by it (`mistFor`, the composite's `worldAt`). What these pin
 * is when it is there at all: a clear dawn, a cloudy dawn a little, a fog at
 * every hour — never a clear noon, where it would only be haze — and that the
 * finishing passes of `light` never pay for it.
 */
import { describe, it, expect } from 'vitest'
import { lightRig, TIMES } from '../components/scene/sky'
import { mistFor } from '../components/scene/post'
import { LOOK } from '../components/scene/look'
import { QUALITY } from '../components/scene/quality'

describe('the mist', () => {
  it('lies at a clear dawn, thinner at a cloudy one', () => {
    expect(mistFor(lightRig('dawn', 'clear'))).toBe(LOOK.mist.dawn)
    expect(mistFor(lightRig('dawn', 'cloudy'))).toBeLessThan(LOOK.mist.dawn)
    expect(mistFor(lightRig('dawn', 'cloudy'))).toBeGreaterThan(0)
  })

  it('lies in a fog at every hour', () => {
    for (const t of TIMES) expect(mistFor(lightRig(t, 'fog')), t).toBeGreaterThan(0)
  })

  it('is never at day, dusk or night under an ordinary sky, nor in the rain', () => {
    for (const t of ['day', 'dusk', 'night'] as const) for (const w of ['clear', 'cloudy', 'rain', 'storm', 'snow'] as const) expect(mistFor(lightRig(t, w)), `${t} ${w}`).toBe(0)
    expect(mistFor(lightRig('dawn', 'rain'))).toBe(0)
  })

  it('is a finishing pass: high and medium run it, light has none', () => {
    expect(QUALITY.high.post?.mist).toBe(true)
    expect(QUALITY.medium.post?.mist).toBe(true)
    expect(QUALITY.light.post).toBeNull()
  })
})
